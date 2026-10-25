import { useState } from 'react';
import { Dices, PlusCircle } from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { focusRing } from '@/lib/ui/styles';
import { createWalletSchema } from '@/types/schemas';
import { useCreateWallet } from './useCreateWallet';
import { useSelectedWallet } from '@/lib/wallet/SelectedWalletContext';
import { useToast } from '@/lib/toast/ToastContext';
import { useSessionHistory } from '@/lib/session-history/SessionHistoryContext';
import { ApiRequestError, ApiConnectionError } from '@/lib/api/client';

const CONFLICT_MESSAGE = 'Já existe uma wallet para esse playerId + moeda. Gere um novo playerId ou consulte a wallet existente.';

export function CreateWalletForm() {
  const [playerId, setPlayerId] = useState('');
  const [amount, setAmount] = useState('100.00');
  const [currency, setCurrency] = useState('BRL');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const mutation = useCreateWallet();
  const { recordWalletUsage } = useSelectedWallet();
  const { pushToast } = useToast();
  const { logEvent } = useSessionHistory();

  const handleSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
    if (mutation.isPending) return; // nunca permite um segundo POST enquanto o primeiro está em voo

    const parsed = createWalletSchema.safeParse({ playerId, initialBalance: { amount, currency } });
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) errors[issue.path.join('.')] = issue.message;
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});

    mutation.mutate(parsed.data, {
      onSuccess: (wallet) => {
        recordWalletUsage({ walletId: wallet.id, playerId: wallet.playerId });
        logEvent(`Wallet criada: ${wallet.id} (saldo inicial ${wallet.balance.amount} ${wallet.balance.currency})`);
        pushToast({ variant: 'success', title: 'Wallet criada', description: wallet.id });
      },
      onError: (error) => {
        if (error instanceof ApiRequestError) {
          logEvent(`Falha ao criar wallet: ${error.apiError.code}`);
          pushToast({ variant: 'error', title: 'Não foi possível criar a wallet', description: error.apiError.message });
        } else if (error instanceof ApiConnectionError) {
          pushToast({ variant: 'error', title: 'Instância indisponível', description: error.message });
        }
      },
    });
  };

  const conflict =
    mutation.isError && mutation.error instanceof ApiRequestError && mutation.error.apiError.code === 'WALLET_ALREADY_EXISTS';
  const genericApiError =
    mutation.isError && mutation.error instanceof ApiRequestError && mutation.error.apiError.code !== 'WALLET_ALREADY_EXISTS'
      ? mutation.error.apiError
      : null;
  const connectionError = mutation.isError && mutation.error instanceof ApiConnectionError ? mutation.error : null;

  return (
    <Panel heading="Criar wallet">
      <form onSubmit={handleSubmit} className="space-y-3" noValidate>
        <div>
          <label htmlFor="playerId" className="mb-1 block text-xs font-medium text-slate-400">
            playerId (UUID)
          </label>
          <div className="flex gap-2">
            <input
              id="playerId"
              value={playerId}
              onChange={(event) => setPlayerId(event.target.value)}
              placeholder="0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1"
              className={`w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 ${focusRing}`}
              aria-invalid={Boolean(fieldErrors.playerId)}
              aria-describedby={fieldErrors.playerId ? 'playerId-error' : undefined}
            />
            <Button type="button" variant="secondary" onClick={() => setPlayerId(crypto.randomUUID())}>
              <Dices className="h-4 w-4" aria-hidden="true" />
              Gerar
            </Button>
          </div>
          {fieldErrors.playerId ? (
            <p id="playerId-error" className="mt-1 text-xs text-red-400">
              {fieldErrors.playerId}
            </p>
          ) : null}
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <label htmlFor="amount" className="mb-1 block text-xs font-medium text-slate-400">
              Saldo inicial
            </label>
            <input
              id="amount"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="100.00"
              inputMode="decimal"
              className={`w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 tabular-nums placeholder:text-slate-600 ${focusRing}`}
              aria-invalid={Boolean(fieldErrors['initialBalance.amount'])}
            />
            {fieldErrors['initialBalance.amount'] ? (
              <p className="mt-1 text-xs text-red-400">{fieldErrors['initialBalance.amount']}</p>
            ) : (
              <p className="mt-1 text-xs text-slate-600">String decimal, 2 casas — nunca número.</p>
            )}
          </div>
          <div className="w-28">
            <label htmlFor="currency" className="mb-1 block text-xs font-medium text-slate-400">
              Moeda
            </label>
            <input
              id="currency"
              value={currency}
              onChange={(event) => setCurrency(event.target.value.toUpperCase())}
              maxLength={3}
              className={`w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm uppercase text-slate-100 ${focusRing}`}
              aria-invalid={Boolean(fieldErrors['initialBalance.currency'])}
            />
            {fieldErrors['initialBalance.currency'] ? (
              <p className="mt-1 text-xs text-red-400">{fieldErrors['initialBalance.currency']}</p>
            ) : (
              <p className="mt-1 text-xs text-slate-600">Hoje só BRL é aceita pelo backend.</p>
            )}
          </div>
        </div>

        {conflict ? (
          <p role="alert" className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            {CONFLICT_MESSAGE}
          </p>
        ) : null}
        {genericApiError ? (
          <p role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {genericApiError.code}: {genericApiError.message}
          </p>
        ) : null}
        {connectionError ? (
          <p role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {connectionError.message}
          </p>
        ) : null}

        <Button type="submit" loading={mutation.isPending} disabled={mutation.isPending}>
          <PlusCircle className="h-4 w-4" aria-hidden="true" />
          Criar wallet
        </Button>
      </form>
    </Panel>
  );
}
