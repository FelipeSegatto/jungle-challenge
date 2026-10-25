import { useState, type FormEvent } from 'react';
import { Search } from 'lucide-react';
import { z } from 'zod';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { focusRing } from '@/lib/ui/styles';
import { useSelectedWallet } from '@/lib/wallet/SelectedWalletContext';

const walletIdSchema = z.string().uuid('Informe um UUID válido');

export function QueryWalletForm() {
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { selectWalletId } = useSelectedWallet();

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault();
    const parsed = walletIdSchema.safeParse(input.trim());
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'walletId inválido');
      return;
    }
    setError(null);
    selectWalletId(parsed.data);
  };

  return (
    <Panel heading="Consultar wallet existente">
      <form onSubmit={handleSubmit} className="flex items-end gap-2" noValidate>
        <div className="flex-1">
          <label htmlFor="query-wallet-id" className="mb-1 block text-xs font-medium text-slate-400">
            walletId (UUID)
          </label>
          <input
            id="query-wallet-id"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="0192f291-27dd-7d3f-8071-5f8685deef37"
            className={`w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 ${focusRing}`}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'query-wallet-id-error' : undefined}
          />
          {error ? (
            <p id="query-wallet-id-error" className="mt-1 text-xs text-red-400">
              {error}
            </p>
          ) : null}
        </div>
        <Button type="submit" variant="secondary">
          <Search className="h-4 w-4" aria-hidden="true" />
          Consultar
        </Button>
      </form>
    </Panel>
  );
}
