import { useCallback, useState } from 'react';
import { RotateCcw, Check, X, HelpCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { toneClasses, type Tone } from '@/lib/ui/styles';
import { StepShell } from './StepShell';
import { STEPS, INITIAL_OUTCOMES, type StepId, type StepOutcome } from './steps';
import { Step1Overview } from './steps/Step1Overview';
import { Step2CreateWallet } from './steps/Step2CreateWallet';
import { Step3ProcessBet } from './steps/Step3ProcessBet';
import { Step4Idempotency } from './steps/Step4Idempotency';
import { Step5Concurrency } from './steps/Step5Concurrency';
import { Step6Messaging } from './steps/Step6Messaging';

const OUTCOME_TONE: Record<StepOutcome, Tone> = { pending: 'neutral', pass: 'success', fail: 'danger', inconclusive: 'warning' };

function StepDot({ order, outcome, active, onClick }: { order: number; outcome: StepOutcome; active: boolean; onClick: () => void }) {
  const tone = OUTCOME_TONE[outcome];
  const classes = toneClasses[tone];
  const Icon = outcome === 'pass' ? Check : outcome === 'fail' ? X : outcome === 'inconclusive' ? HelpCircle : null;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'step' : undefined}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors ${
        active ? 'border-emerald-400 bg-emerald-500/20 text-emerald-300' : `${classes.border} ${classes.bg} ${classes.text}`
      }`}
    >
      {Icon ? <Icon className="h-4 w-4" aria-hidden="true" /> : order}
    </button>
  );
}

/**
 * Página única com navegação livre entre as 6 etapas (não trava sequencialmente — um apresentador
 * pode querer voltar). `resetToken` no `key` dos componentes interativos força remount completo ao
 * reiniciar o roteiro, limpando o estado local de cada etapa (formulários, cenários executados)
 * sem tocar na wallet selecionada globalmente nem em nenhum dado financeiro real.
 */
export function GuidedDemoPage() {
  const [stepId, setStepId] = useState<StepId>('overview');
  const [outcomes, setOutcomes] = useState<Record<StepId, StepOutcome>>(INITIAL_OUTCOMES);
  const [resetToken, setResetToken] = useState(0);

  const setOutcome = useCallback((id: StepId, outcome: StepOutcome) => {
    setOutcomes((current) => (current[id] === outcome ? current : { ...current, [id]: outcome }));
  }, []);

  const onOverview = useCallback((o: StepOutcome) => setOutcome('overview', o), [setOutcome]);
  const onCreateWallet = useCallback((o: StepOutcome) => setOutcome('create-wallet', o), [setOutcome]);
  const onProcessBet = useCallback((o: StepOutcome) => setOutcome('process-bet', o), [setOutcome]);
  const onIdempotency = useCallback((o: StepOutcome) => setOutcome('idempotency', o), [setOutcome]);
  const onConcurrency = useCallback((o: StepOutcome) => setOutcome('concurrency', o), [setOutcome]);
  const onMessaging = useCallback((o: StepOutcome) => setOutcome('messaging', o), [setOutcome]);

  const meta = STEPS.find((s) => s.id === stepId);
  if (!meta) return null;

  const handleReset = (): void => {
    setStepId('overview');
    setOutcomes(INITIAL_OUTCOMES);
    setResetToken((token) => token + 1);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {STEPS.map((step, index) => (
            <div key={step.id} className="flex items-center gap-2">
              <StepDot order={step.order} outcome={outcomes[step.id]} active={step.id === stepId} onClick={() => setStepId(step.id)} />
              {index < STEPS.length - 1 ? <span className="h-px w-6 shrink-0 bg-slate-800" aria-hidden="true" /> : null}
            </div>
          ))}
        </div>
        <Button variant="ghost" onClick={handleReset}>
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Reiniciar roteiro
        </Button>
      </div>

      <StepShell key={`${stepId}-shell`} meta={meta} outcome={outcomes[stepId]}>
        {stepId === 'overview' ? <Step1Overview key={`overview-${resetToken}`} onOutcome={onOverview} /> : null}
        {stepId === 'create-wallet' ? <Step2CreateWallet key={`create-wallet-${resetToken}`} onOutcome={onCreateWallet} /> : null}
        {stepId === 'process-bet' ? <Step3ProcessBet key={`process-bet-${resetToken}`} onOutcome={onProcessBet} /> : null}
        {stepId === 'idempotency' ? <Step4Idempotency key={`idempotency-${resetToken}`} onOutcome={onIdempotency} /> : null}
        {stepId === 'concurrency' ? <Step5Concurrency key={`concurrency-${resetToken}`} onOutcome={onConcurrency} /> : null}
        {stepId === 'messaging' ? <Step6Messaging key={`messaging-${resetToken}`} onOutcome={onMessaging} /> : null}
      </StepShell>

      <div className="flex items-center justify-between">
        <Button
          variant="secondary"
          disabled={meta.order === 1}
          onClick={() => {
            const previous = STEPS.find((s) => s.order === meta.order - 1);
            if (previous) setStepId(previous.id);
          }}
        >
          Etapa anterior
        </Button>
        <Button
          variant="secondary"
          disabled={meta.order === STEPS.length}
          onClick={() => {
            const next = STEPS.find((s) => s.order === meta.order + 1);
            if (next) setStepId(next.id);
          }}
        >
          Próxima etapa
        </Button>
      </div>
    </div>
  );
}
