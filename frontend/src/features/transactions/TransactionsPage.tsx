import { Wallet as WalletIcon } from 'lucide-react';
import { useSelectedWallet } from '@/lib/wallet/SelectedWalletContext';
import { useWallet } from '@/features/wallets/useWallet';
import { WalletDetails } from '@/features/wallets/WalletDetails';
import { RequestInspectorPanel } from '@/components/inspector/RequestInspectorPanel';
import { TransactionForm } from './TransactionForm';
import { TransactionHistoryPanel } from './TransactionHistoryPanel';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import type { ViewId } from '@/app/navigation';

export function TransactionsPage({ onNavigate }: { onNavigate: (view: ViewId) => void }) {
  const { selectedWalletId } = useSelectedWallet();
  const walletQuery = useWallet(selectedWalletId);

  if (!selectedWalletId || !walletQuery.data) {
    return (
      <div className="space-y-6">
        <WalletDetails />
        <EmptyState
          icon={WalletIcon}
          title="Selecione uma wallet antes de operar"
          description="Operações financeiras precisam de uma wallet real e já consultada — crie ou busque uma na seção Wallets."
          action={
            <Button variant="secondary" onClick={() => onNavigate('wallets')}>
              Ir para Wallets
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-6">
        <WalletDetails />
        <TransactionForm wallet={walletQuery.data} onNavigate={onNavigate} />
      </div>
      <div className="space-y-6">
        <TransactionHistoryPanel />
        <RequestInspectorPanel />
      </div>
    </div>
  );
}
