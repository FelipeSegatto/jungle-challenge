import type { ProcessWagerInput } from '@/types/schemas';

export interface IdempotencyRequest {
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly idempotencyKey: string;
  readonly payload: ProcessWagerInput;
}

export function buildIdempotencyKey(providerId: string, externalTransactionId: string): string {
  return `${providerId}:${externalTransactionId}`;
}

export interface OriginalBetParams {
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly walletId: string;
  readonly playerId: string;
  readonly roundId: string;
  readonly gameId: string;
  readonly amount: string;
  readonly currency: string;
}

/** Cenário A: monta a BET original e a Idempotency-Key que vai ser reaproveitada em B/C/D/E. */
export function buildOriginalBetRequest(params: OriginalBetParams): IdempotencyRequest {
  return {
    providerId: params.providerId,
    externalTransactionId: params.externalTransactionId,
    idempotencyKey: buildIdempotencyKey(params.providerId, params.externalTransactionId),
    payload: {
      providerId: params.providerId,
      externalTransactionId: params.externalTransactionId,
      playerId: params.playerId,
      walletId: params.walletId,
      roundId: params.roundId,
      gameId: params.gameId,
      kind: 'BET',
      money: { amount: params.amount, currency: params.currency },
    },
  };
}

/**
 * Cenário B: replay idêntico. Precisa devolver EXATAMENTE a mesma Idempotency-Key, o mesmo
 * providerId/externalTransactionId e um payload de negócio igual — nunca gerar nada novo
 * silenciosamente. Copia os valores (não a mesma referência de objeto) só para blindar contra
 * mutação acidental do estado original em algum outro lugar do app.
 */
export function buildReplayRequest(original: IdempotencyRequest): IdempotencyRequest {
  return {
    providerId: original.providerId,
    externalTransactionId: original.externalTransactionId,
    idempotencyKey: original.idempotencyKey,
    payload: { ...original.payload, money: { ...original.payload.money } },
  };
}

/** Cenário C: mesma Idempotency-Key, mas um campo de negócio permitido (o valor) é alterado de propósito. */
export function buildConflictRequest(original: IdempotencyRequest, modifiedAmount: string): IdempotencyRequest {
  return {
    providerId: original.providerId,
    externalTransactionId: original.externalTransactionId,
    idempotencyKey: original.idempotencyKey,
    payload: { ...original.payload, money: { ...original.payload.money, amount: modifiedAmount } },
  };
}

/** Cenário E: mesma Idempotency-Key, mas o playerId do payload diverge do dono real da wallet. */
export function buildDivergentIdentityRequest(original: IdempotencyRequest, divergentPlayerId: string): IdempotencyRequest {
  return {
    providerId: original.providerId,
    externalTransactionId: original.externalTransactionId,
    idempotencyKey: original.idempotencyKey,
    payload: { ...original.payload, playerId: divergentPlayerId },
  };
}
