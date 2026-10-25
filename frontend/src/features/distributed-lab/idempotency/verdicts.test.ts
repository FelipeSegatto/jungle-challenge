import { describe, test, expect } from 'bun:test';
import { evaluateReplay, evaluateConflict, evaluateReplayAfterIntervening, type WagerOutcomeLike } from './verdicts';

function outcome(overrides: Partial<WagerOutcomeLike> = {}): WagerOutcomeLike {
  return {
    transactionId: 'tx-1',
    status: 'PROCESSED',
    balance: { amount: '80.00', currency: 'BRL' },
    idempotentReplay: false,
    ...overrides,
  };
}

describe('evaluateReplay — cenário B', () => {
  test('PASS: mesmo transactionId, idempotentReplay true, saldo da wallet inalterado', () => {
    const original = outcome();
    const replay = outcome({ idempotentReplay: true });
    const result = evaluateReplay(original, replay, '80.00', '80.00');
    expect(result.verdict).toBe('PASS');
  });

  test('FAIL: transactionId diferente (seria uma operação nova, não um replay)', () => {
    const original = outcome();
    const replay = outcome({ transactionId: 'tx-2', idempotentReplay: true });
    const result = evaluateReplay(original, replay, '80.00', '80.00');
    expect(result.verdict).toBe('FAIL');
  });

  test('FAIL: idempotentReplay false (backend tratou como nova operação)', () => {
    const original = outcome();
    const replay = outcome({ idempotentReplay: false });
    const result = evaluateReplay(original, replay, '80.00', '80.00');
    expect(result.verdict).toBe('FAIL');
  });

  test('FAIL: saldo da wallet mudou -> efeito financeiro duplicado', () => {
    const original = outcome();
    const replay = outcome({ idempotentReplay: true });
    const result = evaluateReplay(original, replay, '80.00', '60.00');
    expect(result.verdict).toBe('FAIL');
    expect(result.reason).toContain('duplicado');
  });

  test('FAIL: saldo histórico do replay diverge do original', () => {
    const original = outcome({ balance: { amount: '80.00', currency: 'BRL' } });
    const replay = outcome({ idempotentReplay: true, balance: { amount: '70.00', currency: 'BRL' } });
    const result = evaluateReplay(original, replay, '80.00', '80.00');
    expect(result.verdict).toBe('FAIL');
  });
});

describe('evaluateConflict — cenários C e E', () => {
  test('PASS: 409 IDEMPOTENCY_CONFLICT, saldo inalterado', () => {
    const result = evaluateConflict(409, 'IDEMPOTENCY_CONFLICT', '80.00', '80.00');
    expect(result.verdict).toBe('PASS');
  });

  test('INCONCLUSIVE: sem resposta HTTP (falha de conexão)', () => {
    const result = evaluateConflict(null, null, '80.00', '80.00');
    expect(result.verdict).toBe('INCONCLUSIVE');
  });

  test('FAIL: saldo mudou mesmo com o conflito', () => {
    const result = evaluateConflict(409, 'IDEMPOTENCY_CONFLICT', '80.00', '60.00');
    expect(result.verdict).toBe('FAIL');
  });

  test('FAIL: requisição divergente foi aceita (sucesso inesperado não vira PASS)', () => {
    const result = evaluateConflict(200, null, '80.00', '80.00');
    expect(result.verdict).toBe('FAIL');
  });

  test('FAIL: código de erro diferente do esperado', () => {
    const result = evaluateConflict(404, 'WALLET_NOT_FOUND', '80.00', '80.00');
    expect(result.verdict).toBe('FAIL');
  });
});

describe('evaluateReplayAfterIntervening — cenário D', () => {
  test('PASS: saldo histórico do replay bate com o original e diverge do saldo atual real', () => {
    const original = outcome({ balance: { amount: '80.00', currency: 'BRL' } });
    const replay = outcome({ idempotentReplay: true, balance: { amount: '80.00', currency: 'BRL' } });
    const result = evaluateReplayAfterIntervening(original, replay, '95.00');
    expect(result.verdict).toBe('PASS');
  });

  test('INCONCLUSIVE: saldo atual igual ao histórico (não prova a divergência)', () => {
    const original = outcome({ balance: { amount: '80.00', currency: 'BRL' } });
    const replay = outcome({ idempotentReplay: true, balance: { amount: '80.00', currency: 'BRL' } });
    const result = evaluateReplayAfterIntervening(original, replay, '80.00');
    expect(result.verdict).toBe('INCONCLUSIVE');
  });

  test('FAIL: saldo histórico do replay recalculado (diferente do original)', () => {
    const original = outcome({ balance: { amount: '80.00', currency: 'BRL' } });
    const replay = outcome({ idempotentReplay: true, balance: { amount: '95.00', currency: 'BRL' } });
    const result = evaluateReplayAfterIntervening(original, replay, '95.00');
    expect(result.verdict).toBe('FAIL');
  });

  test('FAIL: transactionId diferente', () => {
    const original = outcome({ balance: { amount: '80.00', currency: 'BRL' } });
    const replay = outcome({ transactionId: 'tx-other', idempotentReplay: true, balance: { amount: '80.00', currency: 'BRL' } });
    const result = evaluateReplayAfterIntervening(original, replay, '95.00');
    expect(result.verdict).toBe('FAIL');
  });
});
