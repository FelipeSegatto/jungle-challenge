import { useQueries } from '@tanstack/react-query';
import { API_INSTANCES, type ApiInstance } from '@/lib/api/client';
import { useRequestInspector } from '@/lib/inspector/RequestInspectorContext';
import { fetchRawMetrics } from './api';
import { parsePrometheusText, extractWageringMetrics, type WageringMetricsSnapshot } from './prometheus';

export interface InstanceMetricsResult {
  readonly instance: ApiInstance;
  readonly status: 'loading' | 'error' | 'success';
  readonly snapshot: WageringMetricsSnapshot | null;
  readonly errorMessage: string | null;
  readonly fetchedAt: Date | null;
  readonly isFetching: boolean;
  readonly refetch: () => void;
}

/**
 * Sem `refetchInterval`: a Parte B do laboratório é instantânea/cumulativa (contadores desde o
 * início do processo), não um monitor ao vivo — atualiza sob ação explícita (botão), nunca sozinha.
 * `retry: false` porque uma instância fora do ar deve aparecer como erro imediatamente, não após
 * tentativas automáticas silenciosas.
 */
export function useWageringMetrics(): InstanceMetricsResult[] {
  const { recordRequest } = useRequestInspector();

  const results = useQueries({
    queries: API_INSTANCES.map((instance) => ({
      queryKey: ['wagering-metrics', instance] as const,
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const text = await fetchRawMetrics(instance, recordRequest, signal);
        return extractWageringMetrics(parsePrometheusText(text));
      },
      retry: false,
    })),
  });

  return API_INSTANCES.map((instance, index) => {
    const result = results[index];
    const status: InstanceMetricsResult['status'] = result?.status === 'pending' || result?.status === undefined ? 'loading' : result.status;
    return {
      instance,
      status,
      snapshot: result?.data ?? null,
      errorMessage: result?.error instanceof Error ? result.error.message : null,
      fetchedAt: result?.dataUpdatedAt ? new Date(result.dataUpdatedAt) : null,
      isFetching: result?.isFetching ?? false,
      refetch: () => void result?.refetch(),
    };
  });
}
