/** Prova de 3 processos independentes conectados ao mesmo PostgreSQL.
 * Rode em 3 terminais: PORT=3001 bun run start; PORT=3002 bun run start; PORT=3003 bun run start
 * Então: bun run test:3instances
 */
export {}; // Força escopo de módulo: evita colisão de identificadores com outros scripts top-level.
const urls = (process.env.BASE_URLS ?? 'http://localhost:3001,http://localhost:3002,http://localhost:3003').split(',');
if (urls.length < 3)
    throw Error('Provide at least three process URLs');
const cid = () => crypto.randomUUID();
async function post(base: string, path: string, body: object, key?: string) {
    const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json',
            ...(key ? { 'idempotency-key': key } : {}) }, body: JSON.stringify(body) });
    return { http: r.status, data: await r.json() as any };
}
const playerId = cid();
const opened = await post(urls[0], '/wallets', { playerId, initialBalance: { amount: '100.00', currency: 'BRL' } });
if (opened.http !== 201)
    throw Error('Opening failed: ' + JSON.stringify(opened));
const walletId = opened.data.id;
const base = { providerId: 'provider-a', playerId, walletId, roundId: 'round-1', gameId: 'game-1',
    kind: 'BET', money: { amount: '80.00', currency: 'BRL' } };
const [a, b] = await Promise.all([
    post(urls[0], '/wagering/transactions', { ...base, externalTransactionId: 'bet-' + cid() }, 'key-' + cid()),
    post(urls[1], '/wagering/transactions', { ...base, externalTransactionId: 'bet-' + cid() }, 'key-' + cid()),
]);
if (JSON.stringify([a.data.status, b.data.status].sort()) !== '["PROCESSED","REJECTED"]')
    throw Error('Concurrent 80+80 failed: ' + JSON.stringify({ a, b }));
const externalId = 'bet-' + cid(), key = 'idem-' + cid();
const request = { ...base, externalTransactionId: externalId, money: { amount: '1.00', currency: 'BRL' } };
const responses = await Promise.all(Array.from({ length: 50 }, (_, i) => post(urls[i % urls.length], '/wagering/transactions', request, key)));
if (new Set(responses.map(x => x.data.transactionId)).size !== 1 || responses.some(x => x.data.status !== 'PROCESSED'))
    throw Error('Cross-process idempotency broken');
const wallet = await fetch(`${urls[2]}/wallets/${walletId}`).then(r => r.json());
const ledger = await fetch(`${urls[0]}/wallets/${walletId}/ledger`).then(r => r.json());
const reconciliation = await post(urls[1], `/wallets/${walletId}/reconciliation`, {});
const debits = ledger.items.filter((entry: any) => entry.direction === 'DEBIT');
if (wallet.balance.amount !== '19.00' || debits.length !== 2 || reconciliation.data.consistent !== true)
    throw Error('Ledger/saldo invalid: ' + JSON.stringify({ wallet, debits, reconciliation }));
console.log(JSON.stringify({ result: 'PASS', instances: urls, walletId, balance: wallet.balance,
    firstRace: [a.data.status, b.data.status], uniqueTransactionId: responses[0].data.transactionId,
    debitLedgerCount: debits.length, reconciled: reconciliation.data.consistent }, null, 2));
