import { BookOpenCheck, ChevronLeft, ChevronRight, RefreshCw, Inbox, Info, MoveHorizontal } from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { EmptyState } from '@/components/ui/EmptyState';
import { CopyButton } from '@/components/ui/CopyButton';
import { formatMoney } from '@/lib/money/format';
import { useLedgerPage } from './useLedgerPage';
import type { LedgerEntry } from '@/types/api';

function DirectionBadge({ direction }: { direction: LedgerEntry['direction'] }) {
  const isCredit = direction === 'CREDIT';
  return (
    <span className={`font-mono text-xs font-semibold ${isCredit ? 'text-emerald-400' : 'text-red-400'}`}>
      {isCredit ? '+ CREDIT' : '− DEBIT'}
    </span>
  );
}

export function LedgerTable({ walletId }: { walletId: string }) {
  const { query, pageNumber, hasPreviousPage, hasNextPage, goToNextPage, goToPreviousPage, pageSize } = useLedgerPage(walletId);

  return (
    <Panel
      heading={
        <span className="flex items-center gap-1.5">
          <BookOpenCheck className="h-3.5 w-3.5" aria-hidden="true" />
          Ledger
        </span>
      }
      actions={
        <Button variant="ghost" onClick={() => void query.refetch()} disabled={query.isFetching}>
          <RefreshCw className={`h-4 w-4 ${query.isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
          Atualizar
        </Button>
      }
    >
      {query.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      ) : query.isError ? (
        <ErrorState message={query.error instanceof Error ? query.error.message : 'Erro desconhecido.'} onRetry={() => void query.refetch()} />
      ) : !query.data || query.data.items.length === 0 ? (
        <EmptyState icon={Inbox} title="Nenhum lançamento" description="Esta wallet ainda não tem movimentações no ledger." />
      ) : (
        <>
          <p className="mb-2 flex items-center gap-1.5 text-xs text-slate-500 sm:hidden">
            <MoveHorizontal className="h-3.5 w-3.5 shrink-0 animate-pulse" aria-hidden="true" />
            Deslize a tabela para o lado para ver todas as colunas
          </p>
          <div className="relative">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-xs text-slate-500">
                    <th className="py-3 pr-6 font-medium">ID do lançamento</th>
                    <th className="py-3 pr-6 font-medium">Direção</th>
                    <th className="py-3 pr-6 text-right font-medium">Valor</th>
                    <th className="py-3 pr-6 text-right font-medium">Saldo antes</th>
                    <th className="py-3 pr-6 text-right font-medium">Saldo depois</th>
                    <th className="py-3 pr-4 font-medium">Quando</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {query.data.items.map((entry) => (
                    <tr key={entry.id} className="text-slate-300">
                      <td className="py-3 pr-6">
                        <span className="inline-flex items-center gap-1.5 font-mono text-xs text-slate-400">
                          {entry.id.slice(0, 8)}…
                          <CopyButton value={entry.id} label="ID do lançamento" />
                        </span>
                      </td>
                      <td className="py-3 pr-6">
                        <DirectionBadge direction={entry.direction} />
                      </td>
                      <td className="py-3 pr-6 text-right tabular-nums">{formatMoney(entry.money)}</td>
                      <td className="py-3 pr-6 text-right tabular-nums text-slate-500">{formatMoney(entry.balanceBefore)}</td>
                      <td className="py-3 pr-6 text-right tabular-nums">{formatMoney(entry.balanceAfter)}</td>
                      <td className="py-3 pr-4 text-xs text-slate-500">{new Date(entry.createdAt).toLocaleString('pt-BR')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Dica visual de que há mais conteúdo pra rolar — some em telas largas, onde a tabela já cabe inteira. */}
            <div
              className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-slate-900/80 to-transparent sm:hidden"
              aria-hidden="true"
            />
          </div>

          <p className="mt-3 flex items-start gap-1.5 text-xs text-slate-600">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            O endpoint <code className="text-slate-500">GET /wallets/:id/ledger</code> não inclui o{' '}
            <code className="text-slate-500">transactionId</code> de cada lançamento (confirmado contra a API real) — por
            isso não há um link direto daqui para o detalhe da transação. Use a consulta por Transaction ID abaixo
            quando souber o id de uma operação.
          </p>

          <div className="mt-3 flex items-center justify-between border-t border-slate-800 pt-3 text-xs text-slate-500">
            <span>
              Página {pageNumber} · até {pageSize} por página · cursor opaco da API
            </span>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={goToPreviousPage} disabled={!hasPreviousPage || query.isFetching}>
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                Anterior
              </Button>
              <Button variant="secondary" onClick={goToNextPage} disabled={!hasNextPage || query.isFetching}>
                Próxima
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        </>
      )}
    </Panel>
  );
}
