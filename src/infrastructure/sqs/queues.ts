import { SQSClient, CreateQueueCommand, GetQueueAttributesCommand, ListQueuesCommand, SendMessageCommand, GetQueueUrlCommand, } from '@aws-sdk/client-sqs';
export const INPUT_QUEUE = 'wager-transactions.fifo';
export const DLQ = 'wager-transactions-dlq.fifo';
export const EVENT_QUEUE = 'wager-events.fifo';
export function sqsClient(): SQSClient {
    return new SQSClient({
        region: process.env.AWS_REGION ?? 'us-east-1',
        endpoint: process.env.SQS_ENDPOINT ?? 'http://127.0.0.1:4566',
        credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
        },
        maxAttempts: 2,
    });
}
export async function checkSqs(client: SQSClient): Promise<void> {
    await client.send(new ListQueuesCommand({ MaxResults: 1 }));
}
export interface QueueUrls {
    input: string;
    dlq: string;
    events: string;
}
export async function queueUrls(client: SQSClient): Promise<QueueUrls> {
    const [input, dlq, events] = await Promise.all([
        client.send(new GetQueueUrlCommand({ QueueName: INPUT_QUEUE })),
        client.send(new GetQueueUrlCommand({ QueueName: DLQ })),
        client.send(new GetQueueUrlCommand({ QueueName: EVENT_QUEUE })),
    ]);
    if (!input.QueueUrl || !dlq.QueueUrl || !events.QueueUrl)
        throw new Error('QUEUE_URL_MISSING');
    return { input: input.QueueUrl, dlq: dlq.QueueUrl, events: events.QueueUrl };
}
export async function ensureQueues(client: SQSClient): Promise<QueueUrls> {
    const dlq = await client.send(new CreateQueueCommand({
        QueueName: DLQ, Attributes: { FifoQueue: 'true' },
    }));
    if (!dlq.QueueUrl)
        throw new Error('DLQ_NOT_CREATED');
    const attributes = await client.send(new GetQueueAttributesCommand({
        QueueUrl: dlq.QueueUrl, AttributeNames: ['QueueArn'],
    }));
    const arn = attributes.Attributes?.QueueArn;
    if (!arn)
        throw new Error('DLQ_ARN_MISSING');
    await client.send(new CreateQueueCommand({
        QueueName: INPUT_QUEUE,
        Attributes: {
            FifoQueue: 'true',
            VisibilityTimeout: '60',
            RedrivePolicy: JSON.stringify({ deadLetterTargetArn: arn, maxReceiveCount: 5 }),
        },
    }));
    await client.send(new CreateQueueCommand({
        QueueName: EVENT_QUEUE, Attributes: { FifoQueue: 'true' },
    }));
    return queueUrls(client);
}
export async function submitMessage(client: SQSClient, queueUrl: string, event: {
    messageId: string;
    data: {
        walletId: string;
    };
    [key: string]: unknown;
}): Promise<void> {
    await client.send(new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(event),
        MessageGroupId: event.data.walletId,
        MessageDeduplicationId: event.messageId,
    }));
}
