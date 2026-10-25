import { RotateCcw } from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { SideBySide, VerdictBanner } from './labUi';
import type { ScenarioRun } from './useIdempotencyLab';
import type { VerdictResult } from './verdicts';
import type { Wallet } from '@/types/api';

interface ScenarioBProps {
  readonly wallet: Wallet;
  readonly busy: boolean;
  readonly enabled: boolean;
  readonly scenarioA: ScenarioRun | null;
  readonly scenarioB: ScenarioRun | null;
  readonly verdict: VerdictResult | null;
  readonly onRun: () => void;
}

/** Cenário B: reenvia a MESMA operação (mesma key, mesmo payload) — espera o mesmo transactionId, idempotentReplay=true, saldo inalterado. */
export function ScenarioB({ wallet, busy, enabled, scenarioA, scenarioB, verdict, onRun }: ScenarioBProps) {
  return (
    <Panel heading="Cenário B — reenviar a mesma operação">
      {!enabled ? (
        <p className="text-sm text-slate-600">Execute o Cenário A primeiro.</p>
      ) : (
        <div className="space-y-4">
          {!scenarioB ? (
            <Button type="button" loading={busy} disabled={busy} onClick={onRun}>
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Reenviar a mesma operação
            </Button>
          ) : (
            <>
              {scenarioA ? <SideBySide leftLabel="Original (A)" left={scenarioA} rightLabel="Replay (B)" right={scenarioB} currency={wallet.balance.currency} /> : null}
              {verdict ? <VerdictBanner result={verdict} /> : null}
            </>
          )}
        </div>
      )}
    </Panel>
  );
}
