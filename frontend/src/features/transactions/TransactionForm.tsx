import { useEffect, useState, type FormEvent } from 'react';
import { Dices, Play } from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { focusRing } from '@/lib/ui/styles';
import { processWagerSchema } from '@/types/schemas';
import { useSubmitTransaction } from './useSubmitTransaction';
import { useWallet } from '@/features/wallets/useWallet';
import { useSelectedInstance } from '@/lib/instance/InstanceContext';
import { useToast } from '@/lib/toast/ToastContext';
import { ReferencePicker } from './ReferencePicker';
import { TransactionResult } from './TransactionResult';
import { TransactionTimeline } from './TransactionTimeline';
import { ApiRequestError, ApiConnectionError } from '@/lib/api/client';
import type { Wallet, WagerKind } from '@/types/api';
import type { TransactionOutcome, TimelineStep } from './types';
import type { ViewId } from '@/app/navigation';

const KINDS: readonly WagerKind[] = ['BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK'];

const KIND_HINT: Record<WagerKind, string> = {
  BET: 'Debita o valor do saldo — rejeitada (REJECTED/INSUFFICIENT_BALANCE) se não houver saldo suficiente.',
  WIN: 'Credita o valor do prêmio. Pode referenciar a BET da rodada, mas não precisa ter o mesmo valor dela.',
  LOSS: 'Registra o resultado da rodada. Não debita, não credita, não gera lançamento de ledger.',
  REFUND: 'Credita de volta o valor exato de uma BET PROCESSED. Exige referência.',
  ROLLBACK: 'Desfaz uma BET/WIN/REFUND PROCESSED com o movimento inverso. Exige referência.',
};

let timelineCounter = 0;
function nextTimelineId(): string {
  timelineCounter += 1;
  return `timeline-${timelineCounter}`;
}

export function TransactionForm({ wallet, onNavigate }: { wallet: Wallet; onNavigate: (view: ViewId) => void }) {
  const [providerId, setProviderId] = useState('demo-provider');
  const [externalTransactionId, setExternalTransactionId] = useState('');
  const [roundId, setRoundId] = useState('demo-round');
  const [gameId, setGameId] = useState('demo-game');
  const [kind, setKind] = useState<WagerKind>('BET');
  const [amount, setAmount] = useState('25.00');
  const [currency, setCurrency] = useState(wallet.balance.currency);
  const [reference, setReference] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [keyManuallyEdited, setKeyManuallyEdited] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [outcome, setOutcome] = useState<TransactionOutcome | null>(null);
  const [timeline, setTimeline] = useState<TimelineStep[]>([]);

  const mutation = useSubmitTransaction();
  const walletQuery = useWallet(wallet.id);
  const { selected: instance } = useSelectedInstance();
  const { pushToast } = useToast();

  // Gera um externalTransactionId inicial só uma vez, pra não começar com o campo vazio.
  useEffect(() => {
    if (!externalTransactionId) setExternalTransactionId(`tx-${crypto.randomUUID().slice(0, 8)}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sincroniza a Idempotency-Key com providerId:externalTransactionId SÓ enquanto o usuário não a editou à mão —
  // uma vez editada manualmente, nunca mais é sobrescrita silenciosamente (é exatamente o que permite testar replay/conflito de propósito).
  useEffect(() => {
    if (!keyManuallyEdited) setIdempotencyKey(`${providerId}:${externalTransactionId}`);
  }, [providerId, externalTransactionId, keyManuallyEdited]);

  const requiresReference = kind === 'REFUND' || kind === 'ROLLBACK';
  const forbidsReference = kind === 'BET' || kind === 'LOSS';

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (mutation.isPending) return; // nunca permite um segundo POST enquanto o primeiro está em voo

    const payloadCandidate = {
      providerId,
      externalTransactionId,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId,
      gameId,
      kind,
      money: { amount, currency },
      ...(forbidsReference ? {} : reference ? { referenceExternalTransactionId: reference } : {}),
    };

    const parsed = processWagerSchema.safeParse(payloadCandidate);
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) errors[issue.path.join('.')] = issue.message;
      setFieldErrors(errors);
      return;
    }
    if (!idempotencyKey.trim()) {
      setFieldErrors({ idempotencyKey: 'Idempotency-Key é obrigatória' });
      return;
    }
    setFieldErrors({});
    setOutcome(null);

    const sentAt = new Date();
    setTimeline([{ id: nextTimelineId(), label: 'Requisição enviada', detail: `POST /wagering/transactions (${kind})`, timestamp: sentAt }]);

    try {
      const { result, httpStatus } = await mutation.mutateAsync({ payload: parsed.data, idempotencyKey: idempotencyKey.trim() });
      const receivedAt = new Date();
      setTimeline((steps) => [
        ...steps,
        { id: nextTimelineId(), label: 'Resposta recebida', detail: `HTTP ${httpStatus}`, timestamp: receivedAt },
        { id: nextTimelineId(), label: `Estado da transação: ${result.status}`, detail: result.failureCode ?? undefined, timestamp: receivedAt },
      ]);
      setOutcome({ type: 'result', result, httpStatus, instance });

      const refetched = await walletQuery.refetch();
      setTimeline((steps) => [
        ...steps,
        {
          id: nextTimelineId(),
          label: 'Saldo consultado novamente',
          detail: refetched.data ? `${refetched.data.balance.amount} ${refetched.data.balance.currency}` : 'falha ao reconsultar',
          timestamp: new Date(),
        },
      ]);
    } catch (error) {
      const receivedAt = new Date();
      if (error instanceof ApiRequestError && error.apiError.code === 'IDEMPOTENCY_CONFLICT') {
        setTimeline((steps) => [...steps, { id: nextTimelineId(), label: 'Resposta recebida: conflito de idempotência', detail: error.apiError.message, timestamp: receivedAt }]);
        setOutcome({ type: 'conflict', apiError: error.apiError });
        pushToast({ variant: 'warning', title: 'Conflito de idempotência', description: error.apiError.message });
      } else if (error instanceof ApiRequestError) {
        setTimeline((steps) => [...steps, { id: nextTimelineId(), label: `Resposta recebida: ${error.apiError.code}`, detail: error.apiError.message, timestamp: receivedAt }]);
        setOutcome({ type: 'error', message: `${error.apiError.code}: ${error.apiError.message}` });
        pushToast({ variant: 'error', title: 'Requisição rejeitada', description: error.apiError.message });
      } else if (error instanceof ApiConnectionError) {
        setTimeline((steps) => [...steps, { id: nextTimelineId(), label: 'Falha de conexão', detail: error.message, timestamp: receivedAt }]);
        setOutcome({ type: 'error', message: error.message });
        pushToast({ variant: 'error', title: 'Instância indisponível', description: error.message });
      }
    }
  };

  const resetForNewOperation = (): void => {
    setExternalTransactionId(`tx-${crypto.randomUUID().slice(0, 8)}`);
    setKeyManuallyEdited(false);
    setReference('');
    setOutcome(null);
    setTimeline([]);
    setFieldErrors({});
  };

  return (
    <div className="space-y-6">
      <Panel heading="Nova operação">
        <form onSubmit={(event) => void handleSubmit(event)} className="space-y-3" noValidate>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="kind" className="mb-1 block text-xs font-medium text-slate-400">
                kind
              </label>
              <select
                id="kind"
                value={kind}
                onChange={(event) => {
                  setKind(event.target.value as WagerKind);
                  setReference('');
                }}
                className={`w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 ${focusRing}`}
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-600">{KIND_HINT[kind]}</p>
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label htmlFor="amount" className="mb-1 block text-xs font-medium text-slate-400">
                  money.amount
                </label>
                <input
                  id="amount"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  inputMode="decimal"
                  className={`w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm tabular-nums text-slate-100 ${focusRing}`}
                  aria-invalid={Boolean(fieldErrors['money.amount'])}
                />
                {fieldErrors['money.amount'] ? <p className="mt-1 text-xs text-red-400">{fieldErrors['money.amount']}</p> : null}
              </div>
              <div className="w-24">
                <label htmlFor="currency" className="mb-1 block text-xs font-medium text-slate-400">
                  currency
                </label>
                <input
                  id="currency"
                  value={currency}
                  onChange={(event) => setCurrency(event.target.value.toUpperCase())}
                  maxLength={3}
                  className={`w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm uppercase text-slate-100 ${focusRing}`}
                />
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="providerId" className="mb-1 block text-xs font-medium text-slate-400">
                providerId
              </label>
              <input
                id="providerId"
                value={providerId}
                onChange={(event) => setProviderId(event.target.value)}
                className={`w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 ${focusRing}`}
                aria-invalid={Boolean(fieldErrors.providerId)}
              />
            </div>
            <div>
              <label htmlFor="externalTransactionId" className="mb-1 block text-xs font-medium text-slate-400">
                externalTransactionId
              </label>
              <div className="flex gap-2">
                <input
                  id="externalTransactionId"
                  value={externalTransactionId}
                  onChange={(event) => setExternalTransactionId(event.target.value)}
                  className={`w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 ${focusRing}`}
                  aria-invalid={Boolean(fieldErrors.externalTransactionId)}
                />
                <Button type="button" variant="secondary" onClick={() => setExternalTransactionId(`tx-${crypto.randomUUID().slice(0, 8)}`)}>
                  <Dices className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="roundId" className="mb-1 block text-xs font-medium text-slate-400">
                roundId
              </label>
              <input
                id="roundId"
                value={roundId}
                onChange={(event) => setRoundId(event.target.value)}
                className={`w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 ${focusRing}`}
              />
            </div>
            <div>
              <label htmlFor="gameId" className="mb-1 block text-xs font-medium text-slate-400">
                gameId
              </label>
              <input
                id="gameId"
                value={gameId}
                onChange={(event) => setGameId(event.target.value)}
                className={`w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 ${focusRing}`}
              />
            </div>
          </div>

          <ReferencePicker
            kind={kind}
            providerId={providerId}
            value={reference}
            onChange={setReference}
            required={requiresReference}
            error={fieldErrors.referenceExternalTransactionId}
          />

          <div>
            <label htmlFor="idempotency-key" className="mb-1 block text-xs font-medium text-slate-400">
              Idempotency-Key (header HTTP)
            </label>
            <input
              id="idempotency-key"
              value={idempotencyKey}
              onChange={(event) => {
                setIdempotencyKey(event.target.value);
                setKeyManuallyEdited(true);
              }}
              className={`w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-slate-100 ${focusRing}`}
              aria-invalid={Boolean(fieldErrors.idempotencyKey)}
            />
            <p className="mt-1 text-xs text-slate-600">
              {keyManuallyEdited
                ? 'Editada manualmente — não é mais recalculada automaticamente. Repita o envio sem mudar nada para testar replay; mude um campo do payload mantendo a key para testar conflito.'
                : 'Sincronizada automaticamente com providerId:externalTransactionId até você editar.'}
            </p>
            {fieldErrors.idempotencyKey ? <p className="mt-1 text-xs text-red-400">{fieldErrors.idempotencyKey}</p> : null}
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Button type="submit" loading={mutation.isPending} disabled={mutation.isPending}>
              <Play className="h-4 w-4" aria-hidden="true" />
              Executar operação
            </Button>
            <Button type="button" variant="ghost" onClick={resetForNewOperation} disabled={mutation.isPending}>
              Nova operação (nova identidade)
            </Button>
          </div>
        </form>
      </Panel>

      <TransactionResult outcome={outcome} />
      <TransactionTimeline steps={timeline} onNavigate={onNavigate} />
    </div>
  );
}
