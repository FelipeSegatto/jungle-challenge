import type { ReactNode } from 'react';
import { FileCode2, Lightbulb, Target } from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { OutcomeBadge } from './OutcomeBadge';
import type { StepMeta, StepOutcome } from './steps';

/**
 * Casco pedagógico comum às 6 etapas: título + os 3 elementos pedidos (o quê / por quê / código
 * pra explicar) + referências de arquivo + veredito da etapa — o conteúdo interativo de cada etapa
 * entra como children, sem se misturar com o texto fixo do roteiro.
 */
export function StepShell({ meta, outcome, children }: { meta: StepMeta; outcome: StepOutcome; children: ReactNode }) {
  return (
    <div className="space-y-4">
      <Panel
        heading={
          <span className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/15 text-[11px] font-semibold text-emerald-300">
              {meta.order}
            </span>
            {meta.title}
          </span>
        }
        actions={<OutcomeBadge outcome={outcome} />}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-400">
              <Target className="h-3.5 w-3.5" aria-hidden="true" />O que será demonstrado
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">{meta.what}</p>
          </div>
          <div>
            <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-400">
              <Lightbulb className="h-3.5 w-3.5" aria-hidden="true" />
              Por que importa
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">{meta.why}</p>
          </div>
          <div>
            <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-400">
              <FileCode2 className="h-3.5 w-3.5" aria-hidden="true" />
              Código para explicar
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">{meta.codeToExplain}</p>
            <ul className="mt-1.5 space-y-0.5">
              {meta.files.map((file) => (
                <li key={file} className="font-mono text-[11px] text-slate-600">
                  {file}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Panel>

      {children}
    </div>
  );
}
