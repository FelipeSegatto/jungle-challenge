import { describe, test, expect } from 'vitest';
import Decimal from 'decimal.js';
import { toDecimal, formatMoney, formatDecimal } from '@/lib/money/format';

describe('toDecimal', () => {
  test('converte Money em Decimal sem passar por number', () => {
    const decimal = toDecimal({ amount: '19999999999999.99', currency: 'BRL' });
    expect(decimal).toBeInstanceOf(Decimal);
    expect(decimal.toFixed(2)).toBe('19999999999999.99');
  });
});

describe('formatMoney', () => {
  test('formata BRL com símbolo, separador de milhar e vírgula decimal', () => {
    expect(formatMoney({ amount: '1234.50', currency: 'BRL' })).toBe('R$ 1.234,50');
  });

  test('preserva centavos exatos, inclusive .00 e .09', () => {
    expect(formatMoney({ amount: '100.00', currency: 'BRL' })).toBe('R$ 100,00');
    expect(formatMoney({ amount: '0.09', currency: 'BRL' })).toBe('R$ 0,09');
  });

  test('moeda sem símbolo conhecido usa o próprio código como prefixo', () => {
    expect(formatMoney({ amount: '10.00', currency: 'USD' })).toBe('USD 10,00');
  });

  test('não usa number/parseFloat — um valor maior que Number.MAX_SAFE_INTEGER permanece exato', () => {
    const huge = { amount: '90071992547409.91', currency: 'BRL' };
    // Se passasse por Number(), perderia precisão (Number.MAX_SAFE_INTEGER = 9007199254740991).
    expect(formatMoney(huge)).toBe('R$ 90.071.992.547.409,91');
  });
});

describe('formatDecimal', () => {
  test('devolve só o número com 2 casas, sem símbolo de moeda', () => {
    expect(formatDecimal({ amount: '1234.5', currency: 'BRL' })).toBe('1234.50');
  });
});
