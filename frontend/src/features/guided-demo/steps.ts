export type StepId = 'overview' | 'create-wallet' | 'process-bet' | 'idempotency' | 'concurrency' | 'messaging';
export type StepOutcome = 'pending' | 'pass' | 'fail' | 'inconclusive';

export interface StepMeta {
  readonly id: StepId;
  readonly order: number;
  readonly title: string;
  readonly what: string;
  readonly why: string;
  readonly codeToExplain: string;
  readonly files: readonly string[];
}

/**
 * Conteúdo pedagógico fixo (texto), separado dos componentes interativos de cada etapa — o que
 * muda por execução (saldo, resposta HTTP, veredito) nunca entra aqui, só o roteiro em si.
 */
export const STEPS: readonly StepMeta[] = [
  {
    id: 'overview',
    order: 1,
    title: 'Visão geral',
    what: 'O estado real das 3 instâncias da API (liveness, readiness, dependências) e o problema de negócio que o sistema resolve.',
    why:
      'Antes de mexer em qualquer coisa, o avaliador precisa entender que existem 3 processos independentes atrás de um único PostgreSQL — é a premissa de tudo que vem depois (idempotência e concorrência só fazem sentido nesse contexto).',
    codeToExplain:
      'docker-compose.yml (3 serviços api1/api2/api3 apontando para o mesmo postgres) e src/presentation/controllers.ts::HealthController.',
    files: ['docker-compose.yml', 'src/presentation/controllers.ts'],
  },
  {
    id: 'create-wallet',
    order: 2,
    title: 'Criar wallet',
    what: 'Criação de uma carteira real via POST /wallets, com saldo, versão e o lançamento OPENING correspondente no ledger.',
    why:
      'Mostra que mesmo a abertura de uma wallet é uma transação financeira de verdade (gera um WagerRow de kind OPENING e um lançamento de ledger), não um simples INSERT de cadastro — estabelece o padrão que todas as outras operações seguem.',
    codeToExplain: 'src/application/services.ts (bloco de abertura de wallet, método que cria WagerRow kind=OPENING) e src/domain/wallet.ts::Wallet.open.',
    files: ['src/application/services.ts', 'src/domain/wallet.ts'],
  },
  {
    id: 'process-bet',
    order: 3,
    title: 'Processar BET',
    what: 'Uma aposta válida processada de ponta a ponta: requisição, resposta, novo saldo reconsultado e o lançamento correspondente no ledger.',
    why:
      'É a operação financeira mais básica do domínio — debitar com segurança. O saldo e o lançamento de ledger são escritos na MESMA transação PostgreSQL: se um falhar, os dois revertem (nunca existe saldo sem lançamento ou lançamento sem saldo atualizado).',
    codeToExplain: 'src/application/services.ts::WagerService.process (bloco dentro de em.transactional com lockMode: PESSIMISTIC_WRITE).',
    files: ['src/application/services.ts', 'src/presentation/controllers.ts'],
  },
  {
    id: 'idempotency',
    order: 4,
    title: 'Idempotência',
    what: 'A mesma BET reenviada com a mesma Idempotency-Key — o backend devolve o mesmo transactionId, sem debitar de novo.',
    why:
      'Em sistemas distribuídos, o cliente nunca sabe com certeza se uma resposta se perdeu antes de chegar — ele pode reenviar a mesma requisição por segurança. Sem idempotência persistida (não só em memória), isso causaria débito duplicado de dinheiro real.',
    codeToExplain: 'src/application/services.ts::WagerService.process (verificação por idempotencyKey ANTES de criar uma nova linha, e o payloadHash para detectar conflito).',
    files: ['src/application/services.ts'],
  },
  {
    id: 'concurrency',
    order: 5,
    title: 'Concorrência',
    what: 'Uma wallet isolada com R$ 100,00 recebendo duas apostas concorrentes de R$ 80,00 — só uma pode ser aceita.',
    why:
      'Sem controle de concorrência, as duas requisições poderiam ler o mesmo saldo (R$ 100) antes de qualquer uma debitar, e as duas passariam — deixando o saldo negativo. O lock pessimista por wallet serializa o acesso: a segunda espera a primeira terminar antes de ler o saldo.',
    codeToExplain: 'src/application/services.ts (em.findOne(WalletRow, ..., { lockMode: LockMode.PESSIMISTIC_WRITE })) — note que o lock é por walletId, não um lock global.',
    files: ['src/application/services.ts', 'scripts/race.ts'],
  },
  {
    id: 'messaging',
    order: 6,
    title: 'Mensageria',
    what: 'O fluxo assíncrono Provider → SQS → Consumer → Inbox → WagerService → PostgreSQL → Outbox → Publisher → SQS Events.',
    why:
      'O mesmo WagerService usado no caminho HTTP síncrono também é chamado a partir de mensagens SQS — e mensagens podem chegar duplicadas (reentrega) por garantia da fila. O sistema precisa continuar correto nos dois casos, com a mesma idempotência da Etapa 4.',
    codeToExplain: 'src/infrastructure/workers/consumer.ts (loop de recebimento + ChangeMessageVisibility) e src/infrastructure/workers/outbox.ts (publicação).',
    files: ['src/infrastructure/workers/consumer.ts', 'src/infrastructure/workers/outbox.ts', 'src/infrastructure/sqs/queues.ts'],
  },
];

export const INITIAL_OUTCOMES: Record<StepId, StepOutcome> = {
  overview: 'pending',
  'create-wallet': 'pending',
  'process-bet': 'pending',
  idempotency: 'pending',
  concurrency: 'pending',
  messaging: 'pending',
};
