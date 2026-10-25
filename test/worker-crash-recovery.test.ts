import './harness/environment';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';
import { DeleteMessageCommand, ReceiveMessageCommand, type SQSClient } from '@aws-sdk/client-sqs';
import config from '../mikro-orm.config';
import {
  ensureQueues,
  sqsClient,
  submitMessage,
  type QueueUrls,
} from '../src/infrastructure/sqs/queues';
import { WalletService } from '../src/application/services';
import { LedgerRow, InboxRow, OutboxRow } from '../src/infrastructure/entities/rows';
import { assertBalanceMatchesLedger } from './harness/reconcile';
import {
  createSentinelDir,
  spawnWorker,
  waitForSentinel,
  pollUntil,
  killAndWait,
  waitForWorkerEvent,
  spawnApi,
} from './harness/workerProcess';
let orm: MikroORM, client: SQSClient, urls: QueueUrls;
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
function wagerEvent(playerId: string, walletId: string, amount: string) {
  const externalTransactionId = `bet-${uuid()}`;
  return {
    messageId: uuid(),
    type: 'WagerTransactionRequested' as const,
    occurredAt: new Date().toISOString(),
    data: {
      providerId: 'crash-test',
      externalTransactionId,
      idempotencyKey: `crash-test:${externalTransactionId}`,
      playerId,
      walletId,
      roundId: 'r-1',
      gameId: 'g-1',
      kind: 'BET' as const,
      money: { amount, currency: 'BRL' },
    },
  };
}
describe('real process recovery', () => {
  test('SIGKILL after commit, actual redelivery and confirmed DeleteMessage', async () => {
    const playerId = uuid();
    const wallet = await new WalletService(orm.em.fork()).create(playerId, {
      amount: '100.00',
      currency: 'BRL',
    });
    const event = wagerEvent(playerId, wallet.id, '30.00');
    const dir = await createSentinelDir();
    const first = spawnWorker({
      env: {
        TEST_SYNC_SENTINEL_DIR: dir,
        TEST_SYNC_MESSAGE_ID: event.messageId,
        TEST_SYNC_PAUSE_AT: 'after-commit-before-ack',
        WORKER_POLL_SECONDS: '1',
        WORKER_VISIBILITY_TIMEOUT_SECONDS: '3',
      },
    });
    try {
      await submitMessage(client, urls.input, event);
      await waitForSentinel(dir, 'after-commit-before-ack', 30000);
    } finally {
      await killAndWait(first);
    }
    await assertBalanceMatchesLedger(orm.em, wallet.id, '70.00');
    expect(
      (await orm.em.fork().findOneOrFail(InboxRow, { messageId: event.messageId })).processedAt,
    ).not.toBeNull();
    const dir2 = await createSentinelDir();
    const second = spawnWorker({
      env: {
        TEST_SYNC_SENTINEL_DIR: dir2,
        TEST_SYNC_MESSAGE_ID: event.messageId,
        WORKER_POLL_SECONDS: '1',
      },
    });
    try {
      const receiveFile = await waitForSentinel(dir2, 'receive-2', 30000);
      expect((await Bun.file(`${dir2}/${receiveFile}`).json()).count).toBe(2);
      const ack = await waitForWorkerEvent(second, 'sqs_processed', event.messageId);
      expect(ack.status).toBe('PROCESSED');
      expect(ack.messageId).toBe(event.messageId);
    } finally {
      await killAndWait(second, 'SIGTERM');
    }
    await assertBalanceMatchesLedger(orm.em, wallet.id, '70.00');
    expect(await orm.em.fork().count(LedgerRow, { walletId: wallet.id, direction: 'DEBIT' })).toBe(
      1,
    );
    expect(await orm.em.fork().count(InboxRow, { messageId: event.messageId })).toBe(1);
  }, 90000);

  test('API actually restarts, replay survives, and pending outbox envelopes reach SQS', async () => {
    const playerId = uuid();
    const wallet = await new WalletService(orm.em.fork()).create(playerId, {
      amount: '50.00',
      currency: 'BRL',
    });
    const event = wagerEvent(playerId, wallet.id, '15.00');
    const { idempotencyKey, ...body } = event.data;
    const submit = async (base: string) => {
      const response = await fetch(`${base}/wagering/transactions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(200);
      return response.json() as Promise<{
        transactionId: string;
        idempotentReplay: boolean;
        balance: { amount: string };
      }>;
    };
    const firstApi = await spawnApi();
    let original: Awaited<ReturnType<typeof submit>>;
    try {
      original = await submit(firstApi.base);
    } finally {
      await killAndWait(firstApi.process);
    }
    const pending = await orm.em
      .fork()
      .find(OutboxRow, { aggregateId: wallet.id, publishedAt: null });
    expect(pending.length).toBeGreaterThanOrEqual(2);
    const secondApi = await spawnApi();
    try {
      expect(secondApi.process.pid).not.toBe(firstApi.process.pid);
      const replay = await submit(secondApi.base);
      expect(replay.idempotentReplay).toBe(true);
      expect(replay.transactionId).toBe(original!.transactionId);
      expect(replay.balance).toEqual(original!.balance);
    } finally {
      await killAndWait(secondApi.process, 'SIGTERM');
    }
    const worker = spawnWorker({ env: { WORKER_POLL_SECONDS: '1' } });
    try {
      const receivedIds = new Set<string>();
      const delivered = await pollUntil(async () => {
        const received = await client.send(
          new ReceiveMessageCommand({
            QueueUrl: urls.events,
            MaxNumberOfMessages: 10,
            WaitTimeSeconds: 1,
            VisibilityTimeout: 1,
          }),
        );
        for (const message of received.Messages ?? []) {
          if (!message.Body) continue;
          const envelope = JSON.parse(message.Body);
          const expected = pending.find((row) => row.id === envelope.eventId);
          if (expected) {
            expect(envelope).toEqual(expected.payload);
            receivedIds.add(envelope.eventId);
          }
          if (message.ReceiptHandle)
            await client.send(
              new DeleteMessageCommand({
                QueueUrl: urls.events,
                ReceiptHandle: message.ReceiptHandle,
              }),
            );
        }
        return pending.every((row) => receivedIds.has(row.id));
      }, 30000);
      expect(delivered).toBe(true);
      expect(
        await pollUntil(
          async () =>
            (await orm.em
              .fork()
              .count(OutboxRow, { aggregateId: wallet.id, publishedAt: null })) === 0,
          10000,
        ),
      ).toBe(true);
    } finally {
      await killAndWait(worker, 'SIGTERM');
    }
    await assertBalanceMatchesLedger(orm.em, wallet.id, '35.00');
    expect(await orm.em.fork().count(LedgerRow, { walletId: wallet.id, direction: 'DEBIT' })).toBe(
      1,
    );
    expect(await orm.em.fork().count(InboxRow, { messageId: event.messageId })).toBe(0);
  }, 90000);
});
