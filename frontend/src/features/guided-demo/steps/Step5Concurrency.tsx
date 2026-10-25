import { useEffect } from 'react';
import { PlusCircle, Zap, ScanSearch } from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { StatusPill } from '@/components/ui/StatusPill';
import { SideBySide } from '@/features/distributed-lab/idempotency/labUi';
import { useConcurrencyDemo } from './useConcurrencyDemo';
import type { StepOutcome } from '../steps';

/** PASS só quando a prova REAL aparece nos dados: uma PROCESSED e uma REJECTED, saldo final 20.00, reconciliação consistente. */
function computeOutcome(
  runA: ReturnType<typeof useConcurrencyDemo>['runA'],
  runB: ReturnType<typeof useConcurrencyDemo>['runB'],
  reconciliation: ReturnType<typeof useConcurrencyDemo>['reconciliation'],
): StepOutcome {
  if (!runA || !runB) return 'pending';
  const statuses = [runA.result?.status, runB.result?.status].sort();
  const oneWon = JSON.stringify(statuses) === JSON.stringify(['PROCESSED', 'REJECTED']);
  if (!oneWon) return 'fail';
  if (!reconciliation) return 'pending';
  return reconciliation.consistent ? 'pass' : 'fail';
}

export function Step5Concurrency({ onOutcome }: { onOutcome: (outcome: StepOutcome) => void }) {
  const demo = useConcurrencyDemo();
  const outcome = computeOutcome(demo.runA, demo.runB, demo.reconciliation);

  useEffect(() => {
    onOutcome(outcome);
  }, [outcome, onOutcome]);

  return (
    <div className="space-y-4">
      <Panel heading="Passo 1 — wallet isolada">
        {!demo.wallet ? (
          <Button type="button" loading={demo.busy} disabled={demo.busy} onClick={() => void demo.createIsolatedWallet()}>
            <PlusCircle className="h-4 w-4" aria-hidden="true" />
            Criar wallet isolada com R$ 100,00
          </Button>
        ) : (
          <dl className="divide-y divide-slate-800 text-sm">
            <div className="flex items-center justify-between py-1.5">
              <dt className="text-xs text-slate-500">Wallet ID</dt>
              <dd className="font-mono text-xs text-slate-200">{demo.wallet.id}</dd>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <dt className="text-xs text-slate-500">Saldo</dt>
              <dd className="font-mono tabular-nums text-slate-200">
                {demo.wallet.balance.amount} {demo.wallet.balance.currency}
              </dd>
            </div>
          </dl>
        )}
      </Panel>

      {demo.wallet ? (
        <Panel heading="Passo 2 — duas BETs de R$ 80,00 ao mesmo tempo">
          {!demo.runA ? (
            <Button type="button" loading={demo.busy} disabled={demo.busy} onClick={() => void demo.runConcurrentBets()}>
              <Zap className="h-4 w-4" aria-hidden="true" />
              Disparar as duas apostas concorrentes
            </Button>
          ) : demo.runB ? (
            <SideBySide leftLabel="Aposta A" left={demo.runA} rightLabel="Aposta B" right={demo.runB} currency={demo.wallet.balance.currency} />
          ) : null}
        </Panel>
      ) : null}

      {demo.runA && demo.runB ? (
        <Panel heading="Passo 3 — saldo final, ledger e reconciliação">
          {!demo.reconciliation ? (
            <Button type="button" loading={demo.busy} disabled={demo.busy} onClick={() => void demo.runVerification()}>
              <ScanSearch className="h-4 w-4" aria-hidden="true" />
              Verificar saldo, ledger e reconciliação
            </Button>
          ) : (
            <div className="space-y-4">
              <dl className="divide-y divide-slate-800 text-sm">
                <div className="flex items-center justify-between py-1.5">
                  <dt className="text-xs text-slate-500">Saldo final</dt>
                  <dd className="font-mono tabular-nums text-slate-200">
                    {demo.wallet?.balance.amount} {demo.wallet?.balance.currency}
                  </dd>
                </div>
                <div className="flex items-center justify-between py-1.5">
                  <dt className="text-xs text-slate-500">Consistente (reconciliação real)</dt>
                  <dd>
                    <StatusPill tone={demo.reconciliation.consistent ? 'success' : 'danger'}>{demo.reconciliation.consistent ? 'sim' : 'não'}</StatusPill>
                  </dd>
                </div>
              </dl>
              {demo.ledgerEntries ? (
                <div>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Ledger (mais recente primeiro)</p>
                  <ul className="space-y-1 text-xs">
                    {demo.ledgerEntries.map((entry) => (
                      <li key={entry.id} className="flex items-center justify-between font-mono text-slate-400">
                        <span>{entry.direction}</span>
                        <span className="tabular-nums">{entry.money.amount}</span>
                        <span className="tabular-nums text-slate-600">
                          {entry.balanceBefore.amount} → {entry.balanceAfter.amount}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )}
        </Panel>
      ) : null}
    </div>
  );
}
