import { useQuery } from '@tanstack/react-query';
import { getWallet } from './api';
import { useInspectedRequest } from '@/lib/api/useInspectedRequest';
import { useSelectedInstance } from '@/lib/instance/InstanceContext';

/**
 * `enabled` só fica true com um walletId de verdade — nada é consultado ao simplesmente abrir a
 * página. Todas as 3 instâncias apontam para o MESMO PostgreSQL (docker-compose.yml), então trocar
 * de instância com uma wallet selecionada deve devolver os mesmos dados — é parte da demonstração.
 */
export function useWallet(walletId: string | null) {
  const call = useInspectedRequest();
  const { selected: instance } = useSelectedInstance();

  return useQuery({
    queryKey: ['wallet', instance, walletId],
    queryFn: ({ signal }) => getWallet(instance, walletId as string, call, signal),
    enabled: walletId !== null && walletId.trim().length > 0,
  });
}
