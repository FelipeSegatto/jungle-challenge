import { deadLetterDepth } from '../src/infrastructure/metrics';
import './harness/environment';
/**
 * Integração real, separada de `consumer-retry-dlq.test.ts` de propósito: este é o cenário mais
 * pesado (esgota as 5 tentativas reais da fila com backoff exponencial real, ~60s+ só de espera) e,
 * rodando no mesmo processo `bun:test` que os outros cenários de E, deixava o teste seguinte
 * instável esperando a entrega da própria mensagem a tempo — mesma causa raiz já isolada em
 * `worker-sigterm.test.ts`. Isolado aqui, roda de forma limpa e repetida.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';
import { ReceiveMessageCommand, type SQSClient } from '@aws-sdk/client-sqs';
import config from '../mikro-orm.config';
import {
  ensureQueues,
  sqsClient,
  submitMessage,
  updateDlqMetrics,
  type QueueUrls,
} from '../src/infrastructure/sqs/queues';
import { WalletService } from '../src/application/services';
import { WagerRow } from '../src/infrastructure/entities/rows';
import { assertBalanceMatchesLedger } from './harness/reconcile';
import {
  spawnWorker,
  pollUntil,
  killAndWait,
  createSentinelDir,
  waitForSentinel,
} from './harness/workerProcess';

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

async function messageInQueue(queueUrl: string, targetMessageId: string): Promise<boolean> {
  const received = await client.send(
    new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 1,
      VisibilityTimeout: 1,
    }),
  );
  return (received.Messages ?? []).some(
    (m) => m.Body && isJson(m.Body) && JSON.parse(m.Body).messageId === targetMessageId,
  );
}
function isJson(value: string): boolean {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

describe('E — falha persistente do consumidor (SQS real)', () => {
  test('falha persistente: esgota o limite real de tentativas da fila e chega na DLQ real', async () => {
    const playerId = uuid();
    const wallet = await new WalletService(orm.em.fork()).create(playerId, {
      amount: '100.00',
      currency: 'BRL',
    });
    const messageId = uuid();
    const externalTransactionId = `bet-${uuid()}`;
    const event = {
      messageId,
      type: 'WagerTransactionRequested' as const,
      occurredAt: new Date().toISOString(),
      data: {
        providerId: 'retry-dlq-test',
        externalTransactionId,
        idempotencyKey: `retry-dlq-test:${externalTransactionId}`,
        playerId,
        walletId: wallet.id,
        roundId: 'r-1',
        gameId: 'g-1',
        kind: 'BET' as const,
        money: { amount: '10.00', currency: 'BRL' },
      },
    };

    const sentinelDir = await createSentinelDir();
    const worker = spawnWorker({
      env: {
        TEST_SYNC_SENTINEL_DIR: sentinelDir,
        TEST_SYNC_MESSAGE_ID: messageId,
        WORKER_POLL_SECONDS: '1',
        TEST_FAULT_INJECT_MESSAGE_ID: messageId,
        TEST_FAULT_INJECT_MODE: 'always',
      },
    });
    try {
      await submitMessage(client, urls.input, event);
      // maxReceiveCount: 5 (queues.ts) — com backoff exponencial real entre tentativas, pode levar
      // dezenas de segundos até a RedrivePolicy da própria SQS mover a mensagem para a DLQ.
      const reachedDlq = await pollUntil(
        async () => messageInQueue(urls.dlq, messageId),
        150000,
        1000,
      );
      expect(reachedDlq).toBe(true);
      await updateDlqMetrics(client, urls);
      expect((await deadLetterDepth.get()).values[0].value).toBeGreaterThanOrEqual(1);
      let previous: { receivedAt: number; count: number } | undefined;
      for (let attempt = 1; attempt <= 5; attempt++) {
        const file = await waitForSentinel(sentinelDir, `receive-${attempt}`, 5000);
        const observed = await Bun.file(`${sentinelDir}/${file}`).json();
        expect(observed.count).toBe(attempt);
        if (previous)
          expect(observed.receivedAt - previous.receivedAt).toBeGreaterThanOrEqual(
            1000 * 2 ** previous.count - 200,
          );
        previous = observed;
      }
    } finally {
      await killAndWait(worker, 'SIGKILL');
    }

    // Nenhum efeito financeiro indevido: a operação nunca foi processada de verdade.
    const row = await orm.em
      .fork()
      .findOne(WagerRow, { idempotencyKey: event.data.idempotencyKey });
    expect(row).toBeNull();
    await assertBalanceMatchesLedger(orm.em, wallet.id, '100.00');
  }, 180000);
});
