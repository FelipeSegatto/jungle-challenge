/**
 * Contratos extraídos dos DTOs e controllers reais do backend
 * (src/presentation/{dtos,controllers}.ts, src/application/services.ts), confirmados contra
 * respostas HTTP reais nesta sessão de auditoria. Nenhum campo aqui foi inventado — se o backend
 * não devolve algo, não aparece neste arquivo (ex.: o retorno de POST /wagering/transactions não
 * tem `providerId`/`kind`, só a consulta GET tem — por isso são dois tipos diferentes, não um só).
 */

/** Seção 6.1 do desafio. Sempre string decimal de 2 casas — nunca number. */
export interface Money {
  readonly amount: string;
  readonly currency: string;
}

/** GET /wallets/:id e POST /wallets. */
export interface Wallet {
  readonly id: string;
  readonly playerId: string;
  readonly balance: Money;
  readonly version: number;
}

/**
 * Enum real do backend (src/domain/wager.ts: WagerStatus) inclui FAILED, mas nenhum caminho de
 * código atual o produz — ver ../../ARCHITECTURE.md#15-limitações-conhecidas. Mantido aqui por
 * fidelidade ao domínio, não porque a UI precise de um estado visual pra ele.
 */
export type WagerStatus = 'PROCESSED' | 'REJECTED' | 'PENDING_REFERENCE' | 'FAILED';

/** Os 5 tipos que um cliente pode SUBMETER (POST /wagering/transactions) — casa com processWagerSchema. */
export type WagerKind = 'BET' | 'WIN' | 'LOSS' | 'REFUND' | 'ROLLBACK';

/**
 * Os tipos que podem voltar numa CONSULTA (GET) — inclui OPENING, criado internamente na abertura
 * da wallet (providerId "__internal__", nunca aceito via POST — ver wagers_kind_valid na migration
 * do backend). Achado real da revisão de qualidade: `WagerTransaction.kind` usava `WagerKind` e
 * silenciosamente não tipava esse valor real que a API pode devolver.
 */
export type WagerTransactionKind = WagerKind | 'OPENING';

/** Resposta de POST /wagering/transactions — shape confirmado por execução real, NÃO é o mesmo da consulta GET. */
export interface WagerSubmissionResult {
  readonly transactionId: string;
  readonly status: WagerStatus;
  readonly balance: Money | null;
  readonly failureCode: string | null;
  readonly idempotentReplay: boolean;
}

/**
 * Resposta de GET /wagering/transactions/:id e GET /providers/:providerId/wagering/transactions/:externalId.
 * Tem mais campos que WagerSubmissionResult (providerId, kind, referência) — não confundir os dois.
 */
export interface WagerTransaction {
  readonly transactionId: string;
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly walletId: string;
  readonly kind: WagerTransactionKind;
  readonly status: WagerStatus;
  readonly failureCode: string | null;
  readonly referenceExternalTransactionId: string | null;
  readonly balance: Money | null;
}

export type LedgerDirection = 'DEBIT' | 'CREDIT';

/**
 * `createdAt` é string, de propósito: o backend devolve o timestamp do Postgres no formato
 * "2026-10-25 15:13:44.169+00" (confirmado por execução real), não ISO-8601 estrito (sem "T").
 * `new Date(createdAt)` funciona para exibição, mas não trate este campo como ISO-8601 garantido.
 */
export interface LedgerEntry {
  readonly id: string;
  readonly direction: LedgerDirection;
  readonly money: Money;
  readonly balanceBefore: Money;
  readonly balanceAfter: Money;
  readonly createdAt: string;
}

/** GET /wallets/:id/ledger — cursor opaco, nunca recalculado no cliente. */
export interface LedgerPage {
  readonly items: readonly LedgerEntry[];
  readonly nextCursor: string | null;
}

/** POST /wallets/:id/reconciliation. */
export interface Reconciliation {
  readonly walletId: string;
  readonly storedBalance: Money;
  readonly calculatedBalance: Money;
  readonly difference: Money;
  readonly consistent: boolean;
  readonly checkedEntries: number;
}

/**
 * Envelope de erro real de TODOS os endpoints (src/presentation/error-filter.ts), confirmado por
 * execução em 4 cenários diferentes (validação, 404, 409, 503). `code` para erros de ValidationPipe
 * é sempre "HTTP_VALIDATION_ERROR" com `message` genérica ("Bad Request Exception") — o backend não
 * expõe qual campo falhou; é por isso que a validação client-side (Zod) importa tanto quanto a do servidor.
 */
export interface ApiError {
  readonly code: string;
  readonly message: string;
  readonly statusCode: number;
  readonly path: string;
}

export interface HealthLive {
  readonly status: 'ok';
}

/**
 * Só o shape de sucesso tem um formato próprio. A falha (503) não usa o corpo
 * {code:'DEPENDENCY_UNAVAILABLE', status:'not_ready'} que o controller constrói — confirmado por
 * execução real (parando o PostgreSQL de propósito): o ApiErrorFilter sobrescreve com o envelope
 * padrão de erro (ApiError), com statusCode 503. Não existe um "HealthReadyError" separado.
 */
export interface HealthReady {
  readonly status: 'ok';
  readonly dependencies: {
    readonly postgres: 'ok';
    readonly sqs: 'ok';
  };
}
