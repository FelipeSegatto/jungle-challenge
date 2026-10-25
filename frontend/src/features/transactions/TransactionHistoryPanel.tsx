import { History } from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { StatusPill } from '@/components/ui/StatusPill';
import { useTransactionHistory } from '@/lib/transaction-history/TransactionHistoryContext';
import type { Tone } from '@/lib/ui/styles';
import type { WagerStatus } from '@/types/api';

const STATUS_TONE: Record<WagerStatus, Tone> = {
  PROCESSED: 'success',
  REJECTED: 'danger',
  PENDING_REFERENCE: 'warning',
  FAILED: 'danger',
};

/** Operações realmente executadas nesta aba — não é o ledger do backend, é só o que este navegador fez. */
export function TransactionHistoryPanel() {
  const { entries } = useTransactionHistory();

  return (
    <Panel
      heading={
        <span className="flex items-center gap-1.5">
          <History className="h-3.5 w-3.5" aria-hidden="true" />
          Operações desta sessão (local)
        </span>
      }
    >
      <p className="mb-2 text-xs text-slate-500">
        Histórico local do navegador — não substitui o ledger auditável do backend.
      </p>
      {entries.length === 0 ? (
        <p className="text-sm text-slate-600">Nenhuma operação executada ainda nesta sessão.</p>
      ) : (
        <ul className="space-y-1.5" role="list">
          {entries.map((entry) => (
            <li key={entry.localId} className="flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 overflow-hidden">
                <span className="shrink-0 font-mono text-slate-500">{entry.timestamp.toLocaleTimeString('pt-BR')}</span>
                <span className="shrink-0 font-semibold text-slate-300">{entry.kind}</span>
                <span className="truncate text-slate-500">{entry.externalTransactionId}</span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="tabular-nums text-slate-400">
                  {entry.amount} {entry.currency}
                </span>
                {entry.idempotentReplay ? <span className="text-blue-400">replay</span> : null}
                <StatusPill tone={STATUS_TONE[entry.status]}>{entry.status}</StatusPill>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
