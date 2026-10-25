import Decimal from 'decimal.js';
import type { Money } from '@/types/api';

/**
 * Converte um Money da API (string decimal) para Decimal. Nunca passar por `number`/`parseFloat`
 * nesse caminho — é exatamente a restrição 6 do frontend/CLAUDE.md e a falha eliminatória da
 * seção 14 do desafio ("number para dinheiro"), estendida ao frontend por consistência.
 */
export function toDecimal(money: Money): Decimal {
  return new Decimal(money.amount);
}

const CURRENCY_LABEL: Record<string, string> = {
  BRL: 'R$',
};

/** Formata para exibição, ex.: { amount: "25.00", currency: "BRL" } -> "R$ 25,00". */
export function formatMoney(money: Money): string {
  const decimal = toDecimal(money);
  const label = CURRENCY_LABEL[money.currency] ?? money.currency;
  const parts = decimal.toFixed(2).split('.');
  const whole = parts[0] ?? '0';
  const fraction = parts[1] ?? '00';
  const wholeWithThousands = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${label} ${wholeWithThousands},${fraction}`.trim();
}

/** Para debug/exibição crua (ex.: tooltip), sem o símbolo de moeda. */
export function formatDecimal(money: Money): string {
  return toDecimal(money).toFixed(2);
}
