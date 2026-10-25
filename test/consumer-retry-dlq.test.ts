/**
 * Integração real: PostgreSQL + LocalStack reais, worker real como processo filho. Cobre o item E
 * (retry/backoff do CONSUMER e chegada à DLQ) — distinto do teste de retry já existente em
 * `test/messaging.test.ts`, que cobre só o publisher da OUTBOX, não o consumidor de
 * `wager-transactions.fifo`.
 *
 * A origem do PRIMEIRO erro nos cenários de falha transitória/persistente é determinística (hook
 * `TEST_FAULT_INJECT_MESSAGE_ID`/`MODE` de `src/infrastructure/workers/consumer.ts`, inerte em
 * produção — ver comentário lá) em vez de tentar cronometrar uma corrida real de lock no Postgres,
 * que seria inerentemente instável. A partir daí, toda a mecânica testada é 100% real: SQS de
 * verdade, `ChangeMessageVisibility` de verdade, backoff real, e a RedrivePolicy real da fila
 * (`maxReceiveCount: 5`, configurada em `src/infrastructure/sqs/queues.ts`) é o que efetivamente
 * move a mensagem para a DLQ — nada nisso é simulado em código de teste.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';
import { ReceiveMessageCommand, SendMessageCommand, type SQSClient } from '@aws-sdk/client-sqs';
import config from '../mikro-orm.config';
import { ensureQueues, sqsClient, submitMessage, type QueueUrls } from '../src/infrastructure/sqs/queues';
import { WalletService } from '../src/application/services';
import { WagerRow, LedgerRow } from '../src/infrastructure/entities/rows';
import { assertBalanceMatchesLedger } from './harness/reconcile';
import { createSentinelDir, removeSentinelDir, spawnWorker, pollUntil, killAndWait } from './harness/workerProcess';

let orm: MikroORM;
let client: SQSClient;
let urls: QueueUrls;

beforeAll(async () => {
  orm = await MikroORM.init(config);
  client = sqsClient();
  urls = await ensureQueues(client);
});
afterAll(async () => {
  client?.destroy();
  if (orm) await orm.close(true);
});

const uuid = () => crypto.randomUUID();

function wagerEvent(params: { messageId: string; playerId: string; walletId: string; kind: 'BET'; amount: string }) {
  const externalTransactionId = `bet-${uuid()}`;
  const data = {
    providerId: 'retry-dlq-test', externalTransactionId, idempotencyKey: `retry-dlq-test:${externalTransactionId}`,
    playerId: params.playerId, walletId: params.walletId, roundId: 'r-1', gameId: 'g-1',
    kind: params.kind, money: { amount: params.amount, currency: 'BRL' },
  };
  return { messageId: params.messageId, type: 'WagerTransactionRequested' as const, occurredAt: new Date().toISOString(), data };
}

async function messageInQueue(queueUrl: string, targetMessageId: string): Promise<boolean> {
  const received = await client.send(new ReceiveMessageCommand({ QueueUrl: queueUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: 1, VisibilityTimeout: 1 }));
  return (received.Messages ?? []).some((m) => m.Body && isJson(m.Body) && JSON.parse(m.Body).messageId === targetMessageId);
}
function isJson(value: string): boolean {
  try { JSON.parse(value); return true; } catch { return false; }
}

describe('E — retry/backoff do consumidor e chegada à DLQ (SQS real)', () => {
  // Esta roda PRIMEIRO de propósito: é leve e rápida — rodando depois dos cenários de falha
  // persistente (que esgotam 5 tentativas reais com backoff) e injeção de falha, ficava instável
  // esperando a entrega da sua própria mensagem a tempo (mesma causa já isolada nos testes de
  // worker-sigterm.test.ts: resíduo de processos/estado entre cenários pesados no mesmo arquivo).
  test('rejeição normal de negócio (saldo insuficiente) é registrada e confirmada — nunca vai para a DLQ', async () => {
    const playerId = uuid();
    const wallet = await new WalletService(orm.em.fork()).create(playerId, { amount: '5.00', currency: 'BRL' });
    const messageId = uuid();
    const event = wagerEvent({ messageId, playerId, walletId: wallet.id, kind: 'BET', amount: '999.00' });

    const sentinelDir = await createSentinelDir();
    const worker = spawnWorker({ env: { TEST_SYNC_SENTINEL_DIR: sentinelDir, WORKER_POLL_SECONDS: '1' } });
    try {
      await submitMessage(client, urls.input, event);
      const settled = await pollUntil(async () => {
        const row = await orm.em.fork().findOne(WagerRow, { idempotencyKey: event.data.idempotencyKey });
        return row?.status === 'REJECTED';
      }, 20000, 300);
      expect(settled).toBe(true);
    } finally {
      await killAndWait(worker, 'SIGTERM');
      await removeSentinelDir(sentinelDir);
    }

    const row = await orm.em.fork().findOneOrFail(WagerRow, { idempotencyKey: event.data.idempotencyKey });
    expect(row.failureCode).toBe('INSUFFICIENT_BALANCE');
    // Confirmada (ack) normalmente pelo consumer — nunca chega na fila real de DLQ.
    expect(await messageInQueue(urls.input, messageId)).toBe(false);
    expect(await messageInQueue(urls.dlq, messageId)).toBe(false);
    // Rejeição de negócio não move saldo nem gera lançamento (seção 7 do desafio).
    await assertBalanceMatchesLedger(orm.em, wallet.id, '5.00');
  }, 60000);

  test('falha transitória controlada: retry com backoff real, depois recupera e processa normalmente', async () => {
    const playerId = uuid();
    const wallet = await new WalletService(orm.em.fork()).create(playerId, { amount: '100.00', currency: 'BRL' });
    const messageId = uuid();
    const event = wagerEvent({ messageId, playerId, walletId: wallet.id, kind: 'BET', amount: '10.00' });

    const sentinelDir = await createSentinelDir();
    const worker = spawnWorker({
      env: {
        TEST_SYNC_SENTINEL_DIR: sentinelDir, WORKER_POLL_SECONDS: '1',
        TEST_FAULT_INJECT_MESSAGE_ID: messageId, TEST_FAULT_INJECT_MODE: 'once',
      },
    });
    try {
      await submitMessage(client, urls.input, event);
      // A 1ª tentativa falha de propósito (injeção); o worker classifica como transitório e reagenda
      // via ChangeMessageVisibility real — depois disso, a MESMA mensagem é entregue de novo e,
      // dessa vez, processada de verdade (o hook só falha uma vez, modo 'once').
      const recovered = await pollUntil(async () => {
        const row = await orm.em.fork().findOne(WagerRow, { idempotencyKey: event.data.idempotencyKey });
        return row?.status === 'PROCESSED';
      }, 60000, 500);
      expect(recovered).toBe(true);
    } finally {
      await killAndWait(worker, 'SIGTERM');
      await removeSentinelDir(sentinelDir);
    }

    await assertBalanceMatchesLedger(orm.em, wallet.id, '90.00');
    const debits = await orm.em.fork().find(LedgerRow, { walletId: wallet.id, direction: 'DEBIT' });
    expect(debits).toHaveLength(1); // a tentativa que falhou não deixou nenhum efeito financeiro parcial.
    expect(await messageInQueue(urls.input, messageId)).toBe(false);
    // Checa especificamente que ESTA mensagem não foi parar na DLQ — não que a DLQ está vazia no
    // geral (ela pode legitimamente ter resíduo de outros cenários/execuções anteriores).
    expect(await messageInQueue(urls.dlq, messageId)).toBe(false);
  }, 90000);

  // O cenário de falha PERSISTENTE (esgota as 5 tentativas reais até a DLQ) está em
  // `consumer-dlq-persistent.test.ts`, em arquivo separado — é o mais pesado (~60s+ de backoff
  // real) e, rodando aqui junto dos outros, deixava o teste seguinte instável.

  test('mensagem permanentemente inválida (JSON quebrado) vai direto para a DLQ, sem consumir o orçamento de retries', async () => {
    const sentinelDir = await createSentinelDir();
    const worker = spawnWorker({ env: { TEST_SYNC_SENTINEL_DIR: sentinelDir, WORKER_POLL_SECONDS: '1' } });
    const malformedId = `malformed-${uuid()}`; // usado só como correlação manual nos logs; não é lido pelo parser.
    try {
      await client.send(new SendMessageCommand({
        QueueUrl: urls.input, MessageBody: `{"not valid json ${malformedId}`,
        MessageGroupId: 'malformed-group', MessageDeduplicationId: malformedId,
      }));
      const reachedDlq = await pollUntil(async () => {
        const received = await client.send(new ReceiveMessageCommand({ QueueUrl: urls.dlq, MaxNumberOfMessages: 10, WaitTimeSeconds: 1, VisibilityTimeout: 1 }));
        return (received.Messages ?? []).some((m) => m.Body?.includes(malformedId));
      }, 20000, 300);
      expect(reachedDlq).toBe(true); // rápido — vai direto, sem esperar 5 tentativas.
    } finally {
      await killAndWait(worker, 'SIGTERM');
      await removeSentinelDir(sentinelDir);
    }
  }, 60000);
});
