export type Verdict = 'PASS' | 'FAIL' | 'INCONCLUSIVE';

export interface VerdictResult {
  readonly verdict: Verdict;
  readonly reason: string;
}

export interface WagerOutcomeLike {
  readonly transactionId: string;
  readonly status: string;
  readonly balance: { readonly amount: string; readonly currency: string } | null;
  readonly idempotentReplay: boolean;
}

function pass(reason: string): VerdictResult {
  return { verdict: 'PASS', reason };
}
function fail(reason: string): VerdictResult {
  return { verdict: 'FAIL', reason };
}
function inconclusive(reason: string): VerdictResult {
  return { verdict: 'INCONCLUSIVE', reason };
}

/**
 * Cenário B — replay idêntico. PASS só quando TODOS os critérios abaixo são comprovados pelos
 * dados retornados: mesmo transactionId, idempotentReplay=true, saldo histórico preservado, e o
 * saldo REAL da wallet (consultado de novo via GET /wallets/:id) não mudou entre antes e depois
 * do replay — essa última checagem é o que prova "não produziu novo efeito financeiro", não só
 * confiar no que a própria resposta do replay diz.
 */
export function evaluateReplay(
  original: WagerOutcomeLike,
  replay: WagerOutcomeLike,
  walletBalanceBeforeReplay: string,
  walletBalanceAfterReplay: string,
): VerdictResult {
  if (replay.transactionId !== original.transactionId) {
    return fail(`transactionId do replay (${replay.transactionId}) é diferente do original (${original.transactionId}).`);
  }
  if (!replay.idempotentReplay) {
    return fail('idempotentReplay veio false — o backend tratou como uma operação nova, não como replay.');
  }
  if (walletBalanceBeforeReplay !== walletBalanceAfterReplay) {
    return fail(`saldo da wallet mudou de ${walletBalanceBeforeReplay} para ${walletBalanceAfterReplay} após o replay — efeito financeiro duplicado.`);
  }
  if (original.balance && replay.balance && original.balance.amount !== replay.balance.amount) {
    return fail('o saldo histórico devolvido no replay diverge do saldo devolvido na resposta original.');
  }
  return pass('mesmo transactionId, idempotentReplay=true, saldo histórico preservado e saldo real da wallet inalterado.');
}

/**
 * Cenários C e E — conflito de payload / identidade divergente sob a mesma key. O contrato
 * esperado é idêntico nos dois casos: 409 IDEMPOTENCY_CONFLICT, saldo da wallet inalterado. Uma
 * resposta de sucesso (2xx/202) aqui é FAIL explícito, nunca tratado como se fosse um resultado
 * válido — é exatamente o "não tratar um erro inesperado como sucesso" pedido.
 */
export function evaluateConflict(
  httpStatus: number | null,
  errorCode: string | null,
  walletBalanceBefore: string,
  walletBalanceAfter: string,
): VerdictResult {
  if (httpStatus === null) {
    return inconclusive('sem resposta HTTP (falha de conexão) — não foi possível confirmar o comportamento esperado.');
  }
  if (walletBalanceBefore !== walletBalanceAfter) {
    return fail(`saldo mudou de ${walletBalanceBefore} para ${walletBalanceAfter} mesmo com o conflito — não deveria mover dinheiro em nenhuma hipótese.`);
  }
  if (httpStatus === 409 && errorCode === 'IDEMPOTENCY_CONFLICT') {
    return pass('HTTP 409 IDEMPOTENCY_CONFLICT, saldo da wallet inalterado.');
  }
  if (httpStatus >= 200 && httpStatus < 300) {
    return fail(`esperava 409 IDEMPOTENCY_CONFLICT, mas a requisição foi aceita (HTTP ${httpStatus}) — payload divergente não deveria ser aceito sob a mesma key.`);
  }
  return fail(`esperava 409 IDEMPOTENCY_CONFLICT, recebeu HTTP ${httpStatus}${errorCode ? ` (${errorCode})` : ' (sem código reconhecível)'}.`);
}

/**
 * Cenário D — replay depois de outra movimentação válida na mesma wallet. PASS só quando o
 * replay devolve o MESMO saldo histórico da resposta original (não recalculado) E esse saldo
 * histórico é diferente do saldo real atual da wallet (prova de que houve, de fato, uma
 * movimentação intermediária real entre os dois) — se os dois saldos forem iguais, o teste é
 * INCONCLUSIVE porque não dá pra provar a divergência a partir dos dados disponíveis.
 */
export function evaluateReplayAfterIntervening(
  original: WagerOutcomeLike,
  replay: WagerOutcomeLike,
  currentWalletBalance: string,
): VerdictResult {
  if (replay.transactionId !== original.transactionId) {
    return fail(`transactionId do replay (${replay.transactionId}) é diferente do original (${original.transactionId}).`);
  }
  if (!replay.idempotentReplay) {
    return fail('idempotentReplay veio false no replay pós-movimentação intermediária.');
  }
  if (!original.balance || !replay.balance) {
    return inconclusive('resposta original ou do replay não trouxe saldo para comparar.');
  }
  if (original.balance.amount !== replay.balance.amount) {
    return fail(`saldo histórico do replay (${replay.balance.amount}) diverge do saldo da resposta original (${original.balance.amount}) — o backend recalculou em vez de devolver o histórico.`);
  }
  if (replay.balance.amount === currentWalletBalance) {
    return inconclusive('o saldo atual da wallet é igual ao saldo histórico — não foi possível comprovar que houve uma movimentação intermediária real.');
  }
  return pass(`saldo histórico do replay (${replay.balance.amount}) bate com o original e diverge do saldo atual real da wallet (${currentWalletBalance}), provando que o replay reflete o histórico, não o presente.`);
}
