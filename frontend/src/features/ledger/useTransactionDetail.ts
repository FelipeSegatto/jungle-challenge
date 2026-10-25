import { useQuery } from '@tanstack/react-query';
import { getWagerTransaction } from '@/features/transactions/api';
import { useInspectedRequest } from '@/lib/api/useInspectedRequest';
import { useSelectedInstance } from '@/lib/instance/InstanceContext';

/**
 * `enabled` só liga quando o usuário pede ("ver detalhes") — o ledger não carrega o `kind` de
 * cada lançamento, só `direction`; buscar o tipo real da operação é uma chamada extra e sob
 * demanda, nunca automática para todas as linhas da página.
 */
export function useTransactionDetail(transactionId: string | null) {
  const call = useInspectedRequest();
  const { selected: instance } = useSelectedInstance();

  return useQuery({
    queryKey: ['wagerTransaction', instance, transactionId],
    queryFn: () => getWagerTransaction(instance, transactionId as string, call),
    enabled: transactionId !== null,
  });
}
