import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getLedgerPage } from './api';
import { useInspectedRequest } from '@/lib/api/useInspectedRequest';
import { useSelectedInstance } from '@/lib/instance/InstanceContext';

const PAGE_SIZE = 15;

/**
 * Pilha de cursores visitados — não é paginação por offset inventada no cliente, é só memória de
 * qual cursor opaco usar pra "voltar". O cursor em si sempre vem do `nextCursor` real da API.
 */
export function useLedgerPage(walletId: string | null) {
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const call = useInspectedRequest();
  const { selected: instance } = useSelectedInstance();

  const cursor = cursorStack[pageIndex] ?? null;

  const query = useQuery({
    queryKey: ['ledger', instance, walletId, cursor, PAGE_SIZE],
    queryFn: ({ signal }) => getLedgerPage(instance, walletId as string, { cursor, limit: PAGE_SIZE }, call, signal),
    enabled: walletId !== null && walletId.trim().length > 0,
  });

  const goToNextPage = (): void => {
    if (!query.data?.nextCursor) return;
    setCursorStack((stack) => {
      const next = stack.slice(0, pageIndex + 1);
      next.push(query.data!.nextCursor);
      return next;
    });
    setPageIndex((index) => index + 1);
  };

  const goToPreviousPage = (): void => {
    setPageIndex((index) => Math.max(0, index - 1));
  };

  const resetPagination = (): void => {
    setCursorStack([null]);
    setPageIndex(0);
  };

  return {
    query,
    pageNumber: pageIndex + 1,
    hasPreviousPage: pageIndex > 0,
    hasNextPage: Boolean(query.data?.nextCursor),
    goToNextPage,
    goToPreviousPage,
    resetPagination,
    pageSize: PAGE_SIZE,
  };
}
