import { describe, test, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse, delay } from 'msw';
import { server } from '../msw/server';
import { renderWithProviders } from '../utils/renderWithProviders';
import { CreateWalletForm } from '@/features/wallets/CreateWalletForm';

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Gerar' }));
  await user.clear(screen.getByLabelText('Saldo inicial'));
  await user.type(screen.getByLabelText('Saldo inicial'), '100.00');
}

describe('CreateWalletForm — comportamento do formulário', () => {
  test('não envia nenhuma requisição automaticamente ao montar', () => {
    let requestCount = 0;
    server.use(http.post('/api/node-1/wallets', () => { requestCount++; return HttpResponse.json({}); }));
    renderWithProviders(<CreateWalletForm />);
    expect(requestCount).toBe(0);
  });

  test('playerId vazio é rejeitado pela validação Zod antes de qualquer chamada HTTP', async () => {
    let requestCount = 0;
    server.use(http.post('/api/node-1/wallets', () => { requestCount++; return HttpResponse.json({}); }));
    const user = userEvent.setup();
    renderWithProviders(<CreateWalletForm />);
    await user.click(screen.getByRole('button', { name: 'Criar wallet' }));
    expect(await screen.findByText(/playerId deve ser um UUID válido/)).toBeInTheDocument();
    expect(requestCount).toBe(0);
  });

  test('envia POST /wallets com o payload correto quando os dados são válidos', async () => {
    let capturedBody: unknown = null;
    server.use(
      http.post('/api/node-1/wallets', async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ id: 'wallet-1', playerId: 'x', balance: { amount: '100.00', currency: 'BRL' }, version: 1 }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<CreateWalletForm />);
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: 'Criar wallet' }));
    await screen.findByText('Wallet criada');
    expect(capturedBody).toMatchObject({ initialBalance: { amount: '100.00', currency: 'BRL' } });
  });

  test('não permite um segundo POST enquanto o primeiro ainda está em voo (duplo clique)', async () => {
    let requestCount = 0;
    server.use(
      http.post('/api/node-1/wallets', async () => {
        requestCount++;
        await delay(50);
        return HttpResponse.json({ id: 'wallet-1', playerId: 'x', balance: { amount: '100.00', currency: 'BRL' }, version: 1 }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<CreateWalletForm />);
    await fillValidForm(user);
    const submit = screen.getByRole('button', { name: 'Criar wallet' });
    await user.click(submit);
    // O botão fica desabilitado enquanto a mutação está em voo — por isso um clique extra aqui não
    // deveria gerar um segundo POST. `userEvent` respeita o atributo disabled e não dispara o handler.
    expect(submit).toBeDisabled();
    await user.click(submit);
    await screen.findByText('Wallet criada');
    expect(requestCount).toBe(1);
  });

  test('conflito real (409 WALLET_ALREADY_EXISTS) mostra a mensagem específica de conflito', async () => {
    server.use(
      http.post('/api/node-1/wallets', () =>
        HttpResponse.json({ code: 'WALLET_ALREADY_EXISTS', message: 'Já existe.', statusCode: 409, path: '/wallets' }, { status: 409 }),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(<CreateWalletForm />);
    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: 'Criar wallet' }));
    expect(await screen.findByText(/Já existe uma wallet para esse playerId/)).toBeInTheDocument();
  });
});
