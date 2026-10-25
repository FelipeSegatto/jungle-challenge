import { ServerCog, WifiOff } from 'lucide-react';
import { useInstancesHealth, type HealthState } from './useInstancesHealth';
import { Panel } from '@/components/ui/Panel';
import { StatusPill } from '@/components/ui/StatusPill';
import type { Tone } from '@/lib/ui/styles';

const STATE_TONE: Record<HealthState, Tone> = { ok: 'success', down: 'danger', loading: 'neutral' };
const STATE_LABEL: Record<HealthState, string> = { ok: 'ok', down: 'indisponível', loading: 'verificando' };

/**
 * Consulta /health/live e /health/ready das 3 instâncias configuradas no proxy do Vite. Uma
 * instância fora do ar nunca derruba as outras nem a aplicação — cada card é independente.
 */
export function HealthDashboard() {
  const instances = useInstancesHealth();

  return (
    <section aria-labelledby="health-heading" className="space-y-4">
      <h2 id="health-heading" className="flex items-center gap-2 text-sm font-semibold text-slate-300">
        <ServerCog className="h-4 w-4" aria-hidden="true" />
        Instâncias do backend
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {instances.map(({ instance, live, ready, errorMessage, dependencies, lastCheckedAt }) => (
          <Panel key={instance} heading={<span className="font-mono">{instance}</span>}>
            <dl className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-slate-500">live</dt>
                <dd>
                  <StatusPill tone={STATE_TONE[live]}>{STATE_LABEL[live]}</StatusPill>
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-500">ready</dt>
                <dd>
                  <StatusPill tone={STATE_TONE[ready]}>{STATE_LABEL[ready]}</StatusPill>
                </dd>
              </div>
              {dependencies ? (
                <>
                  <div className="flex items-center justify-between pl-3">
                    <dt className="text-xs text-slate-600">↳ postgres</dt>
                    <dd className="text-xs text-emerald-400">{dependencies.postgres}</dd>
                  </div>
                  <div className="flex items-center justify-between pl-3">
                    <dt className="text-xs text-slate-600">↳ sqs</dt>
                    <dd className="text-xs text-emerald-400">{dependencies.sqs}</dd>
                  </div>
                </>
              ) : null}
            </dl>
            {errorMessage ? (
              <p className="mt-3 flex items-start gap-1.5 border-t border-slate-800 pt-2 text-xs text-slate-500">
                <WifiOff className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{errorMessage}</span>
              </p>
            ) : null}
            {lastCheckedAt ? (
              <p className="mt-2 text-[11px] text-slate-600">
                Verificado às {lastCheckedAt.toLocaleTimeString('pt-BR')}
              </p>
            ) : null}
          </Panel>
        ))}
      </div>
    </section>
  );
}
