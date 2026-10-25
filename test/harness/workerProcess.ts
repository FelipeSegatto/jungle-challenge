/**
 * Harness exclusivo de testes para orquestrar processos REAIS de `src/worker-main.ts` (não chamadas
 * diretas a serviços, não mocks). Usa os hooks inertes-em-produção de
 * `src/infrastructure/workers/consumer.ts` (ver comentário lá: TEST_SYNC_SENTINEL_DIR,
 * TEST_FAULT_INJECT_MESSAGE_ID/MODE, WORKER_VISIBILITY_TIMEOUT_SECONDS) — nenhuma dessas env vars
 * existe em `.env`/`.env.docker`/`.env.example`/`docker-compose.yml`, então um worker real de
 * produção nunca as ativa por acidente.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Subprocess } from 'bun';

export async function createSentinelDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'jungle-test-sync-'));
}

export async function removeSentinelDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true }).catch(() => {});
}

/** Porta efêmera "aleatória o suficiente" para não colidir entre workers de teste spawnados em paralelo. */
function randomPort(): number {
  return 21000 + Math.floor(Math.random() * 9000);
}

export interface SpawnWorkerOptions {
  readonly env?: Record<string, string>;
}

/** Processo real: `bun src/worker-main.ts`, não uma chamada de função dentro do processo de teste. */
export function spawnWorker(options: SpawnWorkerOptions = {}): Subprocess {
  return Bun.spawn(['bun', 'src/worker-main.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, METRICS_PORT: String(randomPort()), ...options.env } as Record<string, string>,
    stdout: 'pipe',
    stderr: 'pipe',
  });
}

/** Espera o arquivo-sentinela `<namePrefix>-<pid>` aparecer no diretório — prova um ponto de execução real do worker, não um sleep arbitrário. */
export async function waitForSentinel(dir: string, namePrefix: string, deadlineMs: number): Promise<string> {
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
export async function pollUntil(check: () => Promise<boolean>, deadlineMs: number, intervalMs = 200): Promise<boolean> {
  const deadline = Date.now() + deadlineMs;
  for (;;) {
    if (await check()) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/** Mata o processo (se ainda vivo) e espera a saída real — usado em cleanup, nunca deixa um worker órfão entre testes. */
export async function killAndWait(proc: Subprocess, signal: 'SIGTERM' | 'SIGKILL' = 'SIGKILL'): Promise<void> {
  if (proc.exitCode !== null) return;
  proc.kill(signal);
  await proc.exited;
}
