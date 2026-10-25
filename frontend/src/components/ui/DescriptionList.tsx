import type { ReactNode } from 'react';

/**
 * Extraído depois de encontrar o mesmo par `<dl>`/`<div className="flex items-center justify-
 * between py-1.5">` reimplementado em 9 arquivos diferentes (WalletDetails, TransactionResult,
 * MetricsPanel, TransactionLookupPanel, ReconciliationPanel, FinalVerificationPanel e 3 etapas do
 * Guided Demo) — só estilo e estrutura, nenhuma lógica de domínio aqui.
 */
export function DescriptionList({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <dl className={`divide-y divide-slate-800 text-sm ${className}`}>{children}</dl>;
}

export function DescriptionRow({ label, value, mono = false }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1.5">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={`text-right text-slate-200 ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  );
}
