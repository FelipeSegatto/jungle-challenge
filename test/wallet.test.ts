import { test, expect, describe } from 'bun:test';
import { Wallet } from '../src/domain/wallet';
import { WalletLedgerEntry } from '../src/domain/ledger';
import { Money } from '../src/domain/money';
const brl = (amount: string) => Money.from({ amount, currency: 'BRL' });
describe('Wallet e ledger', () => {
    test('version inicia em 1 e incrementa só quando saldo muda', () => {
        const wallet = Wallet.open(crypto.randomUUID(), brl('100.00'));
        expect(wallet.version).toBe(1);
        const move = wallet.debit(brl('80.00'));
        expect(wallet.balance.toJSON().amount).toBe('20.00');
        expect(wallet.version).toBe(2);
        const ledger = WalletLedgerEntry.create({ walletId: wallet.id, transactionId: crypto.randomUUID(),
            direction: 'DEBIT', money: brl('80.00'), balanceBefore: move.before, balanceAfter: move.after });
        expect(ledger.isBalanced()).toBe(true);
    });
    test('não permite saldo negativo ou moeda incompatível', () => {
        const wallet = Wallet.open(crypto.randomUUID(), brl('100.00'));
        expect(() => wallet.debit(brl('101.00'))).toThrow();
        expect(wallet.balance.toJSON().amount).toBe('100.00');
        expect(() => wallet.credit(Money.from({ amount: '2.00', currency: 'USD' }))).toThrow();
    });
    test('ledger rejeita aritmética adulterada', () => {
        expect(() => WalletLedgerEntry.create({ walletId: crypto.randomUUID(), transactionId: crypto.randomUUID(),
            direction: 'DEBIT', money: brl('8.00'), balanceBefore: brl('100.00'), balanceAfter: brl('99.00') })).toThrow();
    });
});
