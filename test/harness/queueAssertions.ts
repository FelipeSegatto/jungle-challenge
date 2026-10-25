import { expect } from 'bun:test';
import { GetQueueAttributesCommand, type SQSClient } from '@aws-sdk/client-sqs';
/** Read-only observation; never receives or changes visibility of a message. Use after a confirmed ACK. */
export async function assertQueueEmpty(client: SQSClient, queueUrl: string): Promise<void> {
  const attributes = [
    'ApproximateNumberOfMessages',
    'ApproximateNumberOfMessagesNotVisible',
    'ApproximateNumberOfMessagesDelayed',
  ] as const;
  // LocalStack counters can lag a request. Require several consecutive empty observations.
  let stable = 0;
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline && stable < 3) {
    const result = await client.send(
      new GetQueueAttributesCommand({ QueueUrl: queueUrl, AttributeNames: [...attributes] }),
    );
    stable = attributes.every((name) => result.Attributes?.[name] === '0') ? stable + 1 : 0;
    if (stable < 3) await Bun.sleep(200);
  }
  expect(stable).toBe(3);
}
