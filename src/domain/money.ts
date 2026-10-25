import Decimal from 'decimal.js';
import { DomainError } from './errors';
export interface MoneyProps {
  amount: string;
  currency: string;
}
/** Value Object; nunca usar JS number para quantias monetárias. */
export class Money {
  private constructor(
    private readonly value: Decimal,
    public readonly currency: string,
  ) {}
  static from(props: MoneyProps): Money {
    if (
      !props ||
      typeof props.amount !== 'string' ||
      !/^(0|[1-9]\d{0,17})\.\d{2}$/.test(props.amount)
    ) {
      throw new DomainError(
        'INVALID_MONEY',
        'Quantia precisa ser string decimal positiva com 2 casas.',
        400,
      );
    }
    if (typeof props.currency !== 'string' || !/^[A-Z]{3}$/.test(props.currency)) {
      throw new DomainError('INVALID_CURRENCY', 'Moeda ISO-4217 inválida.', 400);
    }
    const value = new Decimal(props.amount);
    if (!value.isFinite()) throw new DomainError('INVALID_MONEY', 'Valor não finito.', 400);
    return new Money(value, props.currency);
  }
  static zero(currency: string): Money {
    return Money.from({ amount: '0.00', currency });
  }
  private sameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new DomainError('CURRENCY_MISMATCH', 'Operação entre moedas diferentes.');
    }
  }
  add(other: Money): Money {
    this.sameCurrency(other);
    return new Money(this.value.plus(other.value), this.currency);
  }
  subtract(other: Money): Money {
    this.sameCurrency(other);
    return new Money(this.value.minus(other.value), this.currency);
  }
  negate(): Money {
    return new Money(this.value.negated(), this.currency);
  }
  isZero(): boolean {
    return this.value.isZero();
  }
  isPositive(): boolean {
    return this.value.gt(0);
  }
  isNegative(): boolean {
    return this.value.lt(0);
  }
  isLessThan(other: Money): boolean {
    this.sameCurrency(other);
    return this.value.lt(other.value);
  }
  equals(other: Money): boolean {
    return this.currency === other.currency && this.value.eq(other.value);
  }
  toJSON(): MoneyProps {
    return { amount: this.value.toFixed(2), currency: this.currency };
  }
  toString(): string {
    return `${this.value.toFixed(2)} ${this.currency}`;
  }
}
