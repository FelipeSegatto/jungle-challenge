import { ServerCog } from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { useExtendedInstancesHealth } from './health/useExtendedHealth';
import { InstanceHealthCard } from './health/InstanceHealthCard';
import { MetricsPanel } from './metrics/MetricsPanel';
import { ArchitectureDiagram } from './messaging/ArchitectureDiagram';
import { MessagingDemoPanel } from './messaging/MessagingDemoPanel';

/**
 * System Health & Messaging: saúde real das 3 instâncias (Parte A), métricas Prometheus reais por
 * instância (Parte B), diagrama explicativo da arquitetura de mensageria (Parte C) e instruções de
 * demonstração via terminal (Parte D). Nada aqui dispara uma operação financeira — só leituras.
 */
export function SystemHealthMessagingPage() {
  const health = useExtendedInstancesHealth();

  return (
    <div className="space-y-6">
      <section aria-labelledby="health-heading" className="space-y-4">
        <h2 id="health-heading" className="flex items-center gap-2 text-sm font-semibold text-slate-300">
          <ServerCog className="h-4 w-4" aria-hidden="true" />
          Instâncias do backend
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {health.map((entry) => (
            <InstanceHealthCard key={entry.instance} health={entry} />
          ))}
        </div>
      </section>

      <MetricsPanel />
      <ArchitectureDiagram />
      <MessagingDemoPanel />

      <Panel heading="Limitações de observabilidade (honestas)">
        <ul className="list-inside list-disc space-y-1.5 text-xs text-slate-400">
          <li>Métricas são por processo (cada instância tem seu próprio registro em memória) — reiniciar uma instância zera os contadores dela.</li>
          <li>Não existe uma métrica agregada do cluster inteiro: somar os 3 cartões manualmente daria um número aproximado, não oficial — por isso este painel nunca soma.</li>
          <li>Não há série histórica: tudo aqui é o valor cumulativo/instantâneo no momento da consulta, não um gráfico ao longo do tempo.</li>
          <li>Conteúdo da Inbox, da tabela Outbox e da fila DLQ não é consultável via API — só indiretamente, pelos scripts de terminal (Parte D) e pela métrica de outbox lag (Parte B).</li>
          <li>
            Um 503 de dependência indisponível em <code className="font-mono">/health/ready</code> vem com <code className="font-mono">code: &quot;HTTP_VALIDATION_ERROR&quot;</code>{' '}
            — confirmado parando o PostgreSQL de propósito nesta sessão — um detalhe real do backend que pode confundir quem olhar só o campo <code className="font-mono">code</code>.
          </li>
        </ul>
      </Panel>
    </div>
  );
}
