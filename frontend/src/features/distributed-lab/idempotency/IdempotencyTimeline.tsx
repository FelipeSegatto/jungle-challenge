import { Activity } from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import type { LabTimelineStep } from './useIdempotencyLab';

/** Só os eventos que o frontend de fato observou (chamadas disparadas e respostas recebidas), na ordem em que chegaram. */
export function IdempotencyTimeline({ steps }: { steps: readonly LabTimelineStep[] }) {
  return (
    <Panel heading="Linha do tempo do laboratório">
      {steps.length === 0 ? (
        <p className="text-sm text-slate-600">Execute algum cenário para ver os passos observados aqui.</p>
      ) : (
        <ol className="space-y-3" role="list">
          {steps.map((step) => (
            <li key={step.id} className="flex items-start gap-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-800 text-slate-400">
                <Activity className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
              <div>
                <p className="text-sm text-slate-200">{step.label}</p>
                {step.detail ? <p className="text-xs text-slate-500">{step.detail}</p> : null}
                <p className="font-mono text-[11px] text-slate-600">
                  {step.timestamp.toLocaleTimeString('pt-BR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 } as Intl.DateTimeFormatOptions)}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
