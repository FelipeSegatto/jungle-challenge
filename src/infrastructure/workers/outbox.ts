import { EntityManager } from '@mikro-orm/postgresql';
import { LockMode } from '@mikro-orm/core';
import { SendMessageCommand, type SQSClient } from '@aws-sdk/client-sqs';
import { OutboxRow } from '../entities/rows';
import { retryCounter } from '../metrics';
/** Claim and send in a single short SQL transaction. Publication is at-least-once. */
export async function publishOutboxBatch(root: EntityManager, client: SQSClient, queueUrl: string, batchSize = 15): Promise<number> {
    return root.fork().transactional(async (em) => {
        // SKIP LOCKED makes two publishers claim disjoint sets of messages.
        const rows = await em.find(OutboxRow, {
            publishedAt: null,
            $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: new Date() } }],
        }, {
            orderBy: { occurredAt: 'ASC', id: 'ASC' },
            limit: batchSize,
            lockMode: LockMode.PESSIMISTIC_PARTIAL_WRITE,
        });
        for (const row of rows) {
            try {
                await client.send(new SendMessageCommand({
                    QueueUrl: queueUrl,
                    MessageBody: JSON.stringify(row.payload),
                    MessageGroupId: row.aggregateId,
                    MessageDeduplicationId: row.id,
                }), { abortSignal: AbortSignal.timeout(5000) });
                row.publishedAt = new Date();
                row.nextAttemptAt = null;
            }
            catch (error) {
                retryCounter.labels('outbox').inc();
                row.attempts += 1;
                row.nextAttemptAt = new Date(Date.now() + Math.min(60000, 1000 * 2 ** Math.min(row.attempts, 6)));
                console.error(JSON.stringify({ level: 'error', event: 'outbox_retry', eventId: row.id,
                    attempts: row.attempts, error: error instanceof Error ? error.name : 'unknown' }));
            }
        }
        return rows.length;
    });
}
