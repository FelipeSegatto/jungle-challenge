import { Wallet as WalletIcon } from 'lucide-react';
import { useSelectedWallet } from '@/lib/wallet/SelectedWalletContext';
import { useWallet } from '@/features/wallets/useWallet';
import { WalletDetails } from '@/features/wallets/WalletDetails';
import { LedgerTable } from './LedgerTable';
import { ReconciliationPanel } from './ReconciliationPanel';
import { FinancialSequence } from './FinancialSequence';
import { TransactionLookupPanel } from './TransactionLookupPanel';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import type { ViewId } from '@/app/navigation';

export function LedgerPage({ onNavigate }: { onNavigate: (view: ViewId) => void }) {
  const { selectedWalletId } = useSelectedWallet();
  const walletQuery = useWallet(selectedWalletId);

  if (!selectedWalletId || !walletQuery.data) {
    return (
      <div className="space-y-6">
        <WalletDetails />
        <EmptyState
          icon={WalletIcon}
          title="Selecione uma wallet para auditar"
          description="O ledger e a reconciliação são por wallet — crie ou busque uma na seção Wallets primeiro."
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
    <div className="space-y-6">
      <WalletDetails />
      <FinancialSequence walletId={selectedWalletId} />
      <div className="grid gap-6 lg:grid-cols-2">
        <ReconciliationPanel walletId={selectedWalletId} />
        <TransactionLookupPanel />
      </div>
      <LedgerTable walletId={selectedWalletId} />
    </div>
  );
}
