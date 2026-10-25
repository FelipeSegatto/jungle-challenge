import { useQuery } from '@tanstack/react-query';
import { getLedgerPage } from './api';
import { useInspectedRequest } from '@/lib/api/useInspectedRequest';
import { useSelectedInstance } from '@/lib/instance/InstanceContext';

const SEQUENCE_LIMIT = 50;

/**
 * Busca independente da tabela paginada, só para a visualização didática: pega até
 * SEQUENCE_LIMIT lançamentos mais recentes (a API devolve newest-first) e devolve já invertidos
 * (oldest-first), pra ler como uma sequência "o que aconteceu primeiro". Se a wallet tiver mais
 * de SEQUENCE_LIMIT lançamentos, os mais antigos (incluindo possivelmente o OPENING) não aparecem
 * aqui — a UI avisa isso explicitamente, não finge ter o histórico completo.
 */
export function useLedgerSequence(walletId: string | null) {
  const call = useInspectedRequest();
  const { selected: instance } = useSelectedInstance();

  const query = useQuery({
    queryKey: ['ledgerSequence', instance, walletId, SEQUENCE_LIMIT],
    queryFn: ({ signal }) => getLedgerPage(instance, walletId as string, { cursor: null, limit: SEQUENCE_LIMIT }, call, signal),
    enabled: walletId !== null && walletId.trim().length > 0,
  });

  const chronological = query.data ? [...query.data.items].reverse() : [];
  const possiblyTruncated = Boolean(query.data?.nextCursor);

  return { query, chronological, possiblyTruncated, limit: SEQUENCE_LIMIT };
}
