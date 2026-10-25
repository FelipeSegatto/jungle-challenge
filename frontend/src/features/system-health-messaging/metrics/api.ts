import { instanceEndpoint, ApiConnectionError, type ApiInstance } from '@/lib/api/client';
import type { InspectedRequest } from '@/lib/inspector/RequestInspectorContext';

/**
 * `GET /health/metrics` devolve texto no formato de exposição do Prometheus, não JSON — por isso
 * não usa `apiRequest`/`apiRequestWithMeta` (que sempre fazem `response.json()`), mesmo padrão já
 * usado em `features/transactions/api.ts::submitWagerTransaction` para o outro endpoint com corpo
 * fora do envelope JSON padrão.
 */
export async function fetchRawMetrics(
  instance: ApiInstance,
  recordRequest: (entry: Omit<InspectedRequest, 'id'>) => void,
  signal?: AbortSignal,
): Promise<string> {
  const endpoint = instanceEndpoint(instance, '/health/metrics');
  const started = performance.now();

  let response: Response;
  try {
    response = await fetch(endpoint, { method: 'GET', signal });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiConnectionError(instance, `Não foi possível conectar à instância "${instance}".`, null, cause);
  }

  const text = await response.text();
  const durationMs = performance.now() - started;

  if (!response.ok) {
    recordRequest({
      method: 'GET',
      endpoint,
      instance,
      requestBody: undefined,
      statusCode: response.status,
      responseBody: text.slice(0, 500),
      durationMs,
      timestamp: new Date(),
      outcome: 'connection-error',
    });
    throw new ApiConnectionError(instance, `Instância "${instance}" respondeu ${response.status} ao consultar métricas.`, response.status);
  }

  recordRequest({
    method: 'GET',
    endpoint,
    instance,
    requestBody: undefined,
    statusCode: response.status,
    responseBody: `(texto no formato Prometheus, ${text.length} bytes — ver painel de métricas para a leitura estruturada)`,
    durationMs,
    timestamp: new Date(),
    outcome: 'success',
  });
  return text;
}
