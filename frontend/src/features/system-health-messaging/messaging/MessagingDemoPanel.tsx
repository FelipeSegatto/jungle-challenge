import { Terminal, Info } from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { CopyButton } from '@/components/ui/CopyButton';

interface CommandStep {
  readonly title: string;
  readonly command: string;
  readonly explanation: string;
  readonly script: string;
  /** Saída real de sucesso, capturada executando o comando de verdade nesta sessão — não inventada. */
  readonly expectedOutput: string;
  readonly prerequisite?: string;
}

const STEPS: readonly CommandStep[] = [
  {
    title: '1. Garantir que as filas existem',
    command: 'bun run queues:init',
    explanation:
      'Cria (se ainda não existirem) as 3 filas FIFO no LocalStack: wager-transactions.fifo (entrada), wager-transactions-dlq.fifo (DLQ) e wager-events.fifo (eventos de saída). Imprime as URLs reais das filas.',
    script: 'scripts/init-queues.ts',
    expectedOutput: '{"event":"queues_ready","queues":{"input":"...wager-transactions.fifo","dlq":"...wager-transactions-dlq.fifo","events":"...wager-events.fifo"}}',
  },
  {
    title: '2. Enviar e consumir uma mensagem de verdade',
    command: 'bun run demo:sqs',
    explanation:
      'Cria uma wallet real via HTTP, publica UMA mensagem WagerTransactionRequested diretamente na fila de entrada (sem passar pelo endpoint HTTP de transações), espera o Consumer processá-la e confirma o novo saldo consultando a API. Imprime {"result":"PASS",...} ou lança erro.',
    script: 'scripts/demo-sqs.ts',
    expectedOutput: '{"result":"PASS","walletId":"...","balance":"75.00","via":"SQS"}',
    prerequisite:
      'Exige um worker rodando num terminal separado (bun run start:worker) — sem ele, a mensagem fica na fila e o script falha com "error: SQS_TRANSACTION_NOT_CONFIRMED" (confirmado rodando o comando sem worker nesta sessão). Ter só as 3 instâncias da API no ar não é suficiente.',
  },
  {
    title: '3. Concorrência + idempotência num único processo',
    command: 'bun run test:race',
    explanation:
      'Cria uma wallet com R$ 100,00 e dispara duas BETs concorrentes de R$ 80,00 — espera uma PROCESSED e uma REJECTED — depois reenvia 50x a mesma operação com a mesma Idempotency-Key e confirma 1 único débito.',
    script: 'scripts/race.ts',
    expectedOutput: '{"scenario":"80+80 concurrent, 50x replay",...,"reconciliation":true}\nPASS: 1 debit from 80+80, 1 debit from 50x replay; ledger is consistent.',
  },
  {
    title: '4. O mesmo cenário entre 3 processos independentes',
    command: 'bun run test:3instances',
    explanation:
      'Requer as 3 instâncias já rodando em terminais separados (PORT=3001/3002/3003). Repete o cenário de concorrência e idempotência disparando as chamadas para instâncias diferentes — prova que o lock e a idempotência são garantidos pelo PostgreSQL compartilhado, não por estado em memória de um único processo.',
    script: 'scripts/race-three.ts',
    expectedOutput: '{"result":"PASS","instances":[...],"firstRace":["PROCESSED","REJECTED"],"debitLedgerCount":2,"reconciled":true}',
  },
];

/**
 * Parte D. Não existe endpoint HTTP para inspecionar Inbox/Outbox/DLQ diretamente (nenhuma tabela
 * de infraestrutura é exposta via REST) — por isso esta seção aponta para os scripts reais do
 * repositório em vez de fingir uma consulta que a API não oferece.
 */
export function MessagingDemoPanel() {
  return (
    <Panel heading={<span className="flex items-center gap-2"><Terminal className="h-4 w-4" aria-hidden="true" />Demonstração de SQS (via terminal)</span>}>
      <p className="mb-4 text-xs text-slate-500">
        Estes comandos rodam na raiz do projeto backend (não em <code className="font-mono">frontend/</code>), com PostgreSQL, LocalStack e ao
        menos uma instância da API no ar. Execute-os no seu terminal — o frontend não dispara nada aqui, só documenta como reproduzir.
      </p>

      <div className="space-y-3">
        {STEPS.map((step) => (
          <div key={step.command} className="rounded-md border border-slate-800 bg-slate-950/60 p-3">
            <p className="text-xs font-semibold text-slate-300">{step.title}</p>
            <div className="mt-1.5 flex items-center gap-2 rounded-md border border-slate-800 bg-slate-900 px-3 py-1.5">
              <code className="flex-1 truncate font-mono text-xs text-emerald-300">{step.command}</code>
              <CopyButton value={step.command} label={step.title} />
            </div>
            <p className="mt-1.5 text-[11px] leading-snug text-slate-500">{step.explanation}</p>
            {step.prerequisite ? (
              <p className="mt-1.5 rounded border border-amber-500/30 bg-amber-500/10 p-1.5 text-[11px] leading-snug text-amber-300">
                {step.prerequisite}
              </p>
            ) : null}
            <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">Saída esperada em caso de sucesso</p>
            <pre className="mt-0.5 overflow-x-auto whitespace-pre-wrap break-all rounded bg-slate-950 p-1.5 font-mono text-[10px] text-emerald-400/80">
              {step.expectedOutput}
            </pre>
            <p className="mt-1 font-mono text-[10px] text-slate-700">{step.script}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-md border border-blue-500/30 bg-blue-500/10 p-3">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-blue-300">
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
          Não exposto pela API
        </p>
        <p className="mt-1 text-[11px] leading-snug text-blue-200/80">
          Conteúdo individual da Inbox, da tabela Outbox ou da fila DLQ: não há endpoint HTTP para isso. A evidência real disponível de que o
          pipeline funcionou é: (a) a própria saída PASS/FAIL dos scripts acima no terminal, (b) o saldo da wallet mudando de fato após
          <code className="font-mono"> demo:sqs</code> (confirmável em Wallets), e (c) a métrica <code className="font-mono">wagering_outbox_oldest_seconds</code>{' '}
          na Parte B, como proxy indireto do atraso de publicação do Outbox.
        </p>
      </div>
    </Panel>
  );
}
