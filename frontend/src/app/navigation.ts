import {
  LayoutDashboard,
  Wallet,
  ArrowLeftRight,
  BookOpenCheck,
  GitCompareArrows,
  HeartPulse,
  GraduationCap,
  type LucideIcon,
} from 'lucide-react';

export type ViewId = 'overview' | 'guided-demo' | 'wallets' | 'transactions' | 'ledger' | 'distributed-lab' | 'system-health';

export interface NavItem {
  readonly id: ViewId;
  readonly label: string;
  readonly icon: LucideIcon;
  /** false = tela ainda não implementada nesta etapa (ver instruções do usuário). */
  readonly implemented: boolean;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, implemented: true },
  { id: 'guided-demo', label: 'Guided Demo', icon: GraduationCap, implemented: true },
  { id: 'wallets', label: 'Wallets', icon: Wallet, implemented: true },
  { id: 'transactions', label: 'Transactions', icon: ArrowLeftRight, implemented: true },
  { id: 'ledger', label: 'Ledger & Reconciliation', icon: BookOpenCheck, implemented: true },
  { id: 'distributed-lab', label: 'Distributed Lab', icon: GitCompareArrows, implemented: true },
  { id: 'system-health', label: 'System Health', icon: HeartPulse, implemented: true },
];
