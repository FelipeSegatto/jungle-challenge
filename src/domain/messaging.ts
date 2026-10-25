import type { IntegrationEvent } from './events';

export interface InboxState {
  messageId: string;
  consumerName: string;
  payloadHash: string;
  receivedAt: Date;
  processedAt: Date | null;
}
/** Envelope identity belongs to messaging; it is independent of the financial idempotency key. */
export class InboxMessage {
  private constructor(private readonly state: InboxState) {}
  static receive(
    props: Omit<InboxState, 'receivedAt' | 'processedAt'>,
    now = new Date(),
  ): InboxMessage {
    return new InboxMessage({ ...props, receivedAt: now, processedAt: null });
  }
  static rehydrate(state: InboxState): InboxMessage {
    return new InboxMessage({ ...state });
  }
  get messageId() {
    return this.state.messageId;
  }
  get consumerName() {
    return this.state.consumerName;
  }
  get payloadHash() {
    return this.state.payloadHash;
  }
  get receivedAt() {
    return this.state.receivedAt;
  }
  get processedAt() {
    return this.state.processedAt;
  }
  isProcessed(): boolean {
    return this.state.processedAt !== null;
  }
  markProcessed(at: Date): void {
    if (!this.isProcessed()) this.state.processedAt = at;
  }
}
export interface OutboxState {
  id: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
  attempts: number;
  nextAttemptAt: Date | null;
  publishedAt: Date | null;
}
export class OutboxMessage {
  private constructor(private readonly state: OutboxState) {}
  static enqueue(event: IntegrationEvent<unknown>): OutboxMessage {
    return new OutboxMessage({
      id: event.eventId,
      aggregateId: event.aggregateId,
      eventType: event.eventType,
      payload: event.toJSON(),
      occurredAt: event.occurredAt,
      attempts: 0,
      nextAttemptAt: null,
      publishedAt: null,
    });
  }
  static rehydrate(state: OutboxState): OutboxMessage {
    return new OutboxMessage({ ...state });
  }
  get id() {
    return this.state.id;
  }
  get aggregateId() {
    return this.state.aggregateId;
  }
  get eventType() {
    return this.state.eventType;
  }
  get payload(): Readonly<Record<string, unknown>> {
    return this.state.payload;
  }
  get occurredAt() {
    return this.state.occurredAt;
  }
  get attempts() {
    return this.state.attempts;
  }
  get nextAttemptAt() {
    return this.state.nextAttemptAt;
  }
  get publishedAt() {
    return this.state.publishedAt;
  }
  isPending(): boolean {
    return this.state.publishedAt === null;
  }
  isDue(now: Date): boolean {
    return this.isPending() && (!this.state.nextAttemptAt || this.state.nextAttemptAt <= now);
  }
  markPublished(at: Date): void {
    this.state.publishedAt ??= at;
    this.state.nextAttemptAt = null;
  }
  scheduleRetry(now: Date): void {
    if (!this.isPending()) throw new Error('PUBLISHED_EVENT_CANNOT_RETRY');
    this.state.attempts++;
    this.state.nextAttemptAt = new Date(
      now.getTime() + Math.min(60000, 1000 * 2 ** Math.min(this.state.attempts, 6)),
    );
  }
}
