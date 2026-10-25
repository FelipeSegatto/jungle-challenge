import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InstanceProvider, useSelectedInstance } from '@/lib/instance/InstanceContext';

const STORAGE_KEY = 'jungle-console:selected-instance';

function Probe() {
  const { selected, setSelected } = useSelectedInstance();
  return (
    <div>
      <p>atual: {selected}</p>
      <button onClick={() => setSelected('node-3')}>escolher node-3</button>
    </div>
  );
}

describe('InstanceContext — seleção de instância', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test('começa em node-1 quando não há nada salvo', () => {
    render(<InstanceProvider><Probe /></InstanceProvider>);
    expect(screen.getByText('atual: node-1')).toBeInTheDocument();
  });

  test('lê a instância persistida no localStorage ao montar', () => {
    window.localStorage.setItem(STORAGE_KEY, 'node-2');
    render(<InstanceProvider><Probe /></InstanceProvider>);
    expect(screen.getByText('atual: node-2')).toBeInTheDocument();
  });

  test('ignora um valor inválido salvo e usa o padrão', () => {
    window.localStorage.setItem(STORAGE_KEY, 'node-99');
    render(<InstanceProvider><Probe /></InstanceProvider>);
    expect(screen.getByText('atual: node-1')).toBeInTheDocument();
  });

  test('trocar a instância atualiza o estado e persiste no localStorage', async () => {
    const user = userEvent.setup();
    render(<InstanceProvider><Probe /></InstanceProvider>);
    await user.click(screen.getByRole('button', { name: 'escolher node-3' }));
    expect(screen.getByText('atual: node-3')).toBeInTheDocument();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('node-3');
  });

  test('useSelectedInstance fora do provider lança erro explícito', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow('useSelectedInstance deve ser usado dentro de <InstanceProvider>');
    consoleError.mockRestore();
  });
});
