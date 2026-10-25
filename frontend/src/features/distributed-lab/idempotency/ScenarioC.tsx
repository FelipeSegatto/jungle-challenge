import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { focusRing } from '@/lib/ui/styles';
import { RunSummary, VerdictBanner } from './labUi';
import type { ScenarioRun } from './useIdempotencyLab';
import type { VerdictResult } from './verdicts';
import type { Wallet } from '@/types/api';

interface ScenarioCProps {
  readonly wallet: Wallet;
  readonly busy: boolean;
  readonly enabled: boolean;
  readonly scenarioC: ScenarioRun | null;
  readonly verdict: VerdictResult | null;
  readonly onRun: (modifiedAmount: string) => void;
}

/**
 * Cenário C: mesma Idempotency-Key, mas o valor da operação é alterado de propósito. O esperado é
 * 409 IDEMPOTENCY_CONFLICT com saldo inalterado — um 2xx aqui é FAIL (payload divergente aceito), nunca sucesso.
 */
export function ScenarioC({ wallet, busy, enabled, scenarioC, verdict, onRun }: ScenarioCProps) {
  const [modifiedAmount, setModifiedAmount] = useState('999.00');

  return (
    <Panel heading="Cenário C — conflito de payload (mesma key, valor diferente)">
      {!enabled ? (
        <p className="text-sm text-slate-600">Execute o Cenário A primeiro.</p>
      ) : (
        <div className="space-y-4">
          {!scenarioC ? (
            <div className="space-y-3">
              <div>
                <label htmlFor="lab-conflict-amount" className="mb-1 block text-xs font-medium text-slate-400">
                  Novo money.amount (propositalmente diferente do original)
                </label>
                <input
                  id="lab-conflict-amount"
                  value={modifiedAmount}
                  onChange={(event) => setModifiedAmount(event.target.value)}
                  inputMode="decimal"
                  className={`w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm tabular-nums text-slate-100 ${focusRing}`}
                />
              </div>
              <Button type="button" variant="danger" loading={busy} disabled={busy} onClick={() => onRun(modifiedAmount)}>
                <ShieldAlert className="h-4 w-4" aria-hidden="true" />
                Reenviar com valor alterado
              </Button>
            </div>
          ) : (
            <>
              <RunSummary run={scenarioC} currency={wallet.balance.currency} />
              {verdict ? <VerdictBanner result={verdict} /> : null}
            </>
          )}
        </div>
      )}
    </Panel>
  );
}
