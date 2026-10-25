import { describe, test, expect } from 'bun:test';
import {
  buildIdempotencyKey,
  buildOriginalBetRequest,
  buildReplayRequest,
  buildConflictRequest,
  buildDivergentIdentityRequest,
} from './scenarioBuilders';

const original = buildOriginalBetRequest({
  providerId: 'demo-provider',
  externalTransactionId: 'tx-1',
  walletId: 'wallet-1',
  playerId: 'player-1',
  roundId: 'round-1',
  gameId: 'game-1',
  amount: '20.00',
  currency: 'BRL',
});

describe('buildIdempotencyKey', () => {
  test('é exatamente providerId:externalTransactionId', () => {
    expect(buildIdempotencyKey('a', 'b')).toBe('a:b');
    expect(original.idempotencyKey).toBe('demo-provider:tx-1');
  });
});

describe('buildReplayRequest — cenário B', () => {
  const replay = buildReplayRequest(original);

  test('preserva a mesma Idempotency-Key', () => {
    expect(replay.idempotencyKey).toBe(original.idempotencyKey);
  });

  test('preserva providerId e externalTransactionId (a identidade da operação)', () => {
    expect(replay.providerId).toBe(original.providerId);
    expect(replay.externalTransactionId).toBe(original.externalTransactionId);
  });

  test('preserva o payload de negócio byte a byte', () => {
    expect(replay.payload).toEqual(original.payload);
  });

  test('não reaproveita a mesma referência de objeto (evita mutação acidental do original)', () => {
    expect(replay.payload).not.toBe(original.payload);
    expect(replay.payload.money).not.toBe(original.payload.money);
  });
});

describe('buildConflictRequest — cenário C', () => {
  const conflict = buildConflictRequest(original, '999.00');

  test('mantém a mesma Idempotency-Key — é o ponto do teste de conflito', () => {
    expect(conflict.idempotencyKey).toBe(original.idempotencyKey);
  });

  test('altera só o valor, de propósito', () => {
    expect(conflict.payload.money.amount).toBe('999.00');
    expect(conflict.payload.money.amount).not.toBe(original.payload.money.amount);
  });

  test('mantém o resto do payload igual ao original', () => {
    expect(conflict.payload.walletId).toBe(original.payload.walletId);
    expect(conflict.payload.playerId).toBe(original.payload.playerId);
    expect(conflict.payload.kind).toBe(original.payload.kind);
  });

  test('não muda o payload original em memória', () => {
    expect(original.payload.money.amount).toBe('20.00');
  });
});

describe('buildDivergentIdentityRequest — cenário E', () => {
  const divergent = buildDivergentIdentityRequest(original, 'outro-player-id');

  test('mantém a mesma Idempotency-Key', () => {
    expect(divergent.idempotencyKey).toBe(original.idempotencyKey);
  });

  test('troca só o playerId', () => {
    expect(divergent.payload.playerId).toBe('outro-player-id');
    expect(divergent.payload.playerId).not.toBe(original.payload.playerId);
  });

  test('mantém walletId e demais campos iguais ao original', () => {
    expect(divergent.payload.walletId).toBe(original.payload.walletId);
    expect(divergent.payload.money).toEqual(original.payload.money);
  });
});
