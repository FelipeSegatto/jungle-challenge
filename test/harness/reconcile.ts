import { expect } from 'bun:test';
import Decimal from 'decimal.js';
import type { EntityManager } from '@mikro-orm/postgresql';
import { LedgerRow, WalletRow } from '../../src/infrastructure/entities/rows';

/**
 * Requisito F: `consistent: true` sozinho não prova que a operação correta aconteceu — por isso
 * esta função SEMPRE recebe o saldo esperado do cenário e recalcula o saldo a partir do ledger
 * (CREDIT soma, DEBIT subtrai) de forma independente do endpoint de reconciliação, comparando os
 * dois com o valor que o teste realmente espera.
 */
export async function assertBalanceMatchesLedger(
  em: EntityManager,
  walletId: string,
  expectedBalance: string,
): Promise<void> {
  const wallet = await em.fork().findOneOrFail(WalletRow, { id: walletId });
  expect(wallet.balance).toBe(expectedBalance);
  const entries = await em.fork().find(LedgerRow, { walletId });
  const reconstructed = entries.reduce(
    (acc, entry) =>
      entry.direction === 'CREDIT' ? acc.plus(entry.amount) : acc.minus(entry.amount),
    new Decimal(0),
  );
  expect(reconstructed.toFixed(2)).toBe(expectedBalance);
}
