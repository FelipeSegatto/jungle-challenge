import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react';
import { useToast, type ToastVariant } from '@/lib/toast/ToastContext';
import { focusRing } from '@/lib/ui/styles';

const VARIANT_CONFIG: Record<ToastVariant, { icon: typeof CheckCircle2; classes: string }> = {
  success: { icon: CheckCircle2, classes: 'border-emerald-500/30 text-emerald-200' },
  error: { icon: XCircle, classes: 'border-red-500/30 text-red-200' },
  warning: { icon: AlertTriangle, classes: 'border-amber-500/30 text-amber-200' },
  info: { icon: Info, classes: 'border-blue-500/30 text-blue-200' },
};

/**
 * `aria-live="polite"` + `role="status"` por toast: leitores de tela anunciam o conteúdo sem
 * interromper o que o usuário está fazendo. Região fixa, renderizada uma vez na raiz do app.
 */
export function ToastViewport() {
  const { toasts, dismissToast } = useToast();

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2 sm:bottom-6 sm:right-6"
    >
      {toasts.map((toast) => {
        const { icon: Icon, classes } = VARIANT_CONFIG[toast.variant];
        return (
          <div
            key={toast.id}
            role="status"
            className={`pointer-events-auto flex items-start gap-2 rounded-lg border bg-slate-900/95 p-3 shadow-lg backdrop-blur transition-opacity duration-150 ${classes}`}
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div className="flex-1 text-sm">
              <p className="font-medium">{toast.title}</p>
              {toast.description ? <p className="mt-0.5 text-xs opacity-80">{toast.description}</p> : null}
            </div>
            <button
              type="button"
              onClick={() => dismissToast(toast.id)}
              aria-label="Fechar notificação"
              className={`rounded p-0.5 text-current/70 hover:text-current ${focusRing}`}
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
