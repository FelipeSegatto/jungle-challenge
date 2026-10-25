import { Send, Inbox, FileCheck, Wallet, BookOpenCheck } from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import type { TimelineStep } from './types';
import type { ViewId } from '@/app/navigation';

const STEP_ICONS = [Send, Inbox, FileCheck, Wallet];

/**
 * Mostra só o que o frontend de fato observou, na ordem em que observou — nenhum passo aqui
 * representa "lock adquirido" ou "commit no banco": essas são garantias internas do backend sem
 * instrumentação visível por HTTP, então não aparecem. "Resposta recebida" e "Estado da
 * transação" têm o MESMO timestamp de propósito: os dois vêm do mesmo corpo de resposta.
 */
export function TransactionTimeline({ steps, onNavigate }: { steps: readonly TimelineStep[]; onNavigate: (view: ViewId) => void }) {
  return (
    <Panel heading="Linha do tempo (eventos observados pelo frontend)">
      {steps.length === 0 ? (
        <p className="text-sm text-slate-600">Execute uma operação para ver os passos observados aqui.</p>
      ) : (
        <ol className="space-y-3" role="list">
          {steps.map((step, index) => {
            const Icon = STEP_ICONS[index] ?? FileCheck;
            return (
              <li key={step.id} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-800 text-slate-400">
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-sm text-slate-200">{step.label}</p>
                  {step.detail ? <p className="text-xs text-slate-500">{step.detail}</p> : null}
                  <p className="font-mono text-[11px] text-slate-600">{step.timestamp.toLocaleTimeString('pt-BR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 } as Intl.DateTimeFormatOptions)}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <div className="mt-3 border-t border-slate-800 pt-3">
        <Button variant="ghost" onClick={() => onNavigate('ledger')}>
          <BookOpenCheck className="h-4 w-4" aria-hidden="true" />
          Ver no Ledger &amp; Reconciliation
        </Button>
      </div>
    </Panel>
  );
}
