import { randomUUID } from 'node:crypto';
import type { MoneyProps } from './money';
import type { Direction, WagerStatus } from './wager';
interface EventProps<T> {
  eventId?: string;
  aggregateId: string;
  correlationId: string;
  occurredAt: Date;
  causationId?: string;
  data: T;
}
export abstract class IntegrationEvent<T> {
  abstract readonly eventType: string;
  abstract readonly version: number;
  readonly eventId: string;
  readonly aggregateId: string;
  readonly correlationId: string;
  readonly occurredAt: Date;
  readonly causationId?: string;
  readonly data: Readonly<T>;
  protected constructor(p: EventProps<T>) {
    this.eventId = p.eventId ?? randomUUID();
    this.aggregateId = p.aggregateId;
    this.correlationId = p.correlationId;
    this.occurredAt = p.occurredAt;
    this.causationId = p.causationId;
    this.data = p.data;
  }
  toJSON(): Record<string, unknown> {
    return {
      eventId: this.eventId,
      eventType: this.eventType,
      aggregateId: this.aggregateId,
      correlationId: this.correlationId,
      causationId: this.causationId ?? null,
      occurredAt: this.occurredAt.toISOString(),
      version: this.version,
      data: this.data,
    };
  }
}
export class WagerTransactionProcessed extends IntegrationEvent<{
  transactionId: string;
  status: WagerStatus;
  kind: string;
}> {
  readonly eventType = 'WagerTransactionProcessed';
  readonly version = 1;
  static from(aggregateId: string, transactionId: string, kind: string, at: Date) {
    return new WagerTransactionProcessed({
      aggregateId,
      correlationId: transactionId,
      occurredAt: at,
      data: { transactionId, status: 'PROCESSED', kind },
    });
  }
}
export class WagerTransactionRejected extends IntegrationEvent<{
  transactionId: string;
  failureCode: string;
}> {
  readonly eventType = 'WagerTransactionRejected';
  readonly version = 1;
  static from(aggregateId: string, transactionId: string, failureCode: string, at: Date) {
    return new WagerTransactionRejected({
      aggregateId,
      correlationId: transactionId,
      occurredAt: at,
      data: { transactionId, failureCode },
    });
  }
}
export class WagerTransactionPendingReference extends IntegrationEvent<{
  transactionId: string;
  referenceExternalTransactionId: string;
}> {
  readonly eventType = 'WagerTransactionPendingReference';
  readonly version = 1;
  static from(aggregateId: string, transactionId: string, reference: string, at: Date) {
    return new WagerTransactionPendingReference({
      aggregateId,
      correlationId: transactionId,
      occurredAt: at,
      data: { transactionId, referenceExternalTransactionId: reference },
    });
  }
}
export class WalletBalanceChanged extends IntegrationEvent<{
  walletId: string;
  transactionId: string;
  direction: Direction;
  money: MoneyProps;
  balanceBefore: MoneyProps;
  balanceAfter: MoneyProps;
  walletVersion: number;
}> {
  readonly eventType = 'WalletBalanceChanged';
  readonly version = 1;
  static from(p: {
    walletId: string;
    transactionId: string;
    direction: Direction;
    money: MoneyProps;
    balanceBefore: MoneyProps;
    balanceAfter: MoneyProps;
    walletVersion: number;
    occurredAt: Date;
  }) {
    return new WalletBalanceChanged({
      aggregateId: p.walletId,
      correlationId: p.transactionId,
      occurredAt: p.occurredAt,
      data: {
        walletId: p.walletId,
        transactionId: p.transactionId,
        direction: p.direction,
        money: p.money,
        balanceBefore: p.balanceBefore,
        balanceAfter: p.balanceAfter,
        walletVersion: p.walletVersion,
      },
    });
  }
}
