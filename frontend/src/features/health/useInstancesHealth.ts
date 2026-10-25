import { useQueries, type QueryFunctionContext } from '@tanstack/react-query';
import { API_INSTANCES, type ApiInstance } from '@/lib/api/client';
import { getLive, getReady } from './api';

export type HealthState = 'loading' | 'ok' | 'down';

export interface InstanceHealthSummary {
  readonly instance: ApiInstance;
  readonly live: HealthState;
  readonly ready: HealthState;
  readonly errorMessage?: string;
  /** Só presente quando /health/ready respondeu 200 — nunca inventado quando a instância está down. */
  readonly dependencies?: { readonly postgres: 'ok'; readonly sqs: 'ok' };
  readonly lastCheckedAt?: Date;
}

function toState(status: 'pending' | 'error' | 'success' | undefined): HealthState {
  if (status === 'error') return 'down';
  if (status === 'success') return 'ok';
  return 'loading';
}

/**
 * Uma query por instância por endpoint (3 x 2 = 6), via `useQueries` — a ferramenta certa do
 * TanStack Query para N queries dinâmicas sobre uma lista fixa, sem chamar hooks dentro de loop.
 * `refetchInterval` mantém o painel atualizado sem o usuário precisar recarregar a página.
 */
export function useInstancesHealth(): InstanceHealthSummary[] {
  const liveResults = useQueries({
    queries: API_INSTANCES.map((instance) => ({
      queryKey: ['health', instance, 'live'] as const,
      queryFn: ({ signal }: QueryFunctionContext) => getLive(instance, signal),
      refetchInterval: 10_000,
    })),
  });

  const readyResults = useQueries({
    queries: API_INSTANCES.map((instance) => ({
      queryKey: ['health', instance, 'ready'] as const,
      queryFn: ({ signal }: QueryFunctionContext) => getReady(instance, signal),
      refetchInterval: 10_000,
    })),
  });

  return API_INSTANCES.map((instance, index) => {
    const live = liveResults[index];
    const ready = readyResults[index];
    const liveError = live?.error instanceof Error ? live.error.message : undefined;
    const readyError = ready?.error instanceof Error ? ready.error.message : undefined;
    const lastCheckedAt = ready?.dataUpdatedAt ? new Date(ready.dataUpdatedAt) : undefined;

    return {
      instance,
      live: toState(live?.status),
      ready: toState(ready?.status),
      errorMessage: liveError ?? readyError,
      dependencies: ready?.data?.dependencies,
      lastCheckedAt,
    };
  });
}
