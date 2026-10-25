import { useEffect } from 'react';
import { describe, test, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { http, HttpResponse, delay } from 'msw';
import { server } from '../msw/server';
import { renderWithProviders } from '../utils/renderWithProviders';
import { WalletDetails } from '@/features/wallets/WalletDetails';
import { useSelectedWallet } from '@/lib/wallet/SelectedWalletContext';

const WALLET_ID = '0192f291-27dd-7d3f-8071-5f8685deef37';

function Harness({ walletId }: { walletId: string | null }) {
  const { selectWalletId } = useSelectedWallet();
  useEffect(() => {
    if (walletId) selectWalletId(walletId);
  }, [walletId, selectWalletId]);
  return <WalletDetails />;
}

describe('WalletDetails — estados de loading/empty/erro/sucesso', () => {
  test('empty: nenhuma wallet selecionada não dispara nenhuma requisição', () => {
    renderWithProviders(<Harness walletId={null} />);
    expect(screen.getByText('Nenhuma wallet selecionada')).toBeInTheDocument();
  });

  test('loading: mostra skeleton antes da resposta, depois renderiza os dados reais', async () => {
    server.use(
      http.get(`/api/node-1/wallets/${WALLET_ID}`, async () => {
        await delay(30);
        return HttpResponse.json({ id: WALLET_ID, playerId: 'p1', balance: { amount: '100.00', currency: 'BRL' }, version: 1 });
      }),
    );
    const { container } = renderWithProviders(<Harness walletId={WALLET_ID} />);
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText(WALLET_ID)).not.toBeInTheDocument();

    expect(await screen.findByText(WALLET_ID)).toBeInTheDocument();
    expect(screen.getByText('R$ 100,00')).toBeInTheDocument();
  });

  test('not found: 404 WALLET_NOT_FOUND mostra o empty state específico, não um erro genérico', async () => {
    server.use(
      http.get(`/api/node-1/wallets/${WALLET_ID}`, () =>
        HttpResponse.json({ code: 'WALLET_NOT_FOUND', message: 'Carteira não encontrada.', statusCode: 404, path: `/wallets/${WALLET_ID}` }, { status: 404 }),
      ),
    );
    renderWithProviders(<Harness walletId={WALLET_ID} />);
    expect(await screen.findByText('Wallet não encontrada')).toBeInTheDocument();
  });

  test('erro de conexão: resposta sem corpo reconhecível mostra ErrorState com retry', async () => {
    server.use(http.get(`/api/node-1/wallets/${WALLET_ID}`, () => new HttpResponse('Bad Gateway', { status: 502 })));
    renderWithProviders(<Harness walletId={WALLET_ID} />);
    expect(await screen.findByText('Não foi possível carregar')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument();
  });

  test('sucesso: exibe saldo formatado, versão e instância usada', async () => {
    server.use(
      http.get(`/api/node-1/wallets/${WALLET_ID}`, () =>
        HttpResponse.json({ id: WALLET_ID, playerId: 'p1', balance: { amount: '1234.56', currency: 'BRL' }, version: 3 }),
      ),
    );
    renderWithProviders(<Harness walletId={WALLET_ID} />);
    expect(await screen.findByText('R$ 1.234,56')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('node-1')).toBeInTheDocument();
  });
});
