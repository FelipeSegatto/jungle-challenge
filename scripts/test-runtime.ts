/** Shared Linux/native test execution. Infrastructure is supplied by the caller. */
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Subprocess } from 'bun';
import { localHttpInstances, localHttpOrigin } from './test-targets';

export const backendSuites = [
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
export function selectSuites(requested: string[]): string[] {
  if (requested.some((suite) => !backendSuites.includes(suite))) {
    throw new Error(`Unknown suite. Choose: ${backendSuites.join(', ')}`);
  }
  return requested.length ? requested : backendSuites;
}
export function freePort(): number {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
  const port = server.port!;
  server.stop(true);
  return port;
}
export async function until(check: () => Promise<boolean>, timeout = 90000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check().catch(() => false)) return;
    await Bun.sleep(200);
  }
  throw new Error('Readiness deadline exceeded');
}
export async function runBackendChecks(
  env: NodeJS.ProcessEnv,
  suites: string[],
  logs: string,
): Promise<void> {
  localHttpOrigin(env.BASE_URL, 'BASE_URL');
  const origins = localHttpInstances(env.BASE_URLS);
  await mkdir(logs, { recursive: true });
  const children = new Set<Subprocess>();
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
  async function command(args: string[], commandEnv = env): Promise<void> {
    const child = Bun.spawn(args, {
      env: commandEnv,
      stdout: 'inherit',
      stderr: 'inherit',
      timeout: 240000,
    });
    children.add(child);
    try {
      const code = await child.exited;
      if (code !== 0) throw new Error(`${args.slice(1).join(' ')} failed (${code})`);
    } finally {
      children.delete(child);
    }
  }
  const shutdown = () => {
    void Promise.all([...children].map(stop)).finally(() => process.exit(130));
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  try {
    await command([process.execPath, 'run', 'format:check']);
    await command([process.execPath, 'run', 'typecheck']);
    await command([process.execPath, 'run', 'migration:up']);
    for (const origin of origins) {
      const port = new URL(origin).port;
      const child = Bun.spawn([process.execPath, 'src/main.ts'], {
        env: { ...env, PORT: port },
        stdout: Bun.file(join(logs, `api-${port}.log`)),
        stderr: Bun.file(join(logs, `api-${port}.err.log`)),
      });
      children.add(child);
      await until(
        async () =>
          (await fetch(`${origin}/health/ready`, { signal: AbortSignal.timeout(2000) })).ok,
      );
    }
    for (const [index, suite] of selectSuites(suites).entries()) {
      console.log(
        `Running ${suite} (${process.platform}, Bun ${Bun.version}, isolated database/queues)`,
      );
      if (suite === 'test:consumer-dlq-persistent')
        console.log('Real retry/backoff: this scenario normally takes about 70 seconds.');
      await command([process.execPath, 'run', suite], {
        ...env,
        SQS_QUEUE_PREFIX: `${env.SQS_QUEUE_PREFIX}${index}-`,
      });
    }
    console.log(`PASS: isolated checks completed. API logs: ${logs}`);
  } catch (error) {
    for (const name of await readdir(logs)) {
      console.error(`--- ${name} ---\n${(await Bun.file(join(logs, name)).text()).slice(-8000)}`);
    }
    throw error;
  } finally {
    process.removeListener('SIGTERM', shutdown);
    process.removeListener('SIGINT', shutdown);
    await Promise.all([...children].map(stop));
  }
}
