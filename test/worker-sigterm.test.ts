import './harness/environment';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';
import config from '../mikro-orm.config';
import { ensureQueues, sqsClient, submitMessage } from '../src/infrastructure/sqs/queues';
import { WalletService } from '../src/application/services';
import { LedgerRow } from '../src/infrastructure/entities/rows';
import { assertBalanceMatchesLedger } from './harness/reconcile';
import {
  createSentinelDir,
  spawnWorker,
  waitForSentinel,
  waitForWorkerEvent,
  waitForExit,
  killAndWait,
} from './harness/workerProcess';
let orm: MikroORM;
const client = sqsClient();
beforeAll(async () => {
  orm = await MikroORM.init(config);
});
afterAll(async () => {
  client.destroy();
  if (orm) await orm.close(true);
});
test('SIGTERM finishes the in-flight message, confirms ACK and exits cleanly within deadline', async () => {
  const playerId = crypto.randomUUID();
  const wallet = await new WalletService(orm.em.fork()).create(playerId, {
    amount: '100.00',
    currency: 'BRL',
  });
  const messageId = crypto.randomUUID(),
    externalTransactionId = crypto.randomUUID();
  const event = {
    messageId,
    type: 'WagerTransactionRequested',
    occurredAt: new Date().toISOString(),
    data: {
      providerId: 'sigterm-test',
      externalTransactionId,
      idempotencyKey: `sigterm:${externalTransactionId}`,
      playerId,
      walletId: wallet.id,
      roundId: 'r',
      gameId: 'g',
      kind: 'BET',
      money: { amount: '40.00', currency: 'BRL' },
    },
  };
  const dir = await createSentinelDir();
  const worker = spawnWorker({
    env: {
      TEST_SYNC_SENTINEL_DIR: dir,
      TEST_SYNC_MESSAGE_ID: messageId,
      TEST_SYNC_PAUSE_AT: 'before-process',
      WORKER_POLL_SECONDS: '1',
    },
  });
  try {
    await submitMessage(client, (await ensureQueues(client)).input, event);
    await waitForSentinel(dir, 'before-process', 30000);
    worker.kill('SIGTERM');
    expect(await waitForExit(worker, 10000)).toBe(0);
    expect((await waitForWorkerEvent(worker, 'sqs_processed', messageId)).status).toBe('PROCESSED');
    expect((await waitForWorkerEvent(worker, 'worker_stopped')).event).toBe('worker_stopped');
  } finally {
    await killAndWait(worker);
  }
  await assertBalanceMatchesLedger(orm.em, wallet.id, '60.00');
  expect(await orm.em.fork().count(LedgerRow, { walletId: wallet.id, direction: 'DEBIT' })).toBe(1);
}, 60000);
