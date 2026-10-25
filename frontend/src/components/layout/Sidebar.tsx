import { Waves, X, Construction } from 'lucide-react';
import { NAV_ITEMS, type ViewId } from '@/app/navigation';
import { focusRing } from '@/lib/ui/styles';

interface SidebarProps {
  active: ViewId;
  onSelect: (view: ViewId) => void;
  /** Controla a versão em drawer, visível só em telas pequenas (ver Header). */
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

function NavList({ active, onSelect }: { active: ViewId; onSelect: (view: ViewId) => void }) {
  return (
    <ul className="flex flex-col gap-0.5" role="list">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const isActive = item.id === active;
        return (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onSelect(item.id)}
              aria-current={isActive ? 'page' : undefined}
              className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors duration-150 ${focusRing} ${
                isActive
                  ? 'bg-emerald-500/10 text-emerald-300 font-medium'
                  : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="flex-1 text-left">{item.label}</span>
              {!item.implemented ? <Construction className="h-3.5 w-3.5 shrink-0 text-slate-600" aria-label="Em construção" /> : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Brand() {
  return (
    <div className="px-3 py-4">
      <p className="flex items-center gap-2 text-sm font-bold text-slate-100">
        <Waves className="h-5 w-5 text-emerald-400" aria-hidden="true" />
        Jungle Wagering Console
      </p>
      <p className="mt-0.5 text-[11px] text-slate-500">Financial Operations &amp; Distributed Systems Lab</p>
    </div>
  );
}

export function Sidebar({ active, onSelect, mobileOpen, onCloseMobile }: SidebarProps) {
  return (
    <>
      {/* Desktop: coluna fixa. */}
      <nav
        aria-label="Navegação principal"
        className="hidden w-60 shrink-0 border-r border-slate-800 bg-slate-950 md:flex md:flex-col"
      >
        <Brand />
        <div className="flex-1 overflow-y-auto px-2">
          <NavList active={active} onSelect={onSelect} />
        </div>
      </nav>

      {/* Mobile: overlay em tela cheia, fechável via Escape/botão/clique fora. */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Fechar navegação"
            onClick={onCloseMobile}
            className="absolute inset-0 bg-slate-950/80"
          />
          <nav
            aria-label="Navegação principal"
            className="relative flex h-full w-72 flex-col bg-slate-950 shadow-xl"
            onKeyDown={(event) => {
              if (event.key === 'Escape') onCloseMobile();
            }}
          >
            <div className="flex items-center justify-between">
              <Brand />
              <button
                type="button"
                onClick={onCloseMobile}
                aria-label="Fechar navegação"
                className={`mr-3 rounded-md p-1.5 text-slate-400 hover:bg-slate-800 ${focusRing}`}
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-2">
              <NavList
                active={active}
                onSelect={(view) => {
                  onSelect(view);
                  onCloseMobile();
                }}
              />
            </div>
          </nav>
        </div>
      ) : null}
    </>
  );
}
