/** Compose supplies private PostgreSQL/SQS sidecars sharing this container's loopback. No Docker socket. */
import { randomBytes } from 'node:crypto';
import { MikroORM } from '@mikro-orm/postgresql';
import config from '../mikro-orm.config';
import { freePort, runBackendChecks, selectSuites, until } from './test-runtime';

if (process.platform !== 'linux')
  throw new Error(
    'Use docker compose -f docker-compose.test.yml up --build --exit-code-from tests',
  );
const requested = process.argv.slice(2);
const suites = selectSuites(
  requested.length
    ? requested
    : (process.env.TEST_SUITES ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
);
const ports = [freePort(), freePort(), freePort()];
const id = randomBytes(6).toString('hex');
const env = {
  ...process.env,
  NODE_ENV: 'test',
  AWS_ACCESS_KEY_ID: 'test',
  AWS_SECRET_ACCESS_KEY: 'test',
  DATABASE_URL: 'postgresql://jungle:jungle@127.0.0.1:5432/jungle_d0cce7_test',
  SQS_ENDPOINT: 'http://127.0.0.1:4566',
  SQS_QUEUE_PREFIX: `jungle-test-${id}-`,
  BASE_URL: `http://127.0.0.1:${ports[0]}`,
  BASE_URLS: ports.map((port) => `http://127.0.0.1:${port}`).join(','),
};
console.log(
  `Linux test environment: Bun ${Bun.version}. Waiting for private PostgreSQL and LocalStack...`,
);
await until(async () => {
  const orm = await MikroORM.init({
    ...config,
    clientUrl: env.DATABASE_URL,
    driverOptions: { connectionTimeoutMillis: 1500 },
  });
  try {
    await orm.em.execute('SELECT 1');
    return true;
  } finally {
    await orm.close(true);
  }
});
await until(async () => {
  const response = await fetch(`${env.SQS_ENDPOINT}/_localstack/health`, {
    signal: AbortSignal.timeout(2000),
  });
  const health = (await response.json()) as { services?: { sqs?: string } };
  return response.ok && ['available', 'running'].includes(health.services?.sqs ?? '');
});
await runBackendChecks(env, suites, `/artifacts/${id}`);
