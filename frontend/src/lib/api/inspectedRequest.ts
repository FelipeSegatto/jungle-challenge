import {
  apiRequestWithMeta,
  instanceEndpoint,
  ApiRequestError,
  ApiConnectionError,
  type ApiInstance,
  type ApiRequestOptions,
} from './client';
import type { InspectedRequest } from '@/lib/inspector/RequestInspectorContext';

/**
 * Nenhum dos contratos atuais (Money, Wallet, ProcessWager) carrega segredo — mas o mecanismo de
 * redação existe de qualquer forma, porque o Inspector é genérico e será reutilizado por telas
 * futuras. Mantém a lista explícita em vez de assumir "nada aqui é sensível para sempre".
 */
const SENSITIVE_KEYS = new Set(['password', 'token', 'secret', 'accesskey', 'authorization', 'apikey']);

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        SENSITIVE_KEYS.has(key.toLowerCase()) ? '[omitido]' : redact(nested),
      ]),
    );
  }
  return value;
}

/**
 * Mesma política de UMA tentativa de `apiRequest` — só adiciona instrumentação (método, endpoint,
 * instância, corpo redigido, status, resposta, duração via `performance.now()`) e reporta pro
 * Request Inspector antes de devolver ou relançar. Nenhuma lógica de negócio nova aqui.
 */
export async function inspectedApiRequest<T>(
  instance: ApiInstance,
  path: string,
  options: ApiRequestOptions & { method: 'GET' | 'POST' },
  recordRequest: (entry: Omit<InspectedRequest, 'id'>) => void,
): Promise<T> {
  const endpoint = instanceEndpoint(instance, path);
  const started = performance.now();

  try {
    const { data, status } = await apiRequestWithMeta<T>(instance, path, options);
    recordRequest({
      method: options.method,
      endpoint,
      instance,
      requestBody: redact(options.body),
      statusCode: status,
      responseBody: data,
      durationMs: performance.now() - started,
      timestamp: new Date(),
      outcome: 'success',
    });
    return data;
  } catch (error) {
    const durationMs = performance.now() - started;
    if (error instanceof ApiRequestError) {
      recordRequest({
        method: options.method,
        endpoint,
        instance,
        requestBody: redact(options.body),
        statusCode: error.apiError.statusCode,
        responseBody: error.apiError,
        durationMs,
        timestamp: new Date(),
        outcome: 'api-error',
      });
    } else if (error instanceof ApiConnectionError) {
      recordRequest({
        method: options.method,
        endpoint,
        instance,
        requestBody: redact(options.body),
        statusCode: error.status,
        responseBody: null,
        durationMs,
        timestamp: new Date(),
        outcome: 'connection-error',
      });
    }
    throw error;
  }
}
