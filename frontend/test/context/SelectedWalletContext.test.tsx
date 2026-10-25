import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SelectedWalletProvider, useSelectedWallet } from '@/lib/wallet/SelectedWalletContext';

function Probe() {
  const { selectedWalletId, recordWalletUsage, history, clearSelection } = useSelectedWallet();
  return (
    <div>
      <p>selecionada: {selectedWalletId ?? 'nenhuma'}</p>
      <p>histórico: {history.length}</p>
      <button onClick={() => recordWalletUsage({ walletId: 'w1', playerId: 'p1' })}>usar w1</button>
      <button onClick={() => recordWalletUsage({ walletId: 'w2', playerId: 'p2' })}>usar w2</button>
      <button onClick={() => recordWalletUsage({ walletId: 'w1', playerId: 'p1' })}>usar w1 de novo</button>
      <button onClick={clearSelection}>limpar</button>
    </div>
  );
}

describe('SelectedWalletContext — seleção de wallet', () => {
  test('começa sem nenhuma wallet selecionada', () => {
    render(<SelectedWalletProvider><Probe /></SelectedWalletProvider>);
    expect(screen.getByText('selecionada: nenhuma')).toBeInTheDocument();
  });

  test('recordWalletUsage seleciona a wallet e grava no histórico desta sessão', async () => {
    const user = userEvent.setup();
    render(<SelectedWalletProvider><Probe /></SelectedWalletProvider>);
    await user.click(screen.getByRole('button', { name: 'usar w1' }));
    expect(screen.getByText('selecionada: w1')).toBeInTheDocument();
    expect(screen.getByText('histórico: 1')).toBeInTheDocument();
  });

  test('reusar a mesma wallet não duplica a entrada no histórico', async () => {
    const user = userEvent.setup();
    render(<SelectedWalletProvider><Probe /></SelectedWalletProvider>);
    await user.click(screen.getByRole('button', { name: 'usar w1' }));
    await user.click(screen.getByRole('button', { name: 'usar w1 de novo' }));
    expect(screen.getByText('histórico: 1')).toBeInTheDocument();
  });

  test('usar uma segunda wallet diferente soma ao histórico e troca a seleção ativa', async () => {
    const user = userEvent.setup();
    render(<SelectedWalletProvider><Probe /></SelectedWalletProvider>);
    await user.click(screen.getByRole('button', { name: 'usar w1' }));
    await user.click(screen.getByRole('button', { name: 'usar w2' }));
    expect(screen.getByText('selecionada: w2')).toBeInTheDocument();
    expect(screen.getByText('histórico: 2')).toBeInTheDocument();
  });

  test('clearSelection volta a selectedWalletId para null sem apagar o histórico', async () => {
    const user = userEvent.setup();
    render(<SelectedWalletProvider><Probe /></SelectedWalletProvider>);
    await user.click(screen.getByRole('button', { name: 'usar w1' }));
    await user.click(screen.getByRole('button', { name: 'limpar' }));
    expect(screen.getByText('selecionada: nenhuma')).toBeInTheDocument();
    expect(screen.getByText('histórico: 1')).toBeInTheDocument();
  });
});
