import { describe, test, expect } from 'vitest';
import { moneySchema, createWalletSchema, processWagerSchema } from '@/types/schemas';

describe('moneySchema', () => {
  test('aceita um decimal positivo com 2 casas', () => {
    expect(moneySchema.safeParse({ amount: '25.00', currency: 'BRL' }).success).toBe(true);
  });

  test('aceita zero', () => {
    expect(moneySchema.safeParse({ amount: '0.00', currency: 'BRL' }).success).toBe(true);
  });

  test('rejeita negativo', () => {
    expect(moneySchema.safeParse({ amount: '-5.00', currency: 'BRL' }).success).toBe(false);
  });

  test('rejeita sem casas decimais', () => {
    expect(moneySchema.safeParse({ amount: '25', currency: 'BRL' }).success).toBe(false);
  });

  test('rejeita mais de 2 casas decimais', () => {
    expect(moneySchema.safeParse({ amount: '25.001', currency: 'BRL' }).success).toBe(false);
  });

  test('rejeita notação científica', () => {
    expect(moneySchema.safeParse({ amount: '2.5e1', currency: 'BRL' }).success).toBe(false);
  });

  test('rejeita zero à esquerda (ex.: 025.00)', () => {
    expect(moneySchema.safeParse({ amount: '025.00', currency: 'BRL' }).success).toBe(false);
  });

  test('rejeita moeda fora do padrão 3 letras maiúsculas', () => {
    expect(moneySchema.safeParse({ amount: '25.00', currency: 'brl' }).success).toBe(false);
    expect(moneySchema.safeParse({ amount: '25.00', currency: 'BRLX' }).success).toBe(false);
  });
});

describe('createWalletSchema', () => {
  const validPlayerId = '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1';

  test('aceita playerId UUID + saldo inicial válido', () => {
    const result = createWalletSchema.safeParse({ playerId: validPlayerId, initialBalance: { amount: '100.00', currency: 'BRL' } });
    expect(result.success).toBe(true);
  });

  test('rejeita playerId que não é UUID', () => {
    const result = createWalletSchema.safeParse({ playerId: 'not-a-uuid', initialBalance: { amount: '100.00', currency: 'BRL' } });
    expect(result.success).toBe(false);
  });
});

describe('processWagerSchema', () => {
  const base = {
    providerId: 'demo-provider',
    externalTransactionId: 'tx-1',
    playerId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1',
    walletId: '0192f291-27dd-7d3f-8071-5f8685deef37',
    roundId: 'round-1',
    gameId: 'game-1',
    money: { amount: '10.00', currency: 'BRL' },
  };

  test('BET sem referência é válida', () => {
    expect(processWagerSchema.safeParse({ ...base, kind: 'BET' }).success).toBe(true);
  });

  test('REFUND exige referenceExternalTransactionId', () => {
    const result = processWagerSchema.safeParse({ ...base, kind: 'REFUND' });
    expect(result.success).toBe(false);
  });

  test('REFUND com referência válida passa', () => {
    const result = processWagerSchema.safeParse({ ...base, kind: 'REFUND', referenceExternalTransactionId: 'tx-0' });
    expect(result.success).toBe(true);
  });

  test('BET com referência é rejeitada (campo proibido para esse kind)', () => {
    const result = processWagerSchema.safeParse({ ...base, kind: 'BET', referenceExternalTransactionId: 'tx-0' });
    expect(result.success).toBe(false);
  });

  test('uma operação não pode referenciar a si mesma', () => {
    const result = processWagerSchema.safeParse({
      ...base,
      kind: 'ROLLBACK',
      externalTransactionId: 'tx-same',
      referenceExternalTransactionId: 'tx-same',
    });
    expect(result.success).toBe(false);
  });

  test('rejeita kind desconhecido', () => {
    const result = processWagerSchema.safeParse({ ...base, kind: 'DEPOSIT' });
    expect(result.success).toBe(false);
  });

  test('rejeita walletId que não é UUID', () => {
    const result = processWagerSchema.safeParse({ ...base, kind: 'BET', walletId: 'wallet-1' });
    expect(result.success).toBe(false);
  });
});
