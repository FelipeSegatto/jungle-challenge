import { randomUUID } from 'node:crypto';
import { DomainError } from './errors';
import { Money } from './money';
import type { Direction } from './wager';
export class WalletLedgerEntry {
  private constructor(
    public readonly id: string,
    public readonly walletId: string,
    public readonly transactionId: string,
    public readonly direction: Direction,
    public readonly money: Money,
    public readonly balanceBefore: Money,
    public readonly balanceAfter: Money,
    public readonly createdAt: Date,
  ) {}
  static create(props: {
    walletId: string;
    transactionId: string;
    direction: Direction;
    money: Money;
    balanceBefore: Money;
    balanceAfter: Money;
    createdAt?: Date;
  }): WalletLedgerEntry {
    const { walletId, transactionId, direction, money, balanceBefore, balanceAfter } = props;
    if (
      !money.isPositive() ||
      !balanceBefore.add(direction === 'CREDIT' ? money : money.negate()).equals(balanceAfter)
    ) {
      throw new DomainError('LEDGER_NOT_BALANCED', 'Aritmética do ledger inválida.', 500);
    }
    return new WalletLedgerEntry(
      randomUUID(),
      walletId,
      transactionId,
      direction,
      money,
      balanceBefore,
      balanceAfter,
      props.createdAt ?? new Date(),
    );
  }
  static rehydrate(s: {
    id: string;
    walletId: string;
    transactionId: string;
    direction: Direction;
    money: Money;
    balanceBefore: Money;
    balanceAfter: Money;
    createdAt: Date;
  }): WalletLedgerEntry {
    return new WalletLedgerEntry(
      s.id,
      s.walletId,
      s.transactionId,
      s.direction,
      s.money,
      s.balanceBefore,
      s.balanceAfter,
      s.createdAt,
    );
  }
  isBalanced(): boolean {
    return this.balanceBefore
      .add(this.direction === 'CREDIT' ? this.money : this.money.negate())
      .equals(this.balanceAfter);
  }
}
