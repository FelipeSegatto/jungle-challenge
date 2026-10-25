import { QueryClient } from '@tanstack/react-query';

/**
 * `mutations.retry: false` é a regra mais importante deste arquivo: POST /wagering/transactions
 * move dinheiro de verdade. Retentar automaticamente uma mutação que já pode ter sido aplicada
 * (rede caiu depois do commit, antes da resposta chegar) seria reintroduzir, no cliente, o
 * exato problema de duplicação que a Idempotency-Key existe para resolver no servidor — não há
 * por que arriscar isso só porque o React Query retenta por padrão.
 *
 * Queries (GET) podem retentar uma vez: ler de novo não tem efeito colateral.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 5_000,
    },
    mutations: {
      retry: false,
    },
  },
});
