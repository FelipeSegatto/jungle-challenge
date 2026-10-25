import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';
import { focusRing } from '@/lib/ui/styles';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
}

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: 'bg-emerald-600 text-white hover:bg-emerald-500 disabled:bg-emerald-800',
  secondary: 'bg-slate-800 text-slate-100 border border-slate-700 hover:bg-slate-700 disabled:bg-slate-800/50',
  ghost: 'bg-transparent text-slate-300 hover:bg-slate-800 disabled:text-slate-600',
  danger: 'bg-red-600 text-white hover:bg-red-500 disabled:bg-red-900',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', loading = false, disabled, className = '', children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={`inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60 ${focusRing} ${VARIANT_CLASSES[variant]} ${className}`}
        {...props}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
        {children}
      </button>
    );
  },
);
Button.displayName = 'Button';
