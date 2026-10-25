/**
 * Integração real com processos de verdade. Requer PostgreSQL, LocalStack e `bun` no PATH (os
 * testes spawnam `bun src/worker-main.ts` como processo filho de verdade — nunca chamam
 * `consumeOnce`/`WagerService.process` diretamente para simular o worker).
 *
 * Cobre os itens B e C do pedido de cobertura: morte real do worker após commit e antes do ACK
 * (B), e recuperação após reinício com outbox pendente e idempotência sobrevivendo (C). O item D
 * (SIGTERM) está em `worker-sigterm.test.ts`, em arquivo/processo `bun test` separado — rodando
 * logo depois de B/C no mesmo processo ele ficava instável esperando uma entrega de mensagem SQS
 * que não chegava a tempo; isolado, passa de forma limpa e repetida.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';
import { PurgeQueueCommand, ReceiveMessageCommand, type SQSClient } from '@aws-sdk/client-sqs';
import config from '../mikro-orm.config';
import { ensureQueues, sqsClient, submitMessage, type QueueUrls } from '../src/infrastructure/sqs/queues';
import { WalletService } from '../src/application/services';
import { LedgerRow, InboxRow, OutboxRow } from '../src/infrastructure/entities/rows';
import { assertBalanceMatchesLedger } from './harness/reconcile';
import { createSentinelDir, removeSentinelDir, spawnWorker, waitForSentinel, pollUntil, killAndWait } from './harness/workerProcess';

let orm: MikroORM;
let client: SQSClient;
let urls: QueueUrls;
const host = process.env.BASE_URL ?? 'http://localhost:3000';

/**
 * Fila exclusiva de testes (LocalStack local, nunca compartilhada) — purgar aqui só remove lixo
 * órfão de execuções anteriores deste mesmo arquivo de teste, nunca uma fila de produção.
 */
async function purgeInputQueue(): Promise<void> {
  await client.send(new PurgeQueueCommand({ QueueUrl: urls.input })).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 500));
}

beforeAll(async () => {
  orm = await MikroORM.init(config);
  client = sqsClient();
  urls = await ensureQueues(client);
  await purgeInputQueue();
});
afterAll(async () => {
  client?.destroy();
  if (orm) await orm.close(true);
});

const uuid = () => crypto.randomUUID();

function wagerEvent(params: { messageId: string; playerId: string; walletId: string; amount: string; externalTransactionId?: string }) {
  const externalTransactionId = params.externalTransactionId ?? `bet-${uuid()}`;
  const data = {
    providerId: 'crash-test', externalTransactionId, idempotencyKey: `crash-test:${externalTransactionId}`,
    playerId: params.playerId, walletId: params.walletId, roundId: 'r-1', gameId: 'g-1',
    kind: 'BET' as const, money: { amount: params.amount, currency: 'BRL' },
  };
  return { messageId: params.messageId, type: 'WagerTransactionRequested' as const, occurredAt: new Date().toISOString(), data };
}

/** Confirma, direto na fila real, se uma mensagem com este messageId ainda está presente/visível. */
async function messageStillInQueue(targetMessageId: string): Promise<boolean> {
  const received = await client.send(new ReceiveMessageCommand({ QueueUrl: urls.input, MaxNumberOfMessages: 10, WaitTimeSeconds: 1 }));
  return (received.Messages ?? []).some((m) => m.Body && JSON.parse(m.Body).messageId === targetMessageId);
}

describe('B — worker morto após commit, antes do ACK (processo real)', () => {
  test('commit sobrevive ao kill -9; reentrega real reprocessa de forma idempotente, sem duplicar o débito', async () => {
    const playerId = uuid();
    const wallet = await new WalletService(orm.em.fork()).create(playerId, { amount: '100.00', currency: 'BRL' });
    const messageId = uuid();
    const event = wagerEvent({ messageId, playerId, walletId: wallet.id, amount: '30.00' });

    const sentinelDir1 = await createSentinelDir();
    const worker1 = spawnWorker({
      env: {
        TEST_SYNC_SENTINEL_DIR: sentinelDir1, WORKER_POLL_SECONDS: '1', WORKER_VISIBILITY_TIMEOUT_SECONDS: '3',
        // Filtra pelo messageId desta execução — a fila real pode ter mensagens órfãs de execuções
        // anteriores, e sem esse filtro o worker processando QUALQUER mensagem já dispararia o sentinela.
        TEST_SYNC_MESSAGE_ID: messageId,
        // Pausa curta DEPOIS do commit real — dá ao teste uma janela confiável para matar o
        // processo exatamente ali, em vez de torcer para vencer uma corrida de poucos milissegundos
        // contra o próprio DeleteMessageCommand que viria em seguida.
        TEST_SYNC_PAUSE_AT: 'after-commit-before-ack',
      },
    });
    try {
      await submitMessage(client, urls.input, event);
      // Ponto de sincronização real: o worker só escreve este sentinela DEPOIS que WagerService.process()
      // retornou — ou seja, depois que a transação SQL (saldo + ledger + inbox) já comitou.
      await waitForSentinel(sentinelDir1, 'after-commit-before-ack', 30000);
      await killAndWait(worker1, 'SIGKILL');
    } finally {
      await removeSentinelDir(sentinelDir1);
    }

    // Commit real confirmado mesmo sem ACK: saldo debitado, 1 lançamento, inbox marcada processada.
    await assertBalanceMatchesLedger(orm.em, wallet.id, '70.00');
    const inboxRow = await orm.em.fork().findOneOrFail(InboxRow, { consumerName: 'wager-sqs-v1', messageId });
    expect(inboxRow.processedAt).not.toBeNull();
    const debits = await orm.em.fork().find(LedgerRow, { walletId: wallet.id, direction: 'DEBIT' });
    expect(debits).toHaveLength(1);

    // Nota: não checamos "a mensagem ainda está na fila" aqui — logo após o kill ela está apenas
    // invisível (dentro do próprio VisibilityTimeout da recepção original), o que pareceria igual a
    // "foi confirmada" nesse instante exato. A prova real de que NUNCA foi confirmada vem a seguir:
    // um worker novo consegue recebê-la e reprocessá-la depois que a visibilidade expira.

    // Reinicia um worker LIMPO (processo novo) e espera a reentrega real do SQS ser reprocessada.
    const sentinelDir2 = await createSentinelDir();
    const worker2 = spawnWorker({
      env: { TEST_SYNC_SENTINEL_DIR: sentinelDir2, WORKER_POLL_SECONDS: '1', TEST_SYNC_MESSAGE_ID: messageId },
    });
    try {
      await waitForSentinel(sentinelDir2, 'after-commit-before-ack', 30000);
      const ackedNow = await pollUntil(async () => !(await messageStillInQueue(messageId)), 20000, 300);
      expect(ackedNow).toBe(true);
    } finally {
      await killAndWait(worker2, 'SIGTERM');
      await removeSentinelDir(sentinelDir2);
    }

    // Efeito financeiro único mesmo após a reentrega+reprocessamento real: nenhum segundo débito.
    await assertBalanceMatchesLedger(orm.em, wallet.id, '70.00');
    const finalDebits = await orm.em.fork().find(LedgerRow, { walletId: wallet.id, direction: 'DEBIT' });
    expect(finalDebits).toHaveLength(1);

    const recon = await fetch(`${host}/wallets/${wallet.id}/reconciliation`, { method: 'POST' }).then((r) => r.json());
    expect(recon.consistent).toBe(true);
    expect(recon.storedBalance.amount).toBe('70.00');
  }, 120000);
});

describe('C — recuperação após reinício (outbox pendente + idempotência sobrevive)', () => {
  test('outbox pendente antes do reinício é publicada depois; replay de uma operação anterior ainda é idempotente', async () => {
    const playerId = uuid();
    const wallet = await new WalletService(orm.em.fork()).create(playerId, { amount: '50.00', currency: 'BRL' });
    const messageId = uuid();
    const event = wagerEvent({ messageId, playerId, walletId: wallet.id, amount: '15.00' });
    // `data.idempotencyKey` existe só para o envelope SQS — o endpoint HTTP usa o header, e rejeita
    // (ValidationPipe forbidNonWhitelisted) qualquer campo extra no corpo que o DTO não declare.
    const { idempotencyKey: _unused, ...httpBody } = event.data;

    // Publica via HTTP (processo da API, já rodando) para gerar outbox pendente real sem nenhum worker no ar ainda.
    const httpResponse = await fetch(`${host}/wagering/transactions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': event.data.idempotencyKey },
      body: JSON.stringify(httpBody),
    }).then((r) => r.json());
    expect(httpResponse.status).toBe('PROCESSED');

    const pendingBefore = await orm.em.fork().count(OutboxRow, { aggregateId: wallet.id, publishedAt: null });
    expect(pendingBefore).toBeGreaterThanOrEqual(1);

    // "Reinício do serviço": sobe um worker real do zero — ele não tinha nenhum estado em memória sobre esta wallet.
    const sentinelDir = await createSentinelDir();
    const worker = spawnWorker({ env: { TEST_SYNC_SENTINEL_DIR: sentinelDir, WORKER_POLL_SECONDS: '1' } });
    try {
      const published = await pollUntil(async () => {
        const pending = await orm.em.fork().count(OutboxRow, { aggregateId: wallet.id, publishedAt: null });
        return pending === 0;
      }, 30000, 300);
      expect(published).toBe(true);

      // Reenvia a MESMA operação (mesma Idempotency-Key) depois que o worker já reiniciou — precisa
      // continuar sendo replay, não um novo efeito, provando que a idempotência é do Postgres, não de memória de processo.
      const replay = await fetch(`${host}/wagering/transactions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': event.data.idempotencyKey },
        body: JSON.stringify(httpBody),
      }).then((r) => r.json());
      expect(replay.idempotentReplay).toBe(true);
      expect(replay.transactionId).toBe(httpResponse.transactionId);
    } finally {
      await killAndWait(worker, 'SIGTERM');
      await removeSentinelDir(sentinelDir);
    }

    // Consistência final: saldo == ledger reconstruído, e nenhum segundo débito do replay pós-reinício.
    await assertBalanceMatchesLedger(orm.em, wallet.id, '35.00');
    const debits = await orm.em.fork().find(LedgerRow, { walletId: wallet.id, direction: 'DEBIT' });
    expect(debits).toHaveLength(1);
    const inboxRows = await orm.em.fork().find(InboxRow, { messageId });
    // Esta operação específica entrou via HTTP, não via SQS — não deve ter criado uma linha de inbox
    // para este messageId (inbox é só para o caminho de mensageria); confirmamos que não há 2 linhas por engano.
    expect(inboxRows.length).toBeLessThanOrEqual(1);
  }, 120000);
});

