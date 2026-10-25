import { describe, test, expect } from 'bun:test';
import { parsePrometheusText, extractWageringMetrics } from './prometheus';

// Trecho real devolvido por `curl http://localhost:3001/health/metrics` nesta sessão (capturado por execução real).
const REAL_SAMPLE = `
# HELP wagering_process_cpu_seconds_total Total user and system CPU time spent in seconds.
# TYPE wagering_process_cpu_seconds_total counter
wagering_process_cpu_seconds_total 37.562

# HELP wagering_transactions_total Financial operations by terminal or pending status
# TYPE wagering_transactions_total counter
wagering_transactions_total{status="PROCESSED"} 10
wagering_transactions_total{status="REJECTED"} 3

# HELP wagering_duplicates_total Idempotent replay responses
# TYPE wagering_duplicates_total counter
wagering_duplicates_total 2

# HELP wagering_retries_total SQS or reference processing retries
# TYPE wagering_retries_total counter

# HELP wagering_dlq_total Messages sent directly to DLQ
# TYPE wagering_dlq_total counter
wagering_dlq_total 0

# HELP wagering_lock_conflicts_total PostgreSQL deadlock and serialization retries
# TYPE wagering_lock_conflicts_total counter
wagering_lock_conflicts_total 0

# HELP wagering_processing_seconds Time to commit operation
# TYPE wagering_processing_seconds histogram
wagering_processing_seconds_bucket{le="0.005"} 0
wagering_processing_seconds_bucket{le="+Inf"} 17
wagering_processing_seconds_sum 0.8320000000000001
wagering_processing_seconds_count 17

# HELP wagering_outbox_oldest_seconds Age of oldest unpublished event
# TYPE wagering_outbox_oldest_seconds gauge
wagering_outbox_oldest_seconds 88846.490372

# HELP wagering_reconciliation_mismatch_total Observed ledger/wallet mismatch
# TYPE wagering_reconciliation_mismatch_total counter
wagering_reconciliation_mismatch_total 0
`;

describe('parsePrometheusText', () => {
  test('ignora linhas de comentário (# HELP / # TYPE) e linhas em branco', () => {
    const metrics = parsePrometheusText(REAL_SAMPLE);
    expect(metrics.has('wagering_transactions_total')).toBe(true);
  });

  test('lê um contador sem labels', () => {
    const metrics = parsePrometheusText(REAL_SAMPLE);
    expect(metrics.get('wagering_duplicates_total')).toEqual([{ labels: {}, value: 2 }]);
  });

  test('lê múltiplas séries com labels diferentes para o mesmo nome', () => {
    const metrics = parsePrometheusText(REAL_SAMPLE);
    const samples = metrics.get('wagering_transactions_total');
    expect(samples).toHaveLength(2);
    expect(samples?.[0]).toEqual({ labels: { status: 'PROCESSED' }, value: 10 });
    expect(samples?.[1]).toEqual({ labels: { status: 'REJECTED' }, value: 3 });
  });

  test('lê o label le="+Inf" do bucket final do histograma como string, não como número', () => {
    const metrics = parsePrometheusText(REAL_SAMPLE);
    const bucket = metrics.get('wagering_processing_seconds_bucket')?.find((s) => s.labels.le === '+Inf');
    expect(bucket?.value).toBe(17); // contagem cumulativa naquele bucket, não o label em si
  });

  test('interpreta +Inf/-Inf/NaN quando aparecem como VALOR da métrica (formato válido do Prometheus, caso sintético)', () => {
    const metrics = parsePrometheusText('synthetic_metric +Inf\nsynthetic_other -Inf\nsynthetic_nan NaN\n');
    expect(metrics.get('synthetic_metric')?.[0]?.value).toBe(Infinity);
    expect(metrics.get('synthetic_other')?.[0]?.value).toBe(-Infinity);
    expect(Number.isNaN(metrics.get('synthetic_nan')?.[0]?.value)).toBe(true);
  });

  test('uma série sem nenhuma amostra (ex.: contador com labels nunca incrementado) simplesmente não aparece no mapa', () => {
    const metrics = parsePrometheusText(REAL_SAMPLE);
    expect(metrics.has('wagering_retries_total')).toBe(false);
  });
});

describe('extractWageringMetrics', () => {
  const snapshot = extractWageringMetrics(parsePrometheusText(REAL_SAMPLE));

  test('agrupa transações por status real (nunca um status inventado)', () => {
    expect(snapshot.transactionsByStatus.get('PROCESSED')).toBe(10);
    expect(snapshot.transactionsByStatus.get('REJECTED')).toBe(3);
    expect(snapshot.transactionsByStatus.has('PENDING_REFERENCE')).toBe(false);
  });

  test('série ausente (retries) vira mapa vazio, não um erro', () => {
    expect(snapshot.retriesByKind.size).toBe(0);
  });

  test('extrai os escalares nomeados corretamente', () => {
    expect(snapshot.duplicates).toBe(2);
    expect(snapshot.deadLettered).toBe(0);
    expect(snapshot.lockConflicts).toBe(0);
    expect(snapshot.processingSecondsSum).toBeCloseTo(0.832);
    expect(snapshot.processingSecondsCount).toBe(17);
    expect(snapshot.outboxOldestSeconds).toBeCloseTo(88846.49, 1);
    expect(snapshot.reconciliationMismatches).toBe(0);
  });

  test('escalar sem nenhuma amostra na resposta vira null, não 0 (0 real e ausente são coisas diferentes)', () => {
    const empty = extractWageringMetrics(parsePrometheusText('# HELP x\n# TYPE x counter\n'));
    expect(empty.duplicates).toBeNull();
    expect(empty.outboxOldestSeconds).toBeNull();
  });

  test('conta métricas não reconhecidas (padrão de processo Node.js) sem inventar o que elas significam', () => {
    expect(snapshot.otherSeriesCount).toBeGreaterThan(0);
  });
});
