import './environment';
import { afterEach } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Subprocess } from 'bun';

export async function createSentinelDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'jungle-test-sync-'));
  directories.add(dir);
  return dir;
}

export async function removeSentinelDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
  directories.delete(dir);
}

const workers = new Set<Subprocess>();
const directories = new Set<string>();
const output = new WeakMap<Subprocess, string[]>();
afterEach(async () => {
  await Promise.all([...workers].map((worker) => killAndWait(worker)));
  await Promise.all([...directories].map(removeSentinelDir));
}, 20000);

async function drain(stream: ReadableStream<Uint8Array>, lines: string[]): Promise<void> {
  let pending = '';
  const decoder = new TextDecoder();
  for await (const chunk of stream) {
    pending += decoder.decode(chunk, { stream: true });
    const parts = pending.split('\n');
    pending = parts.pop() ?? '';
    lines.push(...parts);
    if (lines.length > 2000) lines.splice(0, lines.length - 2000);
  }
  pending += decoder.decode();
  if (pending) lines.push(pending);
}

export async function waitForWorkerEvent(
  worker: Subprocess,
  event: string,
  messageId?: string,
  timeout = 30000,
): Promise<Record<string, unknown>> {
  let matched: Record<string, unknown> | undefined;
  const found = await pollUntil(
    async () => {
      for (const line of output.get(worker) ?? []) {
        try {
          const record = JSON.parse(line);
          if (record.event === event && (!messageId || record.messageId === messageId))
            matched = record;
        } catch {
          /* Framework output is not JSON. */
        }
      }
      return matched !== undefined;
    },
    timeout,
    25,
  );
  if (!found)
    throw new Error(
      `Worker event ${event} missing: ${(output.get(worker) ?? []).slice(-20).join('\n')}`,
    );
  return matched!;
}

export async function waitForExit(worker: Subprocess, timeout = 30000): Promise<number> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      worker.exited,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Worker exit deadline exceeded')), timeout);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface SpawnWorkerOptions {
  readonly env?: Record<string, string>;
}

/** Processo real: `bun src/worker-main.ts`, não uma chamada de função dentro do processo de teste. */
export function spawnWorker(options: SpawnWorkerOptions = {}): Subprocess {
  const worker = Bun.spawn([process.execPath, 'src/worker-main.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, METRICS_PORT: '0', ...options.env } as Record<string, string>,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  workers.add(worker);
  const lines: string[] = [];
  output.set(worker, lines);
  void drain(worker.stdout as ReadableStream<Uint8Array>, lines);
  void drain(worker.stderr as ReadableStream<Uint8Array>, lines);
  return worker;
}

/** Espera o arquivo-sentinela `<namePrefix>-<pid>` aparecer no diretório — prova um ponto de execução real do worker, não um sleep arbitrário. */
export async function waitForSentinel(
  dir: string,
  namePrefix: string,
  deadlineMs: number,
): Promise<string> {
  const deadline = Date.now() + deadlineMs;
  const glob = new Bun.Glob(`${namePrefix}-*`);
  while (Date.now() < deadline) {
    for await (const file of glob.scan(dir)) {
      return file;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Sentinela "${namePrefix}" não apareceu em ${dir} dentro de ${deadlineMs}ms`);
}

/** Poll com deadline sobre uma condição observável real — nunca um sleep fixo seguido de assert. */
export async function pollUntil(
  check: () => Promise<boolean>,
  deadlineMs: number,
  intervalMs = 200,
): Promise<boolean> {
  const deadline = Date.now() + deadlineMs;
  for (;;) {
    if (await check()) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/** Mata o processo (se ainda vivo) e espera a saída real — usado em cleanup, nunca deixa um worker órfão entre testes. */
export async function killAndWait(
  proc: Subprocess,
  signal: 'SIGTERM' | 'SIGKILL' = 'SIGKILL',
): Promise<void> {
  try {
    if (proc.exitCode === null) {
      proc.kill(signal);
      try {
        await waitForExit(proc, 10000);
      } catch {
        proc.kill('SIGKILL');
        await waitForExit(proc, 5000);
      }
    }
  } finally {
    workers.delete(proc);
  }
}

/** An API owned by the test, so restarting it cannot stop the demonstration API. */
export async function spawnApi(): Promise<{ process: Subprocess; base: string }> {
  const reservation = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
  const port = reservation.port!;
  reservation.stop(true);
  const worker = Bun.spawn([process.execPath, 'src/main.ts'], {
    env: { ...process.env, PORT: String(port) },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  workers.add(worker);
  const lines: string[] = [];
  output.set(worker, lines);
  void drain(worker.stdout as ReadableStream<Uint8Array>, lines);
  void drain(worker.stderr as ReadableStream<Uint8Array>, lines);
  const base = `http://127.0.0.1:${port}`;
  const ready = await pollUntil(
    async () => {
      try {
        return (await fetch(`${base}/health/ready`)).ok;
      } catch {
        return false;
      }
    },
    30000,
    100,
  );
  if (!ready) {
    await killAndWait(worker);
    throw new Error(`API readiness failed: ${lines.slice(-20).join('\n')}`);
  }
  return { process: worker, base };
}
