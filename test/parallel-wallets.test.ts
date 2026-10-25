/** Integração real: API HTTP real + PostgreSQL real. Requer a aplicação rodando (BASE_URL). */
import { describe, expect, test } from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';
import config from '../mikro-orm.config';
import { assertBalanceMatchesLedger } from './harness/reconcile';

const host = process.env.BASE_URL ?? 'http://localhost:3000';
const cid = () => crypto.randomUUID();

async function post(path: string, payload: object, idem?: string) {
  const response = await fetch(`${host}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(idem ? { 'idempotency-key': idem } : {}) },
    body: JSON.stringify(payload),
  });
  return { http: response.status, data: (await response.json()) as any };
}
async function get(path: string) {
  const r = await fetch(`${host}${path}`);
  return { http: r.status, data: (await r.json()) as any };
}
async function open(amount = '100.00') {
  const playerId = cid();
  const wallet = await post('/wallets', { playerId, initialBalance: { amount, currency: 'BRL' } });
  expect(wallet.http).toBe(201);
  return { playerId, walletId: wallet.data.id as string };
}
function wager(wallet: { playerId: string; walletId: string }, kind: string, amount: string, externalId: string) {
  return {
    providerId: 'provider-' + wallet.playerId, externalTransactionId: externalId,
    playerId: wallet.playerId, walletId: wallet.walletId, roundId: 'round-1', gameId: 'game-1',
    kind, money: { amount, currency: 'BRL' },
  };
}

describe('A — wallets distintas processadas em paralelo', () => {
  test('N wallets diferentes recebendo operações simultâneas: cada uma fecha certo, sem efeito cruzado', async () => {
    const WALLET_COUNT = 6;
    const wallets = await Promise.all(Array.from({ length: WALLET_COUNT }, () => open('100.00')));

    // Cada wallet recebe 2 operações ao mesmo tempo (uma BET e uma WIN), e as 6 wallets inteiras
    // disparam tudo em paralelo — concorrência real entre wallets diferentes, não só dentro de uma.
    const results = await Promise.all(
      wallets.flatMap((wallet) => [
        post('/wagering/transactions', wager(wallet, 'BET', '30.00', `bet-${cid()}`), `idem-bet-${cid()}`),
        post('/wagering/transactions', wager(wallet, 'WIN', '10.00', `win-${cid()}`), `idem-win-${cid()}`),
      ]),
    );
    expect(results.every((r) => r.data.status === 'PROCESSED')).toBe(true);

    const orm = await MikroORM.init(config);
    try {
      for (const wallet of wallets) {
        // 100 (opening) - 30 (bet) + 10 (win) = 80.00, em TODAS as wallets, de forma independente.
        await assertBalanceMatchesLedger(orm.em, wallet.walletId, '80.00');

        const ledger = (await get(`/wallets/${wallet.walletId}/ledger?limit=10`)).data;
        expect(ledger.items).toHaveLength(3); // opening + bet + win
        expect(ledger.items.filter((e: any) => e.direction === 'DEBIT')).toHaveLength(1);
        expect(ledger.items.filter((e: any) => e.direction === 'CREDIT')).toHaveLength(2);

        // Sem efeito cruzado: nenhum lançamento desta wallet tem o valor exato de uma operação de outra wallet
        // por coincidência de id — a prova real é que a soma do ledger desta wallet já fecha sozinha (acima);
        // aqui confirmamos que o endpoint de reconciliação concorda, por wallet.
        const recon = await post(`/wallets/${wallet.walletId}/reconciliation`, {});
        expect(recon.data.consistent).toBe(true);
        expect(recon.data.storedBalance.amount).toBe('80.00');
        expect(recon.data.checkedEntries).toBe(3);
      }
    } finally {
      await orm.close(true);
    }
  }, 60000);
});
