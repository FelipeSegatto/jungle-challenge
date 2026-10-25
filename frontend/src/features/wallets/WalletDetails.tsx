import { useEffect, useRef } from 'react';
import { Wallet as WalletIcon, RefreshCw, SearchX } from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { CopyButton } from '@/components/ui/CopyButton';
import { StatusPill } from '@/components/ui/StatusPill';
import { useWallet } from './useWallet';
import { useSelectedWallet } from '@/lib/wallet/SelectedWalletContext';
import { useSelectedInstance } from '@/lib/instance/InstanceContext';
import { formatMoney } from '@/lib/money/format';
import { ApiRequestError } from '@/lib/api/client';

function Field({ label, value, copyValue }: { label: string; value: string; copyValue?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1.5">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="flex items-center gap-1 font-mono text-sm text-slate-200">
        {value}
        {copyValue ? <CopyButton value={copyValue} label={label} /> : null}
      </dd>
    </div>
  );
}

export function WalletDetails() {
  const { selectedWalletId, recordWalletUsage } = useSelectedWallet();
  const { selected: instance } = useSelectedInstance();
  const query = useWallet(selectedWalletId);
  const recordedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (query.status === 'success' && query.data && recordedForRef.current !== query.data.id) {
      recordedForRef.current = query.data.id;
      recordWalletUsage({ walletId: query.data.id, playerId: query.data.playerId });
    }
  }, [query.status, query.data, recordWalletUsage]);

  if (!selectedWalletId) {
    return (
      <Panel heading="Wallet selecionada">
        <EmptyState
          icon={WalletIcon}
          title="Nenhuma wallet selecionada"
          description="Crie uma wallet ou consulte uma existente pelo walletId para ver os dados reais aqui."
        />
      </Panel>
    );
  }

  const notFound = query.error instanceof ApiRequestError && query.error.apiError.code === 'WALLET_NOT_FOUND';

  return (
    <Panel
      heading="Wallet selecionada"
      actions={
        <Button variant="ghost" onClick={() => void query.refetch()} disabled={query.isFetching}>
          <RefreshCw className={`h-4 w-4 ${query.isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
          Atualizar saldo
        </Button>
      }
    >
      {query.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-5 w-1/2" />
        </div>
      ) : notFound ? (
        <EmptyState
          icon={SearchX}
          title="Wallet não encontrada"
          description={`Nenhuma wallet com id "${selectedWalletId}" nesta instância/banco.`}
        />
      ) : query.isError ? (
        <ErrorState
          message={query.error instanceof Error ? query.error.message : 'Erro desconhecido.'}
          onRetry={() => void query.refetch()}
        />
      ) : query.data ? (
        <dl className="divide-y divide-slate-800">
          <Field label="Wallet ID" value={query.data.id} copyValue={query.data.id} />
          <Field label="Player ID" value={query.data.playerId} copyValue={query.data.playerId} />
          <Field label="Saldo" value={formatMoney(query.data.balance)} />
          <Field label="Moeda" value={query.data.balance.currency} />
          <Field label="Versão" value={String(query.data.version)} />
          <div className="flex items-center justify-between py-1.5">
            <dt className="text-xs text-slate-500">Status da consulta</dt>
            <dd>
              <StatusPill tone="success">ok</StatusPill>
            </dd>
          </div>
          <div className="flex items-center justify-between py-1.5">
            <dt className="text-xs text-slate-500">Instância utilizada</dt>
            <dd className="font-mono text-sm text-slate-400">{instance}</dd>
          </div>
        </dl>
      ) : null}
    </Panel>
  );
}
