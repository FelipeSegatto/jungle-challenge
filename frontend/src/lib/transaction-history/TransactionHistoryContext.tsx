import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import type { WagerKind, WagerStatus } from '@/types/api';

export interface TransactionHistoryEntry {
  readonly localId: string;
  readonly transactionId: string;
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly kind: WagerKind;
  readonly status: WagerStatus;
  readonly failureCode: string | null;
  readonly idempotencyKey: string;
  readonly idempotentReplay: boolean;
  readonly amount: string;
  readonly currency: string;
  readonly timestamp: Date;
}

interface TransactionHistoryContextValue {
  /** Local a esta aba — não é o ledger auditável do backend, só o que este navegador observou. */
  readonly entries: readonly TransactionHistoryEntry[];
  readonly recordTransaction: (entry: Omit<TransactionHistoryEntry, 'localId' | 'timestamp'>) => void;
}

const TransactionHistoryContext = createContext<TransactionHistoryContextValue | null>(null);

const MAX_ENTRIES = 30;

export function TransactionHistoryProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<TransactionHistoryEntry[]>([]);
  const counterRef = useRef(0);

  const recordTransaction = useCallback((entry: Omit<TransactionHistoryEntry, 'localId' | 'timestamp'>) => {
    counterRef.current += 1;
    const full: TransactionHistoryEntry = { ...entry, localId: `tx-history-${counterRef.current}`, timestamp: new Date() };
    setEntries((current) => [full, ...current].slice(0, MAX_ENTRIES));
  }, []);

  return (
    <TransactionHistoryContext.Provider value={{ entries, recordTransaction }}>
      {children}
    </TransactionHistoryContext.Provider>
  );
}

export function useTransactionHistory(): TransactionHistoryContextValue {
  const context = useContext(TransactionHistoryContext);
  if (!context) throw new Error('useTransactionHistory deve ser usado dentro de <TransactionHistoryProvider>');
  return context;
}
