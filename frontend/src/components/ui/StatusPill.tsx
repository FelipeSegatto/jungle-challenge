import type { ReactNode } from 'react';
import { toneClasses, type Tone } from '@/lib/ui/styles';

/** Pill de status genérico — usado para live/ready, e reutilizável depois para PROCESSED/REJECTED/PENDING_REFERENCE. */
export function StatusPill({ tone, children }: { tone: Tone; children: ReactNode }) {
  const classes = toneClasses[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${classes.text} ${classes.bg} ${classes.border}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${classes.dot}`} aria-hidden="true" />
      {children}
    </span>
  );
}
