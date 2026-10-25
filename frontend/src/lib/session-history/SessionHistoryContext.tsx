import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

export interface SessionHistoryEntry {
  readonly id: string;
  readonly timestamp: Date;
  readonly message: string;
}

interface SessionHistoryContextValue {
  readonly entries: readonly SessionHistoryEntry[];
  readonly logEvent: (message: string) => void;
}

const SessionHistoryContext = createContext<SessionHistoryContextValue | null>(null);

const MAX_ENTRIES = 20;

/**
 * Histórico puramente local desta aba/sessão do navegador — nunca persistido no servidor, nunca
 * lido de volta da API. Existe só para a demonstração mostrar "o que eu fiz até aqui" sem fingir
 * que é um audit log real (esse é o ledger do backend, ver features/ledger).
 */
export function SessionHistoryProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<SessionHistoryEntry[]>([]);
  const counterRef = useRef(0);

  const logEvent = useCallback((message: string) => {
    counterRef.current += 1;
    const entry: SessionHistoryEntry = { id: `history-${counterRef.current}`, timestamp: new Date(), message };
    setEntries((current) => [entry, ...current].slice(0, MAX_ENTRIES));
  }, []);

  return <SessionHistoryContext.Provider value={{ entries, logEvent }}>{children}</SessionHistoryContext.Provider>;
}

export function useSessionHistory(): SessionHistoryContextValue {
  const context = useContext(SessionHistoryContext);
  if (!context) throw new Error('useSessionHistory deve ser usado dentro de <SessionHistoryProvider>');
  return context;
}
