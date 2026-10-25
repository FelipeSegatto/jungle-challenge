import { useState } from 'react';
import { Dices, UserX } from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { focusRing } from '@/lib/ui/styles';
import { RunSummary, VerdictBanner } from './labUi';
import type { ScenarioRun } from './useIdempotencyLab';
import type { VerdictResult } from './verdicts';
import type { Wallet } from '@/types/api';

interface ScenarioEProps {
  readonly wallet: Wallet;
  readonly busy: boolean;
  readonly enabled: boolean;
  readonly scenarioE: ScenarioRun | null;
  readonly verdict: VerdictResult | null;
  readonly onRun: (divergentPlayerId: string) => void;
}

/**
 * Cenário E: mesma Idempotency-Key, mas o playerId do payload diverge do dono real da wallet
 * (walletId permanece o mesmo — trocar o walletId faria o backend operar outra wallet, o que não
 * testaria idempotência). Esperado: 409 IDEMPOTENCY_CONFLICT, saldo inalterado — igual ao Cenário C.
 */
export function ScenarioE({ wallet, busy, enabled, scenarioE, verdict, onRun }: ScenarioEProps) {
  const [divergentPlayerId, setDivergentPlayerId] = useState<string>(() => crypto.randomUUID());

  return (
    <Panel heading="Cenário E — identidade divergente (mesma key, playerId diferente)">
      {!enabled ? (
        <p className="text-sm text-slate-600">Execute o Cenário A primeiro.</p>
      ) : (
        <div className="space-y-4">
          {!scenarioE ? (
            <div className="space-y-3">
              <div>
                <label htmlFor="lab-divergent-playerId" className="mb-1 block text-xs font-medium text-slate-400">
                  playerId divergente (walletId original: <span className="font-mono text-slate-500">{wallet.id}</span>)
                </label>
                <div className="flex gap-2">
                  <input
                    id="lab-divergent-playerId"
                    value={divergentPlayerId}
                    onChange={(event) => setDivergentPlayerId(event.target.value)}
                    className={`w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-slate-100 ${focusRing}`}
                  />
                  <Button type="button" variant="secondary" onClick={() => setDivergentPlayerId(crypto.randomUUID())}>
                    <Dices className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>
              <Button type="button" variant="danger" loading={busy} disabled={busy} onClick={() => onRun(divergentPlayerId)}>
                <UserX className="h-4 w-4" aria-hidden="true" />
                Reenviar com identidade divergente
              </Button>
            </div>
          ) : (
            <>
              <RunSummary run={scenarioE} currency={wallet.balance.currency} />
              {verdict ? <VerdictBanner result={verdict} /> : null}
            </>
          )}
        </div>
      )}
    </Panel>
  );
}
