import './harness/environment';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';
import config from '../mikro-orm.config';
import { WalletService, WagerService } from '../src/application/services';
import {
  WalletRow,
  WagerRow,
  LedgerRow,
  InboxRow,
  OutboxRow,
} from '../src/infrastructure/entities/rows';
import { assertBalanceMatchesLedger } from './harness/reconcile';

let orm: MikroORM;
beforeAll(async () => {
  orm = await MikroORM.init(config);
});
afterAll(async () => {
  if (orm) await orm.close(true);
});

test('real outbox INSERT failure rolls back the complete financial transaction; retry applies once', async () => {
  const playerId = crypto.randomUUID();
  const wallet = await new WalletService(orm.em.fork()).create(playerId, {
    amount: '100.00',
    currency: 'BRL',
  });
  const key = crypto.randomUUID();
  const inbox = {
    consumerName: 'atomicity-test',
    messageId: crypto.randomUUID(),
    payloadHash: 'a'.repeat(64),
  };
  const command = {
    providerId: 'atomicity-test',
    externalTransactionId: crypto.randomUUID(),
    playerId,
    walletId: wallet.id,
    roundId: 'r',
    gameId: 'g',
    kind: 'BET' as const,
    money: { amount: '10.00', currency: 'BRL' },
  };
  const trigger = `atomicity_${crypto.randomUUID().replaceAll('-', '')}`;
  try {
    // Identifiers and wallet ID are generated locally; the trigger affects only this fixture.
    // This injects a real PostgreSQL failure at the outbox boundary, not a mock of the use case.
    await orm.em.execute(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.aggregate_id = '${wallet.id}'::uuid THEN RAISE EXCEPTION 'ATOMICITY_TEST_OUTBOX_FAILURE'; END IF;
      RETURN NEW; END; $$`);
    await orm.em.execute(`CREATE TRIGGER ${trigger} BEFORE INSERT ON outbox_messages
      FOR EACH ROW EXECUTE FUNCTION ${trigger}()`);
    await expect(new WagerService(orm.em.fork()).process(command, key, inbox)).rejects.toThrow(
      'ATOMICITY_TEST_OUTBOX_FAILURE',
    );
    await assertBalanceMatchesLedger(orm.em, wallet.id, '100.00');
    expect((await orm.em.fork().findOneOrFail(WalletRow, { id: wallet.id })).version).toBe(1);
    expect(await orm.em.fork().count(WagerRow, { idempotencyKey: key })).toBe(0);
    expect(await orm.em.fork().count(WagerRow, { walletId: wallet.id })).toBe(1); // only OPENING
    expect(await orm.em.fork().count(InboxRow, { messageId: inbox.messageId })).toBe(0);
    expect(await orm.em.fork().count(LedgerRow, { walletId: wallet.id })).toBe(1);
    expect(await orm.em.fork().count(OutboxRow, { aggregateId: wallet.id })).toBe(2); // opening events
  } finally {
    await orm.em.execute(`DROP TRIGGER IF EXISTS ${trigger} ON outbox_messages`);
    await orm.em.execute(`DROP FUNCTION IF EXISTS ${trigger}()`);
  }
  const applied = await new WagerService(orm.em.fork()).process(command, key, inbox);
  expect(applied.status).toBe('PROCESSED');
  expect(applied.idempotentReplay).toBe(false);
  const replay = await new WagerService(orm.em.fork()).process(command, key, inbox);
  expect(replay.transactionId).toBe(applied.transactionId);
  expect(replay.idempotentReplay).toBe(true);
  await assertBalanceMatchesLedger(orm.em, wallet.id, '90.00');
  expect((await orm.em.fork().findOneOrFail(WalletRow, { id: wallet.id })).version).toBe(2);
  expect(await orm.em.fork().count(WagerRow, { walletId: wallet.id })).toBe(2);
  expect(await orm.em.fork().count(LedgerRow, { walletId: wallet.id })).toBe(2);
  expect(await orm.em.fork().count(InboxRow, { messageId: inbox.messageId })).toBe(1);
  expect(await orm.em.fork().count(OutboxRow, { aggregateId: wallet.id })).toBe(4);
}, 30000);
