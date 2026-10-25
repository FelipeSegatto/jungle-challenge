import { useState } from 'react';
import { getWallet } from '@/features/wallets/api';
import { useInspectedRequest } from '@/lib/api/useInspectedRequest';
import { useRequestInspector } from '@/lib/inspector/RequestInspectorContext';
import { useSelectedInstance } from '@/lib/instance/InstanceContext';
import { runWagerSubmission, type ScenarioRun } from '../shared/runSubmission';
import {
  buildOriginalBetRequest,
  buildReplayRequest,
  buildConflictRequest,
  buildDivergentIdentityRequest,
  type IdempotencyRequest,
} from './scenarioBuilders';
import { evaluateReplay, evaluateConflict, evaluateReplayAfterIntervening, type VerdictResult } from './verdicts';
import type { Wallet } from '@/types/api';

export type { ScenarioRun } from '../shared/runSubmission';

export interface LabTimelineStep {
  readonly id: string;
  readonly label: string;
  readonly detail?: string;
  readonly timestamp: Date;
}

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

function runSubmission(
  instance: Parameters<typeof runWagerSubmission>[0],
  request: IdempotencyRequest,
  walletId: string,
  call: ReturnType<typeof useInspectedRequest>,
  recordRequest: ReturnType<typeof useRequestInspector>['recordRequest'],
): Promise<ScenarioRun> {
  return runWagerSubmission(instance, request.payload, request.idempotencyKey, walletId, call, recordRequest);
}

export function useIdempotencyLab(wallet: Wallet) {
  const call = useInspectedRequest();
  const { recordRequest } = useRequestInspector();
  const { selected: instance } = useSelectedInstance();

  const [originalRequest, setOriginalRequest] = useState<IdempotencyRequest | null>(null);
  const [scenarioA, setScenarioA] = useState<ScenarioRun | null>(null);
  const [scenarioB, setScenarioB] = useState<ScenarioRun | null>(null);
  const [scenarioC, setScenarioC] = useState<ScenarioRun | null>(null);
  const [scenarioDIntervening, setScenarioDIntervening] = useState<ScenarioRun | null>(null);
  const [scenarioD, setScenarioD] = useState<ScenarioRun | null>(null);
  const [scenarioE, setScenarioE] = useState<ScenarioRun | null>(null);

  const [verdictB, setVerdictB] = useState<VerdictResult | null>(null);
  const [verdictC, setVerdictC] = useState<VerdictResult | null>(null);
  const [verdictD, setVerdictD] = useState<VerdictResult | null>(null);
  const [verdictE, setVerdictE] = useState<VerdictResult | null>(null);

  const [timeline, setTimeline] = useState<LabTimelineStep[]>([]);
  const [busy, setBusy] = useState(false);

  const log = (label: string, detail?: string): void => {
    setTimeline((steps) => [...steps, { id: nextId('step'), label, detail, timestamp: new Date() }]);
  };

  const runScenarioA = async (params: {
    providerId: string;
    externalTransactionId: string;
    roundId: string;
    gameId: string;
    amount: string;
  }): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const request = buildOriginalBetRequest({
        providerId: params.providerId,
        externalTransactionId: params.externalTransactionId,
        walletId: wallet.id,
        playerId: wallet.playerId,
        roundId: params.roundId,
        gameId: params.gameId,
        amount: params.amount,
        currency: wallet.balance.currency,
      });
      setOriginalRequest(request);
      log('Cenário A: enviando operação original', `Idempotency-Key ${request.idempotencyKey}`);
      const run = await runSubmission(instance, request, wallet.id, call, recordRequest);
      setScenarioA(run);
      log('Cenário A: resposta recebida', `HTTP ${run.httpStatus} · saldo da wallet agora ${run.walletBalanceAfter}`);
    } finally {
      setBusy(false);
    }
  };

  const runScenarioB = async (): Promise<void> => {
    if (busy || !originalRequest || !scenarioA?.result) return;
    setBusy(true);
    try {
      const before = await getWallet(instance, wallet.id, call);
      const replayRequest = buildReplayRequest(originalRequest);
      log('Cenário B: reenviando a mesma operação (mesma key, mesmo payload)');
      const run = await runSubmission(instance, replayRequest, wallet.id, call, recordRequest);
      setScenarioB(run);
      log('Cenário B: resposta recebida', `HTTP ${run.httpStatus} · idempotentReplay=${run.result?.idempotentReplay}`);
      if (run.result) {
        const verdict = evaluateReplay(scenarioA.result, run.result, before.balance.amount, run.walletBalanceAfter ?? '');
        setVerdictB(verdict);
      } else {
        setVerdictB({ verdict: 'INCONCLUSIVE', reason: 'a chamada de replay não devolveu um resultado de negócio válido.' });
      }
    } finally {
      setBusy(false);
    }
  };

  const runScenarioC = async (modifiedAmount: string): Promise<void> => {
    if (busy || !originalRequest) return;
    setBusy(true);
    try {
      const before = await getWallet(instance, wallet.id, call);
      const conflictRequest = buildConflictRequest(originalRequest, modifiedAmount);
      log('Cenário C: reenviando com a mesma key, valor alterado de propósito', `novo valor: ${modifiedAmount}`);
      const run = await runSubmission(instance, conflictRequest, wallet.id, call, recordRequest);
      setScenarioC(run);
      log('Cenário C: resposta recebida', `HTTP ${run.httpStatus}${run.apiErrorCode ? ` (${run.apiErrorCode})` : ''}`);
      setVerdictC(evaluateConflict(run.httpStatus, run.apiErrorCode, before.balance.amount, run.walletBalanceAfter ?? before.balance.amount));
    } finally {
      setBusy(false);
    }
  };

  const runScenarioDIntervening = async (amount: string): Promise<void> => {
    if (busy || !originalRequest) return;
    setBusy(true);
    try {
      const interveningExternalId = `${originalRequest.externalTransactionId}-intervening`;
      const interveningRequest = buildOriginalBetRequest({
        providerId: originalRequest.providerId,
        externalTransactionId: interveningExternalId,
        walletId: wallet.id,
        playerId: wallet.playerId,
        roundId: 'lab-intervening-round',
        gameId: originalRequest.payload.gameId,
        amount,
        currency: wallet.balance.currency,
      });
      // WIN em vez de BET: não depende do saldo atual cobrir o valor, e credita de verdade — muda o saldo visivelmente.
      const winRequest: IdempotencyRequest = { ...interveningRequest, payload: { ...interveningRequest.payload, kind: 'WIN' } };
      log('Cenário D (passo 1): executando outra movimentação válida (WIN)', `valor: ${amount}`);
      const run = await runSubmission(instance, winRequest, wallet.id, call, recordRequest);
      setScenarioDIntervening(run);
      log('Cenário D (passo 1): resposta recebida', `HTTP ${run.httpStatus} · saldo da wallet agora ${run.walletBalanceAfter}`);
    } finally {
      setBusy(false);
    }
  };

  const runScenarioD = async (): Promise<void> => {
    if (busy || !originalRequest || !scenarioA?.result || !scenarioDIntervening) return;
    setBusy(true);
    try {
      const replayRequest = buildReplayRequest(originalRequest);
      log('Cenário D (passo 2): repetindo a BET original após a movimentação intermediária');
      const run = await runSubmission(instance, replayRequest, wallet.id, call, recordRequest);
      setScenarioD(run);
      log('Cenário D (passo 2): resposta recebida', `HTTP ${run.httpStatus} · saldo real atual ${run.walletBalanceAfter}`);
      if (run.result) {
        setVerdictD(evaluateReplayAfterIntervening(scenarioA.result, run.result, run.walletBalanceAfter ?? ''));
      } else {
        setVerdictD({ verdict: 'INCONCLUSIVE', reason: 'o replay pós-movimentação não devolveu um resultado de negócio válido.' });
      }
    } finally {
      setBusy(false);
    }
  };

  const runScenarioE = async (divergentPlayerId: string): Promise<void> => {
    if (busy || !originalRequest) return;
    setBusy(true);
    try {
      const before = await getWallet(instance, wallet.id, call);
      const divergentRequest = buildDivergentIdentityRequest(originalRequest, divergentPlayerId);
      log('Cenário E: reenviando com a mesma key, playerId divergente do dono real da wallet', `playerId usado: ${divergentPlayerId}`);
      const run = await runSubmission(instance, divergentRequest, wallet.id, call, recordRequest);
      setScenarioE(run);
      log('Cenário E: resposta recebida', `HTTP ${run.httpStatus}${run.apiErrorCode ? ` (${run.apiErrorCode})` : ''}`);
      setVerdictE(evaluateConflict(run.httpStatus, run.apiErrorCode, before.balance.amount, run.walletBalanceAfter ?? before.balance.amount));
    } finally {
      setBusy(false);
    }
  };

  const resetLab = (): void => {
    setOriginalRequest(null);
    setScenarioA(null);
    setScenarioB(null);
    setScenarioC(null);
    setScenarioDIntervening(null);
    setScenarioD(null);
    setScenarioE(null);
    setVerdictB(null);
    setVerdictC(null);
    setVerdictD(null);
    setVerdictE(null);
    setTimeline([]);
  };

  return {
    busy,
    originalRequest,
    scenarioA,
    scenarioB,
    scenarioC,
    scenarioDIntervening,
    scenarioD,
    scenarioE,
    verdictB,
    verdictC,
    verdictD,
    verdictE,
    timeline,
    runScenarioA,
    runScenarioB,
    runScenarioC,
    runScenarioDIntervening,
    runScenarioD,
    runScenarioE,
    resetLab,
  };
}
