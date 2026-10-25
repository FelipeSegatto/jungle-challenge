import type { HTMLAttributes, ReactNode } from 'react';

interface PanelProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  heading?: ReactNode;
  actions?: ReactNode;
}

/** "Superfície discretamente elevada" — um tom mais claro que o fundo, borda sutil, sem sombra pesada. */
export function Panel({ heading, actions, className = '', children, ...props }: PanelProps) {
  return (
    <div
      className={`rounded-lg border border-slate-800 bg-slate-900/60 p-4 sm:p-5 ${className}`}
      {...props}
    >
      {heading || actions ? (
        <div className="mb-3 flex items-center justify-between gap-2">
          {heading ? <h3 className="text-sm font-semibold text-slate-200">{heading}</h3> : <span />}
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}
