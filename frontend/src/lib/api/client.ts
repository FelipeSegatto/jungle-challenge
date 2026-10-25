import type { ApiError } from '@/types/api';

/** Uma instância por processo NestJS real (docker-compose.yml: api1/api2/api3 em 3001/3002/3003). */
export const API_INSTANCES = ['node-1', 'node-2', 'node-3'] as const;
export type ApiInstance = (typeof API_INSTANCES)[number];

const INSTANCE_BASE_PATH: Record<ApiInstance, string> = {
  'node-1': '/api/node-1',
  'node-2': '/api/node-2',
  'node-3': '/api/node-3',
};

export function instanceEndpoint(instance: ApiInstance, path: string): string {
  return `${INSTANCE_BASE_PATH[instance]}${path}`;
}

/** Erro de negócio/contrato real da API — o corpo bate com o ApiError documentado em types/api.ts. */
export class ApiRequestError extends Error {
  readonly apiError: ApiError;

  constructor(apiError: ApiError) {
    super(apiError.message);
    this.name = 'ApiRequestError';
    this.apiError = apiError;
  }
}

/**
 * A instância não respondeu com um envelope de erro reconhecível: ou o `fetch` falhou antes de
 * chegar a um servidor (rede/DNS), ou o proxy do Vite devolveu um erro de gateway (instância fora
 * do ar) cujo corpo não é o JSON padrão do backend. As duas situações são "não consegui falar com
 * essa instância" do ponto de vista do usuário — nunca derrubam a aplicação, sempre chegam aqui.
 * `status` só vem preenchido quando existiu uma resposta HTTP de verdade (caso do proxy); uma
 * falha de rede pura (DNS, fetch rejeitado) não tem status nenhum para reportar.
 */
export class ApiConnectionError extends Error {
  readonly instance: ApiInstance;
  readonly status: number | null;
  readonly cause?: unknown;

  constructor(instance: ApiInstance, message: string, status: number | null, cause?: unknown) {
    super(message);
    this.name = 'ApiConnectionError';
    this.instance = instance;
    this.status = status;
    this.cause = cause;
  }
}

function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).code === 'string' &&
    typeof (value as Record<string, unknown>).message === 'string' &&
    typeof (value as Record<string, unknown>).statusCode === 'number'
  );
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  headers?: Record<string, string>;
  /** Propagado pelo TanStack Query (query/mutation function recebe { signal }). */
  signal?: AbortSignal;
}

export interface ApiResponseMeta<T> {
  readonly data: T;
  readonly status: number;
}

/**
 * Núcleo único de chamada HTTP — faz exatamente UMA tentativa — nunca retenta sozinho. Retry
 * (quando fizer sentido, só em GET) é responsabilidade do QueryClient, configurado para NUNCA
 * retentar mutações financeiras (ver lib/api/queryClient.ts). `apiRequest` (abaixo) é o que a
 * maioria do código deve usar; `apiRequestWithMeta` existe só para quem precisa do status HTTP
 * real, como o Request Inspector (lib/api/inspectedRequest.ts).
 */
export async function apiRequestWithMeta<T>(
  instance: ApiInstance,
  path: string,
  options: ApiRequestOptions = {},
): Promise<ApiResponseMeta<T>> {
  const url = instanceEndpoint(instance, path);
  const method = options.method ?? 'GET';

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...options.headers,
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiConnectionError(instance, `Não foi possível conectar à instância "${instance}".`, null, cause);
  }

  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    if (isApiError(data)) throw new ApiRequestError(data);
    // Corpo não é o envelope de erro do backend: instância fora do ar, proxy sem alvo, etc.
    throw new ApiConnectionError(
      instance,
      `Instância "${instance}" respondeu ${response.status} sem um corpo de erro reconhecível — provavelmente fora do ar.`,
      response.status,
    );
  }

  return { data: data as T, status: response.status };
}

/** Única porta de saída para a API para quem não precisa do status HTTP cru. */
export async function apiRequest<T>(
  instance: ApiInstance,
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const { data } = await apiRequestWithMeta<T>(instance, path, options);
  return data;
}
