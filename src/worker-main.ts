import 'dotenv/config';
import { MikroORM } from '@mikro-orm/postgresql';
import config from '../mikro-orm.config';
import { ensureQueues, sqsClient, updateDlqMetrics } from './infrastructure/sqs/queues';
import { consumeOnce } from './infrastructure/workers/consumer';
import { publishOutboxBatch } from './infrastructure/workers/outbox';
import { retryReferences } from './infrastructure/workers/references';
import { registry, outboxLag } from './infrastructure/metrics';
async function main(): Promise<void> {
  const orm = await MikroORM.init(config);
  const client = sqsClient();
  let shutdown = false;
  let ready = false;
  const metricsServer = Bun.serve({
    port: Number(process.env.METRICS_PORT ?? '9090'),
    fetch: async (request) => {
      const path = new URL(request.url).pathname;
      if (path === '/health/ready') {
        const healthy = ready && !shutdown;
        return Response.json(
          { status: healthy ? 'ok' : 'not_ready' },
          { status: healthy ? 200 : 503 },
        );
      }
      return path === '/metrics'
        ? new Response(await registry.metrics(), {
            headers: { 'Content-Type': registry.contentType },
          })
        : new Response('Not found', { status: 404 });
    },
  });
  console.log(
    JSON.stringify({ level: 'info', event: 'worker_starting', metricsPort: metricsServer.port }),
  );
  process.once('SIGTERM', () => {
    shutdown = true;
  });
  process.once('SIGINT', () => {
    shutdown = true;
  });
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  try {
    let queues: Awaited<ReturnType<typeof ensureQueues>> | undefined;
    for (let i = 0; i < 30 && !shutdown; i++) {
      try {
        queues = await ensureQueues(client);
        break;
      } catch (e) {
        console.warn(JSON.stringify({ level: 'warn', event: 'sqs_startup_retry', attempt: i + 1 }));
        await sleep(2000);
      }
    }
    if (!queues) throw new Error('SQS_BOOTSTRAP_FAILED');
    ready = true;
    console.log(
      JSON.stringify({ level: 'info', event: 'worker_ready', metricsPort: metricsServer.port }),
    );
    // Each batch finishes before shutdown. Redelivery covers a kill -9 or container crash.
    while (!shutdown) {
      try {
        await publishOutboxBatch(orm.em, client, queues.events);
        const [lag] = await orm.em.getConnection().execute<
          Array<{
            age: string | null;
          }>
        >(`
          SELECT EXTRACT(EPOCH FROM(now()-MIN(occurred_at)))::text AS age
          FROM outbox_messages WHERE published_at IS NULL
        `);
        outboxLag.set(lag?.age ? Number(lag.age) : 0);
        await retryReferences(orm.em);
        await consumeOnce(orm.em, client, queues);
        await updateDlqMetrics(client, queues);
      } catch (e) {
        console.error(
          JSON.stringify({
            level: 'error',
            event: 'worker_cycle_failed',
            name: e instanceof Error ? e.name : 'unknown',
          }),
        );
        if (!shutdown) await sleep(1000);
      }
    }
  } finally {
    ready = false;
    metricsServer.stop(true);
    client.destroy();
    await orm.close(true);
    console.log(JSON.stringify({ level: 'info', event: 'worker_stopped' }));
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
