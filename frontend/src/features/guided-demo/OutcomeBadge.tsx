import { StatusPill } from '@/components/ui/StatusPill';
import type { Tone } from '@/lib/ui/styles';
import type { StepOutcome } from './steps';

const OUTCOME_TONE: Record<StepOutcome, Tone> = { pending: 'neutral', pass: 'success', fail: 'danger', inconclusive: 'warning' };
const OUTCOME_LABEL: Record<StepOutcome, string> = { pending: 'pendente', pass: 'concluída', fail: 'falhou', inconclusive: 'inconclusiva' };

export function OutcomeBadge({ outcome }: { outcome: StepOutcome }) {
  return <StatusPill tone={OUTCOME_TONE[outcome]}>{OUTCOME_LABEL[outcome]}</StatusPill>;
}
