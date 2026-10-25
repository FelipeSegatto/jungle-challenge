import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { focusRing } from '@/lib/ui/styles';

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (): Promise<void> => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      aria-label={`Copiar ${label}`}
      className={`inline-flex items-center justify-center rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-300 ${focusRing}`}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
    </button>
  );
}
