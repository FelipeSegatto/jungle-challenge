import type { LucideIcon } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';

interface PlaceholderPageProps {
  icon: LucideIcon;
  title: string;
  description: string;
}

/**
 * Tela honesta para seções ainda não implementadas (Wallets, Transactions, Ledger &
 * Reconciliation, Distributed Lab) — nunca mostra dado simulado, só avisa o que vem a seguir.
 */
export function PlaceholderPage({ icon, title, description }: PlaceholderPageProps) {
  return (
    <EmptyState
      icon={icon}
      title={`${title} — ainda não implementado`}
      description={description}
    />
  );
}
