import { WifiOff, Gauge } from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { StatusPill } from '@/components/ui/StatusPill';
import { Skeleton } from '@/components/ui/Skeleton';
import { toneClasses, type Tone } from '@/lib/ui/styles';
import type { ExtendedInstanceHealth, OverallStatus } from './useExtendedHealth';

const OVERALL_TONE: Record<OverallStatus, Tone> = {
  healthy: 'success',
  unhealthy: 'warning',
  unavailable: 'danger',
  checking: 'neutral',
};

const OVERALL_LABEL: Record<OverallStatus, string> = {
  healthy: 'healthy',
  unhealthy: 'unhealthy',
  unavailable: 'unavailable',
  checking: 'verificando',
};

function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return '—';
  return `${ms.toFixed(0)} ms`;
}

/**
 * Um servidor que responde `live` mas não `ready` NÃO é "saudável" — é `unhealthy` (servidor
 * acessível, dependência com problema). Só `live` falhando vira `unavailable`. Essa distinção é
 * intencional, não um detalhe visual (ver a regra do enunciado sobre não confundir os dois).
 */
export function InstanceHealthCard({ health }: { health: ExtendedInstanceHealth }) {
  const tone = OVERALL_TONE[health.overall];
  const classes = toneClasses[tone];
  const responseTime = health.readyDurationMs ?? health.liveDurationMs;

  return (
    <Panel
      heading={<span className="font-mono">{health.instance}</span>}
      actions={<StatusPill tone={tone}>{OVERALL_LABEL[health.overall]}</StatusPill>}
      className={health.overall !== 'healthy' && health.overall !== 'checking' ? `border-l-2 ${classes.border}` : undefined}
    >
      {health.overall === 'checking' ? (
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : (
        <dl className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <dt className="text-slate-500">liveness</dt>
            <dd>
              <StatusPill tone={health.live === 'ok' ? 'success' : 'danger'}>{health.live === 'ok' ? 'ok' : 'indisponível'}</StatusPill>
            </dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-slate-500">readiness</dt>
            <dd>
              <StatusPill tone={health.ready === 'ok' ? 'success' : 'danger'}>{health.ready === 'ok' ? 'ok' : 'indisponível'}</StatusPill>
            </dd>
          </div>
          {health.dependencies ? (
            <>
              <div className="flex items-center justify-between pl-3">
                <dt className="text-xs text-slate-600">↳ postgres</dt>
                <dd className="text-xs text-emerald-400">{health.dependencies.postgres}</dd>
              </div>
              <div className="flex items-center justify-between pl-3">
                <dt className="text-xs text-slate-600">↳ sqs</dt>
                <dd className="text-xs text-emerald-400">{health.dependencies.sqs}</dd>
              </div>
            </>
          ) : null}
          <div className="flex items-center justify-between border-t border-slate-800 pt-2">
            <dt className="flex items-center gap-1 text-xs text-slate-500">
              <Gauge className="h-3.5 w-3.5" aria-hidden="true" />
              Tempo de resposta (navegador)
            </dt>
            <dd className="font-mono text-xs text-slate-300">{formatDuration(responseTime)}</dd>
          </div>
          {health.lastCheckedAt ? (
            <div className="flex items-center justify-between">
              <dt className="text-xs text-slate-500">Última verificação</dt>
              <dd className="text-xs text-slate-400">{health.lastCheckedAt.toLocaleTimeString('pt-BR')}</dd>
            </div>
          ) : null}
        </dl>
      )}

      {health.errorKind === 'dependency-unavailable' ? (
        <p role="alert" className="mt-3 flex items-start gap-1.5 border-t border-amber-500/20 pt-2 text-xs text-amber-300">
          <WifiOff className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            Servidor acessível, mas uma dependência não está pronta: {health.errorMessage}
            <br />
            <span className="text-amber-400/60">
              (nota: o backend devolve <code className="font-mono">code: &quot;HTTP_VALIDATION_ERROR&quot;</code> nesse 503, um detalhe real porém
              enganoso — a classificação acima usa o HTTP status, não esse campo.)
            </span>
          </span>
        </p>
      ) : health.errorKind === 'connection' ? (
        <p role="alert" className="mt-3 flex items-start gap-1.5 border-t border-red-500/20 pt-2 text-xs text-red-300">
          <WifiOff className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{health.errorMessage}</span>
        </p>
      ) : health.errorKind === 'unknown' && health.errorMessage ? (
        <p role="alert" className="mt-3 flex items-start gap-1.5 border-t border-red-500/20 pt-2 text-xs text-red-300">
          <WifiOff className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{health.errorMessage}</span>
        </p>
      ) : null}
    </Panel>
  );
}
