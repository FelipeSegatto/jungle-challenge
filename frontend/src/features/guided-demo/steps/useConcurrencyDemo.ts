import { useState } from 'react';
import { createWallet, getWallet } from '@/features/wallets/api';
import { getLedgerPage, reconcileWallet } from '@/features/ledger/api';
import { runWagerSubmission, type ScenarioRun } from '@/features/distributed-lab/shared/runSubmission';
import { useInspectedRequest } from '@/lib/api/useInspectedRequest';
import { useRequestInspector } from '@/lib/inspector/RequestInspectorContext';
import { useSelectedInstance } from '@/lib/instance/InstanceContext';
import type { Wallet, LedgerEntry, Reconciliation } from '@/types/api';
import type { ProcessWagerInput } from '@/types/schemas';

/**
 * Orquestra o cenário "duas BETs de R$ 80 concorrentes numa wallet de R$ 100" reaproveitando as
 * MESMAS funções usadas no Idempotency Lab e no módulo Transactions (`createWallet`, `getWallet`,
 * `getLedgerPage`, `reconcileWallet`, `runWagerSubmission`) — a única coisa nova aqui é o
 * `Promise.all` disparando as duas chamadas ao mesmo tempo. Usa uma wallet PRÓPRIA, isolada da
 * wallet selecionada globalmente nas outras etapas, porque o cenário exige saldo inicial exato de
 * R$ 100,00 e nenhuma movimentação prévia.
 */
export function useConcurrencyDemo() {
  const call = useInspectedRequest();
  const { recordRequest } = useRequestInspector();
  const { selected: instance } = useSelectedInstance();

  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [busy, setBusy] = useState(false);
  const [runA, setRunA] = useState<ScenarioRun | null>(null);
  const [runB, setRunB] = useState<ScenarioRun | null>(null);
  const [ledgerEntries, setLedgerEntries] = useState<readonly LedgerEntry[] | null>(null);
  const [reconciliation, setReconciliation] = useState<Reconciliation | null>(null);

  const createIsolatedWallet = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const playerId = crypto.randomUUID();
      const created = await createWallet(instance, { playerId, initialBalance: { amount: '100.00', currency: 'BRL' } }, call);
      setWallet(created);
      setRunA(null);
      setRunB(null);
      setLedgerEntries(null);
      setReconciliation(null);
    } finally {
      setBusy(false);
    }
  };

  const runConcurrentBets = async (): Promise<void> => {
    if (busy || !wallet) return;
    setBusy(true);
    try {
      const idA = crypto.randomUUID();
      const idB = crypto.randomUUID();
      const basePayload: Omit<ProcessWagerInput, 'externalTransactionId'> = {
        providerId: 'guided-demo-concurrency',
        playerId: wallet.playerId,
        walletId: wallet.id,
        roundId: 'guided-demo-concurrency-round',
        gameId: 'guided-demo-concurrency-game',
        kind: 'BET',
        money: { amount: '80.00', currency: wallet.balance.currency },
      };
      const [resultA, resultB] = await Promise.all([
        runWagerSubmission(
          instance,
          { ...basePayload, externalTransactionId: `bet-a-${idA}` },
          `guided-demo-concurrency:a:${idA}`,
          wallet.id,
          call,
          recordRequest,
        ),
        runWagerSubmission(
          instance,
          { ...basePayload, externalTransactionId: `bet-b-${idB}` },
          `guided-demo-concurrency:b:${idB}`,
          wallet.id,
          call,
          recordRequest,
        ),
      ]);
      setRunA(resultA);
      setRunB(resultB);
    } finally {
      setBusy(false);
    }
  };

  const runVerification = async (): Promise<void> => {
    if (busy || !wallet) return;
    setBusy(true);
    try {
      const [ledgerPage, reconciled, fresh] = await Promise.all([
        getLedgerPage(instance, wallet.id, { cursor: null, limit: 20 }, call),
        reconcileWallet(instance, wallet.id, call),
        getWallet(instance, wallet.id, call),
      ]);
      setLedgerEntries(ledgerPage.items);
      setReconciliation(reconciled);
      setWallet(fresh);
    } finally {
      setBusy(false);
    }
  };

  const reset = (): void => {
    setWallet(null);
    setRunA(null);
    setRunB(null);
    setLedgerEntries(null);
    setReconciliation(null);
  };

  return { wallet, busy, createIsolatedWallet, runA, runB, runConcurrentBets, ledgerEntries, reconciliation, runVerification, reset };
}
