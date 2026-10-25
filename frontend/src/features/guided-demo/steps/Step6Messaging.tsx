import { useEffect } from 'react';
import { Panel } from '@/components/ui/Panel';
import { ArchitectureDiagram } from '@/features/system-health-messaging/messaging/ArchitectureDiagram';
import { MessagingDemoPanel } from '@/features/system-health-messaging/messaging/MessagingDemoPanel';
import type { StepOutcome } from '../steps';

/**
 * Reaproveita os mesmos componentes do módulo System Health & Messaging — nenhum diagrama ou
 * instrução novos aqui. Sempre `inconclusive`: diferente das outras etapas, esta não tem uma
 * chamada HTTP única para provar PASS/FAIL dentro da própria UI — a evidência real exige rodar os
 * scripts de terminal da Parte D, fora do navegador.
 */
export function Step6Messaging({ onOutcome }: { onOutcome: (outcome: StepOutcome) => void }) {
  useEffect(() => {
    onOutcome('inconclusive');
  }, [onOutcome]);

  return (
    <div className="space-y-4">
      <Panel heading="Por que isso importa aqui">
        <p className="text-sm leading-relaxed text-slate-400">
          O mesmo <code className="font-mono text-slate-300">WagerService.process</code> explicado na Etapa 3 também é chamado pelo Consumer
          (Etapa 6) quando a operação chega via SQS em vez de HTTP direto. A fila pode reentregar a mesma mensagem (reentrega por timeout de
          visibilidade, ou retry de uma falha transiente) — é a MESMA idempotência da Etapa 4 que garante que isso não gera um débito duplicado,
          não importa se a requisição chegou duas vezes por HTTP ou duas vezes pela fila.
        </p>
      </Panel>
      <ArchitectureDiagram />
      <MessagingDemoPanel />
    </div>
  );
}
