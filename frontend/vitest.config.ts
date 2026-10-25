import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

/**
 * Suíte separada do `bun:test` já existente (scenarioBuilders.test.ts, verdicts.test.ts,
 * prometheus.test.ts — lógica pura, sem DOM). Vitest + RTL + MSW entram só para o que bun:test não
 * cobre bem: montar componentes React de verdade e simular respostas HTTP. `include` aponta só
 * para `test/` (fora de `src/`) de propósito — `bun test src` nunca varre esse diretório, então as
 * duas suítes nunca disputam o mesmo arquivo.
 */
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      environmentOptions: { jsdom: { url: 'http://localhost/' } },
      setupFiles: ['./test/setup.ts'],
      include: ['test/**/*.test.{ts,tsx}'],
      css: false,
      restoreMocks: true,
    },
  }),
);
