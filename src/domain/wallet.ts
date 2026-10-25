import { randomUUID } from 'node:crypto';
import { Money } from './money';
import { DomainError } from './errors';
export interface WalletState {
  id: string;
  playerId: string;
  currency: string;
  balance: Money;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}
export class Wallet {
  private constructor(
    public readonly id: string,
    public readonly playerId: string,
    public readonly currency: string,
    private _balance: Money,
    private _version: number,
    public readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}
  static open(playerId: string, initialBalance: Money, now = new Date()): Wallet {
    if (initialBalance.isNegative())
      throw new DomainError('NEGATIVE_OPENING', 'Saldo inicial negativo.');
    return new Wallet(randomUUID(), playerId, initialBalance.currency, initialBalance, 1, now, now);
  }
  static rehydrate(s: WalletState): Wallet {
    return new Wallet(s.id, s.playerId, s.currency, s.balance, s.version, s.createdAt, s.updatedAt);
  }
  get balance(): Money {
    return this._balance;
  }
  get version(): number {
    return this._version;
  }
  get updatedAt(): Date {
    return this._updatedAt;
  }
  private assertCurrency(money: Money): void {
    if (money.currency !== this.currency)
      throw new DomainError('CURRENCY_MISMATCH', 'Moeda diferente da wallet.');
  }
  private assertPositive(money: Money): void {
    if (!money.isPositive())
      throw new DomainError('INVALID_AMOUNT', 'Movimentação deve ser maior que zero.', 400);
  }
  debit(
    money: Money,
    now = new Date(),
  ): {
    before: Money;
    after: Money;
  } {
    this.assertCurrency(money);
    this.assertPositive(money);
    if (this._balance.isLessThan(money))
      throw new DomainError('INSUFFICIENT_BALANCE', 'Saldo insuficiente.');
    const before = this._balance;
    this._balance = this._balance.subtract(money);
    this._version++;
    this._updatedAt = now;
    return { before, after: this._balance };
  }
  credit(
    money: Money,
    now = new Date(),
  ): {
    before: Money;
    after: Money;
  } {
    this.assertCurrency(money);
    this.assertPositive(money);
    const before = this._balance;
    this._balance = this._balance.add(money);
    this._version++;
    this._updatedAt = now;
    return { before, after: this._balance };
  }
}
