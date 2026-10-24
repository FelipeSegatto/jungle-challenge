/** Real integration. Requires PostgreSQL, LocalStack and applied migrations. */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';
import { type SQSClient } from '@aws-sdk/client-sqs';
import config from '../mikro-orm.config';
import { ensureQueues, sqsClient, submitMessage, type QueueUrls } from '../src/infrastructure/sqs/queues';
import { WalletService, WagerService } from '../src/application/services';
import { consumeOnce } from '../src/infrastructure/workers/consumer';
import { publishOutboxBatch } from '../src/infrastructure/workers/outbox';
import { payloadHash } from '../src/domain/hash';
import { InboxRow, OutboxRow, WalletRow, LedgerRow } from '../src/infrastructure/entities/rows';
let orm: MikroORM;
let client: SQSClient;
let urls: QueueUrls;
beforeAll(async () => {
    orm = await MikroORM.init(config);
    client = sqsClient();
    urls = await ensureQueues(client);
});
afterAll(async () => { client?.destroy(); if (orm)
    await orm.close(true); });
const uuid = () => crypto.randomUUID();
describe('SQS/Inbox/Outbox reais', () => {
    test('redelivery após commit antes do ACK não duplica débito', async () => {
        const playerId = uuid();
        const wallet = await new WalletService(orm.em.fork()).create(playerId, { amount: '100.00', currency: 'BRL' });
        const data = {
            providerId: 'provider-' + uuid(), externalTransactionId: 'bet-' + uuid(), idempotencyKey: 'idem-' + uuid(),
            playerId, walletId: wallet.id, roundId: 'round-1', gameId: 'game-1', kind: 'BET' as const,
            money: { amount: '25.00', currency: 'BRL' },
        };
        const event = { messageId: uuid(), type: 'WagerTransactionRequested' as const,
            occurredAt: new Date().toISOString(), data };
        // Simulates consumer crash: financial commit exists, but SQS was not acknowledged.
        const first = await new WagerService(orm.em.fork()).process(data, data.idempotencyKey, {
            consumerName: 'wager-sqs-v1', messageId: event.messageId, payloadHash: payloadHash(event),
        });
        expect(first.status).toBe('PROCESSED');
        await submitMessage(client, urls.input, event);
        // Inbox sees the duplicate, consumer acknowledges without touching balance.
        await consumeOnce(orm.em, client, urls);
        const saved = await orm.em.fork().findOneOrFail(WalletRow, { id: wallet.id });
        expect(saved.balance).toBe('75.00');
        const ledger = await orm.em.fork().find(LedgerRow, { walletId: wallet.id });
        expect(ledger.filter(x => x.direction === 'DEBIT')).toHaveLength(1);
        const inbox = await orm.em.fork().find(InboxRow, { consumerName: 'wager-sqs-v1', messageId: event.messageId });
        expect(inbox).toHaveLength(1);
        expect(inbox[0].processedAt).not.toBeNull();
    }, 120000);
    test('dois publishers reivindicam a outbox sem perder eventos', async () => {
        const playerId = uuid();
        const wallet = await new WalletService(orm.em.fork()).create(playerId, { amount: '20.00', currency: 'BRL' });
        const eventIds = (await orm.em.fork().find(OutboxRow, { aggregateId: wallet.id })).map(x => x.id);
        expect(eventIds.length).toBeGreaterThanOrEqual(2);
        await Promise.all([
            publishOutboxBatch(orm.em, client, urls.events, 15),
            publishOutboxBatch(orm.em, client, urls.events, 15),
        ]);
        const rows = await orm.em.fork().find(OutboxRow, { aggregateId: wallet.id });
        expect(rows.every(x => x.publishedAt !== null)).toBe(true);
        // SQS FIFO may deliver older groups too; outbox SQL state is authoritative here.
    }, 120000);
});
