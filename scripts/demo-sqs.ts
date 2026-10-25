/** Simple end-to-end SQS demonstration. Requires API + worker + LocalStack. */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { ensureQueues, sqsClient, submitMessage } from '../src/infrastructure/sqs/queues';
const host = process.env.BASE_URL ?? 'http://localhost:3001';
const playerId = randomUUID();
const opening = await fetch(`${host}/wallets`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ playerId, initialBalance: { amount: '100.00', currency: 'BRL' } }),
});
if (!opening.ok) throw new Error(`OPENING_FAILED_${opening.status}`);
const wallet = (await opening.json()) as {
  id: string;
};
const client = sqsClient();
try {
  const queues = await ensureQueues(client);
  const txId = randomUUID();
  await submitMessage(client, queues.input, {
    messageId: randomUUID(),
    type: 'WagerTransactionRequested',
    occurredAt: new Date().toISOString(),
    data: {
      providerId: 'provider-a',
      externalTransactionId: txId,
      idempotencyKey: `provider-a:${txId}`,
      playerId,
      walletId: wallet.id,
      roundId: 'round-demo',
      gameId: 'fortune-chimp',
      kind: 'BET',
      money: { amount: '25.00', currency: 'BRL' },
    },
  });
  let confirmed = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    const request = await fetch(`${host}/wallets/${wallet.id}`);
    const state = (await request.json()) as {
      balance: {
        amount: string;
      };
    };
    if (state.balance.amount === '75.00') {
      confirmed = true;
      break;
    }
    await Bun.sleep(500);
  }
  if (!confirmed) throw new Error('SQS_TRANSACTION_NOT_CONFIRMED');
  console.log(
    JSON.stringify({ result: 'PASS', walletId: wallet.id, balance: '75.00', via: 'SQS' }, null, 2),
  );
} finally {
  client.destroy();
}
