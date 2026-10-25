import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Wallet as WalletIcon } from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { CreateWalletForm } from '@/features/wallets/CreateWalletForm';
import { WalletDetails } from '@/features/wallets/WalletDetails';
import { getLedgerPage } from '@/features/ledger/api';
import { useInspectedRequest } from '@/lib/api/useInspectedRequest';
import { useSelectedInstance } from '@/lib/instance/InstanceContext';
import { useSelectedWallet } from '@/lib/wallet/SelectedWalletContext';
import type { StepOutcome } from '../steps';

/**
 * A API não devolve um campo "kind" por lançamento de ledger (ver types/api.ts::LedgerEntry) — o
 * lançamento OPENING é identificado aqui heuristicamente: `balanceBefore === "0.00"`, que só é
 * verdade para a primeira movimentação de uma wallet. Isso é uma inferência do frontend, não um
 * dado literal da API, e é dito explicitamente na tela.
 */
export function Step2CreateWallet({ onOutcome }: { onOutcome: (outcome: StepOutcome) => void }) {
  const call = useInspectedRequest();
  const { selected: instance } = useSelectedInstance();
  const { selectedWalletId } = useSelectedWallet();

  const ledgerQuery = useQuery({
    queryKey: ['guided-demo-opening-ledger', instance, selectedWalletId],
    queryFn: ({ signal }) => getLedgerPage(instance, selectedWalletId as string, { cursor: null, limit: 50 }, call, signal),
    enabled: selectedWalletId !== null,
  });

  const openingEntry = ledgerQuery.data?.items.find((entry) => entry.balanceBefore.amount === '0.00') ?? null;

  useEffect(() => {
    if (!selectedWalletId) onOutcome('pending');
    else if (ledgerQuery.isLoading) onOutcome('pending');
    else if (ledgerQuery.isError) onOutcome('fail');
    else if (openingEntry) onOutcome('pass');
    else onOutcome('inconclusive');
  }, [selectedWalletId, ledgerQuery.isLoading, ledgerQuery.isError, openingEntry, onOutcome]);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-4">
        <CreateWalletForm />
        <WalletDetails />
      </div>
      <Panel heading="Lançamento OPENING no ledger">
        {!selectedWalletId ? (
          <EmptyState icon={WalletIcon} title="Crie uma wallet ao lado" description="O lançamento OPENING aparece aqui assim que uma wallet for criada." />
        ) : ledgerQuery.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : ledgerQuery.isError ? (
          <ErrorState message="Não foi possível consultar o ledger desta wallet." onRetry={() => void ledgerQuery.refetch()} />
        ) : openingEntry ? (
          <dl className="divide-y divide-slate-800 text-sm">
            <div className="flex items-center justify-between py-1.5">
              <dt className="text-xs text-slate-500">Direção</dt>
              <dd className="font-mono text-slate-200">{openingEntry.direction}</dd>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <dt className="text-xs text-slate-500">Valor</dt>
              <dd className="font-mono tabular-nums text-slate-200">
                {openingEntry.money.amount} {openingEntry.money.currency}
              </dd>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <dt className="text-xs text-slate-500">Saldo antes → depois</dt>
              <dd className="font-mono tabular-nums text-slate-200">
                {openingEntry.balanceBefore.amount} → {openingEntry.balanceAfter.amount}
              </dd>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <dt className="text-xs text-slate-500">Quando</dt>
              <dd className="text-xs text-slate-400">{new Date(openingEntry.createdAt).toLocaleString('pt-BR')}</dd>
            </div>
          </dl>
        ) : (
          <EmptyState
            icon={WalletIcon}
            title="Nenhum lançamento inicial encontrado"
            description="Isso é esperado se a wallet foi criada com saldo inicial 0.00 — o backend só grava o lançamento OPENING quando o valor inicial é maior que zero (src/application/services.ts)."
          />
        )}
        <p className="mt-3 border-t border-slate-800 pt-2 text-[11px] text-slate-600">
          Identificado heuristicamente (saldo antes = 0.00) — o endpoint de ledger não devolve um campo de tipo por lançamento.
        </p>
      </Panel>
    </div>
  );
}
