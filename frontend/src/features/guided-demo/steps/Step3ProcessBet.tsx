import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Play, Wallet as WalletIcon } from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusPill } from '@/components/ui/StatusPill';
import { focusRing } from '@/lib/ui/styles';
import { WalletDetails } from '@/features/wallets/WalletDetails';
import { useWallet } from '@/features/wallets/useWallet';
import { useSubmitTransaction } from '@/features/transactions/useSubmitTransaction';
import { getLedgerPage } from '@/features/ledger/api';
import { useInspectedRequest } from '@/lib/api/useInspectedRequest';
import { useSelectedInstance } from '@/lib/instance/InstanceContext';
import { useSelectedWallet } from '@/lib/wallet/SelectedWalletContext';
import { processWagerSchema } from '@/types/schemas';
import { ApiRequestError, ApiConnectionError } from '@/lib/api/client';
import type { StepOutcome } from '../steps';
import type { WagerSubmissionResult } from '@/types/api';

/** Mesmo hook usado na página Transactions (useSubmitTransaction) — nenhuma chamada HTTP nova aqui. */
export function Step3ProcessBet({ onOutcome }: { onOutcome: (outcome: StepOutcome) => void }) {
  const { selectedWalletId } = useSelectedWallet();
  const walletQuery = useWallet(selectedWalletId);
  const call = useInspectedRequest();
  const { selected: instance } = useSelectedInstance();
  const mutation = useSubmitTransaction();

  const [amount, setAmount] = useState('15.00');
  const [externalTransactionId, setExternalTransactionId] = useState(() => `guided-demo-bet-${crypto.randomUUID().slice(0, 8)}`);
  const [result, setResult] = useState<WagerSubmissionResult | null>(null);
  const [httpStatus, setHttpStatus] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const ledgerQuery = useQuery({
    queryKey: ['guided-demo-latest-ledger', instance, selectedWalletId, result?.transactionId],
    queryFn: ({ signal }) => getLedgerPage(instance, selectedWalletId as string, { cursor: null, limit: 1 }, call, signal),
    enabled: selectedWalletId !== null && result !== null,
  });

  useEffect(() => {
    if (!selectedWalletId) onOutcome('pending');
    else if (!result) onOutcome('pending');
    else if (result.status === 'PROCESSED') onOutcome('pass');
    else if (result.status === 'REJECTED') onOutcome('fail');
    else onOutcome('inconclusive');
  }, [selectedWalletId, result, onOutcome]);

  if (!selectedWalletId || !walletQuery.data) {
    return <EmptyState icon={WalletIcon} title="Crie a wallet na Etapa 2 primeiro" description="Esta etapa precisa de uma wallet real já selecionada." />;
  }

  const wallet = walletQuery.data;

  const handleSubmit = async (): Promise<void> => {
    if (mutation.isPending) return;
    const payload = {
      providerId: 'guided-demo',
      externalTransactionId,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'guided-demo-round',
      gameId: 'guided-demo-game',
      kind: 'BET' as const,
      money: { amount, currency: wallet.balance.currency },
    };
    const parsed = processWagerSchema.safeParse(payload);
    if (!parsed.success) {
      setErrorMessage(parsed.error.issues[0]?.message ?? 'Payload inválido.');
      return;
    }
    setErrorMessage(null);
    try {
      const { result: outcome, httpStatus: status } = await mutation.mutateAsync({
        payload: parsed.data,
        idempotencyKey: `guided-demo:${externalTransactionId}`,
      });
      setResult(outcome);
      setHttpStatus(status);
    } catch (error) {
      if (error instanceof ApiRequestError) setErrorMessage(`${error.apiError.code}: ${error.apiError.message}`);
      else if (error instanceof ApiConnectionError) setErrorMessage(error.message);
      else setErrorMessage('Erro inesperado.');
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-4">
        <WalletDetails />
        <Panel heading="Nova BET">
          <div className="space-y-3">
            <div>
              <label htmlFor="guided-bet-amount" className="mb-1 block text-xs font-medium text-slate-400">
                money.amount ({wallet.balance.currency})
              </label>
              <input
                id="guided-bet-amount"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="decimal"
                className={`w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm tabular-nums text-slate-100 ${focusRing}`}
              />
            </div>
            {errorMessage ? <p role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-300">{errorMessage}</p> : null}
            <div className="flex items-center gap-2">
              <Button type="button" loading={mutation.isPending} disabled={mutation.isPending} onClick={() => void handleSubmit()}>
                <Play className="h-4 w-4" aria-hidden="true" />
                Executar BET
              </Button>
              {result ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setExternalTransactionId(`guided-demo-bet-${crypto.randomUUID().slice(0, 8)}`);
                    setResult(null);
                    setHttpStatus(null);
                  }}
                >
                  Nova BET (nova identidade)
                </Button>
              ) : null}
            </div>
          </div>
        </Panel>
      </div>

      <Panel heading="Resultado">
        {!result ? (
          <p className="text-sm text-slate-600">Execute a BET para ver a requisição, a resposta e o novo saldo aqui.</p>
        ) : (
          <dl className="divide-y divide-slate-800 text-sm">
            <div className="flex items-center justify-between py-1.5">
              <dt className="text-xs text-slate-500">HTTP</dt>
              <dd className="font-mono text-slate-200">{httpStatus}</dd>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <dt className="text-xs text-slate-500">Status</dt>
              <dd>
                <StatusPill tone={result.status === 'PROCESSED' ? 'success' : 'danger'}>{result.status}</StatusPill>
              </dd>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <dt className="text-xs text-slate-500">Novo saldo (reconsultado)</dt>
              <dd className="font-mono tabular-nums text-slate-200">{walletQuery.data?.balance.amount ?? '—'}</dd>
            </div>
            {ledgerQuery.data?.items[0] ? (
              <div className="flex items-center justify-between py-1.5">
                <dt className="text-xs text-slate-500">Último lançamento no ledger</dt>
                <dd className="font-mono tabular-nums text-slate-200">
                  {ledgerQuery.data.items[0].direction} {ledgerQuery.data.items[0].money.amount}
                </dd>
              </div>
            ) : null}
          </dl>
        )}
      </Panel>
    </div>
  );
}
