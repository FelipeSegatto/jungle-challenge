import { Wallet as WalletIcon, RotateCcw, BookOpenCheck } from 'lucide-react';
import { useSelectedWallet } from '@/lib/wallet/SelectedWalletContext';
import { useWallet } from '@/features/wallets/useWallet';
import { WalletDetails } from '@/features/wallets/WalletDetails';
import { RequestInspectorPanel } from '@/components/inspector/RequestInspectorPanel';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { useIdempotencyLab } from './useIdempotencyLab';
import { ScenarioA } from './ScenarioA';
import { ScenarioB } from './ScenarioB';
import { ScenarioC } from './ScenarioC';
import { ScenarioD } from './ScenarioD';
import { ScenarioE } from './ScenarioE';
import { IdempotencyTimeline } from './IdempotencyTimeline';
import { FinalVerificationPanel } from './FinalVerificationPanel';
import type { ViewId } from '@/app/navigation';
import type { Wallet } from '@/types/api';
import type { UseQueryResult } from '@tanstack/react-query';

/**
 * Laboratório de idempotência: 5 cenários (A a E) rodados contra a API real da instância
 * selecionada, cada um disparado por uma ação explícita do usuário (nunca automático). Reaproveita
 * o mesmo caminho de envio do módulo Transactions (`submitWagerTransaction`) — não existe lógica
 * financeira paralela aqui, só orquestração de chamadas reais e leitura das respostas reais.
 */
export function IdempotencyLabPage({ onNavigate }: { onNavigate: (view: ViewId) => void }) {
  const { selectedWalletId } = useSelectedWallet();
  const walletQuery = useWallet(selectedWalletId);

  if (!selectedWalletId || !walletQuery.data) {
    return (
      <div className="space-y-6">
        <WalletDetails />
        <EmptyState
          icon={WalletIcon}
          title="Selecione uma wallet de demonstração antes de operar"
          description="O laboratório de idempotência precisa de uma wallet real e já consultada — crie ou busque uma na seção Wallets."
          action={
            <Button variant="secondary" onClick={() => onNavigate('wallets')}>
              Ir para Wallets
            </Button>
          }
        />
      </div>
    );
  }

  return <IdempotencyLabContent wallet={walletQuery.data} walletQuery={walletQuery} onNavigate={onNavigate} />;
}

/** Separado da guarda de seleção acima para que `useIdempotencyLab` só seja chamado quando já existe uma wallet real — nunca condicionalmente dentro do mesmo componente. */
function IdempotencyLabContent({
  wallet,
  walletQuery,
  onNavigate,
}: {
  wallet: Wallet;
  walletQuery: UseQueryResult<Wallet>;
  onNavigate: (view: ViewId) => void;
}) {
  const lab = useIdempotencyLab(wallet);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-6">
        <WalletDetails />

        <ScenarioA wallet={wallet} busy={lab.busy} originalRequest={lab.originalRequest} scenarioA={lab.scenarioA} onRun={lab.runScenarioA} />
        <ScenarioB
          wallet={wallet}
          busy={lab.busy}
          enabled={Boolean(lab.scenarioA?.result)}
          scenarioA={lab.scenarioA}
          scenarioB={lab.scenarioB}
          verdict={lab.verdictB}
          onRun={lab.runScenarioB}
        />
        <ScenarioC
          wallet={wallet}
          busy={lab.busy}
          enabled={Boolean(lab.originalRequest)}
          scenarioC={lab.scenarioC}
          verdict={lab.verdictC}
          onRun={lab.runScenarioC}
        />
        <ScenarioD
          wallet={wallet}
          busy={lab.busy}
          enabled={Boolean(lab.scenarioA?.result)}
          scenarioA={lab.scenarioA}
          scenarioDIntervening={lab.scenarioDIntervening}
          scenarioD={lab.scenarioD}
          verdict={lab.verdictD}
          onRunIntervening={lab.runScenarioDIntervening}
          onRunReplay={lab.runScenarioD}
        />
        <ScenarioE
          wallet={wallet}
          busy={lab.busy}
          enabled={Boolean(lab.originalRequest)}
          scenarioE={lab.scenarioE}
          verdict={lab.verdictE}
          onRun={lab.runScenarioE}
        />

        <Button type="button" variant="ghost" onClick={lab.resetLab} disabled={lab.busy}>
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Reiniciar laboratório (nova identidade)
        </Button>
      </div>

      <div className="space-y-6">
        <FinalVerificationPanel walletId={wallet.id} onRefreshWallet={() => void walletQuery.refetch()} />
        <Button type="button" variant="ghost" onClick={() => onNavigate('ledger')}>
          <BookOpenCheck className="h-4 w-4" aria-hidden="true" />
          Ver lançamentos no Ledger &amp; Reconciliation
        </Button>
        <IdempotencyTimeline steps={lab.timeline} />
        <RequestInspectorPanel />
      </div>
    </div>
  );
}
