import { CreateWalletForm } from './CreateWalletForm';
import { QueryWalletForm } from './QueryWalletForm';
import { WalletDetails } from './WalletDetails';
import { WalletHistoryPanel } from './WalletHistoryPanel';
import { RequestInspectorPanel } from '@/components/inspector/RequestInspectorPanel';

export function WalletsPage() {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-6">
        <CreateWalletForm />
        <QueryWalletForm />
        <WalletHistoryPanel />
      </div>
      <div className="space-y-6">
        <WalletDetails />
        <RequestInspectorPanel />
      </div>
    </div>
  );
}
