import { Sparkles, RotateCcw, ShieldAlert } from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { StatusPill } from '@/components/ui/StatusPill';
import { CopyButton } from '@/components/ui/CopyButton';
import type { Tone } from '@/lib/ui/styles';
import type { WagerStatus } from '@/types/api';
import type { TransactionOutcome } from './types';

const STATUS_TONE: Record<WagerStatus, Tone> = {
  PROCESSED: 'success',
  REJECTED: 'danger',
  PENDING_REFERENCE: 'warning',
  FAILED: 'danger',
};

export function TransactionResult({ outcome }: { outcome: TransactionOutcome | null }) {
  if (!outcome) {
    return (
      <Panel heading="Resultado da operação">
        <p className="text-sm text-slate-600">Execute uma operação para ver o resultado real aqui.</p>
      </Panel>
    );
  }

  if (outcome.type === 'conflict') {
    return (
      <Panel heading="Resultado da operação">
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200"
        >
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-medium">Nova operação com outra identidade, mesma Idempotency-Key</p>
            <p className="mt-1 text-xs text-amber-300/80">
              {outcome.apiError.code}: {outcome.apiError.message}
            </p>
            <p className="mt-1 text-xs text-amber-300/60">
              A key não foi trocada automaticamente — isso é esperado: mesma key, payload diferente, é
              conflito, não uma nova operação silenciosa.
            </p>
          </div>
        </div>
      </Panel>
    );
  }

  if (outcome.type === 'error') {
    return (
      <Panel heading="Resultado da operação">
        <p role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          {outcome.message}
        </p>
      </Panel>
    );
  }

  const { result, httpStatus, instance } = outcome;
  const identityBadge = result.idempotentReplay ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2 py-0.5 text-xs font-medium text-blue-300">
      <RotateCcw className="h-3 w-3" aria-hidden="true" />
      Replay desta operação
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-300">
      <Sparkles className="h-3 w-3" aria-hidden="true" />
      Nova operação
    </span>
  );

  return (
    <Panel heading="Resultado da operação" actions={identityBadge}>
      <dl className="divide-y divide-slate-800 text-sm">
        <div className="flex items-center justify-between py-1.5">
          <dt className="text-xs text-slate-500">Transaction ID</dt>
          <dd className="flex items-center gap-1 font-mono text-slate-200">
            {result.transactionId}
            <CopyButton value={result.transactionId} label="Transaction ID" />
          </dd>
        </div>
        <div className="flex items-center justify-between py-1.5">
          <dt className="text-xs text-slate-500">Status</dt>
          <dd>
            <StatusPill tone={STATUS_TONE[result.status]}>{result.status}</StatusPill>
          </dd>
        </div>
        {result.failureCode ? (
          <div className="flex items-center justify-between py-1.5">
            <dt className="text-xs text-slate-500">failureCode</dt>
            <dd className="font-mono text-xs text-red-300">{result.failureCode}</dd>
          </div>
        ) : null}
        <div className="flex items-center justify-between py-1.5">
          <dt className="text-xs text-slate-500">Saldo retornado</dt>
          <dd className="tabular-nums text-slate-200">
            {result.balance ? `${result.balance.amount} ${result.balance.currency}` : '— (operação não alterou saldo)'}
          </dd>
        </div>
        <div className="flex items-center justify-between py-1.5">
          <dt className="text-xs text-slate-500">idempotentReplay</dt>
          <dd className="font-mono text-slate-200">{String(result.idempotentReplay)}</dd>
        </div>
        <div className="flex items-center justify-between py-1.5">
          <dt className="text-xs text-slate-500">Código HTTP</dt>
          <dd className="font-mono text-slate-200">{httpStatus}</dd>
        </div>
        <div className="flex items-center justify-between py-1.5">
          <dt className="text-xs text-slate-500">Instância utilizada</dt>
          <dd className="font-mono text-slate-200">{instance}</dd>
        </div>
      </dl>
    </Panel>
  );
}
