import { useState } from 'react';
import { Play, Dices } from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { focusRing } from '@/lib/ui/styles';
import { PayloadView, RunSummary } from './labUi';
import type { IdempotencyRequest } from './scenarioBuilders';
import type { ScenarioRun } from './useIdempotencyLab';
import type { Wallet } from '@/types/api';

interface ScenarioAProps {
  readonly wallet: Wallet;
  readonly busy: boolean;
  readonly originalRequest: IdempotencyRequest | null;
  readonly scenarioA: ScenarioRun | null;
  readonly onRun: (params: { providerId: string; externalTransactionId: string; roundId: string; gameId: string; amount: string }) => void;
}

/** Cenário A: operação original — ponto de partida para todos os outros cenários (B a E reusam a Idempotency-Key gerada aqui). */
export function ScenarioA({ wallet, busy, originalRequest, scenarioA, onRun }: ScenarioAProps) {
  const [providerId, setProviderId] = useState('demo-provider');
  const [externalTransactionId, setExternalTransactionId] = useState(() => `idem-${crypto.randomUUID().slice(0, 8)}`);
  const [roundId, setRoundId] = useState('idempotency-lab-round');
  const [gameId, setGameId] = useState('idempotency-lab-game');
  const [amount, setAmount] = useState('10.00');

  const done = Boolean(originalRequest);

  return (
    <Panel heading="Cenário A — operação original">
      {!done ? (
        <div className="space-y-3">
          <p className="text-xs text-slate-500">
            Prepare os identificadores da BET original. A Idempotency-Key será <code className="font-mono text-blue-300">providerId:externalTransactionId</code> — reaproveitada,
            sem recálculo, em todos os cenários seguintes.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="lab-providerId" className="mb-1 block text-xs font-medium text-slate-400">
                providerId
              </label>
              <input
                id="lab-providerId"
                value={providerId}
                onChange={(event) => setProviderId(event.target.value)}
                className={`w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 ${focusRing}`}
              />
            </div>
            <div>
              <label htmlFor="lab-externalTransactionId" className="mb-1 block text-xs font-medium text-slate-400">
                externalTransactionId
              </label>
              <div className="flex gap-2">
                <input
                  id="lab-externalTransactionId"
                  value={externalTransactionId}
                  onChange={(event) => setExternalTransactionId(event.target.value)}
                  className={`w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 ${focusRing}`}
                />
                <Button type="button" variant="secondary" onClick={() => setExternalTransactionId(`idem-${crypto.randomUUID().slice(0, 8)}`)}>
                  <Dices className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
            <div>
              <label htmlFor="lab-roundId" className="mb-1 block text-xs font-medium text-slate-400">
                roundId
              </label>
              <input
                id="lab-roundId"
                value={roundId}
                onChange={(event) => setRoundId(event.target.value)}
                className={`w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 ${focusRing}`}
              />
            </div>
            <div>
              <label htmlFor="lab-gameId" className="mb-1 block text-xs font-medium text-slate-400">
                gameId
              </label>
              <input
                id="lab-gameId"
                value={gameId}
                onChange={(event) => setGameId(event.target.value)}
                className={`w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 ${focusRing}`}
              />
            </div>
            <div>
              <label htmlFor="lab-amount" className="mb-1 block text-xs font-medium text-slate-400">
                money.amount (BET, {wallet.balance.currency})
              </label>
              <input
                id="lab-amount"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="decimal"
                className={`w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm tabular-nums text-slate-100 ${focusRing}`}
              />
            </div>
          </div>
          <Button
            type="button"
            loading={busy}
            disabled={busy}
            onClick={() => onRun({ providerId, externalTransactionId, roundId, gameId, amount })}
          >
            <Play className="h-4 w-4" aria-hidden="true" />
            Executar operação original
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {originalRequest ? <PayloadView request={originalRequest} /> : null}
          {scenarioA ? <RunSummary run={scenarioA} currency={wallet.balance.currency} /> : <p className="text-sm text-slate-600">Enviando…</p>}
        </div>
      )}
    </Panel>
  );
}
