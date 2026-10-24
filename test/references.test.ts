/** Real integration: out-of-order dependency recovery uses PostgreSQL transactions. */
import { beforeAll, afterAll, describe, test, expect } from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';
import config from '../mikro-orm.config';
import { WalletService, WagerService } from '../src/application/services';
import { WagerRow, WalletRow, LedgerRow } from '../src/infrastructure/entities/rows';
let orm: MikroORM;
beforeAll(async () => { orm = await MikroORM.init(config); });
afterAll(async () => { if (orm)
    await orm.close(true); });
const uuid = () => crypto.randomUUID();
describe('Pendências de referência', () => {
    test('REFUND antes de BET resolve após chegada da referência', async () => {
        const playerId = uuid(), providerId = 'provider-' + uuid(), betExternal = 'bet-' + uuid();
        const wallet = await new WalletService(orm.em.fork()).create(playerId, { amount: '100.00', currency: 'BRL' });
        const common = { providerId, playerId, walletId: wallet.id, roundId: 'r-1', gameId: 'g-1' };
        const wagers = new WagerService(orm.em.fork());
        const refund = await wagers.process({ ...common, externalTransactionId: 'refund-' + uuid(),
            kind: 'REFUND', money: { amount: '20.00', currency: 'BRL' }, referenceExternalTransactionId: betExternal }, 'idem-' + uuid());
        expect(refund.status).toBe('PENDING_REFERENCE');
        const bet = await wagers.process({ ...common, externalTransactionId: betExternal,
            kind: 'BET', money: { amount: '20.00', currency: 'BRL' } }, 'idem-' + uuid());
        expect(bet.status).toBe('PROCESSED');
        // Clock advance without sleeping: scheduled retry is now due.
        await orm.em.fork().nativeUpdate(WagerRow, { id: refund.transactionId }, { nextAttemptAt: new Date(0) });
        expect(['processed','skipped']).toContain(await wagers.retryPendingReference(refund.transactionId));
        const state = await orm.em.fork().findOneOrFail(WalletRow, { id: wallet.id });
        expect(state.balance).toBe('100.00');
        const row = await orm.em.fork().findOneOrFail(WagerRow, { id: refund.transactionId });
        expect(row.status).toBe('PROCESSED');
        const ledger = await orm.em.fork().find(LedgerRow, { walletId: wallet.id });
        expect(ledger).toHaveLength(3); // opening, bet, refund
    }, 90000);
    test('ausência de referência termina em REJECTED e permanece auditável', async () => {
        const playerId = uuid();
        const wallet = await new WalletService(orm.em.fork()).create(playerId, { amount: '10.00', currency: 'BRL' });
        const service = new WagerService(orm.em.fork());
        const pending = await service.process({ providerId: 'p-' + uuid(), externalTransactionId: 'refund-' + uuid(),
            playerId, walletId: wallet.id, roundId: 'r', gameId: 'g', kind: 'REFUND',
            money: { amount: '5.00', currency: 'BRL' }, referenceExternalTransactionId: 'never-' + uuid() }, 'idem-' + uuid());
        await orm.em.fork().nativeUpdate(WagerRow, { id: pending.transactionId }, { nextAttemptAt: new Date(0) });
        expect(await service.retryPendingReference(pending.transactionId, 1)).toBe('rejected');
        const saved = await orm.em.fork().findOneOrFail(WagerRow, { id: pending.transactionId });
        expect(saved.failureCode).toBe('REFERENCE_NOT_FOUND');
        expect(saved.status).toBe('REJECTED');
        expect((await orm.em.fork().findOneOrFail(WalletRow, { id: wallet.id })).balance).toBe('10.00');
    }, 90000);
    /**
     * Regressão: WIN paga o valor do prêmio, não o valor da aposta — REFERENCE_AMOUNT_MISMATCH só
     * vale para REFUND/ROLLBACK (seção 7). O caminho síncrono (BET já processada) e o caminho de
     * retryPendingReference (WIN chega antes da BET) precisam concordar nisso; antes da correção,
     * o segundo caminho rejeitava a WIN por engano quando o valor divergia do da BET referenciada.
     */
    test('WIN 50 referenciando BET 10: BET-first e WIN-first/PENDING_REFERENCE terminam PROCESSED com o mesmo resultado financeiro', async () => {
        async function run(winFirst: boolean): Promise<string> {
            const playerId = uuid(), providerId = 'provider-' + uuid(), betExternal = 'bet-' + uuid(), winExternal = 'win-' + uuid();
            const wallet = await new WalletService(orm.em.fork()).create(playerId, { amount: '100.00', currency: 'BRL' });
            const common = { providerId, playerId, walletId: wallet.id, roundId: 'r-1', gameId: 'g-1' };
            const wagers = new WagerService(orm.em.fork());
            if (winFirst) {
                const win = await wagers.process({ ...common, externalTransactionId: winExternal, kind: 'WIN',
                    money: { amount: '50.00', currency: 'BRL' }, referenceExternalTransactionId: betExternal }, 'idem-' + uuid());
                expect(win.status).toBe('PENDING_REFERENCE');
                const bet = await wagers.process({ ...common, externalTransactionId: betExternal, kind: 'BET',
                    money: { amount: '10.00', currency: 'BRL' } }, 'idem-' + uuid());
                expect(bet.status).toBe('PROCESSED');
                await orm.em.fork().nativeUpdate(WagerRow, { id: win.transactionId }, { nextAttemptAt: new Date(0) });
                expect(await wagers.retryPendingReference(win.transactionId)).toBe('processed');
                const row = await orm.em.fork().findOneOrFail(WagerRow, { id: win.transactionId });
                expect(row.status).toBe('PROCESSED');
                expect(row.failureCode).toBeNull();
            } else {
                const bet = await wagers.process({ ...common, externalTransactionId: betExternal, kind: 'BET',
                    money: { amount: '10.00', currency: 'BRL' } }, 'idem-' + uuid());
                expect(bet.status).toBe('PROCESSED');
                const win = await wagers.process({ ...common, externalTransactionId: winExternal, kind: 'WIN',
                    money: { amount: '50.00', currency: 'BRL' }, referenceExternalTransactionId: betExternal }, 'idem-' + uuid());
                expect(win.status).toBe('PROCESSED');
            }
            return (await orm.em.fork().findOneOrFail(WalletRow, { id: wallet.id })).balance;
        }
        const betFirstBalance = await run(false);
        const winFirstBalance = await run(true);
        // 100.00 (opening) - 10.00 (BET) + 50.00 (WIN) = 140.00, igual nos dois caminhos.
        expect(betFirstBalance).toBe('140.00');
        expect(winFirstBalance).toBe('140.00');
    }, 90000);
});
