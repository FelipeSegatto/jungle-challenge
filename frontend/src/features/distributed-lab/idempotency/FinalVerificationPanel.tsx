import { useState } from 'react';
import { ScanSearch } from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { StatusPill } from '@/components/ui/StatusPill';
import { reconcileWallet } from '@/features/ledger/api';
import { useInspectedRequest } from '@/lib/api/useInspectedRequest';
import { useSelectedInstance } from '@/lib/instance/InstanceContext';
import { ApiRequestError, ApiConnectionError } from '@/lib/api/client';
import type { Reconciliation } from '@/types/api';

/**
 * Verificação final honesta: chama de verdade GET /wallets/:id (via refetch do chamador) e
 * POST /wallets/:id/reconciliation — nunca recalcula saldo/ledger no cliente. É a evidência de
 * que os cenários acima não deixaram a wallet num estado inconsistente.
 */
export function FinalVerificationPanel({ walletId, onRefreshWallet }: { walletId: string; onRefreshWallet: () => void }) {
  const call = useInspectedRequest();
  const { selected: instance } = useSelectedInstance();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Reconciliation | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCheck = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      onRefreshWallet();
      const reconciliation = await reconcileWallet(instance, walletId, call);
      setResult(reconciliation);
    } catch (cause) {
      if (cause instanceof ApiRequestError) setError(`${cause.apiError.code}: ${cause.apiError.message}`);
      else if (cause instanceof ApiConnectionError) setError(cause.message);
      else setError('Erro inesperado ao verificar.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel heading="Verificação final — saldo e ledger">
      <div className="space-y-3">
        <p className="text-xs text-slate-500">
          Reconsulta o saldo real da wallet e roda a reconciliação de verdade (soma do ledger contra o saldo materializado) — a mesma usada na página
          Ledger &amp; Reconciliation, sem recalcular nada no frontend.
        </p>
        <Button type="button" variant="secondary" loading={busy} disabled={busy} onClick={() => void handleCheck()}>
          <ScanSearch className="h-4 w-4" aria-hidden="true" />
          Verificar saldo e ledger agora
        </Button>
        {error ? <p role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</p> : null}
        {result ? (
          <dl className="divide-y divide-slate-800 text-sm">
            <div className="flex items-center justify-between py-1.5">
              <dt className="text-xs text-slate-500">Saldo armazenado</dt>
              <dd className="font-mono tabular-nums text-slate-200">{result.storedBalance.amount} {result.storedBalance.currency}</dd>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <dt className="text-xs text-slate-500">Saldo calculado (soma do ledger)</dt>
              <dd className="font-mono tabular-nums text-slate-200">{result.calculatedBalance.amount} {result.calculatedBalance.currency}</dd>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <dt className="text-xs text-slate-500">Diferença</dt>
              <dd className="font-mono tabular-nums text-slate-200">{result.difference.amount} {result.difference.currency}</dd>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <dt className="text-xs text-slate-500">Lançamentos verificados</dt>
              <dd className="font-mono text-slate-200">{result.checkedEntries}</dd>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <dt className="text-xs text-slate-500">Consistente</dt>
              <dd>
                <StatusPill tone={result.consistent ? 'success' : 'danger'}>{result.consistent ? 'sim' : 'não'}</StatusPill>
              </dd>
            </div>
          </dl>
        ) : null}
      </div>
    </Panel>
  );
}
