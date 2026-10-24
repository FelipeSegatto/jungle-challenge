import { ChangeMessageVisibilityCommand, DeleteMessageCommand, ReceiveMessageCommand, SendMessageCommand, type SQSClient, } from '@aws-sdk/client-sqs';
import { EntityManager } from '@mikro-orm/postgresql';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { ProcessWagerDto } from '../../presentation/dtos';
import { WagerService } from '../../application/services';
import { payloadHash } from '../../domain/hash';
import { DomainError } from '../../domain/errors';
import type { QueueUrls } from '../sqs/queues';
import { retryCounter, deadLetterCounter } from '../metrics';
interface RequestedEvent {
    messageId: string;
    type: 'WagerTransactionRequested';
    occurredAt: string;
    data: ProcessWagerDto & {
        idempotencyKey: string;
    };
}
function parseEvent(body: string): RequestedEvent {
    let event: RequestedEvent;
    try {
        event = JSON.parse(body) as RequestedEvent;
    }
    catch {
        throw new DomainError('INVALID_SQS_JSON', 'JSON inválido.', 400);
    }
    if (!event || event.type !== 'WagerTransactionRequested' ||
        typeof event.messageId !== 'string' || !event.messageId ||
        typeof event.occurredAt !== 'string' || !event.data ||
        typeof event.data.idempotencyKey !== 'string' || !event.data.idempotencyKey) {
        throw new DomainError('INVALID_SQS_ENVELOPE', 'Envelope SQS inválido.', 400);
    }
    if (Number.isNaN(Date.parse(event.occurredAt)))
        throw new DomainError('INVALID_OCCURRED_AT', 'Data inválida.', 400);
    const dto = plainToInstance(ProcessWagerDto, event.data);
    if (validateSync(dto, { whitelist: true, forbidNonWhitelisted: false }).length > 0) {
        throw new DomainError('INVALID_SQS_DATA', 'Dados financeiros inválidos.', 400);
    }
    return event;
}
export async function consumeOnce(root: EntityManager, client: SQSClient, urls: QueueUrls): Promise<number> {
    const received = await client.send(new ReceiveMessageCommand({
        QueueUrl: urls.input, MaxNumberOfMessages: 5,
        WaitTimeSeconds: Math.min(20, Math.max(0, Number(process.env.WORKER_POLL_SECONDS ?? '10'))),
        VisibilityTimeout: 60, MessageSystemAttributeNames: ['ApproximateReceiveCount'],
    }));
    let handled = 0;
    for (const message of received.Messages ?? []) {
        if (!message.ReceiptHandle || !message.Body)
            continue;
        const handle = message.ReceiptHandle;
        try {
            const event = parseEvent(message.Body);
            const result = await new WagerService(root.fork()).process(event.data, event.data.idempotencyKey, {
                consumerName: 'wager-sqs-v1', messageId: event.messageId,
                payloadHash: payloadHash(event),
            });
            // Acknowledge ONLY after SQL transaction has committed.
            await client.send(new DeleteMessageCommand({ QueueUrl: urls.input, ReceiptHandle: handle }));
            console.log(JSON.stringify({ level: 'info', event: 'sqs_processed', messageId: event.messageId,
                correlationId: result.transactionId, transactionId: result.transactionId,
                walletId: event.data.walletId, providerId: event.data.providerId, status: result.status }));
            handled++;
        }
        catch (error) {
            const permanent = error instanceof DomainError && error.httpStatus < 500 &&
                !['INBOX_MESSAGE_CONFLICT', 'INBOX_PAYLOAD_CONFLICT'].includes(error.code);
            if (permanent) {
                // Invalid/terminal messages are sent to the audit DLQ (no infinite retries).
                await client.send(new SendMessageCommand({
                    QueueUrl: urls.dlq, MessageBody: message.Body,
                    MessageGroupId: 'invalid-event', MessageDeduplicationId: message.MessageId ?? randomUUID(),
                }));
                await client.send(new DeleteMessageCommand({ QueueUrl: urls.input, ReceiptHandle: handle }));
                handled++;
                deadLetterCounter.inc();
            }
            else {
                retryCounter.labels('sqs').inc();
                const attempt = Number(message.Attributes?.ApproximateReceiveCount ?? '1');
                const seconds = Math.min(60, 2 ** Math.min(attempt, 6));
                console.error(JSON.stringify({ level: 'warn', event: 'sqs_retry', sqsMessageId: message.MessageId,
                    attempt, error: error instanceof Error ? error.name : 'unknown' }));
                await client.send(new ChangeMessageVisibilityCommand({
                    QueueUrl: urls.input, ReceiptHandle: handle, VisibilityTimeout: seconds,
                }));
                // SQS redrive policy moves the message to DLQ after 5 receives.
            }
        }
    }
    return handled;
}
