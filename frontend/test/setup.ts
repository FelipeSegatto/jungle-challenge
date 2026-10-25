import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { cleanup } from '@testing-library/react';
import { fetch as undiciFetch, Headers, Request, Response } from 'undici';
import { server } from './msw/server';

/**
 * Achado real desta revisão: sob `environment: 'jsdom'`, o `fetch` embutido do jsdom reconstrói a
 * requisição por dentro de `http.ClientRequest` do Node antes de chegar ao MSW, e o `AbortSignal`
 * resultante vem de um realm diferente do que o `undici` espera — o interceptor de baixo nível do
 * MSW rejeita com "Expected signal to be an instance of AbortSignal", mesmo sem nenhum `signal`
 * explícito no código da aplicação (confirmado isolando o teste em `environment: 'node'`, onde o
 * mesmo código passa limpo). Troca aqui o `fetch`/`Request`/`Response`/`Headers` globais pelos do
 * `undici` — a mesma implementação que o Node usa nativamente — mantendo `window.location` do
 * jsdom (de onde vêm as URLs relativas que o app sempre usa, ex.: "/api/node-1/wallets").
 */
Object.assign(globalThis, { fetch: undiciFetch, Headers, Request, Response });

// `onUnhandledFrame: 'error'` de propósito (nome real da opção no MSW 3.x — "onUnhandledRequest"
// foi renomeado) — uma requisição real sem handler mockado deve derrubar o teste, não passar em
// silêncio (o mesmo espírito de "nunca inventar sucesso" do resto do app).
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());
