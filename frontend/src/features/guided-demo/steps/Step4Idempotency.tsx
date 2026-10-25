import { useEffect } from 'react';
import { Wallet as WalletIcon } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { useWallet } from '@/features/wallets/useWallet';
import { useSelectedWallet } from '@/lib/wallet/SelectedWalletContext';
import { useIdempotencyLab } from '@/features/distributed-lab/idempotency/useIdempotencyLab';
import { ScenarioA } from '@/features/distributed-lab/idempotency/ScenarioA';
import { ScenarioB } from '@/features/distributed-lab/idempotency/ScenarioB';
import type { StepOutcome } from '../steps';
import type { Wallet } from '@/types/api';

/**
 * Reaproveita o Idempotency Lab inteiro (hook + componentes de Cenário A e B) em vez de reimplementar
 * qualquer parte do envio ou da avaliação do veredito — o Guided Demo só adiciona o texto pedagógico
 * ao redor.
 */
export function Step4Idempotency({ onOutcome }: { onOutcome: (outcome: StepOutcome) => void }) {
  const { selectedWalletId } = useSelectedWallet();
  const walletQuery = useWallet(selectedWalletId);

  if (!selectedWalletId || !walletQuery.data) {
    return <EmptyState icon={WalletIcon} title="Crie a wallet na Etapa 2 primeiro" description="A demonstração de idempotência reaproveita a mesma wallet das etapas anteriores." />;
  }

  return <Step4Content wallet={walletQuery.data} onOutcome={onOutcome} />;
}

function Step4Content({ wallet, onOutcome }: { wallet: Wallet; onOutcome: (outcome: StepOutcome) => void }) {
  const lab = useIdempotencyLab(wallet);

  useEffect(() => {
    if (lab.verdictB) {
      onOutcome(lab.verdictB.verdict === 'PASS' ? 'pass' : lab.verdictB.verdict === 'FAIL' ? 'fail' : 'inconclusive');
    } else {
      onOutcome('pending');
    }
  }, [lab.verdictB, onOutcome]);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
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
    </div>
  );
}
