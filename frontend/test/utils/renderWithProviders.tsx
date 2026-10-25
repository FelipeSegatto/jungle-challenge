import type { ReactElement, ReactNode } from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { InstanceProvider } from '@/lib/instance/InstanceContext';
import { ToastProvider } from '@/lib/toast/ToastContext';
import { RequestInspectorProvider } from '@/lib/inspector/RequestInspectorContext';
import { SelectedWalletProvider } from '@/lib/wallet/SelectedWalletContext';
import { TransactionHistoryProvider } from '@/lib/transaction-history/TransactionHistoryContext';
import { SessionHistoryProvider } from '@/lib/session-history/SessionHistoryContext';
import { ToastViewport } from '@/components/ui/ToastViewport';

/**
 * `queries.retry: false` aqui (diferente do `retry: 1` de produção em `lib/api/queryClient.ts`) é
 * só para os testes não ficarem lentos/flakeys esperando uma segunda tentativa automática — não
 * tem relação com a regra de negócio. `mutations.retry: false` É a mesma regra de produção,
 * propositalmente idêntica.
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

function AllProviders({ children, queryClient }: { children: ReactNode; queryClient: QueryClient }) {
  return (
    <QueryClientProvider client={queryClient}>
      <SessionHistoryProvider>
        <InstanceProvider>
          <ToastProvider>
            <RequestInspectorProvider>
              <SelectedWalletProvider>
                <TransactionHistoryProvider>
                  {children}
                  <ToastViewport />
                </TransactionHistoryProvider>
              </SelectedWalletProvider>
            </RequestInspectorProvider>
          </ToastProvider>
        </InstanceProvider>
      </SessionHistoryProvider>
    </QueryClientProvider>
  );
}

export function renderWithProviders(ui: ReactElement, options?: { queryClient?: QueryClient }) {
  const queryClient = options?.queryClient ?? createTestQueryClient();
  return {
    queryClient,
    ...render(ui, { wrapper: ({ children }) => <AllProviders queryClient={queryClient}>{children}</AllProviders> }),
  };
}
