import { AlertTriangle } from 'lucide-react';
import { Button } from './Button';

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200"
    >
      <p className="flex items-center gap-2 font-medium">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
        Não foi possível carregar
      </p>
      <p className="text-red-300/80">{message}</p>
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry} className="mt-1">
          Tentar de novo
        </Button>
      ) : null}
    </div>
  );
}
