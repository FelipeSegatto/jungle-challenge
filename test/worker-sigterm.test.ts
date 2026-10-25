/**
 * Integração real com processo filho de verdade (`bun src/worker-main.ts`). Separado de
 * `worker-crash-recovery.test.ts` (itens B e C) de propósito: rodando logo depois de B/C no mesmo
 * processo `bun:test`, este teste ficava instável esperando a entrega de uma mensagem SQS que não
 * chegava dentro do prazo — isolado, ele passa de forma limpa e repetida. Mesma convenção que o
 * projeto já usa para outras suítes pesadas de integração (test:integration, test:messaging e
 * test:references também são arquivos/processos `bun test` separados).
 *
 * Cobre o item D: SIGTERM durante processamento.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';
import { ReceiveMessageCommand, type SQSClient } from '@aws-sdk/client-sqs';
import config from '../mikro-orm.config';
import { ensureQueues, sqsClient, submitMessage, type QueueUrls } from '../src/infrastructure/sqs/queues';
import { WalletService } from '../src/application/services';
import { WagerRow, LedgerRow } from '../src/infrastructure/entities/rows';
import { assertBalanceMatchesLedger } from './harness/reconcile';
import { createSentinelDir, removeSentinelDir, spawnWorker, waitForSentinel, pollUntil, killAndWait } from './harness/workerProcess';

let orm: MikroORM;
let client: SQSClient;
let urls: QueueUrls;
const host = process.env.BASE_URL ?? 'http://localhost:3000';

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

function wagerEvent(params: { messageId: string; playerId: string; walletId: string; amount: string }) {
  const externalTransactionId = `bet-${uuid()}`;
  const data = {
    providerId: 'sigterm-test', externalTransactionId, idempotencyKey: `sigterm-test:${externalTransactionId}`,
    playerId: params.playerId, walletId: params.walletId, roundId: 'r-1', gameId: 'g-1',
    kind: 'BET' as const, money: { amount: params.amount, currency: 'BRL' },
  };
  return { messageId: params.messageId, type: 'WagerTransactionRequested' as const, occurredAt: new Date().toISOString(), data };
}

async function messageStillInQueue(targetMessageId: string): Promise<boolean> {
  const received = await client.send(new ReceiveMessageCommand({ QueueUrl: urls.input, MaxNumberOfMessages: 10, WaitTimeSeconds: 1 }));
  return (received.Messages ?? []).some((m) => m.Body && JSON.parse(m.Body).messageId === targetMessageId);
}

describe('D — SIGTERM durante processamento', () => {
  /**
   * ACHADO REAL desta revisão (reproduzido isoladamente, fora deste arquivo, com um script
   * mínimo de ~15 linhas): sob Bun 1.4.4 neste ambiente, `process.once('SIGTERM', handler)` em
   * `worker-main.ts` NUNCA chega a disparar — o processo recebe SIGTERM e termina imediatamente
   * (saída via signalCode, não via fluxo normal do programa), diferente do comportamento
   * documentado do Node.js (onde registrar um listener suprime a terminação automática). Não foi
   * possível reverificar isso dentro de um container Linux real nesta sessão (ambiente Windows) —
   * fica como limitação documentada, não como certeza multiplataforma; recomendo revalidar no
   * ambiente Docker/Linux real antes de tratar como confirmado fora deste ambiente.
   *
   * Por isso este teste verifica os DOIS desfechos que o requisito aceita ("conclui o trabalho OU
   * permite reentrega segura") em vez de assumir qual vai acontecer, documenta qual foi
   * observado, e prova que, em qualquer um dos dois casos, não há perda nem duplicação do efeito
   * financeiro — a mesma garantia de fundo do item B (worker-crash-recovery.test.ts), agora
   * disparada por SIGTERM em vez de SIGKILL.
   */
  test('SIGTERM enquanto uma mensagem está em processamento: sem perda nem duplicação do efeito financeiro, em qualquer um dos desfechos aceitos', async () => {
    const playerId = uuid();
    const wallet = await new WalletService(orm.em.fork()).create(playerId, { amount: '100.00', currency: 'BRL' });
    const messageId = uuid();
    const event = wagerEvent({ messageId, playerId, walletId: wallet.id, amount: '40.00' });

    const sentinelDir = await createSentinelDir();
    const worker = spawnWorker({
      env: {
        TEST_SYNC_SENTINEL_DIR: sentinelDir, WORKER_POLL_SECONDS: '1', TEST_SYNC_PAUSE_AT: 'before-process',
        TEST_SYNC_MESSAGE_ID: messageId,
        WORKER_VISIBILITY_TIMEOUT_SECONDS: '3', // visibilidade curta, para o cenário de não-conclusão poder provar a reentrega sem esperar o padrão de 60s.
      },
    });
    const sigtermSentAt = { value: 0 };
    try {
      await submitMessage(client, urls.input, event);
      // Pega o worker genuinamente NO MEIO do processamento: sentinela escrito logo após o parse da
      // mensagem, antes de qualquer commit — é exatamente a janela que o requisito pede.
      await waitForSentinel(sentinelDir, 'before-process', 30000);
      sigtermSentAt.value = Date.now();
      worker.kill('SIGTERM');
      await worker.exited;
    } finally {
      await removeSentinelDir(sentinelDir);
    }
    const shutdownMs = Date.now() - sigtermSentAt.value;
    // Prazo de encerramento: o processo precisa realmente terminar, não ficar pendurado para sempre
    // (vale tanto para um shutdown gracioso quanto para a terminação imediata observada).
    expect(shutdownMs).toBeLessThan(30000);

    const wagerRow = await orm.em.fork().findOne(WagerRow, { idempotencyKey: event.data.idempotencyKey });
    const completedDuringSigterm = wagerRow?.status === 'PROCESSED';
    console.log(JSON.stringify({ event: 'test_observation', scenario: 'D-sigterm', completedDuringSigterm, shutdownMs }));

    if (!completedDuringSigterm) {
      // Desfecho observado: terminação imediata, operação NÃO concluída (não foi commitada, logo
      // não poderia ter sido acked). A prova real de "permite reentrega segura" vem a seguir: um
      // worker novo recebe a mesma mensagem depois que a visibilidade expira e a processa.
      const debitsBeforeRedelivery = await orm.em.fork().find(LedgerRow, { walletId: wallet.id, direction: 'DEBIT' });
      expect(debitsBeforeRedelivery).toHaveLength(0);

      const sentinelDir2 = await createSentinelDir();
      const worker2 = spawnWorker({ env: { TEST_SYNC_SENTINEL_DIR: sentinelDir2, WORKER_POLL_SECONDS: '1', TEST_SYNC_MESSAGE_ID: messageId } });
      try {
        const recovered = await pollUntil(async () => {
          const row = await orm.em.fork().findOne(WagerRow, { idempotencyKey: event.data.idempotencyKey });
          return row?.status === 'PROCESSED';
        }, 30000, 300);
        expect(recovered).toBe(true);
      } finally {
        await killAndWait(worker2, 'SIGKILL');
        await removeSentinelDir(sentinelDir2);
      }
    }

    // Em qualquer um dos dois caminhos: exatamente um efeito financeiro, nunca zero, nunca dois.
    await assertBalanceMatchesLedger(orm.em, wallet.id, '60.00');
    const debits = await orm.em.fork().find(LedgerRow, { walletId: wallet.id, direction: 'DEBIT' });
    expect(debits).toHaveLength(1);
    expect(await messageStillInQueue(messageId)).toBe(false);

    const recon = await fetch(`${host}/wallets/${wallet.id}/reconciliation`, { method: 'POST' }).then((r) => r.json());
    expect(recon.consistent).toBe(true);
  }, 120000);
});
