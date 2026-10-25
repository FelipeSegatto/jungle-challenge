import { Menu } from 'lucide-react';
import { InstancePicker } from './InstancePicker';
import { focusRing } from '@/lib/ui/styles';

export function Header({ title, onOpenMobileNav }: { title: string; onOpenMobileNav: () => void }) {
  return (
    <header className="flex items-center justify-between gap-3 border-b border-slate-800 bg-slate-950/80 px-4 py-3 backdrop-blur sm:px-6">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onOpenMobileNav}
          aria-label="Abrir navegação"
          className={`rounded-md p-1.5 text-slate-400 hover:bg-slate-800 md:hidden ${focusRing}`}
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>
        <h1 className="text-base font-semibold text-slate-100 sm:text-lg">{title}</h1>
      </div>
      <InstancePicker />
    </header>
  );
}
