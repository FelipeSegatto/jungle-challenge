import { describe, test, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from './msw/server';
import { submitWagerTransaction } from '@/features/transactions/api';
import { queryClient as productionQueryClient } from '@/lib/api/queryClient';

describe('mutations.retry: false — nunca reenviar um POST financeiro sozinho', () => {
  test('o QueryClient real da aplicação tem mutations.retry: false', () => {
    expect(productionQueryClient.getDefaultOptions().mutations?.retry).toBe(false);
  });

  test('uma mutação financeira que falha é chamada exatamente 1 vez, mesmo com o defaultOptions real da aplicação', async () => {
    let callCount = 0;
    server.use(
      http.post('/api/node-1/wagering/transactions', () => {
        callCount++;
        return HttpResponse.json({ code: 'INTERNAL_ERROR', message: 'Falha simulada.', statusCode: 500, path: '/wagering/transactions' }, { status: 500 });
      }),
    );

    const client = new QueryClient({ defaultOptions: productionQueryClient.getDefaultOptions() });
    const { result } = renderHook(
      () =>
        useMutation({
          mutationFn: () => submitWagerTransaction('node-1', {
            providerId: 'p', externalTransactionId: 'e', playerId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1',
            walletId: '0192f291-27dd-7d3f-8071-5f8685deef37', roundId: 'r', gameId: 'g', kind: 'BET',
            money: { amount: '10.00', currency: 'BRL' },
          }, 'key', vi.fn()),
        }),
      { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> },
    );

    result.current.mutate();
    await waitFor(() => expect(result.current.isError).toBe(true));
    // Dá tempo de sobra para um retry automático acontecer, se o retry estivesse ligado.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(callCount).toBe(1);
  });
});
