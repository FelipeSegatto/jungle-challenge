import { ChevronDown } from 'lucide-react';
import { API_INSTANCES, type ApiInstance } from '@/lib/api/client';
import { useSelectedInstance } from '@/lib/instance/InstanceContext';
import { useExtendedInstancesHealth } from '@/features/system-health-messaging/health/useExtendedHealth';
import { toneClasses } from '@/lib/ui/styles';
import { focusRing } from '@/lib/ui/styles';

/**
 * Indicador de conexão + seletor da instância ativa. `<select>` nativo de propósito — é
 * totalmente acessível por teclado e leitor de tela sem nenhum código extra, e 3 opções não
 * justificam um combobox customizado.
 */
export function InstancePicker() {
  const { selected, setSelected } = useSelectedInstance();
  const instances = useExtendedInstancesHealth();
  const current = instances.find((entry) => entry.instance === selected);
  const tone = current?.ready === 'ok' ? 'success' : current?.ready === 'down' ? 'danger' : 'warning';
  const dotClasses = toneClasses[tone];

  return (
    <div className="flex items-center gap-2">
      <span className={`h-2 w-2 shrink-0 rounded-full ${dotClasses.dot}`} aria-hidden="true" />
      <label htmlFor="instance-picker" className="sr-only">
        Instância da API selecionada
      </label>
      <div className="relative">
        <select
          id="instance-picker"
          value={selected}
          onChange={(event) => setSelected(event.target.value as ApiInstance)}
          className={`appearance-none rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 pr-8 text-sm text-slate-200 hover:bg-slate-800 ${focusRing}`}
        >
          {API_INSTANCES.map((instance) => (
            <option key={instance} value={instance}>
              {instance}
            </option>
          ))}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500"
          aria-hidden="true"
        />
      </div>
    </div>
  );
}
