import { Workflow, ArrowRight, Info } from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatMoney } from '@/lib/money/format';
import { useLedgerSequence } from './useLedgerSequence';

/**
 * A sequência OPENING → BET → WIN → REFUND → ROLLBACK citada na especificação é só a ORDEM
 * POSSÍVEL de tipos de operação — o rótulo exibido por lançamento aqui é sempre CREDIT/DEBIT
 * (o que o ledger de fato devolve). O `kind` real (BET, WIN, etc.) só existe consultando a
 * transação específica — ver "Consultar transação por ID" ao lado.
 */
export function FinancialSequence({ walletId }: { walletId: string }) {
  const { query, chronological, possiblyTruncated, limit } = useLedgerSequence(walletId);

  return (
    <Panel
      heading={
        <span className="flex items-center gap-1.5">
          <Workflow className="h-3.5 w-3.5" aria-hidden="true" />
          Sequência financeira (da mais antiga para a mais nova)
        </span>
      }
    >
      {query.isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : query.isError ? (
        <ErrorState message={query.error instanceof Error ? query.error.message : 'Erro desconhecido.'} onRetry={() => void query.refetch()} />
      ) : chronological.length === 0 ? (
        <EmptyState icon={Workflow} title="Sem lançamentos" description="Esta wallet ainda não tem movimentações para visualizar como sequência." />
      ) : (
        <>
          <div className="flex flex-wrap items-stretch gap-2 overflow-x-auto pb-1">
            {chronological.map((entry, index) => (
              <div key={entry.id} className="flex items-center gap-2">
                <div className="min-w-[8rem] rounded-md border border-slate-800 bg-slate-950 p-2 text-center">
                  <p className={`text-xs font-semibold ${entry.direction === 'CREDIT' ? 'text-emerald-400' : 'text-red-400'}`}>
                    {entry.direction}
                  </p>
                  <p className="tabular-nums text-sm text-slate-200">{formatMoney(entry.money)}</p>
                  <p className="mt-1 text-[11px] text-slate-600">saldo → {formatMoney(entry.balanceAfter)}</p>
                </div>
                {index < chronological.length - 1 ? <ArrowRight className="h-4 w-4 shrink-0 text-slate-700" aria-hidden="true" /> : null}
              </div>
            ))}
          </div>
          {possiblyTruncated ? (
            <p className="mt-3 flex items-start gap-1.5 text-xs text-slate-600">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Esta wallet tem mais lançamentos do que os {limit} mais recentes mostrados aqui — os mais antigos
              (possivelmente incluindo o OPENING) não aparecem nesta visualização. Use a tabela do Ledger
              paginada para ver tudo.
            </p>
          ) : null}
        </>
      )}
    </Panel>
  );
}
