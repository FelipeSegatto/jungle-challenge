import { OutboxMessage } from '../../domain/messaging';
import { EntityManager } from '@mikro-orm/postgresql';
import { LockMode } from '@mikro-orm/core';
import { SendMessageCommand, type SQSClient } from '@aws-sdk/client-sqs';
import { OutboxRow } from '../entities/rows';
import { retryCounter } from '../metrics';
/** Claim and send in a single short SQL transaction. Publication is at-least-once. */
export async function publishOutboxBatch(
  root: EntityManager,
  client: SQSClient,
  queueUrl: string,
  batchSize = 15,
): Promise<number> {
  return root.fork().transactional(async (em) => {
    // SKIP LOCKED makes two publishers claim disjoint sets of messages.
    const rows = await em.find(
      OutboxRow,
      {
        publishedAt: null,
        $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: new Date() } }],
      },
      {
        orderBy: { occurredAt: 'ASC', id: 'ASC' },
        limit: batchSize,
        lockMode: LockMode.PESSIMISTIC_PARTIAL_WRITE,
      },
    );
    for (const row of rows) {
      const message = OutboxMessage.rehydrate(row);
      try {
        await client.send(
          new SendMessageCommand({
            QueueUrl: queueUrl,
            MessageBody: JSON.stringify(row.payload),
            MessageGroupId: row.aggregateId,
            MessageDeduplicationId: row.id,
          }),
          { abortSignal: AbortSignal.timeout(5000) },
        );
        message.markPublished(new Date());
        row.publishedAt = message.publishedAt;
        row.nextAttemptAt = message.nextAttemptAt;
      } catch (error) {
        retryCounter.labels('outbox').inc();
        message.scheduleRetry(new Date());
        row.attempts = message.attempts;
        row.nextAttemptAt = message.nextAttemptAt;
        console.error(
          JSON.stringify({
            level: 'error',
            event: 'outbox_retry',
            eventId: row.id,
            attempts: row.attempts,
            error: error instanceof Error ? error.name : 'unknown',
          }),
        );
      }
    }
    return rows.length;
  });
}
