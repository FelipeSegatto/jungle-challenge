import { instanceEndpoint, ApiRequestError, ApiConnectionError, type ApiInstance } from '@/lib/api/client';
import type { InspectedRequest } from '@/lib/inspector/RequestInspectorContext';
import type { ApiError, WagerSubmissionResult, WagerStatus, WagerTransaction } from '@/types/api';
import type { ProcessWagerInput } from '@/types/schemas';

const WAGER_STATUSES: readonly WagerStatus[] = ['PROCESSED', 'REJECTED', 'PENDING_REFERENCE', 'FAILED'];

function isWagerSubmissionResult(value: unknown): value is WagerSubmissionResult {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.transactionId === 'string' &&
    typeof record.status === 'string' &&
    WAGER_STATUSES.includes(record.status as WagerStatus) &&
    typeof record.idempotentReplay === 'boolean'
  );
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

/**
 * POST /wagering/transactions é o único endpoint do backend cujo corpo de resposta não segue a
 * convenção "2xx = T, !2xx = ApiError" do resto da API — confirmado rodando a chamada de verdade
 * durante a auditoria: uma rejeição de negócio (`REJECTED`) vem em HTTP 422 com o MESMO shape de
 * um sucesso (`{transactionId, status, balance, failureCode, idempotentReplay}`), não com o
 * envelope `{code, message, statusCode, path}` dos demais erros. `apiRequest`/`apiRequestWithMeta`
 * genéricos tratariam esse 422 como falha de conexão por engano — por isso este endpoint tem seu
 * próprio parsing, verificando o SHAPE do corpo em vez de só o status HTTP.
 */
export interface WagerSubmissionResponse {
  readonly result: WagerSubmissionResult;
  readonly httpStatus: number;
}

export async function submitWagerTransaction(
  instance: ApiInstance,
  body: ProcessWagerInput,
  idempotencyKey: string,
  recordRequest: (entry: Omit<InspectedRequest, 'id'>) => void,
): Promise<WagerSubmissionResponse> {
  const endpoint = instanceEndpoint(instance, '/wagering/transactions');
  const started = performance.now();

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(body),
    });
  } catch (cause) {
    throw new ApiConnectionError(instance, `Não foi possível conectar à instância "${instance}".`, null, cause);
  }

  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  const durationMs = performance.now() - started;

  if (isWagerSubmissionResult(data)) {
    // 200 (PROCESSED/replay), 202 (PENDING_REFERENCE) ou 422 (REJECTED) — todos resultados de negócio válidos.
    recordRequest({
      method: 'POST',
      endpoint,
      instance,
      requestBody: body,
      statusCode: response.status,
      responseBody: data,
      durationMs,
      timestamp: new Date(),
      outcome: 'success',
    });
    return { result: data, httpStatus: response.status };
  }

  recordRequest({
    method: 'POST',
    endpoint,
    instance,
    requestBody: body,
    statusCode: isApiError(data) ? data.statusCode : response.ok ? response.status : null,
    responseBody: data,
    durationMs,
    timestamp: new Date(),
    outcome: isApiError(data) ? 'api-error' : 'connection-error',
  });

  if (isApiError(data)) throw new ApiRequestError(data);
  throw new ApiConnectionError(
    instance,
    `Instância "${instance}" respondeu ${response.status} sem um corpo reconhecível — provavelmente fora do ar.`,
    response.status,
  );
}

/** GET /wagering/transactions/:id — usado pela linha do tempo para reconsultar o estado depois de PENDING_REFERENCE. */
export async function getWagerTransaction(
  instance: ApiInstance,
  transactionId: string,
  call: <T>(instance: ApiInstance, path: string, options: { method: 'GET' }) => Promise<T>,
): Promise<WagerTransaction> {
  return call<WagerTransaction>(instance, `/wagering/transactions/${transactionId}`, { method: 'GET' });
}
