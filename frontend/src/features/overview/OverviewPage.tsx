import { Wallet, ArrowLeftRight, History, Clock, RefreshCw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { HealthDashboard } from '@/features/health/HealthDashboard';
import { useExtendedInstancesHealth } from '@/features/system-health-messaging/health/useExtendedHealth';
import { WalletDetails } from '@/features/wallets/WalletDetails';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { useSessionHistory } from '@/lib/session-history/SessionHistoryContext';
import { useToast } from '@/lib/toast/ToastContext';
import type { ViewId } from '@/app/navigation';

function mostRecentCheck(instances: ReturnType<typeof useExtendedInstancesHealth>): Date | undefined {
  const timestamps = instances.map((i) => i.lastCheckedAt).filter((d): d is Date => d !== undefined);
  if (timestamps.length === 0) return undefined;
  return new Date(Math.max(...timestamps.map((d) => d.getTime())));
}

export function OverviewPage({ onNavigate }: { onNavigate: (view: ViewId) => void }) {
  const instances = useExtendedInstancesHealth();
  const { entries, logEvent } = useSessionHistory();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const lastUpdate = mostRecentCheck(instances);

  const handleRefreshNow = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['health'] });
    logEvent('Atualização manual de status solicitada');
    pushToast({ variant: 'info', title: 'Atualizando status das instâncias…' });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs text-slate-500">
          <Clock className="h-3.5 w-3.5" aria-hidden="true" />
          {lastUpdate
            ? `Última verificação: ${lastUpdate.toLocaleTimeString('pt-BR')}`
            : 'Ainda sem verificação concluída'}
        </p>
        <Button variant="secondary" onClick={handleRefreshNow}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Atualizar status agora
        </Button>
      </div>

      <HealthDashboard />

      <WalletDetails />

      <Panel heading="Atalhos">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => onNavigate('wallets')}>
            <Wallet className="h-4 w-4" aria-hidden="true" />
            Criar wallet
          </Button>
          <Button variant="secondary" onClick={() => onNavigate('transactions')}>
            <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
            Submeter transação
          </Button>
        </div>
      </Panel>

      <Panel
        heading={
          <span className="flex items-center gap-1.5">
            <History className="h-3.5 w-3.5" aria-hidden="true" />
            Histórico desta sessão
          </span>
        }
      >
        <p className="mb-2 text-xs text-slate-500">
          Local a esta aba do navegador — não é persistido no servidor nem é o ledger auditável do backend.
        </p>
        {entries.length === 0 ? (
          <p className="text-sm text-slate-600">Nenhum evento registrado ainda.</p>
        ) : (
          <ul className="space-y-1.5 text-sm" role="list">
            {entries.map((entry) => (
              <li key={entry.id} className="flex items-baseline gap-2 text-slate-400">
                <span className="font-mono text-xs text-slate-600">{entry.timestamp.toLocaleTimeString('pt-BR')}</span>
                <span>{entry.message}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
