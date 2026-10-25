import { useCallback } from 'react';
import { useRequestInspector } from '@/lib/inspector/RequestInspectorContext';
import { inspectedApiRequest } from './inspectedRequest';
import type { ApiInstance, ApiRequestOptions } from './client';

/** Função de chamada à API já ligada ao Request Inspector deste app — use em vez de `apiRequest` direto nas features. */
export function useInspectedRequest() {
  const { recordRequest } = useRequestInspector();

  return useCallback(
    <T,>(instance: ApiInstance, path: string, options: ApiRequestOptions & { method: 'GET' | 'POST' }) =>
      inspectedApiRequest<T>(instance, path, options, recordRequest),
    [recordRequest],
  );
}
