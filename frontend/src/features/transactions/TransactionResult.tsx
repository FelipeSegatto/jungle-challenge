import { Sparkles, RotateCcw, ShieldAlert } from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { StatusPill } from '@/components/ui/StatusPill';
import { CopyButton } from '@/components/ui/CopyButton';
import { DescriptionList, DescriptionRow } from '@/components/ui/DescriptionList';
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
      <DescriptionList>
        <DescriptionRow
          label="Transaction ID"
          mono
          value={
            <span className="flex items-center gap-1">
              {result.transactionId}
              <CopyButton value={result.transactionId} label="Transaction ID" />
            </span>
          }
        />
        <DescriptionRow label="Status" value={<StatusPill tone={STATUS_TONE[result.status]}>{result.status}</StatusPill>} />
        {result.failureCode ? (
          <DescriptionRow label="failureCode" value={<span className="font-mono text-xs text-red-300">{result.failureCode}</span>} />
        ) : null}
        <DescriptionRow
          label="Saldo retornado"
          value={<span className="tabular-nums">{result.balance ? `${result.balance.amount} ${result.balance.currency}` : '— (operação não alterou saldo)'}</span>}
        />
        <DescriptionRow label="idempotentReplay" mono value={String(result.idempotentReplay)} />
        <DescriptionRow label="Código HTTP" mono value={httpStatus} />
        <DescriptionRow label="Instância utilizada" mono value={instance} />
      </DescriptionList>
    </Panel>
  );
}
