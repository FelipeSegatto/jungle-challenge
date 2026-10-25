import { fileURLToPath } from 'node:url';
import { defineConfig, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Uma entrada por instância do backend (docker-compose.yml: api1/api2/api3 em 3001/3002/3003).
 * Prefixo e porta são configuráveis via env porque o mesmo compose também sobe a API solta em
 * 3000 quando roda fora do Docker — nunca hardcoded num único lugar do app.
 */
const INSTANCE_TARGETS: Record<string, string> = {
  'node-1': process.env.VITE_NODE_1_TARGET ?? 'http://127.0.0.1:3001',
  'node-2': process.env.VITE_NODE_2_TARGET ?? 'http://127.0.0.1:3002',
  'node-3': process.env.VITE_NODE_3_TARGET ?? 'http://127.0.0.1:3003',
};

function buildProxyTable(): Record<string, ProxyOptions> {
  const table: Record<string, ProxyOptions> = {};
  for (const [name, target] of Object.entries(INSTANCE_TARGETS)) {
    table[`/api/${name}`] = {
      target,
      changeOrigin: true,
      rewrite: (path) => path.replace(new RegExp(`^/api/${name}`), ''),
    };
  }
  return table;
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // Backend não tem autenticação (NoopAuthGuard) — nunca expor o dev server fora do loopback.
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: buildProxyTable(),
  },
});
