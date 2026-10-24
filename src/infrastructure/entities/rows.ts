import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { DecimalType } from '@mikro-orm/core';

@Entity({ tableName: 'wallets' })
export class WalletRow {
  @PrimaryKey({ type: 'uuid' }) id!: string;
  @Property({ type: 'uuid' }) playerId!: string;
  @Property({ type: 'string', length: 3 }) currency!: string;
  @Property({ type: DecimalType, columnType: 'numeric(20,2)' }) balance!: string;
  @Property({ type: 'integer' }) version!: number;
  @Property({ type: 'datetime' }) createdAt!: Date;
  @Property({ type: 'datetime' }) updatedAt!: Date;
}

@Entity({ tableName: 'wager_transactions' })
export class WagerRow {
  @PrimaryKey({ type: 'uuid' }) id!: string;
  @Property({ type: 'text' }) providerId!: string;
  @Property({ type: 'text' }) externalTransactionId!: string;
  @Property({ type: 'text' }) idempotencyKey!: string;
  @Property({ type: 'string', columnType: 'char(64)' }) payloadHash!: string;
  @Property({ type: 'uuid' }) walletId!: string;
  @Property({ type: 'uuid' }) playerId!: string;
  @Property({ type: 'text' }) roundId!: string;
  @Property({ type: 'text' }) gameId!: string;
  @Property({ type: 'text' }) kind!: string;
  @Property({ type: DecimalType, columnType: 'numeric(20,2)' }) amount!: string;
  @Property({ type: 'string', length: 3 }) currency!: string;
  @Property({ type: 'text' }) status!: string;
  @Property({ type: 'text', nullable: true }) referenceExternalTransactionId: string | null = null;
  @Property({ type: 'uuid', nullable: true }) referenceTransactionId: string | null = null;
  @Property({ type: 'text', nullable: true }) failureCode: string | null = null;
  @Property({ type: DecimalType, columnType: 'numeric(20,2)', nullable: true }) responseBalanceAmount: string | null = null;
  @Property({ type: 'datetime', nullable: true }) processedAt: Date | null = null;
  @Property({ type: 'datetime' }) createdAt!: Date;
  @Property({ type: 'integer' }) referenceAttempts: number = 0;
  @Property({ type: 'datetime', nullable: true }) nextAttemptAt: Date | null = null;
}

@Entity({ tableName: 'wallet_ledger_entries' })
export class LedgerRow {
  @PrimaryKey({ type: 'uuid' }) id!: string;
  @Property({ type: 'uuid' }) walletId!: string;
  @Property({ type: 'uuid' }) transactionId!: string;
  @Property({ type: 'text' }) direction!: string;
  @Property({ type: DecimalType, columnType: 'numeric(20,2)' }) amount!: string;
  @Property({ type: 'string', length: 3 }) currency!: string;
  @Property({ type: DecimalType, columnType: 'numeric(20,2)' }) balanceBefore!: string;
  @Property({ type: DecimalType, columnType: 'numeric(20,2)' }) balanceAfter!: string;
  @Property({ type: 'datetime' }) createdAt!: Date;
}

@Entity({ tableName: 'outbox_messages' })
export class OutboxRow {
  @PrimaryKey({ type: 'uuid' }) id!: string;
  @Property({ type: 'uuid' }) aggregateId!: string;
  @Property({ type: 'text' }) eventType!: string;
  @Property({ type: 'json' }) payload!: Record<string, unknown>;
  @Property({ type: 'integer' }) attempts: number = 0;
  @Property({ type: 'datetime', nullable: true }) nextAttemptAt: Date | null = null;
  @Property({ type: 'datetime', nullable: true }) publishedAt: Date | null = null;
  @Property({ type: 'datetime' }) occurredAt!: Date;
}

@Entity({ tableName: 'inbox_messages' })
export class InboxRow {
  @PrimaryKey({ type: 'uuid' }) id!: string;
  @Property({ type: 'text' }) consumerName!: string;
  @Property({ type: 'text' }) messageId!: string;
  @Property({ type: 'string', columnType: 'char(64)' }) payloadHash!: string;
  @Property({ type: 'datetime' }) receivedAt!: Date;
  @Property({ type: 'datetime', nullable: true }) processedAt: Date | null = null;
}

export const entities = [WalletRow, WagerRow, LedgerRow, OutboxRow, InboxRow];
