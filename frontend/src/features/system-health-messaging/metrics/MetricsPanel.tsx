import { RefreshCw, Gauge as GaugeIcon } from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { StatusPill } from '@/components/ui/StatusPill';
import { useWageringMetrics } from './useWageringMetrics';
import type { WageringMetricsSnapshot } from './prometheus';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="font-mono text-sm text-slate-200">{value}</dd>
    </div>
  );
}

function formatSeconds(value: number | null): string {
  if (value === null) return '—';
  if (value >= 60) return `${(value / 60).toFixed(1)} min`;
  return `${value.toFixed(3)} s`;
}

function SnapshotView({ snapshot }: { snapshot: WageringMetricsSnapshot }) {
  const statuses = Array.from(snapshot.transactionsByStatus.entries());
  const retries = Array.from(snapshot.retriesByKind.entries());
  const avgProcessing =
    snapshot.processingSecondsCount && snapshot.processingSecondsCount > 0 && snapshot.processingSecondsSum !== null
      ? snapshot.processingSecondsSum / snapshot.processingSecondsCount
      : null;

  return (
    <dl className="divide-y divide-slate-800">
      <div className="pb-2">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Transações processadas (por status)</p>
        {statuses.length === 0 ? (
          <p className="text-xs text-slate-600">Nenhuma ainda neste processo.</p>
        ) : (
          statuses.map(([status, count]) => <Row key={status} label={status} value={String(count)} />)
        )}
      </div>
      <div className="py-2">
        <Row label="Duplicatas (replay idempotente)" value={snapshot.duplicates !== null ? String(snapshot.duplicates) : '—'} />
        <Row label="Conflitos de lock (PostgreSQL)" value={snapshot.lockConflicts !== null ? String(snapshot.lockConflicts) : '—'} />
        <Row label="Enviadas direto à DLQ pelo consumer" value={snapshot.deadLettered !== null ? String(snapshot.deadLettered) : '—'} />
        <Row label="Divergências de reconciliação" value={snapshot.reconciliationMismatches !== null ? String(snapshot.reconciliationMismatches) : '—'} />
      </div>
      <div className="py-2">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Retries (por tipo)</p>
        {retries.length === 0 ? (
          <p className="text-xs text-slate-600">Nenhum retry ainda neste processo.</p>
        ) : (
          retries.map(([kind, count]) => <Row key={kind} label={kind} value={String(count)} />)
        )}
      </div>
      <div className="py-2">
        <Row label="Latência média de commit" value={formatSeconds(avgProcessing)} />
        <Row
          label="Amostras de latência"
          value={snapshot.processingSecondsCount !== null ? String(snapshot.processingSecondsCount) : '—'}
        />
        <Row label="Outbox lag (calculado ao vivo)" value={formatSeconds(snapshot.outboxOldestSeconds)} />
      </div>
      <p className="pt-2 text-[11px] text-slate-600">
        {snapshot.otherSeriesCount} outras séries presentes na resposta (métricas padrão de processo Node.js — CPU, memória, event loop —
        não específicas do domínio financeiro, não exibidas individualmente aqui).
      </p>
    </dl>
  );
}

/**
 * Parte B. Cada instância tem seu PRÓPRIO registro de métricas em memória (um processo Node.js
 * independente) — nunca somamos os 3 cartões num "total do sistema": isso inventaria uma métrica
 * global que a API não fornece. São contadores cumulativos desde que aquele processo iniciou, não
 * uma série histórica — por isso não há gráfico aqui, só o valor atual.
 */
export function MetricsPanel() {
  const metrics = useWageringMetrics();

  return (
    <section aria-labelledby="metrics-heading" className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 id="metrics-heading" className="flex items-center gap-2 text-sm font-semibold text-slate-300">
          <GaugeIcon className="h-4 w-4" aria-hidden="true" />
          Métricas (por instância — contadores cumulativos deste processo)
        </h2>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {metrics.map((entry) => (
          <Panel
            key={entry.instance}
            heading={<span className="font-mono">{entry.instance}</span>}
            actions={
              <Button variant="ghost" onClick={entry.refetch} disabled={entry.isFetching}>
                <RefreshCw className={`h-4 w-4 ${entry.isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
              </Button>
            }
          >
            {entry.status === 'loading' ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            ) : entry.status === 'error' ? (
              <ErrorState message={entry.errorMessage ?? 'Não foi possível consultar as métricas desta instância.'} onRetry={entry.refetch} />
            ) : entry.snapshot ? (
              <>
                <SnapshotView snapshot={entry.snapshot} />
                {entry.fetchedAt ? (
                  <p className="mt-2 flex items-center gap-1 text-[11px] text-slate-600">
                    <StatusPill tone="info">consultado</StatusPill>
                    às {entry.fetchedAt.toLocaleTimeString('pt-BR')}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-xs text-slate-600">Sem métricas disponíveis nesta resposta.</p>
            )}
          </Panel>
        ))}
      </div>
    </section>
  );
}
