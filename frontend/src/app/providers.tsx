import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/api/queryClient';
import { InstanceProvider } from '@/lib/instance/InstanceContext';
import { ToastProvider } from '@/lib/toast/ToastContext';
import { SessionHistoryProvider } from '@/lib/session-history/SessionHistoryContext';
import { RequestInspectorProvider } from '@/lib/inspector/RequestInspectorContext';
import { SelectedWalletProvider } from '@/lib/wallet/SelectedWalletContext';
import { TransactionHistoryProvider } from '@/lib/transaction-history/TransactionHistoryContext';

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <SessionHistoryProvider>
        <InstanceProvider>
          <ToastProvider>
            <RequestInspectorProvider>
              <SelectedWalletProvider>
                <TransactionHistoryProvider>{children}</TransactionHistoryProvider>
              </SelectedWalletProvider>
            </RequestInspectorProvider>
          </ToastProvider>
        </InstanceProvider>
      </SessionHistoryProvider>
    </QueryClientProvider>
  );
}
