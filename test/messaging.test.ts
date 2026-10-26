import './harness/environment';
/** Real integration. Requires PostgreSQL, LocalStack and applied migrations. */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';
import {
  CreateQueueCommand,
  DeleteQueueCommand,
  SendMessageCommand,
  ReceiveMessageCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import config from '../mikro-orm.config';
import {
  ensureQueues,
  sqsClient,
  submitMessage,
  type QueueUrls,
} from '../src/infrastructure/sqs/queues';
import { WalletService, WagerService } from '../src/application/services';
import { consumeOnce } from '../src/infrastructure/workers/consumer';
import { publishOutboxBatch } from '../src/infrastructure/workers/outbox';
import { payloadHash } from '../src/domain/hash';
import { InboxRow, OutboxRow, WalletRow, LedgerRow } from '../src/infrastructure/entities/rows';
let orm: MikroORM;
let client: SQSClient;
let urls: QueueUrls;
beforeAll(async () => {
  orm = await MikroORM.init(config);
  client = sqsClient();
  urls = await ensureQueues(client);
  // O Postgres de desenvolvimento é persistente entre execuções da suíte inteira (não é
  // truncado entre arquivos de teste); outros arquivos criam wallets sem nunca publicar seus
  // eventos. publishOutboxBatch reivindica sempre as N linhas pendentes MAIS ANTIGAS da tabela
  // inteira (ORDER BY occurred_at ASC) — com um backlog grande, as linhas da wallet criada por
  // ESTE teste (as mais novas) nunca entram no lote e os testes abaixo ficam dependentes de
  // quanto lixo de outras execuções já se acumulou. Drena esse backlog antes de medir qualquer
  // coisa, para que os testes abaixo raciocinem sobre números exatos.
  for (let i = 0; i < 100; i++) {
    const claimed = await publishOutboxBatch(orm.em, client, urls.events, 200);
    if (claimed === 0) break;
  }
});
afterAll(async () => {
  client?.destroy();
  if (orm) await orm.close(true);
});
const uuid = () => crypto.randomUUID();
/** Chama publishOutboxBatch em ciclos reais (sem mock) até a condição valer ou o deadline vencer. */
async function drainUntil(check: () => Promise<boolean>, deadlineMs: number): Promise<boolean> {
  const deadline = Date.now() + deadlineMs;
  while (true) {
    if (await check()) return true;
    if (Date.now() >= deadline) return false;
    await publishOutboxBatch(orm.em, client, urls.events, 50);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}
describe('SQS/Inbox/Outbox reais', () => {
  test('redelivery após commit antes do ACK não duplica débito', async () => {
    const playerId = uuid();
    const wallet = await new WalletService(orm.em.fork()).create(playerId, {
      amount: '100.00',
      currency: 'BRL',
    });
    const data = {
      providerId: 'provider-' + uuid(),
      externalTransactionId: 'bet-' + uuid(),
      idempotencyKey: 'idem-' + uuid(),
      playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'game-1',
      kind: 'BET' as const,
      money: { amount: '25.00', currency: 'BRL' },
    };
    const event = {
      messageId: uuid(),
      type: 'WagerTransactionRequested' as const,
      occurredAt: new Date().toISOString(),
      data,
    };
    // Simulates consumer crash: financial commit exists, but SQS was not acknowledged.
    const first = await new WagerService(orm.em.fork()).process(data, data.idempotencyKey, {
      consumerName: 'wager-sqs-v1',
      messageId: event.messageId,
      payloadHash: payloadHash(event),
    });
    expect(first.status).toBe('PROCESSED');
    await submitMessage(client, urls.input, event);
    // Inbox sees the duplicate, consumer acknowledges without touching balance.
    await consumeOnce(orm.em, client, urls);
    const saved = await orm.em.fork().findOneOrFail(WalletRow, { id: wallet.id });
    expect(saved.balance).toBe('75.00');
    const ledger = await orm.em.fork().find(LedgerRow, { walletId: wallet.id });
    expect(ledger.filter((x) => x.direction === 'DEBIT')).toHaveLength(1);
    const inbox = await orm.em
      .fork()
      .find(InboxRow, { consumerName: 'wager-sqs-v1', messageId: event.messageId });
    expect(inbox).toHaveLength(1);
    expect(inbox[0].processedAt).not.toBeNull();
  }, 120000);

  /**
   * Concorrência: dois publishers reivindicando a MESMA outbox ao mesmo tempo não podem
   * reivindicar a mesma linha duas vezes nem deixar nenhuma linha de fora. SKIP LOCKED garante
   * isso no SQL; aqui provamos observando que a soma do que cada chamada reivindicou é
   * exatamente o total pendente no instante da corrida — nem mais (duplicou reivindicação),
   * nem menos (perdeu uma linha para os dois lados).
   */
  test('dois publishers concorrentes dividem a outbox sem reivindicar a mesma linha duas vezes', async () => {
    const playerId = uuid();
    const wallet = await new WalletService(orm.em.fork()).create(playerId, {
      amount: '20.00',
      currency: 'BRL',
    });
    const totalPendingBefore = await orm.em.fork().count(OutboxRow, { publishedAt: null });
    expect(totalPendingBefore).toBeGreaterThanOrEqual(2);

    const [claimed1, claimed2] = await Promise.all([
      publishOutboxBatch(orm.em, client, urls.events, 50),
      publishOutboxBatch(orm.em, client, urls.events, 50),
    ]);
    expect(claimed1 + claimed2).toBe(totalPendingBefore);

    // Garantia de "nenhum evento perdido" fim a fim: drena eventuais pendências residuais
    // (ex.: um transitório real de rede durante a corrida) antes de concluir.
    const published = await drainUntil(async () => {
      const rows = await orm.em.fork().find(OutboxRow, { aggregateId: wallet.id });
      return rows.length >= 2 && rows.every((x) => x.publishedAt !== null);
    }, 10000);
    expect(published).toBe(true);
  }, 30000);

  /**
   * Recuperação: força uma falha REAL (não mock) de SendMessageCommand — fila inexistente —
   * para provar o caminho de at-least-once com retry: attempts incrementa, nextAttemptAt é
   * agendado, o evento NÃO é perdido, e ciclos de publicação subsequentes (fila correta)
   * eventualmente publicam tudo dentro de um deadline controlado.
   */
  test('outbox recupera de falha transitória de publicação e garante publicação eventual', async () => {
    const playerId = uuid();
    const wallet = await new WalletService(orm.em.fork()).create(playerId, {
      amount: '20.00',
      currency: 'BRL',
    });
    const totalPendingBefore = await orm.em.fork().count(OutboxRow, { publishedAt: null });
    expect(totalPendingBefore).toBeGreaterThanOrEqual(2);

    const bogusQueueUrl = urls.events.replace(/[^/]+$/, 'non-existent-queue-for-test.fifo');
    const claimed = await publishOutboxBatch(orm.em, client, bogusQueueUrl, 50);
    expect(claimed).toBe(totalPendingBefore);

    // Toda linha reivindicada nesse lote passou pelo mesmo SendMessageCommand (fila inexistente)
    // e falhou de verdade: nenhuma foi publicada, e cada uma ficou agendada para retry.
    const afterFailure = await orm.em.fork().find(OutboxRow, { publishedAt: null });
    expect(afterFailure.length).toBe(totalPendingBefore);
    for (const row of afterFailure) {
      expect(row.attempts).toBeGreaterThanOrEqual(1);
      expect(row.nextAttemptAt).not.toBeNull();
      expect(row.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());
    }

    // Equivalente a esperar o backoff vencer, sem sleep real: adianta o relógio do agendamento.
    await orm.em
      .fork()
      .nativeUpdate(OutboxRow, { publishedAt: null }, { nextAttemptAt: new Date(0) });

    const published = await drainUntil(async () => {
      const rows = await orm.em.fork().find(OutboxRow, { aggregateId: wallet.id });
      return rows.length >= 2 && rows.every((x) => x.publishedAt !== null);
    }, 15000);
    expect(published).toBe(true);

    const finalRows = await orm.em.fork().find(OutboxRow, { aggregateId: wallet.id });
    for (const row of finalRows) {
      expect(row.attempts).toBeGreaterThanOrEqual(1); // prova que passou pelo caminho de retry, não um envio direto.
      expect(row.publishedAt).not.toBeNull();
    }
  }, 30000);
});

test('configured SQS endpoint works even when the advertised QueueUrl hostname is unreachable', async () => {
  const created = await client.send(
    new CreateQueueCommand({
      QueueName: `${process.env.SQS_QUEUE_PREFIX}endpoint-probe.fifo`,
      Attributes: { FifoQueue: 'true' },
    }),
  );
  const queueUrl = created.QueueUrl!;
  try {
    const advertised = new URL(queueUrl);
    advertised.hostname = 'queue-url.invalid';
    const id = uuid();
    await client.send(
      new SendMessageCommand({
        QueueUrl: advertised.toString(),
        MessageBody: id,
        MessageGroupId: id,
        MessageDeduplicationId: id,
      }),
      { abortSignal: AbortSignal.timeout(5000) },
    );
    const received = await client.send(
      new ReceiveMessageCommand({
        QueueUrl: advertised.toString(),
        WaitTimeSeconds: 1,
        MaxNumberOfMessages: 1,
      }),
      { abortSignal: AbortSignal.timeout(5000) },
    );
    expect(received.Messages).toHaveLength(1);
    expect(received.Messages![0].Body).toBe(id);
  } finally {
    await client.send(new DeleteQueueCommand({ QueueUrl: queueUrl }));
  }
}, 20000);
