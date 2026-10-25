import { useMutation, useQueryClient } from '@tanstack/react-query';
import { submitWagerTransaction } from './api';
import { useRequestInspector } from '@/lib/inspector/RequestInspectorContext';
import { useSelectedInstance } from '@/lib/instance/InstanceContext';
import { useTransactionHistory } from '@/lib/transaction-history/TransactionHistoryContext';
import type { ProcessWagerInput } from '@/types/schemas';

interface SubmitArgs {
  readonly payload: ProcessWagerInput;
  readonly idempotencyKey: string;
}

/**
 * `retry: false` vem do default global do QueryClient — nunca reenviar um POST financeiro
 * sozinho. `isPending` desabilita o botão de executar enquanto a chamada está em voo, o que
 * impede duplo clique virar duplo POST (a Idempotency-Key também protegeria o backend, mas a UI
 * não deveria depender só disso).
 */
export function useSubmitTransaction() {
  const { selected: instance } = useSelectedInstance();
  const { recordRequest } = useRequestInspector();
  const { recordTransaction } = useTransactionHistory();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ payload, idempotencyKey }: SubmitArgs) =>
      submitWagerTransaction(instance, payload, idempotencyKey, recordRequest),
    onSuccess: ({ result }, variables) => {
      recordTransaction({
        transactionId: result.transactionId,
        providerId: variables.payload.providerId,
        externalTransactionId: variables.payload.externalTransactionId,
        kind: variables.payload.kind,
        status: result.status,
        failureCode: result.failureCode,
        idempotencyKey: variables.idempotencyKey,
        idempotentReplay: result.idempotentReplay,
        amount: variables.payload.money.amount,
        currency: variables.payload.money.currency,
      });
      // Nunca assumimos o saldo novo a partir da resposta — reconsulta de verdade no backend,
      // mesmo quando a operação não move dinheiro (LOSS, REJECTED), pra provar que de fato não moveu.
      void queryClient.invalidateQueries({ queryKey: ['wallet', instance, variables.payload.walletId] });
    },
    onError: (_error, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['wallet', instance, variables.payload.walletId] });
    },
  });
}
