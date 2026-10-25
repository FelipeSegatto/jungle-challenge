import type { ApiInstance } from '@/lib/api/client';
import type { InspectedCall } from '@/features/wallets/api';
import type { LedgerPage, Reconciliation } from '@/types/api';

/**
 * GET /wallets/:walletId/ledger — cursor é opaco (base64url sobre created_at+id no backend,
 * src/application/services.ts::QueryService.ledger). Nunca recalculado aqui, só repassado como
 * veio de `nextCursor`.
 */
export function getLedgerPage(
  instance: ApiInstance,
  walletId: string,
  options: { cursor: string | null; limit: number },
  call: InspectedCall,
  signal?: AbortSignal,
): Promise<LedgerPage> {
  const params = new URLSearchParams({ limit: String(options.limit) });
  if (options.cursor) params.set('cursor', options.cursor);
  return call<LedgerPage>(instance, `/wallets/${walletId}/ledger?${params.toString()}`, { method: 'GET', signal });
}

/** POST /wallets/:walletId/reconciliation — sem corpo (confirmado na auditoria). */
export function reconcileWallet(instance: ApiInstance, walletId: string, call: InspectedCall): Promise<Reconciliation> {
  return call<Reconciliation>(instance, `/wallets/${walletId}/reconciliation`, { method: 'POST' });
}
