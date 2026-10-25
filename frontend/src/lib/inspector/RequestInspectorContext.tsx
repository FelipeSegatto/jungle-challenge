import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import type { ApiInstance } from '@/lib/api/client';

export type InspectedOutcome = 'success' | 'api-error' | 'connection-error';

export interface InspectedRequest {
  readonly id: string;
  readonly method: 'GET' | 'POST';
  readonly endpoint: string;
  readonly instance: ApiInstance;
  readonly requestBody: unknown;
  /** null só quando não existiu resposta HTTP nenhuma (falha de rede antes de qualquer servidor responder). */
  readonly statusCode: number | null;
  readonly responseBody: unknown;
  readonly durationMs: number;
  readonly timestamp: Date;
  readonly outcome: InspectedOutcome;
}

interface RequestInspectorContextValue {
  readonly lastRequest: InspectedRequest | null;
  readonly recordRequest: (entry: Omit<InspectedRequest, 'id'>) => void;
}

const RequestInspectorContext = createContext<RequestInspectorContextValue | null>(null);

/**
 * Guarda só a última chamada instrumentada — o objetivo é inspeção didática de "o que acabou de
 * acontecer", não um log de auditoria (esse é o histórico de sessão / o ledger real do backend).
 */
export function RequestInspectorProvider({ children }: { children: ReactNode }) {
  const [lastRequest, setLastRequest] = useState<InspectedRequest | null>(null);
  const counterRef = useRef(0);

  const recordRequest = useCallback((entry: Omit<InspectedRequest, 'id'>) => {
    counterRef.current += 1;
    setLastRequest({ ...entry, id: `inspected-${counterRef.current}` });
  }, []);

  return (
    <RequestInspectorContext.Provider value={{ lastRequest, recordRequest }}>
      {children}
    </RequestInspectorContext.Provider>
  );
}

export function useRequestInspector(): RequestInspectorContextValue {
  const context = useContext(RequestInspectorContext);
  if (!context) throw new Error('useRequestInspector deve ser usado dentro de <RequestInspectorProvider>');
  return context;
}
