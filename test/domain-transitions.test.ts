import { expect, test } from 'bun:test';
import { Money } from '../src/domain/money';
import { WagerTransaction, type WagerKind } from '../src/domain/wager';
import { InboxMessage, OutboxMessage } from '../src/domain/messaging';
import { WagerTransactionProcessed } from '../src/domain/events';
const props = (kind: WagerKind) => ({
  providerId: 'p',
  externalTransactionId: 'e',
  idempotencyKey: 'k',
  payloadHash: 'h',
  walletId: 'w',
  playerId: 'p',
  roundId: 'r',
  gameId: 'g',
  kind,
  money: Money.from({ amount: '10.00', currency: 'BRL' }),
});
test('financial kinds have the expected direction and reference requirements', () => {
  expect(WagerTransaction.create(props('BET')).ledgerDirectionFor()).toBe('DEBIT');
  expect(WagerTransaction.create(props('WIN')).ledgerDirectionFor()).toBe('CREDIT');
  expect(WagerTransaction.create(props('LOSS')).ledgerDirectionFor()).toBeNull();
  expect(() => WagerTransaction.create(props('REFUND'))).toThrow();
  expect(() => WagerTransaction.create(props('ROLLBACK'))).toThrow();
  const refund = WagerTransaction.create({
    ...props('REFUND'),
    referenceExternalTransactionId: 'bet',
  });
  expect(refund.ledgerDirectionFor('BET')).toBe('CREDIT');
  const rollback = WagerTransaction.create({
    ...props('ROLLBACK'),
    referenceExternalTransactionId: 'original',
  });
  expect(rollback.ledgerDirectionFor('BET')).toBe('CREDIT');
  expect(rollback.ledgerDirectionFor('WIN')).toBe('DEBIT');
  expect(rollback.ledgerDirectionFor('REFUND')).toBe('DEBIT');
});
test('terminal transitions cannot be changed and OPENING has its own internal factory', () => {
  for (const terminal of ['processed', 'rejected', 'failed'] as const) {
    const wager = WagerTransaction.create(props('BET'));
    if (terminal === 'processed') wager.markProcessed(null, new Date());
    else if (terminal === 'rejected') wager.reject('BUSINESS_ERROR');
    else wager.fail('INFRASTRUCTURE_ERROR');
    expect(wager.isTerminal()).toBe(true);
    expect(() => wager.markPendingReference()).toThrow();
    expect(() => wager.markProcessed(null, new Date())).toThrow();
    expect(() => wager.reject('OTHER')).toThrow();
    expect(() => wager.fail('OTHER')).toThrow();
  }
  expect(() => WagerTransaction.create(props('OPENING'))).toThrow();
  const opening = WagerTransaction.opening({
    walletId: 'w',
    playerId: 'p',
    money: props('BET').money,
    payloadHash: 'h',
  });
  expect(opening.providerId).toBe('__internal__');
  expect(opening.status).toBe('PROCESSED');
});
test('inbox records completion once and rehydrates it', () => {
  const message = InboxMessage.receive(
    { messageId: 'm', consumerName: 'c', payloadHash: 'h' },
    new Date(0),
  );
  expect(message.isProcessed()).toBe(false);
  message.markProcessed(new Date(1000));
  message.markProcessed(new Date(2000));
  expect(message.processedAt?.getTime()).toBe(1000);
  expect(
    InboxMessage.rehydrate({
      messageId: 'm',
      consumerName: 'c',
      payloadHash: 'h',
      receivedAt: new Date(0),
      processedAt: message.processedAt,
    }).isProcessed(),
  ).toBe(true);
});
test('outbox backoff is bounded and published events cannot be retried', () => {
  const now = new Date(0);
  const message = OutboxMessage.enqueue(WagerTransactionProcessed.from('w', 't', 'BET', now));
  expect(message.isDue(now)).toBe(true);
  message.scheduleRetry(now);
  expect(message.attempts).toBe(1);
  expect(message.nextAttemptAt?.getTime()).toBe(2000);
  expect(message.isDue(new Date(1999))).toBe(false);
  expect(message.isDue(new Date(2000))).toBe(true);
  for (let i = 0; i < 10; i++) message.scheduleRetry(now);
  expect(message.nextAttemptAt?.getTime()).toBe(60000);
  message.markPublished(new Date(1000));
  expect(message.isPending()).toBe(false);
  expect(message.nextAttemptAt).toBeNull();
  expect(() => message.scheduleRetry(now)).toThrow();
});
