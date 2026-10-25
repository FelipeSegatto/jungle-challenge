import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs';
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
  } catch {
    throw new DomainError('INVALID_SQS_JSON', 'JSON inválido.', 400);
  }
  if (
    !event ||
    event.type !== 'WagerTransactionRequested' ||
    typeof event.messageId !== 'string' ||
    !event.messageId ||
    typeof event.occurredAt !== 'string' ||
    !event.data ||
    typeof event.data.idempotencyKey !== 'string' ||
    !event.data.idempotencyKey
  ) {
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
// Test instrumentation is rejected outside an explicitly isolated test environment.
const hooksConfigured = Object.keys(process.env).some(
  (name) => name.startsWith('TEST_SYNC_') || name.startsWith('TEST_FAULT_'),
);
if (hooksConfigured) {
  const db = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/invalid');
  const sqs = new URL(process.env.SQS_ENDPOINT ?? 'http://invalid');
  if (
    process.env.NODE_ENV !== 'test' ||
    !['127.0.0.1', 'localhost'].includes(db.hostname) ||
    !db.pathname.endsWith('_test') ||
    !['127.0.0.1', 'localhost'].includes(sqs.hostname) ||
    !process.env.SQS_QUEUE_PREFIX?.startsWith('jungle-test-')
  ) {
    throw new Error('TEST_HOOKS_REQUIRE_ISOLATED_TEST_ENVIRONMENT');
  }
}
async function testSyncSignal(
  name: string,
  messageId: string,
  detail: unknown = Date.now(),
): Promise<void> {
  const dir = process.env.TEST_SYNC_SENTINEL_DIR;
  if (process.env.NODE_ENV !== 'test' || !dir) return;
  // Filtra por messageId quando o teste pede: a fila real pode ter mensagens órfãs de execuções
  // anteriores (ex.: um teste de retry/DLQ que ainda não terminou de se limpar) — sem esse filtro,
  // o worker processando QUALQUER OUTRA mensagem já dispararia o sentinela por engano.
  const targetId = process.env.TEST_SYNC_MESSAGE_ID;
  if (targetId && targetId !== messageId) return;
  await Bun.write(`${dir}/${name}-${process.pid}`, JSON.stringify(detail));
  // Pausa curta e FIXA (não depende de nenhum sinal) só para dar ao processo de teste uma janela
  // real para agir (matar o processo, por exemplo) enquanto ele está genuinamente neste ponto do
  // código — sem isso, a diferença de tempo entre "escrever o sentinela" e "continuar para a
  // próxima linha" é pequena demais (varia com I/O) para o teste observar de forma confiável.
  if (process.env.TEST_SYNC_PAUSE_AT === name) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}
const testFaultedOnce = new Set<string>();
function maybeInjectTestFault(messageId: string): void {
  const targetId = process.env.TEST_FAULT_INJECT_MESSAGE_ID;
  if (!targetId || targetId !== messageId) return;
  const mode = process.env.TEST_FAULT_INJECT_MODE ?? 'once';
  if (mode === 'once') {
    if (testFaultedOnce.has(messageId)) return;
    testFaultedOnce.add(messageId);
  }
  throw new Error('test-injected-transient-failure');
}

export async function consumeOnce(
  root: EntityManager,
  client: SQSClient,
  urls: QueueUrls,
): Promise<number> {
  const received = await client.send(
    new ReceiveMessageCommand({
      QueueUrl: urls.input,
      MaxNumberOfMessages: 5,
      WaitTimeSeconds: Math.min(20, Math.max(0, Number(process.env.WORKER_POLL_SECONDS ?? '10'))),
      VisibilityTimeout: Math.max(1, Number(process.env.WORKER_VISIBILITY_TIMEOUT_SECONDS ?? '60')),
      MessageSystemAttributeNames: ['ApproximateReceiveCount'],
    }),
  );
  let handled = 0;
  for (const message of received.Messages ?? []) {
    if (!message.ReceiptHandle || !message.Body) continue;
    const handle = message.ReceiptHandle;
    let parsed: RequestedEvent | undefined;
    try {
      const event = parseEvent(message.Body);
      parsed = event;
      await testSyncSignal(
        `receive-${message.Attributes?.ApproximateReceiveCount ?? '1'}`,
        event.messageId,
        {
          receivedAt: Date.now(),
          count: Number(message.Attributes?.ApproximateReceiveCount ?? '1'),
        },
      );
      await testSyncSignal('before-process', event.messageId);
      maybeInjectTestFault(event.messageId);
      const result = await new WagerService(root.fork()).process(
        event.data,
        event.data.idempotencyKey,
        {
          consumerName: 'wager-sqs-v1',
          messageId: event.messageId,
          payloadHash: payloadHash(event),
        },
      );
      await testSyncSignal('after-commit-before-ack', event.messageId);
      // Acknowledge ONLY after SQL transaction has committed.
      await client.send(new DeleteMessageCommand({ QueueUrl: urls.input, ReceiptHandle: handle }));
      await testSyncSignal('after-ack', event.messageId);
      console.log(
        JSON.stringify({
          level: 'info',
          event: 'sqs_processed',
          messageId: event.messageId,
          correlationId: result.transactionId,
          transactionId: result.transactionId,
          walletId: event.data.walletId,
          providerId: event.data.providerId,
          status: result.status,
        }),
      );
      handled++;
    } catch (error) {
      const permanent =
        error instanceof DomainError &&
        error.httpStatus < 500 &&
        !['INBOX_MESSAGE_CONFLICT', 'INBOX_PAYLOAD_CONFLICT'].includes(error.code);
      if (permanent) {
        // Invalid/terminal messages are sent to the audit DLQ (no infinite retries).
        await client.send(
          new SendMessageCommand({
            QueueUrl: urls.dlq,
            MessageBody: message.Body,
            MessageGroupId: 'invalid-event',
            MessageDeduplicationId: message.MessageId ?? randomUUID(),
          }),
        );
        await client.send(
          new DeleteMessageCommand({ QueueUrl: urls.input, ReceiptHandle: handle }),
        );
        handled++;
        deadLetterCounter.inc();
        console.log(
          JSON.stringify({
            level: 'warn',
            event: 'sqs_dead_lettered',
            messageId: parsed?.messageId ?? null,
            sqsMessageId: message.MessageId,
            correlationId: parsed?.messageId ?? message.MessageId,
            transactionId: null,
            walletId: parsed?.data.walletId ?? null,
            providerId: parsed?.data.providerId ?? null,
            attempt: Number(message.Attributes?.ApproximateReceiveCount ?? '1'),
            errorCode: error instanceof DomainError ? error.code : 'UNKNOWN',
          }),
        );
      } else {
        retryCounter.labels('sqs').inc();
        const attempt = Number(message.Attributes?.ApproximateReceiveCount ?? '1');
        const seconds = Math.min(60, 2 ** Math.min(attempt, 6));
        console.error(
          JSON.stringify({
            level: 'warn',
            event: 'sqs_retry',
            sqsMessageId: message.MessageId,
            attempt,
            messageId: parsed?.messageId ?? null,
            correlationId: parsed?.messageId ?? message.MessageId,
            walletId: parsed?.data.walletId ?? null,
            providerId: parsed?.data.providerId ?? null,
            transactionId: null,
            error: error instanceof Error ? error.name : 'unknown',
          }),
        );
        await client.send(
          new ChangeMessageVisibilityCommand({
            QueueUrl: urls.input,
            ReceiptHandle: handle,
            VisibilityTimeout: seconds,
          }),
        );
        // SQS redrive policy moves the message to DLQ after 5 receives.
      }
    }
  }
  return handled;
}
