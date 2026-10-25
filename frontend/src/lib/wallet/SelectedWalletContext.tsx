import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

export interface WalletHistoryEntry {
  readonly walletId: string;
  readonly playerId: string;
  readonly lastUsedAt: Date;
}

interface SelectedWalletContextValue {
  /** Só o identificador — nunca o saldo. Saldo sempre vem de uma query fresca ao backend. */
  readonly selectedWalletId: string | null;
  readonly selectWalletId: (walletId: string) => void;
  readonly clearSelection: () => void;
  /** Local a esta aba, apagado ao recarregar — não é a lista de wallets do PostgreSQL. */
  readonly history: readonly WalletHistoryEntry[];
  readonly recordWalletUsage: (wallet: { walletId: string; playerId: string }) => void;
}

const SelectedWalletContext = createContext<SelectedWalletContextValue | null>(null);

const MAX_HISTORY = 10;

export function SelectedWalletProvider({ children }: { children: ReactNode }) {
  const [selectedWalletId, setSelectedWalletId] = useState<string | null>(null);
  const [history, setHistory] = useState<WalletHistoryEntry[]>([]);

  const selectWalletId = useCallback((walletId: string) => setSelectedWalletId(walletId), []);
  const clearSelection = useCallback(() => setSelectedWalletId(null), []);

  const recordWalletUsage = useCallback((wallet: { walletId: string; playerId: string }) => {
    setSelectedWalletId(wallet.walletId);
    setHistory((current) => {
      const withoutDuplicate = current.filter((entry) => entry.walletId !== wallet.walletId);
      return [{ ...wallet, lastUsedAt: new Date() }, ...withoutDuplicate].slice(0, MAX_HISTORY);
    });
  }, []);

  return (
    <SelectedWalletContext.Provider
      value={{ selectedWalletId, selectWalletId, clearSelection, history, recordWalletUsage }}
    >
      {children}
    </SelectedWalletContext.Provider>
  );
}

export function useSelectedWallet(): SelectedWalletContextValue {
  const context = useContext(SelectedWalletContext);
  if (!context) throw new Error('useSelectedWallet deve ser usado dentro de <SelectedWalletProvider>');
  return context;
}
