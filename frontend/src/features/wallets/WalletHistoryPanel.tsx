import { History } from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { useSelectedWallet } from '@/lib/wallet/SelectedWalletContext';

/** Lista local das wallets usadas NESTA aba — não é "todas as wallets do PostgreSQL". */
export function WalletHistoryPanel() {
  const { history, selectWalletId, selectedWalletId } = useSelectedWallet();

  return (
    <Panel
      heading={
        <span className="flex items-center gap-1.5">
          <History className="h-3.5 w-3.5" aria-hidden="true" />
          Wallets usadas nesta sessão (local)
        </span>
      }
    >
      <p className="mb-2 text-xs text-slate-500">
        Histórico local desta aba do navegador — não é uma listagem de todas as wallets no PostgreSQL.
      </p>
      {history.length === 0 ? (
        <p className="text-sm text-slate-600">Nenhuma wallet usada ainda nesta sessão.</p>
      ) : (
        <ul className="space-y-1" role="list">
          {history.map((entry) => (
            <li key={entry.walletId}>
              <button
                type="button"
                onClick={() => selectWalletId(entry.walletId)}
                className={`w-full rounded-md px-2 py-1.5 text-left text-xs transition-colors duration-150 hover:bg-slate-800 ${
                  entry.walletId === selectedWalletId ? 'bg-emerald-500/10 text-emerald-300' : 'text-slate-400'
                }`}
              >
                <span className="font-mono">{entry.walletId}</span>
                <span className="ml-2 text-slate-600">player {entry.playerId.slice(0, 8)}…</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
