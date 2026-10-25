import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { API_INSTANCES, type ApiInstance } from '@/lib/api/client';

const STORAGE_KEY = 'jungle-console:selected-instance';

function isApiInstance(value: string | null): value is ApiInstance {
  return value !== null && (API_INSTANCES as readonly string[]).includes(value);
}

function readInitialInstance(): ApiInstance {
  if (typeof window === 'undefined') return API_INSTANCES[0];
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return isApiInstance(stored) ? stored : API_INSTANCES[0];
}

interface InstanceContextValue {
  readonly selected: ApiInstance;
  readonly setSelected: (instance: ApiInstance) => void;
}

const InstanceContext = createContext<InstanceContextValue | null>(null);

/**
 * Qual instância (node-1/2/3) as próximas operações financeiras vão usar. Persistido só em
 * localStorage do navegador — não é um conceito que o backend conhece, é puramente de
 * conveniência de demonstração (lembrar a escolha entre reloads da página).
 */
export function InstanceProvider({ children }: { children: ReactNode }) {
  const [selected, setSelectedState] = useState<ApiInstance>(readInitialInstance);

  const setSelected = (instance: ApiInstance): void => {
    setSelectedState(instance);
    window.localStorage.setItem(STORAGE_KEY, instance);
  };

  const value = useMemo(() => ({ selected, setSelected }), [selected]);
  return <InstanceContext.Provider value={value}>{children}</InstanceContext.Provider>;
}

export function useSelectedInstance(): InstanceContextValue {
  const context = useContext(InstanceContext);
  if (!context) throw new Error('useSelectedInstance deve ser usado dentro de <InstanceProvider>');
  return context;
}
