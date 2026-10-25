import { test, expect, describe } from 'bun:test';
import { canonicalJson, payloadHash } from '../src/domain/hash';

/**
 * payloadHash é o mecanismo por trás da detecção de "mesma Idempotency-Key, payload divergente"
 * (seção 9 do desafio). Testado aqui em isolamento total — sem Postgres, sem HTTP — porque é
 * puramente funcional: a mesma entrada de negócio sempre produz o mesmo hash (replay seguro), e
 * qualquer campo de negócio diferente produz um hash diferente (conflito detectável). Os cenários
 * de ponta a ponta (HTTP + Postgres reais) estão em test/integration.test.ts.
 */
describe('payloadHash — base da detecção de payload divergente na mesma Idempotency-Key', () => {
  const base = {
    providerId: 'provider-a',
    externalTransactionId: 'tx-1',
    walletId: 'wallet-1',
    playerId: 'player-1',
    roundId: 'round-1',
    gameId: 'game-1',
    kind: 'BET',
    money: { amount: '10.00', currency: 'BRL' },
    referenceExternalTransactionId: null,
  };

  test('mesmo payload, só com a ordem das chaves diferente, produz o mesmo hash -> replay seguro', () => {
    const reordered = {
      kind: base.kind,
      money: base.money,
      gameId: base.gameId,
      roundId: base.roundId,
      playerId: base.playerId,
      walletId: base.walletId,
      externalTransactionId: base.externalTransactionId,
      providerId: base.providerId,
      referenceExternalTransactionId: base.referenceExternalTransactionId,
    };
    expect(payloadHash(base)).toBe(payloadHash(reordered));
  });

  test('amount diferente produz hash diferente', () => {
    expect(payloadHash(base)).not.toBe(
      payloadHash({ ...base, money: { amount: '10.01', currency: 'BRL' } }),
    );
  });

  test('currency diferente produz hash diferente', () => {
    expect(payloadHash(base)).not.toBe(
      payloadHash({ ...base, money: { amount: '10.00', currency: 'USD' } }),
    );
  });

  test('playerId diferente produz hash diferente', () => {
    expect(payloadHash(base)).not.toBe(payloadHash({ ...base, playerId: 'player-2' }));
  });

  test('walletId diferente produz hash diferente', () => {
    expect(payloadHash(base)).not.toBe(payloadHash({ ...base, walletId: 'wallet-2' }));
  });

  test('kind diferente produz hash diferente', () => {
    expect(payloadHash(base)).not.toBe(payloadHash({ ...base, kind: 'WIN' }));
  });

  test('referenceExternalTransactionId diferente (ex.: null vs. preenchido) produz hash diferente', () => {
    expect(payloadHash(base)).not.toBe(
      payloadHash({ ...base, referenceExternalTransactionId: 'ref-1' }),
    );
  });

  test('canonicalJson ordena chaves de objetos aninhados independentemente da ordem de inserção', () => {
    const a = canonicalJson({ b: 1, a: { y: 2, x: 1 } });
    const b = canonicalJson({ a: { x: 1, y: 2 }, b: 1 });
    expect(a).toBe(b);
  });

  test('canonicalJson distingue arrays de objetos e preserva ordem de array (não é um conjunto)', () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson({ '0': 1, '1': 2 }));
  });
});
