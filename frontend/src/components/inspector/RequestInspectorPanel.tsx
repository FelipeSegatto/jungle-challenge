import { Terminal } from 'lucide-react';
import { useRequestInspector } from '@/lib/inspector/RequestInspectorContext';
import { Panel } from '@/components/ui/Panel';
import { StatusPill } from '@/components/ui/StatusPill';
import { EmptyState } from '@/components/ui/EmptyState';
import type { Tone } from '@/lib/ui/styles';

function statusTone(statusCode: number | null): Tone {
  if (statusCode === null) return 'neutral';
  if (statusCode >= 200 && statusCode < 300) return 'success';
  if (statusCode === 202) return 'warning';
  if (statusCode >= 400 && statusCode < 500) return 'warning';
  return 'danger';
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-slate-500">{label}</p>
      <pre className="max-h-48 overflow-auto rounded-md border border-slate-800 bg-slate-950 p-2.5 text-xs text-slate-300">
        {value === undefined || value === null ? '—' : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

/**
 * Mostra a última chamada HTTP instrumentada via useInspectedRequest — método, endpoint,
 * instância, corpo enviado (redigido), status real, resposta e duração medida no navegador.
 * Reutilizado por Wallets e, nas próximas etapas, por Transactions.
 */
export function RequestInspectorPanel() {
  const { lastRequest } = useRequestInspector();

  return (
    <Panel
      heading={
        <span className="flex items-center gap-1.5">
          <Terminal className="h-3.5 w-3.5" aria-hidden="true" />
          Request Inspector
        </span>
      }
    >
      {!lastRequest ? (
        <EmptyState icon={Terminal} title="Nenhuma requisição ainda" description="Execute uma ação para ver método, endpoint, payload e resposta reais aqui." />
      ) : (
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-xs font-semibold text-slate-300">
              {lastRequest.method}
            </span>
            <span className="font-mono text-xs text-slate-400">{lastRequest.endpoint}</span>
            <StatusPill tone={statusTone(lastRequest.statusCode)}>
              {lastRequest.statusCode ?? 'sem resposta'}
            </StatusPill>
            <span className="text-xs text-slate-500">{lastRequest.durationMs.toFixed(0)} ms</span>
            <span className="text-xs text-slate-600">{lastRequest.timestamp.toLocaleTimeString('pt-BR')}</span>
          </div>
          <p className="text-xs text-slate-500">
            instância: <span className="font-mono text-slate-400">{lastRequest.instance}</span>
          </p>
          <JsonBlock label="Corpo enviado" value={lastRequest.requestBody} />
          <JsonBlock label="Resposta" value={lastRequest.responseBody} />
        </div>
      )}
    </Panel>
  );
}
