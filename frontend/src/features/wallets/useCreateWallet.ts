import { useMutation } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { createWallet } from './api';
import { useInspectedRequest } from '@/lib/api/useInspectedRequest';
import { useSelectedInstance } from '@/lib/instance/InstanceContext';
import type { CreateWalletInput } from '@/types/schemas';

/**
 * `retry: false` já vem do default global do QueryClient (mutações financeiras nunca retentam
 * sozinhas — ver lib/api/queryClient.ts). `isPending` é o que a UI usa pra desabilitar o botão e
 * impedir duplo clique virar duplo POST.
 */
export function useCreateWallet() {
  const call = useInspectedRequest();
  const { selected: instance } = useSelectedInstance();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateWalletInput) => createWallet(instance, input, call),
    onSuccess: (wallet) => {
      queryClient.setQueryData(['wallet', instance, wallet.id], wallet);
    },
  });
}
