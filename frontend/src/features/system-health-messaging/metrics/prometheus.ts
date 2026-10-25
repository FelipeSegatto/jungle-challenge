/**
 * Parser mínimo do formato de exposição do Prometheus (texto puro, não JSON) — só o suficiente
 * para ler o que `GET /health/metrics` devolve de verdade (biblioteca `prom-client` no backend,
 * confirmado em `src/infrastructure/metrics.ts` e por execução real: `curl http://localhost:3001/health/metrics`).
 * Não é uma lib de propósito geral (não cobre tudo do formato oficial, ex.: multi-linha de HELP
 * com escapes exóticos) — só o suficiente e correto para as métricas reais deste backend.
 */
export interface PrometheusSample {
  readonly labels: Readonly<Record<string, string>>;
  readonly value: number;
}

export type PrometheusMetrics = ReadonlyMap<string, readonly PrometheusSample[]>;

const LINE_PATTERN = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{[^}]*\})?\s+(\S+)(?:\s+\d+)?$/;
const LABEL_PATTERN = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g;

function parseValue(raw: string): number {
  if (raw === '+Inf') return Infinity;
  if (raw === '-Inf') return -Infinity;
  if (raw === 'NaN') return NaN;
  return Number(raw);
}

function parseLabels(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  const inner = raw.slice(1, -1);
  const labels: Record<string, string> = {};
  for (const match of inner.matchAll(LABEL_PATTERN)) {
    const key = match[1];
    const value = match[2];
    if (key !== undefined && value !== undefined) labels[key] = value.replace(/\\"/g, '"').replace(/\\n/g, '\n');
  }
  return labels;
}

export function parsePrometheusText(text: string): PrometheusMetrics {
  const metrics = new Map<string, PrometheusSample[]>();
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = LINE_PATTERN.exec(trimmed);
    if (!match) continue;
    const [, name, labelsRaw, valueRaw] = match;
    if (!name || valueRaw === undefined) continue;
    const sample: PrometheusSample = { labels: parseLabels(labelsRaw), value: parseValue(valueRaw) };
    const existing = metrics.get(name);
    if (existing) existing.push(sample);
    else metrics.set(name, [sample]);
  }
  return metrics;
}

/**
 * Nomes reais registrados em `src/infrastructure/metrics.ts` — nada aqui é inventado. As métricas
 * padrão de processo Node.js (`collectDefaultMetrics`, prefixo `wagering_process_*`/`wagering_nodejs_*`)
 * existem na resposta real mas não são específicas do domínio financeiro, então não são extraídas
 * individualmente — só contadas em `otherSeriesCount` para não esconder que existem.
 */
const KNOWN_SERIES_PREFIXES = [
  'wagering_transactions_total',
  'wagering_duplicates_total',
  'wagering_retries_total',
  'wagering_dlq_total',
  'wagering_lock_conflicts_total',
  'wagering_processing_seconds',
  'wagering_outbox_oldest_seconds',
  'wagering_reconciliation_mismatch_total',
] as const;

export interface WageringMetricsSnapshot {
  /** status -> contador cumulativo (só aparecem status que já ocorreram ao menos uma vez neste processo). */
  readonly transactionsByStatus: ReadonlyMap<string, number>;
  readonly duplicates: number | null;
  /** kind -> contador ('reference' | 'sqs' | 'outbox' — só aparecem depois do primeiro retry daquele tipo). */
  readonly retriesByKind: ReadonlyMap<string, number>;
  readonly deadLettered: number | null;
  readonly lockConflicts: number | null;
  readonly processingSecondsSum: number | null;
  readonly processingSecondsCount: number | null;
  /** Calculado ao vivo pelo backend a cada chamada (consulta real ao Postgres) — não é um contador cumulativo. */
  readonly outboxOldestSeconds: number | null;
  readonly reconciliationMismatches: number | null;
  /** Séries presentes na resposta mas não extraídas individualmente (métricas padrão de processo Node.js). */
  readonly otherSeriesCount: number;
}

function scalarOf(metrics: PrometheusMetrics, name: string): number | null {
  const samples = metrics.get(name);
  if (!samples || samples.length === 0) return null;
  return samples[0]?.value ?? null;
}

export function extractWageringMetrics(metrics: PrometheusMetrics): WageringMetricsSnapshot {
  const transactionsByStatus = new Map<string, number>();
  for (const sample of metrics.get('wagering_transactions_total') ?? []) {
    const status = sample.labels.status;
    if (status) transactionsByStatus.set(status, sample.value);
  }

  const retriesByKind = new Map<string, number>();
  for (const sample of metrics.get('wagering_retries_total') ?? []) {
    const kind = sample.labels.kind;
    if (kind) retriesByKind.set(kind, sample.value);
  }

  let otherSeriesCount = 0;
  for (const name of metrics.keys()) {
    const isKnown = KNOWN_SERIES_PREFIXES.some((prefix) => name === prefix || name.startsWith(`${prefix}_`));
    if (!isKnown) otherSeriesCount += 1;
  }

  return {
    transactionsByStatus,
    duplicates: scalarOf(metrics, 'wagering_duplicates_total'),
    retriesByKind,
    deadLettered: scalarOf(metrics, 'wagering_dlq_total'),
    lockConflicts: scalarOf(metrics, 'wagering_lock_conflicts_total'),
    processingSecondsSum: scalarOf(metrics, 'wagering_processing_seconds_sum'),
    processingSecondsCount: scalarOf(metrics, 'wagering_processing_seconds_count'),
    outboxOldestSeconds: scalarOf(metrics, 'wagering_outbox_oldest_seconds'),
    reconciliationMismatches: scalarOf(metrics, 'wagering_reconciliation_mismatch_total'),
    otherSeriesCount,
  };
}
