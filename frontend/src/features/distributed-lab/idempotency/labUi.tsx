import { KeyRound } from 'lucide-react';
import { StatusPill } from '@/components/ui/StatusPill';
import { CopyButton } from '@/components/ui/CopyButton';
import { DescriptionList, DescriptionRow } from '@/components/ui/DescriptionList';
import { toneClasses, type Tone } from '@/lib/ui/styles';
import type { WagerStatus } from '@/types/api';
import type { IdempotencyRequest } from './scenarioBuilders';
import type { ScenarioRun } from './useIdempotencyLab';
import type { Verdict, VerdictResult } from './verdicts';

const STATUS_TONE: Record<WagerStatus, Tone> = {
  PROCESSED: 'success',
  REJECTED: 'danger',
  PENDING_REFERENCE: 'warning',
  FAILED: 'danger',
};

const VERDICT_TONE: Record<Verdict, Tone> = { PASS: 'success', FAIL: 'danger', INCONCLUSIVE: 'warning' };

/** Payload real que vai (ou foi) enviado, com a Idempotency-Key em destaque — nada aqui é inventado, é o objeto que vira o body/header do fetch. */
export function PayloadView({ request }: { request: IdempotencyRequest }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-2">
        <KeyRound className="h-4 w-4 shrink-0 text-blue-300" aria-hidden="true" />
        <code className="min-w-0 flex-1 truncate font-mono text-xs text-blue-200">{request.idempotencyKey}</code>
        <CopyButton value={request.idempotencyKey} label="Idempotency-Key" />
      </div>
      <pre className="overflow-x-auto rounded-md border border-slate-800 bg-slate-950 p-3 text-xs text-slate-400">
        {JSON.stringify(request.payload, null, 2)}
      </pre>
    </div>
  );
}

/** Resumo genérico de um ScenarioRun — reaproveitado em todos os cenários B a E para não repetir o mesmo dl 5 vezes. */
export function RunSummary({ run, currency }: { run: ScenarioRun; currency: string }) {
  return (
    <DescriptionList>
      <DescriptionRow label="HTTP" value={<span className="font-mono">{run.httpStatus !== null ? run.httpStatus : '— (sem resposta)'}</span>} />
      {run.outcome === 'success' && run.result ? (
        <>
          <DescriptionRow
            label="Transaction ID"
            value={
              <span className="flex items-center justify-end gap-1 font-mono text-xs">
                {run.result.transactionId}
                <CopyButton value={run.result.transactionId} label="Transaction ID" />
              </span>
            }
          />
          <DescriptionRow label="Status" value={<StatusPill tone={STATUS_TONE[run.result.status]}>{run.result.status}</StatusPill>} />
          <DescriptionRow label="idempotentReplay" value={<span className="font-mono">{String(run.result.idempotentReplay)}</span>} />
          <DescriptionRow
            label="Saldo histórico (na resposta)"
            value={<span className="font-mono tabular-nums">{run.result.balance ? `${run.result.balance.amount} ${run.result.balance.currency}` : '—'}</span>}
          />
        </>
      ) : run.outcome === 'api-error' ? (
        <DescriptionRow label="Erro" value={<span className="font-mono text-xs text-red-300">{run.apiErrorCode}: {run.apiErrorMessage}</span>} />
      ) : (
        <DescriptionRow label="Falha de conexão" value={<span className="text-xs text-red-300">{run.apiErrorMessage ?? 'desconhecida'}</span>} />
      )}
      <DescriptionRow
        label="Saldo real da wallet (reconsultado)"
        value={<span className="font-mono tabular-nums">{run.walletBalanceAfter ? `${run.walletBalanceAfter} ${currency}` : '—'}</span>}
      />
    </DescriptionList>
  );
}

/** Compara duas execuções lado a lado — usado em B (A vs replay) e D (A vs replay pós-intervenção). */
export function SideBySide({
  leftLabel,
  left,
  rightLabel,
  right,
  currency,
}: {
  leftLabel: string;
  left: ScenarioRun;
  rightLabel: string;
  right: ScenarioRun;
  currency: string;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{leftLabel}</p>
        <RunSummary run={left} currency={currency} />
      </div>
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{rightLabel}</p>
        <RunSummary run={right} currency={currency} />
      </div>
    </div>
  );
}

export function VerdictBanner({ result }: { result: VerdictResult }) {
  const tone = VERDICT_TONE[result.verdict];
  const classes = toneClasses[tone];
  return (
    <div className={`rounded-md border p-3 ${classes.border} ${classes.bg}`}>
      <StatusPill tone={tone}>{result.verdict}</StatusPill>
      <p className="mt-1.5 text-xs text-slate-300">{result.reason}</p>
    </div>
  );
}
