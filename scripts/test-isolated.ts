/** Run backend integration checks in disposable local containers, never the developer's database. */
import { randomBytes } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Subprocess } from 'bun';

const id = randomBytes(6).toString('hex');
const dbName = `jungle_${id}_test`;
const containers = [`jungle-test-pg-${id}`, `jungle-test-sqs-${id}`];
const children = new Set<Subprocess>();
const logs = await mkdtemp(join(tmpdir(), `jungle-test-${id}-`));
const reservePort = () => {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
  const port = server.port!;
  server.stop(true);
  return port;
};
async function command(args: string[], env = process.env): Promise<string> {
  const child = Bun.spawn(args, { env, stdout: 'pipe', stderr: 'pipe', timeout: 240000 });
  children.add(child);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code !== 0)
      throw new Error(`${args.slice(0, 3).join(' ')} failed (${code}): ${stderr}\n${stdout}`);
    if (args[0] === process.execPath && stderr) console.log(stderr.trim());
    return stdout.trim();
  } finally {
    children.delete(child);
  }
}
async function stop(child: Subprocess): Promise<void> {
  if (child.exitCode === null) {
    child.kill('SIGTERM');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        child.exited,
        new Promise<void>((resolve) => {
          timer = setTimeout(() => {
            child.kill('SIGKILL');
            resolve();
          }, 5000);
        }),
      ]);
      await child.exited;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  children.delete(child);
}
async function until(check: () => Promise<boolean>, timeout = 60000): Promise<void> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check().catch(() => false)) return;
    await Bun.sleep(200);
  }
  throw new Error('Readiness deadline exceeded');
}
let cleaning: Promise<void> | undefined;
function cleanup(): Promise<void> {
  return (cleaning ??= (async () => {
    await Promise.all([...children].map(stop));
    for (const container of containers) {
      await command(['docker', 'rm', '-fv', container]).catch(() => {});
    }
  })());
}
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void cleanup().finally(() => process.exit(130));
  });

const scripts = [
  'test',
  'test:integration',
  'test:atomicity',
  'test:messaging',
  'test:references',
  'test:parallel-wallets',
  'test:inbox-replay',
  'test:crash-recovery',
  'test:sigterm',
  'test:consumer-retry',
  'test:consumer-dlq-persistent',
  'test:race',
  'test:3instances',
];
const requested = process.argv.slice(2);
if (requested.some((script) => !scripts.includes(script)))
  throw new Error(`Unknown suite. Choose: ${scripts.join(', ')}`);
try {
  const pgPort = reservePort(),
    sqsPort = reservePort();
  await command([
    'docker',
    'run',
    '-d',
    '--name',
    containers[0],
    '-e',
    'POSTGRES_USER=jungle',
    '-e',
    'POSTGRES_PASSWORD=jungle',
    '-e',
    `POSTGRES_DB=${dbName}`,
    '--tmpfs',
    '/var/lib/postgresql/data:rw,size=512m',
    '-p',
    `127.0.0.1:${pgPort}:5432`,
    'postgres:16-alpine',
  ]);
  await command([
    'docker',
    'run',
    '-d',
    '--name',
    containers[1],
    '-e',
    'SERVICES=sqs',
    '-e',
    'SQS_ENDPOINT_STRATEGY=path',
    '-e',
    `LOCALSTACK_HOST=127.0.0.1:${sqsPort}`,
    '-p',
    `127.0.0.1:${sqsPort}:4566`,
    'localstack/localstack:4.10',
  ]);
  await until(async () => {
    await command(['docker', 'exec', containers[0], 'pg_isready', '-U', 'jungle', '-d', dbName]);
    return true;
  });
  await until(async () => (await fetch(`http://127.0.0.1:${sqsPort}/_localstack/health`)).ok);
  const ports = [reservePort(), reservePort(), reservePort()];
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    AWS_ACCESS_KEY_ID: 'test',
    AWS_SECRET_ACCESS_KEY: 'test',
    DATABASE_URL: `postgresql://jungle:jungle@127.0.0.1:${pgPort}/${dbName}`,
    SQS_ENDPOINT: `http://127.0.0.1:${sqsPort}`,
    SQS_QUEUE_PREFIX: `jungle-test-${id}-`,
    BASE_URL: `http://127.0.0.1:${ports[0]}`,
    BASE_URLS: ports.map((port) => `http://127.0.0.1:${port}`).join(','),
  };
  await command([process.execPath, 'run', 'migration:up'], env);
  for (const port of ports) {
    const child = Bun.spawn([process.execPath, 'src/main.ts'], {
      env: { ...env, PORT: String(port) },
      stdout: Bun.file(join(logs, `api-${port}.log`)),
      stderr: Bun.file(join(logs, `api-${port}.err.log`)),
    });
    children.add(child);
    await until(async () => (await fetch(`http://127.0.0.1:${port}/health/ready`)).ok);
  }
  for (const [index, suite] of (requested.length ? requested : scripts).entries()) {
    console.log(`Running ${suite} with isolated database/queues`);
    const suiteEnv = { ...env, SQS_QUEUE_PREFIX: `jungle-test-${id}-${index}-` };
    const output = await command([process.execPath, 'run', suite], suiteEnv);
    console.log(output);
  }
  console.log(`PASS: isolated checks completed. API logs: ${logs}`);
} finally {
  await cleanup();
}
