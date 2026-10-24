/** Requer aplicação HTTP rodando, PostgreSQL real + migration aplicada. */
import { test, expect, describe } from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';
import config from '../mikro-orm.config';
const host = process.env.BASE_URL ?? 'http://localhost:3000';
const cid = () => crypto.randomUUID();
async function post(path: string, payload: object, idem?: string) {
    const response = await fetch(`${host}${path}`, { method: 'POST', headers: { 'content-type': 'application/json',
            ...(idem ? { 'idempotency-key': idem } : {}) }, body: JSON.stringify(payload) });
    return { http: response.status, data: await response.json() as any };
}
async function get(path: string) {
    const r = await fetch(`${host}${path}`);
    return { http: r.status, data: await r.json() as any };
}
async function open(amount = '100.00') {
    const playerId = cid();
    const wallet = await post('/wallets', { playerId, initialBalance: { amount, currency: 'BRL' } });
    expect(wallet.http).toBe(201);
    return { playerId, walletId: wallet.data.id };
}
function wager(wallet: {
    playerId: string;
    walletId: string;
}, kind: string, amount: string, externalId: string, ref?: string) {
    return { providerId: 'provider-' + wallet.playerId, externalTransactionId: externalId,
        playerId: wallet.playerId, walletId: wallet.walletId, roundId: 'round-1', gameId: 'game-1',
        kind, money: { amount, currency: 'BRL' }, ...(ref ? { referenceExternalTransactionId: ref } : {}) };
}
describe('INTEGRAÇÃO REAL — HTTP + PostgreSQL', () => {
    test('OPENING, saldo, um lançamento e reconciliação', async () => {
        const w = await open();
        const ledger = (await get(`/wallets/${w.walletId}/ledger`)).data;
        expect(ledger.items).toHaveLength(1);
        expect(ledger.items[0].direction).toBe('CREDIT');
        expect(ledger.items[0].money.amount).toBe('100.00');
        const recon = await post(`/wallets/${w.walletId}/reconciliation`, {});
        expect(recon.data.consistent).toBe(true);
    });
    test('BET 80 + BET 80 simultâneas: só uma passa', async () => {
        const w = await open();
        const results = await Promise.all(['a', 'b'].map(i => post('/wagering/transactions', wager(w, 'BET', '80.00', `bet-${i}-${cid()}`), `idem-${i}-${cid()}`)));
        expect(results.map(x => x.data.status).sort()).toEqual(['PROCESSED', 'REJECTED']);
        expect((await get(`/wallets/${w.walletId}`)).data.balance.amount).toBe('20.00');
        const ledger = (await get(`/wallets/${w.walletId}/ledger`)).data;
        expect(ledger.items.filter((x: any) => x.direction === 'DEBIT')).toHaveLength(1);
    });
    test('50 mensagens iguais = 1 débito, replay original e conflito de hash', async () => {
        const w = await open();
        const id = 'tx-' + cid(), key = 'idem-' + cid(), payload = wager(w, 'BET', '12.00', id);
        const results = await Promise.all(Array.from({ length: 50 }, () => post('/wagering/transactions', payload, key)));
        expect(new Set(results.map(x => x.data.transactionId)).size).toBe(1);
        expect(results.every(x => x.data.status === 'PROCESSED')).toBe(true);
        expect((await get(`/wallets/${w.walletId}`)).data.balance.amount).toBe('88.00');
        const conflict = await post('/wagering/transactions', { ...payload, money: { amount: '11.00', currency: 'BRL' } }, key);
        expect(conflict.http).toBe(409);
        const different = wager(w, 'WIN', '30.00', 'win-' + cid());
        await post('/wagering/transactions', different, 'idem-' + cid());
        const replay = await post('/wagering/transactions', payload, key);
        expect(replay.data.idempotentReplay).toBe(true);
        expect(replay.data.balance.amount).toBe('88.00'); // NÃO 118.00
    });
    test('WIN, LOSS e REFUND/ROLLBACK respeitam reversão e saldo', async () => {
        const w = await open();
        const betId = 'bet-' + cid();
        const bet = await post('/wagering/transactions', wager(w, 'BET', '40.00', betId), 'idem-' + cid());
        expect(bet.data.status).toBe('PROCESSED');
        const loss = await post('/wagering/transactions', wager(w, 'LOSS', '40.00', 'loss-' + cid()), 'idem-' + cid());
        expect(loss.data.status).toBe('PROCESSED');
        expect((await get(`/wallets/${w.walletId}`)).data.balance.amount).toBe('60.00');
        const refund = await post('/wagering/transactions', wager(w, 'REFUND', '40.00', 'refund-' + cid(), betId), 'idem-' + cid());
        expect(refund.data.status).toBe('PROCESSED');
        expect((await get(`/wallets/${w.walletId}`)).data.balance.amount).toBe('100.00');
        const doubleRefund = await post('/wagering/transactions', wager(w, 'REFUND', '40.00', 'refund-' + cid(), betId), 'idem-' + cid());
        expect(doubleRefund.http).toBe(422);
        expect(doubleRefund.data.failureCode).toBe('ALREADY_REVERSED');
    });
    test('ROLLBACK de WIN que geraria saldo negativo é rejeição terminal distinta', async () => {
        const w = await open('10.00');
        const winId = 'win-' + cid();
        const win = await post('/wagering/transactions', wager(w, 'WIN', '40.00', winId), 'idem-' + cid());
        expect(win.data.status).toBe('PROCESSED');
        const bet = await post('/wagering/transactions', wager(w, 'BET', '45.00', 'bet-' + cid()), 'idem-' + cid());
        expect(bet.data.status).toBe('PROCESSED');
        const rollback = await post('/wagering/transactions', wager(w, 'ROLLBACK', '40.00', 'rollback-' + cid(), winId), 'idem-' + cid());
        expect(rollback.http).toBe(422);
        expect(rollback.data.status).toBe('REJECTED');
        expect(rollback.data.failureCode).toBe('REVERSAL_INSUFFICIENT_BALANCE');
        expect((await get(`/wallets/${w.walletId}`)).data.balance.amount).toBe('5.00');
        expect((await post(`/wallets/${w.walletId}/reconciliation`, {})).data.consistent).toBe(true);
    });
    test('REFUND antes da BET fica PENDING_REFERENCE e gera 202', async () => {
        const w = await open();
        const refund = await post('/wagering/transactions', wager(w, 'REFUND', '20.00', 'refund-' + cid(), 'future-' + cid()), 'idem-' + cid());
        expect(refund.http).toBe(202);
        expect(refund.data.status).toBe('PENDING_REFERENCE');
        expect((await get(`/wallets/${w.walletId}`)).data.balance.amount).toBe('100.00');
    });
    test('trigger no PostgreSQL impede adulteração do ledger', async () => {
        const w = await open();
        const orm = await MikroORM.init(config);
        try {
            const rows = await orm.em.getConnection().execute<Array<{
                id: string;
            }>>('SELECT id FROM wallet_ledger_entries WHERE wallet_id=? LIMIT 1', [w.walletId]);
            expect(rows).toHaveLength(1);
            await expect(orm.em.getConnection().execute('UPDATE wallet_ledger_entries SET amount=900 WHERE id=?', [rows[0].id])).rejects.toThrow();
        }
        finally {
            await orm.close(true);
        }
    });
  test('rollback SQL preserva wallet quando um lançamento falha', async () => {
    const w = await open();
    const orm = await MikroORM.init(config);
    try {
      const { WalletRow, LedgerRow } = await import('../src/infrastructure/entities/rows');
      const original = await orm.em.fork().findOneOrFail(WalletRow, {id:w.walletId});
      const entry = await orm.em.fork().findOneOrFail(LedgerRow,{walletId:w.walletId});
      let failed = false;
      try {
        await orm.em.fork().transactional(async em => {
          const wallet = await em.findOneOrFail(WalletRow,{id:w.walletId});
          wallet.balance = '85.00';
          wallet.version += 1;
          const duplicate = new LedgerRow();
          duplicate.id = cid(); duplicate.walletId = w.walletId;
          duplicate.transactionId = entry.transactionId; // unique ledger per wallet/tx
          duplicate.direction = 'DEBIT'; duplicate.amount = '15.00';
          duplicate.currency = 'BRL'; duplicate.balanceBefore = '100.00';
          duplicate.balanceAfter = '85.00'; duplicate.createdAt = new Date();
          em.persist(duplicate);
        });
      } catch { failed = true; }
      expect(failed).toBe(true);
      const after = await orm.em.fork().findOneOrFail(WalletRow,{id:w.walletId});
      expect(after.balance).toBe(original.balance);
      expect(after.version).toBe(original.version);
      expect((await orm.em.fork().find(LedgerRow,{walletId:w.walletId})).length).toBe(1);
    } finally { await orm.close(true); }
  });

});
