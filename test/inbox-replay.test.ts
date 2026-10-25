import './harness/environment';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';
import config from '../mikro-orm.config';
import { WalletService, WagerService } from '../src/application/services';
import { InboxRow, LedgerRow, OutboxRow } from '../src/infrastructure/entities/rows';
import { assertBalanceMatchesLedger } from './harness/reconcile';
let orm: MikroORM;
beforeAll(async () => {
  orm = await MikroORM.init(config);
});
afterAll(async () => {
  if (orm) await orm.close(true);
});
async function scenario() {
  const playerId = crypto.randomUUID();
  const wallet = await new WalletService(orm.em.fork()).create(playerId, {
    amount: '100.00',
    currency: 'BRL',
  });
  const command = {
    providerId: 'inbox-regression',
    externalTransactionId: crypto.randomUUID(),
    playerId,
    walletId: wallet.id,
    roundId: 'r',
    gameId: 'g',
    kind: 'BET' as const,
    money: { amount: '10.00', currency: 'BRL' },
  };
  const key = crypto.randomUUID();
  const result = await new WagerService(orm.em.fork()).process(command, key);
  const inbox = {
    consumerName: 'wager-sqs-v1',
    messageId: crypto.randomUUID(),
    payloadHash: 'a'.repeat(64),
  };
  return { wallet, command, key, result, inbox };
}
test('HTTP then concurrent SQS replays record inbox once without extra ledger or outbox', async () => {
  const { wallet, command, key, result, inbox } = await scenario();
  const outboxCount = await orm.em.fork().count(OutboxRow, { aggregateId: wallet.id });
  const responses = await Promise.all(
    Array.from({ length: 10 }, () => new WagerService(orm.em.fork()).process(command, key, inbox)),
  );
  expect(
    responses.every(
      (response) => response.idempotentReplay && response.transactionId === result.transactionId,
    ),
  ).toBe(true);
  const rows = await orm.em.fork().find(InboxRow, { messageId: inbox.messageId });
  expect(rows).toHaveLength(1);
  expect(rows[0].processedAt).not.toBeNull();
  expect(await orm.em.fork().count(OutboxRow, { aggregateId: wallet.id })).toBe(outboxCount);
  expect(await orm.em.fork().count(LedgerRow, { walletId: wallet.id, direction: 'DEBIT' })).toBe(1);
  await assertBalanceMatchesLedger(orm.em, wallet.id, '90.00');
});
test('same message with altered envelope conflicts even when financial key would replay', async () => {
  const { wallet, command, key, inbox } = await scenario();
  await new WagerService(orm.em.fork()).process(command, key, inbox);
  await expect(
    new WagerService(orm.em.fork()).process(command, key, {
      ...inbox,
      payloadHash: 'b'.repeat(64),
    }),
  ).rejects.toMatchObject({ code: 'INBOX_PAYLOAD_CONFLICT' });
  expect(
    (await orm.em.fork().findOneOrFail(InboxRow, { messageId: inbox.messageId })).payloadHash,
  ).toBe(inbox.payloadHash);
  await assertBalanceMatchesLedger(orm.em, wallet.id, '90.00');
});
test('concurrent envelopes with different hashes have only one winner', async () => {
  const { wallet, command, key, inbox } = await scenario();
  const results = await Promise.allSettled(
    ['a', 'b'].map((letter) =>
      new WagerService(orm.em.fork()).process(command, key, {
        ...inbox,
        payloadHash: letter.repeat(64),
      }),
    ),
  );
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  const failure = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
  expect(failure.reason.code).toBe('INBOX_PAYLOAD_CONFLICT');
  await assertBalanceMatchesLedger(orm.em, wallet.id, '90.00');
});
