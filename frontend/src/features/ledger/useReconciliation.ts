import { useMutation } from '@tanstack/react-query';
import { reconcileWallet } from './api';
import { useInspectedRequest } from '@/lib/api/useInspectedRequest';
import { useSelectedInstance } from '@/lib/instance/InstanceContext';

/** Disparada só por clique explícito — esta página é de consulta/auditoria, nada roda sozinho. */
export function useReconciliation(walletId: string) {
  const call = useInspectedRequest();
  const { selected: instance } = useSelectedInstance();

  return useMutation({
    mutationFn: () => reconcileWallet(instance, walletId, call),
  });
}
