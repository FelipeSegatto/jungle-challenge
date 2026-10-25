import { test, expect, describe } from 'bun:test';
import { Money } from '../src/domain/money';
describe('Money - precisão decimal, formato e moedas', () => {
  test('0.10 + 0.20 = 0.30 sem float', () => {
    expect(
      Money.from({ amount: '0.10', currency: 'BRL' })
        .add(Money.from({ amount: '0.20', currency: 'BRL' }))
        .toJSON().amount,
    ).toBe('0.30');
  });
  test('rejeita notação científica, expoente, número e casas extras', () => {
    for (const amount of ['1e2', '-1.00', '1.001', '', 'Infinity', 'NaN', '1', '01.00']) {
      expect(() => Money.from({ amount, currency: 'BRL' })).toThrow();
    }
    expect(() => Money.from({ amount: 1 as unknown as string, currency: 'BRL' })).toThrow();
  });
  test('rejeita moedas divergentes', () => {
    expect(() =>
      Money.from({ amount: '10.00', currency: 'BRL' }).add(
        Money.from({ amount: '5.00', currency: 'USD' }),
      ),
    ).toThrow();
  });
  test('operações não modificam o valor original', () => {
    const first = Money.from({ amount: '15.00', currency: 'BRL' });
    const updated = first.subtract(Money.from({ amount: '2.00', currency: 'BRL' }));
    expect(first.toJSON().amount).toBe('15.00');
    expect(updated.toJSON().amount).toBe('13.00');
  });
});
