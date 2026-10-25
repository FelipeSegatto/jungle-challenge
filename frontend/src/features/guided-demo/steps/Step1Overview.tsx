import { useEffect } from 'react';
import { Panel } from '@/components/ui/Panel';
import { HealthDashboard } from '@/features/health/HealthDashboard';
import { useInstancesHealth } from '@/features/health/useInstancesHealth';
import type { StepOutcome } from '../steps';

/** Reaproveita o HealthDashboard já usado na Overview — zero lógica de health duplicada aqui. */
export function Step1Overview({ onOutcome }: { onOutcome: (outcome: StepOutcome) => void }) {
  const instances = useInstancesHealth();

  useEffect(() => {
    if (instances.some((i) => i.live === 'loading' || i.ready === 'loading')) {
      onOutcome('pending');
    } else if (instances.every((i) => i.live === 'ok' && i.ready === 'ok')) {
      onOutcome('pass');
    } else {
      onOutcome('fail');
    }
  }, [instances, onOutcome]);

  return (
    <div className="space-y-4">
      <Panel heading="O problema de negócio">
        <p className="text-sm leading-relaxed text-slate-400">
          Um processador de apostas precisa aceitar operações financeiras (BET/WIN/LOSS/REFUND/ROLLBACK) vindas de múltiplos processos da API ao
          mesmo tempo, sem nunca deixar o saldo de uma wallet ficar inconsistente — nem por duas requisições concorrentes na mesma wallet, nem
          por uma requisição reenviada por engano (timeout, retry de rede). As 3 instâncias abaixo são 3 processos Node.js independentes,
          todos apontando para o mesmo PostgreSQL — é esse compartilhamento que precisa ser seguro.
        </p>
      </Panel>
      <HealthDashboard />
    </div>
  );
}
