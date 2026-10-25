import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
export const registry = new Registry();
collectDefaultMetrics({ register: registry, prefix: 'wagering_' });
export const transactionCounter = new Counter({
  name: 'wagering_transactions_total',
  help: 'Financial operations by terminal or pending status',
  labelNames: ['status'] as const,
  registers: [registry],
});
export const duplicateCounter = new Counter({
  name: 'wagering_duplicates_total',
  help: 'Idempotent replay responses',
  registers: [registry],
});
export const retryCounter = new Counter({
  name: 'wagering_retries_total',
  help: 'SQS or reference processing retries',
  labelNames: ['kind'] as const,
  registers: [registry],
});
export const deadLetterCounter = new Counter({
  name: 'wagering_dlq_total',
  help: 'Messages sent directly to DLQ',
  registers: [registry],
});
export const conflictCounter = new Counter({
  name: 'wagering_lock_conflicts_total',
  help: 'PostgreSQL deadlock and serialization retries',
  registers: [registry],
});
export const processingLatency = new Histogram({
  name: 'wagering_processing_seconds',
  help: 'Time to commit operation',
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [registry],
});
export const outboxLag = new Gauge({
  name: 'wagering_outbox_oldest_seconds',
  help: 'Age of oldest unpublished event',
  registers: [registry],
});
export const reconciliationMismatch = new Counter({
  name: 'wagering_reconciliation_mismatch_total',
  help: 'Observed ledger/wallet mismatch',
  registers: [registry],
});

/** Current backlog includes messages moved automatically by the SQS redrive policy. */
export const deadLetterDepth = new Gauge({
  name: 'wagering_dlq_messages',
  help: 'Current visible, in-flight and delayed messages in the DLQ',
  registers: [registry],
});
