import { useState, type FormEvent } from 'react';
import { Search, FileSearch } from 'lucide-react';
import { z } from 'zod';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusPill } from '@/components/ui/StatusPill';
import { CopyButton } from '@/components/ui/CopyButton';
import { focusRing } from '@/lib/ui/styles';
import type { Tone } from '@/lib/ui/styles';
import { formatMoney } from '@/lib/money/format';
import { useTransactionDetail } from './useTransactionDetail';
import { useTransactionHistory } from '@/lib/transaction-history/TransactionHistoryContext';
import type { WagerStatus } from '@/types/api';

const STATUS_TONE: Record<WagerStatus, Tone> = {
  PROCESSED: 'success',
  REJECTED: 'danger',
  PENDING_REFERENCE: 'warning',
  FAILED: 'danger',
};

const idSchema = z.string().uuid('Informe um UUID de transação válido');

/**
 * GET /wagering/transactions/:id usado sob demanda — nunca disparado automaticamente. Oferece as
 * transações desta sessão (Transactions, lib/transaction-history) como atalho real, já que o
 * ledger não traz o transactionId de cada lançamento para vincular.
 */
export function TransactionLookupPanel() {
  const [input, setInput] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { entries } = useTransactionHistory();
  const query = useTransactionDetail(activeId);

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault();
    const parsed = idSchema.safeParse(input.trim());
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'id inválido');
      return;
    }
    setError(null);
    setActiveId(parsed.data);
  };

  return (
    <Panel
      heading={
        <span className="flex items-center gap-1.5">
          <FileSearch className="h-3.5 w-3.5" aria-hidden="true" />
          Consultar transação por ID
        </span>
      }
    >
      <form onSubmit={handleSubmit} className="mb-3 flex items-end gap-2" noValidate>
        <div className="flex-1">
          <label htmlFor="tx-lookup" className="mb-1 block text-xs font-medium text-slate-400">
            transactionId (UUID interno)
          </label>
          <input
            id="tx-lookup"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="0192f298-345e-7e38-af88-e43f851a819d"
            className={`w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 ${focusRing}`}
            aria-invalid={Boolean(error)}
          />
          {error ? <p className="mt-1 text-xs text-red-400">{error}</p> : null}
        </div>
        <Button type="submit" variant="secondary">
          <Search className="h-4 w-4" aria-hidden="true" />
          Buscar
        </Button>
      </form>

      {entries.length > 0 ? (
        <div className="mb-3 flex flex-wrap gap-1.5">
          <span className="text-xs text-slate-600">Desta sessão:</span>
          {entries.slice(0, 6).map((entry) => (
            <button
              key={entry.localId}
              type="button"
              onClick={() => {
                setInput(entry.transactionId);
                setActiveId(entry.transactionId);
                setError(null);
              }}
              className="rounded border border-slate-800 px-1.5 py-0.5 font-mono text-[11px] text-slate-500 hover:border-emerald-600 hover:text-emerald-300"
            >
              {entry.kind} {entry.transactionId.slice(0, 8)}…
            </button>
          ))}
        </div>
      ) : null}

      {!activeId ? (
        <EmptyState icon={FileSearch} title="Nenhuma consulta ainda" description="Informe um transactionId ou escolha uma operação desta sessão acima." />
      ) : query.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : query.isError ? (
        <ErrorState message={query.error instanceof Error ? query.error.message : 'Erro desconhecido.'} onRetry={() => void query.refetch()} />
      ) : query.data ? (
        <dl className="divide-y divide-slate-800 text-sm">
          <div className="flex items-center justify-between py-1.5">
            <dt className="text-xs text-slate-500">Transaction ID</dt>
            <dd className="flex items-center gap-1 font-mono text-slate-200">
              {query.data.transactionId}
              <CopyButton value={query.data.transactionId} label="Transaction ID" />
            </dd>
          </div>
          <div className="flex items-center justify-between py-1.5">
            <dt className="text-xs text-slate-500">kind</dt>
            <dd className="font-mono text-slate-200">{query.data.kind}</dd>
          </div>
          <div className="flex items-center justify-between py-1.5">
            <dt className="text-xs text-slate-500">status</dt>
            <dd>
              <StatusPill tone={STATUS_TONE[query.data.status]}>{query.data.status}</StatusPill>
            </dd>
          </div>
          {query.data.failureCode ? (
            <div className="flex items-center justify-between py-1.5">
              <dt className="text-xs text-slate-500">failureCode</dt>
              <dd className="font-mono text-xs text-red-300">{query.data.failureCode}</dd>
            </div>
          ) : null}
          <div className="flex items-center justify-between py-1.5">
            <dt className="text-xs text-slate-500">providerId</dt>
            <dd className="font-mono text-slate-200">{query.data.providerId}</dd>
          </div>
          <div className="flex items-center justify-between py-1.5">
            <dt className="text-xs text-slate-500">externalTransactionId</dt>
            <dd className="font-mono text-slate-200">{query.data.externalTransactionId}</dd>
          </div>
          {query.data.referenceExternalTransactionId ? (
            <div className="flex items-center justify-between py-1.5">
              <dt className="text-xs text-slate-500">referência</dt>
              <dd className="font-mono text-slate-200">{query.data.referenceExternalTransactionId}</dd>
            </div>
          ) : null}
          <div className="flex items-center justify-between py-1.5">
            <dt className="text-xs text-slate-500">balance (no momento)</dt>
            <dd className="tabular-nums text-slate-200">{query.data.balance ? formatMoney(query.data.balance) : '—'}</dd>
          </div>
        </dl>
      ) : null}
    </Panel>
  );
}
