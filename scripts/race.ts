/** Teste HTTP real: precisa de PostgreSQL e aplicação rodando (PORT=3000). */
const url = process.env.BASE_URL ?? 'http://localhost:3000';
const id = crypto.randomUUID();
async function request(path: string, body: object, key?: string): Promise<{
    status: number;
    body: any;
}> {
    const response = await fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json',
            ...(key ? { 'idempotency-key': key } : {}) }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
}
const created = await request('/wallets', { playerId: id, initialBalance: { amount: '100.00', currency: 'BRL' } });
if (created.status !== 201)
    throw Error(`Wallet failure: ${JSON.stringify(created)}`);
const walletId = created.body.id;
const base = { providerId: 'provider-a', playerId: id, walletId, roundId: 'round-a', gameId: 'game-1',
    kind: 'BET', money: { amount: '80.00', currency: 'BRL' } };
const bets = await Promise.all(['A', 'B'].map(async (label) => request('/wagering/transactions', { ...base, externalTransactionId: `bet-${label}-${crypto.randomUUID()}` }, `race:${walletId}:${label}`)));
const statuses = bets.map(x => x.body.status).sort();
if (JSON.stringify(statuses) !== JSON.stringify(['PROCESSED', 'REJECTED']))
    throw Error(`Race failed: ${JSON.stringify(bets)}`);
const get = await fetch(`${url}/wallets/${walletId}`).then(r => r.json());
const ledger = await fetch(`${url}/wallets/${walletId}/ledger`).then(r => r.json());
const debits = ledger.items.filter((e: any) => e.direction === 'DEBIT');
if (get.balance.amount !== '20.00' || debits.length !== 1)
    throw Error(`Money failed: ${JSON.stringify({ get, ledger })}`);
const replayId = `replay-${crypto.randomUUID()}`;
const replayPayload = { ...base, externalTransactionId: replayId, money: { amount: '1.00', currency: 'BRL' } };
const replays = await Promise.all(Array.from({ length: 50 }, () => request('/wagering/transactions', replayPayload, `idem:${replayId}`)));
if (replays.some(x => x.body.status !== 'PROCESSED') || new Set(replays.map(x => x.body.transactionId)).size !== 1)
    throw Error(`Replay failed: ${JSON.stringify(replays)}`);
const after = await fetch(`${url}/wallets/${walletId}`).then(r => r.json());
if (after.balance.amount !== '19.00')
    throw Error(`Duplicated debit: ${JSON.stringify(after)}`);
const recon = await request(`/wallets/${walletId}/reconciliation`, {});
if (recon.body.consistent !== true)
    throw Error(`Reconciliation failed: ${JSON.stringify(recon)}`);
console.log(JSON.stringify({ scenario: '80+80 concurrent, 50x replay', bets, finalBalance: after.balance,
    uniqueReplayTransactionId: replays[0].body.transactionId, reconciliation: recon.body.consistent }, null, 2));
console.log('PASS: 1 debit from 80+80, 1 debit from 50x replay; ledger is consistent.');
