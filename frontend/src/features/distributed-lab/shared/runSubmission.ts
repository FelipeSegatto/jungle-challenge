import { submitWagerTransaction } from '@/features/transactions/api';
import { getWallet, type InspectedCall } from '@/features/wallets/api';
import { ApiRequestError, ApiConnectionError, type ApiInstance } from '@/lib/api/client';
import type { InspectedRequest } from '@/lib/inspector/RequestInspectorContext';
import type { ProcessWagerInput } from '@/types/schemas';
import type { WagerSubmissionResult } from '@/types/api';

export interface ScenarioRun {
  readonly httpStatus: number | null;
  readonly outcome: 'success' | 'api-error' | 'connection-error';
  readonly result: WagerSubmissionResult | null;
  readonly apiErrorCode: string | null;
  readonly apiErrorMessage: string | null;
  readonly walletBalanceAfter: string | null;
}

/**
 * Submete UMA operação (sem retry) e reconsulta o saldo real da wallet depois — compartilhado
 * entre o Idempotency Lab e o passo de Concorrência do Guided Demo, pra não duplicar o caminho
 * "enviar + reconsultar + classificar o resultado" em dois lugares.
 */
export async function runWagerSubmission(
  instance: ApiInstance,
  payload: ProcessWagerInput,
  idempotencyKey: string,
  walletId: string,
  call: InspectedCall,
  recordRequest: (entry: Omit<InspectedRequest, 'id'>) => void,
): Promise<ScenarioRun> {
  try {
    const { result, httpStatus } = await submitWagerTransaction(instance, payload, idempotencyKey, recordRequest);
    const wallet = await getWallet(instance, walletId, call);
    return {
      httpStatus,
      outcome: 'success',
      result,
      apiErrorCode: null,
      apiErrorMessage: null,
      walletBalanceAfter: wallet.balance.amount,
    };
  } catch (error) {
    const walletBalanceAfter = await getWallet(instance, walletId, call)
      .then((w) => w.balance.amount)
      .catch(() => null);
    if (error instanceof ApiRequestError) {
      return {
        httpStatus: error.apiError.statusCode,
        outcome: 'api-error',
        result: null,
        apiErrorCode: error.apiError.code,
        apiErrorMessage: error.apiError.message,
        walletBalanceAfter,
      };
    }
    if (error instanceof ApiConnectionError) {
      return {
        httpStatus: error.status,
        outcome: 'connection-error',
        result: null,
        apiErrorCode: null,
        apiErrorMessage: error.message,
        walletBalanceAfter,
      };
    }
    throw error;
  }
}
