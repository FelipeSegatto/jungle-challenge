import { useTransactionHistory } from '@/lib/transaction-history/TransactionHistoryContext';
import { focusRing } from '@/lib/ui/styles';
import type { WagerKind } from '@/types/api';

/** Regras reais do backend (src/application/services.ts): quem cada kind pode referenciar. */
const ALLOWED_REFERENCE_KINDS: Partial<Record<WagerKind, readonly WagerKind[]>> = {
  WIN: ['BET'],
  REFUND: ['BET'],
  ROLLBACK: ['BET', 'WIN', 'REFUND'],
};

interface ReferencePickerProps {
  kind: WagerKind;
  providerId: string;
  value: string;
  onChange: (value: string) => void;
  required: boolean;
  error?: string;
}

/**
 * Só oferece como opção transações que este navegador de fato viu serem PROCESSED nesta sessão,
 * do mesmo provider e de um kind que o backend aceita como referência para o `kind` atual — a UI
 * nunca sugere que uma referência arbitrária/inventada vai ser aceita. Mantém um campo manual
 * como fallback para testar um externalTransactionId conhecido mas não observado nesta sessão.
 */
export function ReferencePicker({ kind, providerId, value, onChange, required, error }: ReferencePickerProps) {
  const { entries } = useTransactionHistory();
  const allowedKinds = ALLOWED_REFERENCE_KINDS[kind] ?? [];
  const candidates = entries.filter(
    (entry) => entry.providerId === providerId && entry.status === 'PROCESSED' && allowedKinds.includes(entry.kind),
  );

  if (allowedKinds.length === 0) return null;

  return (
    <div>
      <label htmlFor="reference" className="mb-1 block text-xs font-medium text-slate-400">
        referenceExternalTransactionId {required ? '(obrigatório)' : '(opcional)'}
      </label>
      <select
        id="reference"
        value={candidates.some((c) => c.externalTransactionId === value) ? value : ''}
        onChange={(event) => onChange(event.target.value)}
        className={`mb-1.5 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 ${focusRing}`}
      >
        <option value="">
          {candidates.length === 0
            ? `Nenhuma ${allowedKinds.join('/')} PROCESSED deste provider nesta sessão ainda`
            : 'Selecione uma transação PROCESSED desta sessão…'}
        </option>
        {candidates.map((entry) => (
          <option key={entry.localId} value={entry.externalTransactionId}>
            {entry.kind} {entry.amount} {entry.currency} — {entry.externalTransactionId}
          </option>
        ))}
      </select>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="…ou informe manualmente um externalTransactionId conhecido"
        className={`w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs text-slate-300 placeholder:text-slate-600 ${focusRing}`}
        aria-invalid={Boolean(error)}
      />
      {error ? <p className="mt-1 text-xs text-red-400">{error}</p> : null}
    </div>
  );
}
