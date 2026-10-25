import type { ApiInstance, ApiRequestOptions } from '@/lib/api/client';
import type { Wallet } from '@/types/api';
import type { CreateWalletInput } from '@/types/schemas';

/** Assinatura de useInspectedRequest() — injetada em vez de importada, pra api.ts não depender de hooks/React. */
export type InspectedCall = <T>(
  instance: ApiInstance,
  path: string,
  options: ApiRequestOptions & { method: 'GET' | 'POST' },
) => Promise<T>;

/** POST /wallets — src/presentation/controllers.ts (WalletsController.create). */
export function createWallet(
  instance: ApiInstance,
  body: CreateWalletInput,
  call: InspectedCall,
): Promise<Wallet> {
  return call<Wallet>(instance, '/wallets', { method: 'POST', body });
}

/** GET /wallets/:walletId — src/presentation/controllers.ts (WalletsController.get). */
export function getWallet(
  instance: ApiInstance,
  walletId: string,
  call: InspectedCall,
  signal?: AbortSignal,
): Promise<Wallet> {
  return call<Wallet>(instance, `/wallets/${walletId}`, { method: 'GET', signal });
}
