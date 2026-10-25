import { http, HttpResponse } from 'msw';

/**
 * Handlers padrão: as 3 instâncias saudáveis, e nenhuma wallet/transação pré-cadastrada (cada
 * teste registra o que precisa com `server.use(...)` — estes só evitam que um teste que nem olha
 * para health/metrics precise redeclarar isso).
 */
export const handlers = [
  http.get('/api/:instance/health/live', () => HttpResponse.json({ status: 'ok' })),
  http.get('/api/:instance/health/ready', () =>
    HttpResponse.json({ status: 'ok', dependencies: { postgres: 'ok', sqs: 'ok' } }),
  ),
];
