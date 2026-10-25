import { Scale, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { formatMoney } from '@/lib/money/format';
import { useReconciliation } from './useReconciliation';
import { ApiRequestError, ApiConnectionError } from '@/lib/api/client';

/**
 * Só consulta — POST /wallets/:id/reconciliation não altera nada no backend (é o próprio endpoint
 * de auditoria do desafio). Nenhum botão de corrigir saldo ou editar lançamento existe aqui de
 * propósito: essa página nunca escreve dado financeiro.
 */
export function ReconciliationPanel({ walletId }: { walletId: string }) {
  const mutation = useReconciliation(walletId);

  const errorMessage =
    mutation.error instanceof ApiRequestError
      ? `${mutation.error.apiError.code}: ${mutation.error.apiError.message}`
      : mutation.error instanceof ApiConnectionError
        ? mutation.error.message
        : null;

  return (
    <Panel
      heading={
        <span className="flex items-center gap-1.5">
          <Scale className="h-3.5 w-3.5" aria-hidden="true" />
          Reconciliação
        </span>
      }
      actions={
        <Button variant="secondary" onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={mutation.isPending}>
          Verificar agora
        </Button>
      }
    >
      {!mutation.data && !mutation.isError ? (
        <p className="text-sm text-slate-600">
          Soma o ledger inteiro (CREDIT − DEBIT) e compara com o saldo materializado da wallet — clique em
          &quot;Verificar agora&quot; para rodar.
        </p>
      ) : errorMessage ? (
        <ErrorState message={errorMessage} onRetry={() => mutation.mutate()} />
      ) : mutation.data ? (
        <div className="space-y-3">
          {mutation.data.consistent ? (
            <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-2.5 text-sm text-emerald-300">
              <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              Saldo consistente com o ledger.
            </div>
          ) : (
            <div role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
              <p className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                Divergência encontrada entre o saldo e o ledger
              </p>
              <p className="mt-1 text-red-300/90">
                Diferença real: <span className="font-mono">{formatMoney(mutation.data.difference)}</span>
              </p>
              <p className="mt-1 text-xs text-red-300/70">
                Isto não é corrigido automaticamente pela API nem por esta tela — investigue o ledger completo
                da wallet antes de confiar no saldo exibido.
              </p>
            </div>
          )}
          <dl className="divide-y divide-slate-800 text-sm">
            <div className="flex items-center justify-between py-1.5">
              <dt className="text-xs text-slate-500">Wallet ID</dt>
              <dd className="font-mono text-xs text-slate-300">{mutation.data.walletId}</dd>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <dt className="text-xs text-slate-500">Stored balance</dt>
              <dd className="tabular-nums text-slate-200">{formatMoney(mutation.data.storedBalance)}</dd>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <dt className="text-xs text-slate-500">Calculated balance</dt>
              <dd className="tabular-nums text-slate-200">{formatMoney(mutation.data.calculatedBalance)}</dd>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <dt className="text-xs text-slate-500">Difference</dt>
              <dd className="tabular-nums text-slate-200">{formatMoney(mutation.data.difference)}</dd>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <dt className="text-xs text-slate-500">Consistent</dt>
              <dd className="font-mono text-slate-200">{String(mutation.data.consistent)}</dd>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <dt className="text-xs text-slate-500">Checked entries</dt>
              <dd className="tabular-nums text-slate-200">{mutation.data.checkedEntries}</dd>
            </div>
          </dl>
        </div>
      ) : null}
    </Panel>
  );
}
