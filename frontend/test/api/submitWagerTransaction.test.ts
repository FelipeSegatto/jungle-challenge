import { describe, test, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server';
import { submitWagerTransaction } from '@/features/transactions/api';
import { ApiRequestError, ApiConnectionError } from '@/lib/api/client';
import type { ProcessWagerInput } from '@/types/schemas';

const PAYLOAD: ProcessWagerInput = {
  providerId: 'demo-provider',
  externalTransactionId: 'tx-1',
  playerId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1',
  walletId: '0192f291-27dd-7d3f-8071-5f8685deef37',
  roundId: 'round-1',
  gameId: 'game-1',
  kind: 'BET',
  money: { amount: '25.00', currency: 'BRL' },
};
const KEY = 'demo-provider:tx-1';
const noopRecord = vi.fn();

describe('submitWagerTransaction — montagem da requisição', () => {
  test('envia o header Idempotency-Key exatamente como recebido', async () => {
    let capturedHeader: string | null = null;
    server.use(
      http.post('/api/node-1/wagering/transactions', ({ request }) => {
        capturedHeader = request.headers.get('Idempotency-Key');
        return HttpResponse.json({ transactionId: 't1', status: 'PROCESSED', balance: { amount: '75.00', currency: 'BRL' }, failureCode: null, idempotentReplay: false });
      }),
    );
    await submitWagerTransaction('node-1', PAYLOAD, KEY, noopRecord);
    expect(capturedHeader).toBe(KEY);
  });

  test('serializa o payload como JSON idêntico ao objeto enviado (sem perder campos nem converter números)', async () => {
    let capturedBody: unknown = null;
    server.use(
      http.post('/api/node-1/wagering/transactions', async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ transactionId: 't1', status: 'PROCESSED', balance: { amount: '75.00', currency: 'BRL' }, failureCode: null, idempotentReplay: false });
      }),
    );
    await submitWagerTransaction('node-1', PAYLOAD, KEY, noopRecord);
    expect(capturedBody).toEqual(PAYLOAD);
    // money.amount precisa continuar string, nunca virar number na serialização.
    expect(typeof (capturedBody as typeof PAYLOAD).money.amount).toBe('string');
  });

  test('usa o endpoint da instância correta (prefixo /api/:instance)', async () => {
    let hitNode2 = false;
    server.use(
      http.post('/api/node-2/wagering/transactions', () => {
        hitNode2 = true;
        return HttpResponse.json({ transactionId: 't1', status: 'PROCESSED', balance: { amount: '75.00', currency: 'BRL' }, failureCode: null, idempotentReplay: false });
      }),
    );
    await submitWagerTransaction('node-2', PAYLOAD, KEY, noopRecord);
    expect(hitNode2).toBe(true);
  });
});

describe('submitWagerTransaction — contrato de resposta real (POST /wagering/transactions)', () => {
  test('200 PROCESSED é tratado como sucesso', async () => {
    server.use(
      http.post('/api/node-1/wagering/transactions', () =>
        HttpResponse.json({ transactionId: 't1', status: 'PROCESSED', balance: { amount: '75.00', currency: 'BRL' }, failureCode: null, idempotentReplay: false }, { status: 200 }),
      ),
    );
    const { result, httpStatus } = await submitWagerTransaction('node-1', PAYLOAD, KEY, noopRecord);
    expect(httpStatus).toBe(200);
    expect(result.status).toBe('PROCESSED');
  });

  test('202 PENDING_REFERENCE é tratado como sucesso (nunca como erro)', async () => {
    server.use(
      http.post('/api/node-1/wagering/transactions', () =>
        HttpResponse.json({ transactionId: 't1', status: 'PENDING_REFERENCE', balance: null, failureCode: null, idempotentReplay: false }, { status: 202 }),
      ),
    );
    const { result, httpStatus } = await submitWagerTransaction('node-1', PAYLOAD, KEY, noopRecord);
    expect(httpStatus).toBe(202);
    expect(result.status).toBe('PENDING_REFERENCE');
  });

  test('422 REJECTED usa o MESMO shape de sucesso — não deve lançar erro', async () => {
    server.use(
      http.post('/api/node-1/wagering/transactions', () =>
        HttpResponse.json(
          { transactionId: 't1', status: 'REJECTED', balance: { amount: '0.00', currency: 'BRL' }, failureCode: 'INSUFFICIENT_BALANCE', idempotentReplay: false },
          { status: 422 },
        ),
      ),
    );
    const { result, httpStatus } = await submitWagerTransaction('node-1', PAYLOAD, KEY, noopRecord);
    expect(httpStatus).toBe(422);
    expect(result.status).toBe('REJECTED');
    expect(result.failureCode).toBe('INSUFFICIENT_BALANCE');
  });

  test('409 com envelope ApiError vira ApiRequestError (IDEMPOTENCY_CONFLICT)', async () => {
    server.use(
      http.post('/api/node-1/wagering/transactions', () =>
        HttpResponse.json({ code: 'IDEMPOTENCY_CONFLICT', message: 'Chave usada com payload diferente.', statusCode: 409, path: '/wagering/transactions' }, { status: 409 }),
      ),
    );
    let caught: unknown;
    try {
      await submitWagerTransaction('node-1', PAYLOAD, KEY, noopRecord);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ApiRequestError);
    expect((caught as ApiRequestError).apiError.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  test('503 sem corpo reconhecível vira ApiConnectionError, não ApiRequestError', async () => {
    server.use(http.post('/api/node-1/wagering/transactions', () => new HttpResponse('Bad Gateway', { status: 503 })));
    await expect(submitWagerTransaction('node-1', PAYLOAD, KEY, noopRecord)).rejects.toBeInstanceOf(ApiConnectionError);
  });

  test('falha de rede (fetch rejeitado) vira ApiConnectionError', async () => {
    server.use(http.post('/api/node-1/wagering/transactions', () => HttpResponse.error()));
    await expect(submitWagerTransaction('node-1', PAYLOAD, KEY, noopRecord)).rejects.toBeInstanceOf(ApiConnectionError);
  });

  test('registra a chamada no Request Inspector com status e duração', async () => {
    server.use(
      http.post('/api/node-1/wagering/transactions', () =>
        HttpResponse.json({ transactionId: 't1', status: 'PROCESSED', balance: { amount: '75.00', currency: 'BRL' }, failureCode: null, idempotentReplay: false }),
      ),
    );
    const record = vi.fn();
    await submitWagerTransaction('node-1', PAYLOAD, KEY, record);
    expect(record).toHaveBeenCalledTimes(1);
    const entry = record.mock.calls[0]?.[0];
    expect(entry.statusCode).toBe(200);
    expect(entry.outcome).toBe('success');
    expect(typeof entry.durationMs).toBe('number');
  });
});
