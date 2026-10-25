import { Workflow } from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { toneClasses, type Tone } from '@/lib/ui/styles';

interface Step {
  readonly label: string;
  readonly detail: string;
  readonly phase: 'input' | 'processing' | 'commit' | 'publish';
}

const STEPS: readonly Step[] = [
  { label: 'Provider', detail: 'Origem externa da aposta (simulada pelos scripts de demonstração)', phase: 'input' },
  { label: 'SQS Input', detail: 'wager-transactions.fifo — fila FIFO, 1 mensagem por walletId em ordem', phase: 'input' },
  { label: 'Consumer', detail: 'src/infrastructure/workers/consumer.ts — faz long-polling da fila', phase: 'input' },
  { label: 'Inbox', detail: 'Registro de deduplicação por (consumerName, messageId) antes de processar', phase: 'processing' },
  { label: 'WagerService', detail: 'src/application/services.ts — valida, aplica idempotência, lock pessimista', phase: 'processing' },
  { label: 'PostgreSQL', detail: 'Commit atômico: wallet + wager + ledger + outbox na mesma transação', phase: 'commit' },
  { label: 'Outbox', detail: 'Eventos gravados na mesma transação do commit — nunca perdidos se a publicação falhar depois', phase: 'commit' },
  { label: 'Publisher', detail: 'src/infrastructure/workers/outbox.ts — lê a tabela outbox e publica', phase: 'publish' },
  { label: 'SQS Events', detail: 'wager-events.fifo — eventos de domínio para quem quiser consumir', phase: 'publish' },
];

const PHASE_LABEL: Record<Step['phase'], string> = {
  input: 'Entrada assíncrona',
  processing: 'Processamento financeiro',
  commit: 'Commit PostgreSQL',
  publish: 'Publicação posterior',
};

const PHASE_TONE: Record<Step['phase'], Tone> = {
  input: 'info',
  processing: 'warning',
  commit: 'success',
  publish: 'info',
};

/**
 * Parte C — diagrama EXPLICATIVO, não um monitor ao vivo: nenhuma caixa aqui reflete estado real
 * em tempo real (isso seria inventar telemetria que a API não expõe por mensagem individual). O
 * fluxo e os arquivos citados são reais (lidos do código), a animação é só didática.
 */
export function ArchitectureDiagram() {
  return (
    <Panel heading={<span className="flex items-center gap-2"><Workflow className="h-4 w-4" aria-hidden="true" />Arquitetura de mensageria (diagrama explicativo)</span>}>
      <p className="mb-4 text-xs text-slate-500">
        Este é um diagrama estático para entender o desenho do sistema — não é um monitor ao vivo. Nenhuma caixa abaixo reflete uma mensagem
        específica em trânsito agora; para evidência real de uma execução, veja a Parte D (demonstração via terminal) e as métricas da Parte B.
      </p>

      <div className="overflow-x-auto pb-2">
        <div className="flex min-w-max items-stretch gap-1.5">
          {STEPS.map((step, index) => {
            const classes = toneClasses[PHASE_TONE[step.phase]];
            return (
              <div key={step.label} className="flex items-stretch gap-1.5">
                <div className={`flex w-56 flex-col justify-between rounded-md border p-2.5 ${classes.border} ${classes.bg}`}>
                  <div>
                    <p className={`text-xs font-semibold ${classes.text}`}>{step.label}</p>
                    <p className="mt-1 break-words text-[11px] leading-snug text-slate-400">{step.detail}</p>
                  </div>
                </div>
                {index < STEPS.length - 1 ? <span className="flex items-center text-slate-600" aria-hidden="true">→</span> : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {(Object.keys(PHASE_LABEL) as Step['phase'][]).map((phase) => {
          const classes = toneClasses[PHASE_TONE[phase]];
          return (
            <span key={phase} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] ${classes.text} ${classes.bg} ${classes.border}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${classes.dot}`} aria-hidden="true" />
              {PHASE_LABEL[phase]}
            </span>
          );
        })}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
          <p className="text-xs font-semibold text-amber-300">Redelivery (reentrega)</p>
          <p className="mt-1 text-[11px] leading-snug text-amber-200/80">
            Se o Consumer falhar ao processar (erro transiente), ele chama <code className="font-mono">ChangeMessageVisibility</code> para
            devolver a mensagem à fila (consumer.ts) em vez de apagá-la — a mesma mensagem pode ser entregue de novo. É por isso que o
            processamento precisa ser idempotente mesmo vindo da fila, não só via HTTP.
          </p>
        </div>
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3">
          <p className="text-xs font-semibold text-red-300">DLQ (Dead Letter Queue)</p>
          <p className="mt-1 text-[11px] leading-snug text-red-200/80">
            Dois caminhos reais e distintos: (1) o Consumer manda direto à <code className="font-mono">wager-transactions-dlq.fifo</code> quando
            reconhece um erro permanente; (2) a própria SQS move automaticamente após 5 tentativas (RedrivePolicy em
            <code className="font-mono"> queues.ts</code>) — só o caminho (1) é contado em <code className="font-mono">wagering_dlq_total</code>
            (Parte B); o caminho (2) não tem evento observável pela API desta aplicação.
          </p>
        </div>
      </div>
    </Panel>
  );
}
