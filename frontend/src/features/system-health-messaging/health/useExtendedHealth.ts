import { useQueries, type QueryFunctionContext } from '@tanstack/react-query';
import { API_INSTANCES, ApiRequestError, ApiConnectionError, type ApiInstance } from '@/lib/api/client';
import { getLive, getReady } from '@/features/health/api';

export type HealthState = 'loading' | 'ok' | 'down';
/** healthy = live+ready ok; unhealthy = servidor responde mas dependências não; unavailable = nem o live responde. */
export type OverallStatus = 'checking' | 'healthy' | 'unhealthy' | 'unavailable';
export type ErrorKind = 'none' | 'dependency-unavailable' | 'connection' | 'unknown';

interface TimedResult<T> {
  readonly data: T;
  readonly durationMs: number;
}

/** Reaproveita `getLive`/`getReady` de `features/health/api.ts` — só mede o tempo em volta, não reimplementa a chamada. */
async function timed<T>(fetcher: (signal?: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<TimedResult<T>> {
  const started = performance.now();
  const data = await fetcher(signal);
  return { data, durationMs: performance.now() - started };
}

function toState(status: 'pending' | 'error' | 'success' | undefined): HealthState {
  if (status === 'error') return 'down';
  if (status === 'success') return 'ok';
  return 'loading';
}

export interface ExtendedInstanceHealth {
  readonly instance: ApiInstance;
  readonly live: HealthState;
  readonly ready: HealthState;
  readonly overall: OverallStatus;
  readonly dependencies?: { readonly postgres: 'ok'; readonly sqs: 'ok' };
  readonly lastCheckedAt?: Date;
  /** Tempo medido no navegador (fetch start -> corpo lido), não um valor reportado pelo servidor. */
  readonly liveDurationMs?: number;
  readonly readyDurationMs?: number;
  readonly errorKind: ErrorKind;
  readonly errorMessage?: string;
}

function overallStatus(live: HealthState, ready: HealthState): OverallStatus {
  if (live === 'loading' || ready === 'loading') return 'checking';
  if (live === 'down') return 'unavailable';
  if (ready === 'down') return 'unhealthy';
  return 'healthy';
}

/**
 * Extensão de `features/health/useInstancesHealth` com o que a Parte A do módulo de System Health
 * exige e o hook original não tinha: tempo de resposta medido no navegador e classificação
 * explícita de erro (dependência indisponível vs. falha de conexão). Mantido como hook separado
 * para não alterar o comportamento do `HealthDashboard` já usado na Overview.
 */
export function useExtendedInstancesHealth(): ExtendedInstanceHealth[] {
  const liveResults = useQueries({
    queries: API_INSTANCES.map((instance) => ({
      queryKey: ['ext-health', instance, 'live'] as const,
      queryFn: ({ signal }: QueryFunctionContext) => timed((s) => getLive(instance, s), signal),
      refetchInterval: 10_000,
    })),
  });

  const readyResults = useQueries({
    queries: API_INSTANCES.map((instance) => ({
      queryKey: ['ext-health', instance, 'ready'] as const,
      queryFn: ({ signal }: QueryFunctionContext) => timed((s) => getReady(instance, s), signal),
      refetchInterval: 10_000,
    })),
  });

  return API_INSTANCES.map((instance, index) => {
    const live = liveResults[index];
    const ready = readyResults[index];
    const liveState = toState(live?.status);
    const readyState = toState(ready?.status);

    let errorKind: ErrorKind = 'none';
    let errorMessage: string | undefined;
    const readyError = ready?.error;
    const liveError = live?.error;
    if (readyError instanceof ApiRequestError) {
      // Confirmado por execução real (parando o PostgreSQL de propósito): um 503 de dependência indisponível
      // vem com `code: "HTTP_VALIDATION_ERROR"` — um detalhe enganoso real do backend (ver ARCHITECTURE.md),
      // não um bug do frontend. Por isso classificamos pelo `statusCode`, nunca pelo campo `code`.
      errorKind = readyError.apiError.statusCode === 503 ? 'dependency-unavailable' : 'unknown';
      errorMessage = readyError.apiError.message;
    } else if (readyError instanceof ApiConnectionError) {
      errorKind = 'connection';
      errorMessage = readyError.message;
    } else if (liveError instanceof ApiConnectionError) {
      errorKind = 'connection';
      errorMessage = liveError.message;
    } else if (liveError instanceof Error) {
      errorKind = 'unknown';
      errorMessage = liveError.message;
    }

    return {
      instance,
      live: liveState,
      ready: readyState,
      overall: overallStatus(liveState, readyState),
      dependencies: ready?.data?.data.dependencies,
      lastCheckedAt: ready?.dataUpdatedAt ? new Date(ready.dataUpdatedAt) : undefined,
      liveDurationMs: live?.data?.durationMs,
      readyDurationMs: ready?.data?.durationMs,
      errorKind,
      errorMessage,
    };
  });
}
