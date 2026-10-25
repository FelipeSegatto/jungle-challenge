import { expect, test } from 'bun:test';
async function run(source: string, overrides: Record<string, string>) {
  const child = Bun.spawn([process.execPath, '-e', source], {
    env: { ...process.env, ...overrides },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, code };
}
test('integration guard rejects development database and remote services before connecting', async () => {
  for (const overrides of [
    {
      DATABASE_URL: 'postgresql://jungle:jungle@127.0.0.1:55432/jungle_wagering',
      SQS_ENDPOINT: 'http://127.0.0.1:4566',
    },
    {
      DATABASE_URL: 'postgresql://jungle:jungle@remote.example/jungle_abc_test',
      SQS_ENDPOINT: 'http://127.0.0.1:4566',
    },
  ]) {
    const result = await run('import "./test/harness/environment"', {
      NODE_ENV: 'test',
      SQS_QUEUE_PREFIX: 'jungle-test-abc-',
      ...overrides,
    });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('test');
  }
});
test('test instrumentation is rejected in production', async () => {
  const result = await run('import "./src/infrastructure/workers/consumer"', {
    NODE_ENV: 'production',
    TEST_FAULT_INJECT_MESSAGE_ID: 'accidentally-configured',
    DATABASE_URL: 'postgresql://jungle:jungle@127.0.0.1:55432/jungle_wagering',
  });
  expect(result.code).not.toBe(0);
  expect(result.stderr).toContain('TEST_HOOKS_REQUIRE_ISOLATED_TEST_ENVIRONMENT');
});
test('queue names remain compatible when no prefix is configured', async () => {
  const result = await run(
    'import {INPUT_QUEUE,DLQ,EVENT_QUEUE} from "./src/infrastructure/sqs/queues"; console.log(JSON.stringify([INPUT_QUEUE,DLQ,EVENT_QUEUE]))',
    { SQS_QUEUE_PREFIX: '' },
  );
  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual([
    'wager-transactions.fifo',
    'wager-transactions-dlq.fifo',
    'wager-events.fifo',
  ]);
});

test('HTTP targets reject missing, remote, malformed and duplicate origins before any request', async () => {
  const { localHttpOrigin, localHttpInstances } = await import('../scripts/test-targets');
  expect(localHttpOrigin('http://127.0.0.1:3001/', 'BASE_URL')).toBe('http://127.0.0.1:3001');
  expect(localHttpOrigin('http://[::1]:3001', 'BASE_URL')).toBe('http://[::1]:3001');
  for (const value of [
    undefined,
    '',
    'https://example.invalid',
    'http://localhost.example.invalid',
    'file:///tmp/test',
    'http://user:password@localhost:3001',
    'http://localhost:3001/api',
    'http://localhost:3001?target=remote',
    'http://localhost:3001#target',
    'not-a-url',
  ]) {
    expect(() => localHttpOrigin(value, 'BASE_URL')).toThrow();
  }
  for (const value of [
    undefined,
    '',
    'http://localhost:3001,http://localhost:3001,http://localhost:3001',
    'http://localhost:3001,http://localhost:3002,https://example.invalid',
  ]) {
    expect(() => localHttpInstances(value)).toThrow();
  }
  expect(
    localHttpInstances('http://localhost:3001,http://localhost:3002,http://localhost:3003'),
  ).toHaveLength(3);
  const valid = {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://jungle:jungle@127.0.0.1:55433/jungle_abc_test',
    SQS_ENDPOINT: 'http://127.0.0.1:4567',
    SQS_QUEUE_PREFIX: 'jungle-test-abc-',
    BASE_URL: 'http://127.0.0.1:3001',
    BASE_URLS: 'http://localhost:3001,http://localhost:3002,http://localhost:3003',
  };
  for (const overrides of [
    { BASE_URL: '' },
    { BASE_URL: 'https://example.invalid' },
    { BASE_URLS: '' },
    { BASE_URLS: 'http://localhost:3001,http://localhost:3002,https://example.invalid' },
  ]) {
    const result = await run('import "./test/harness/environment"', { ...valid, ...overrides });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('BASE_URL');
  }
  expect((await run('import "./test/harness/environment"', valid)).code).toBe(0);
  for (const script of ['scripts/race.ts', 'scripts/race-three.ts']) {
    const result = await run(`import "./${script}"`, {
      BASE_URL: 'https://example.invalid',
      BASE_URLS: 'http://localhost:3001,http://localhost:3002,https://example.invalid',
    });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('loopback');
  }
});
