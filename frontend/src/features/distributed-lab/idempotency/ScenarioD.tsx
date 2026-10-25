import { useState } from 'react';
import { TrendingUp, RotateCcw } from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { focusRing } from '@/lib/ui/styles';
import { SideBySide, RunSummary, VerdictBanner } from './labUi';
import type { ScenarioRun } from './useIdempotencyLab';
import type { VerdictResult } from './verdicts';
import type { Wallet } from '@/types/api';

interface ScenarioDProps {
  readonly wallet: Wallet;
  readonly busy: boolean;
  readonly enabled: boolean;
  readonly scenarioA: ScenarioRun | null;
  readonly scenarioDIntervening: ScenarioRun | null;
  readonly scenarioD: ScenarioRun | null;
  readonly verdict: VerdictResult | null;
  readonly onRunIntervening: (amount: string) => void;
  readonly onRunReplay: () => void;
}

/**
 * Cenário D: replay da BET original depois de uma OUTRA movimentação válida (um WIN separado) ter
 * acontecido na mesma wallet. O ponto é mostrar a diferença entre o saldo histórico devolvido pelo
 * replay (deve ser o mesmo da resposta original) e o saldo real atual da wallet (deve já refletir o WIN).
 */
export function ScenarioD({ wallet, busy, enabled, scenarioA, scenarioDIntervening, scenarioD, verdict, onRunIntervening, onRunReplay }: ScenarioDProps) {
  const [amount, setAmount] = useState('5.00');

  return (
    <Panel heading="Cenário D — replay após outra movimentação válida">
      {!enabled ? (
        <p className="text-sm text-slate-600">Execute o Cenário A primeiro.</p>
      ) : (
        <div className="space-y-4">
          {!scenarioDIntervening ? (
            <div className="space-y-3">
              <p className="text-xs text-slate-500">Passo 1: execute um WIN independente (nova key, nova operação) para mudar o saldo real da wallet antes do replay.</p>
              <div>
                <label htmlFor="lab-intervening-amount" className="mb-1 block text-xs font-medium text-slate-400">
                  money.amount do WIN intermediário ({wallet.balance.currency})
                </label>
                <input
                  id="lab-intervening-amount"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  inputMode="decimal"
                  className={`w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm tabular-nums text-slate-100 ${focusRing}`}
                />
              </div>
              <Button type="button" loading={busy} disabled={busy} onClick={() => onRunIntervening(amount)}>
                <TrendingUp className="h-4 w-4" aria-hidden="true" />
                Executar movimentação intermediária (WIN)
              </Button>
            </div>
          ) : !scenarioD ? (
            <div className="space-y-3">
              <RunSummary run={scenarioDIntervening} currency={wallet.balance.currency} />
              <p className="text-xs text-slate-500">Passo 2: repita a BET original (mesma Idempotency-Key do Cenário A) agora que o saldo real já mudou.</p>
              <Button type="button" loading={busy} disabled={busy} onClick={onRunReplay}>
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                Repetir a BET original
              </Button>
            </div>
          ) : (
            <>
              {scenarioA ? <SideBySide leftLabel="Original (A)" left={scenarioA} rightLabel="Replay pós-intervenção (D)" right={scenarioD} currency={wallet.balance.currency} /> : null}
              {verdict ? <VerdictBanner result={verdict} /> : null}
            </>
          )}
        </div>
      )}
    </Panel>
  );
}
