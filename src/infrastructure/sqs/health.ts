import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { SQSClient } from '@aws-sdk/client-sqs';
import { checkSqs, sqsClient } from './queues';
@Injectable()
export class SqsHealth implements OnModuleDestroy {
  private readonly client: SQSClient = sqsClient();
  check(): Promise<void> {
    return checkSqs(this.client);
  }
  onModuleDestroy(): void {
    this.client.destroy();
  }
}
