import { useEffect, useRef, useState } from 'react';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { ToastViewport } from '@/components/ui/ToastViewport';
import { NAV_ITEMS, type ViewId } from './navigation';
import { OverviewPage } from '@/features/overview/OverviewPage';
import { GuidedDemoPage } from '@/features/guided-demo/GuidedDemoPage';
import { SystemHealthMessagingPage } from '@/features/system-health-messaging/SystemHealthMessagingPage';
import { WalletsPage } from '@/features/wallets/WalletsPage';
import { TransactionsPage } from '@/features/transactions/TransactionsPage';
import { LedgerPage } from '@/features/ledger/LedgerPage';
import { IdempotencyLabPage } from '@/features/distributed-lab/idempotency/IdempotencyLabPage';
import { useSelectedInstance } from '@/lib/instance/InstanceContext';
import { useSessionHistory } from '@/lib/session-history/SessionHistoryContext';

function PageContent({ view, onNavigate }: { view: ViewId; onNavigate: (view: ViewId) => void }) {
  switch (view) {
    case 'overview':
      return <OverviewPage onNavigate={onNavigate} />;
    case 'guided-demo':
      return <GuidedDemoPage />;
    case 'system-health':
      return <SystemHealthMessagingPage />;
    case 'wallets':
      return <WalletsPage />;
    case 'transactions':
      return <TransactionsPage onNavigate={onNavigate} />;
    case 'ledger':
      return <LedgerPage onNavigate={onNavigate} />;
    case 'distributed-lab':
      return <IdempotencyLabPage onNavigate={onNavigate} />;
  }
}

export function App() {
  const [activeView, setActiveView] = useState<ViewId>('overview');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { selected } = useSelectedInstance();
  const { logEvent } = useSessionHistory();
  const previousInstanceRef = useRef(selected);

  useEffect(() => {
    if (previousInstanceRef.current !== selected) {
      logEvent(`Instância ativa trocada para ${selected}`);
      previousInstanceRef.current = selected;
    }
  }, [selected, logEvent]);

  const title = NAV_ITEMS.find((item) => item.id === activeView)?.label ?? 'Overview';

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100">
      <Sidebar
        active={activeView}
        onSelect={setActiveView}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header title={title} onOpenMobileNav={() => setMobileNavOpen(true)} />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <PageContent view={activeView} onNavigate={setActiveView} />
        </main>
      </div>
      <ToastViewport />
    </div>
  );
}
