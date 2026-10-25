# Guia de leitura e estudos

Este guia é para quem vai estudar o projeto sozinho antes de uma entrevista — não para quem só quer rodar a aplicação (isso está no [README](../README.md#como-executar-localmente)).

A ideia é abrir o VS Code e seguir cada tema abrindo o arquivo indicado, achando o método, e tentando responder a pergunta antes de olhar a resposta no código.

## Trilha sugerida

### 1. Problema de negócio

**Entenda:** o que é um provedor de jogo, o que é uma rodada, por que `BET`/`WIN`/`LOSS`/`REFUND`/`ROLLBACK` são os únicos tipos de operação, e por que "at-least-once" muda tudo.

**Abra:** `challenge.md` (seções 1 a 3).

**Pergunta que você precisa saber responder:** por que o desafio diz explicitamente que não está avaliando CRUD?

### 2. Estrutura do projeto

**Entenda:** a separação em `domain` / `application` / `infrastructure` / `presentation`, e por que ela existe.

**Abra:** a árvore de `src/` no [README](../README.md#estrutura-do-projeto).

**Exercício:** sem abrir `services.ts`, tente adivinhar em qual pasta estaria a regra "BET sem saldo suficiente é rejeitada". Depois confirme.

**Pergunta:** se você precisasse trocar o MikroORM por outro ORM, quantos arquivos de `src/domain/` teriam que mudar?

### 3. TypeScript e NestJS

**Entenda:** decorators (`@Injectable`, `@Controller`, `@Entity`), injeção de dependência, DTOs com `class-validator`, e por que `tsconfig.json` tem `"strict": true`.

**Abra:** `src/app.module.ts`, `src/presentation/dtos.ts`, `tsconfig.json`.

**Pergunta:** o que o `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })` em `main.ts` faz com um campo que não existe no DTO?

### 4. Money e Wallet

**Entenda:** por que `number` não serve para dinheiro, como `Decimal` resolve isso, e como `Wallet` impede saldo negativo.

**Abra:** `src/domain/money.ts`, `src/domain/wallet.ts`.

**Localize:** `Money.from()` (a regex de validação), `Wallet.debit()` (a ordem das três checagens).

**Execute:** `bun run test` e leia `test/money.test.ts` — em especial o teste `0.10 + 0.20 = 0.30 sem float`.

**Pergunta:** por que `Money.negate()` não valida a entrada da mesma forma que `Money.from()`?

### 5. Ledger

**Entenda:** a diferença entre saldo materializado (`wallets.balance`) e o histórico auditável (`wallet_ledger_entries`).

**Abra:** `src/domain/ledger.ts`.

**Localize:** a checagem dentro de `WalletLedgerEntry.create()` que recusa um lançamento com aritmética errada.

**Pergunta:** por que a validação de `balanceBefore ± money === balanceAfter` está na factory, e não num método separado que você chamaria depois de criar o objeto?

### 6. Operações financeiras

**Entenda:** o que cada `kind` faz, quando gera lançamento, e as regras de referência de `REFUND`/`ROLLBACK`.

**Abra:** `src/domain/wager.ts` (em especial `ledgerDirectionFor()`) e a tabela em [README § Operações de negócio](../README.md#operações-de-negócio).

**Pergunta:** por que uma `WIN` de R$ 50 pode referenciar uma `BET` de R$ 10 sem erro, mas um `REFUND` de R$ 50 sobre a mesma `BET` seria rejeitado?

### 7. PostgreSQL e transações

**Entenda:** atomicidade, `CHECK`, `UNIQUE`, triggers de imutabilidade, e a diferença entre `flush()` e commit.

**Abra:** `src/infrastructure/migrations/Migration202610230001.ts` e `Migration202610240002.ts`.

**Localize:** o trigger `prevent_ledger_mutation` e o índice único parcial `wagers_one_reversal_per_kind`.

**Execute:** `bun run test:integration` e leia o teste "trigger no PostgreSQL impede adulteração do ledger".

**Pergunta:** o que acontece se o código da aplicação tiver um bug e tentar fazer `UPDATE` direto numa linha de `wallet_ledger_entries`?

### 8. Idempotência

**Entenda:** `Idempotency-Key`, hash canônico, replay vs. conflito, e por que a ordem das validações importa.

**Abra:** `src/domain/hash.ts`, e em `src/application/services.ts` o método `resolveByIdempotencyKey`.

**Execute:** `bun run test` (leia `test/hash.test.ts`) e `bun run test:integration` (leia os 5 testes da seção "IDEMPOTÊNCIA").

**Pergunta:** por que o pre-check de idempotência precisa rodar antes do `em.findOne(WalletRow, ...)`, e não depois?

### 9. Concorrência

**Entenda:** lost update, pessimistic locking, por que a unidade de lock é a wallet e não uma tabela inteira.

**Abra:** em `services.ts`, a linha com `LockMode.PESSIMISTIC_WRITE`.

**Execute:** `bun run test:race` (um único processo, mas concorrência real via `Promise.all` de requisições HTTP) e, se tiver tempo, suba o `docker-compose.yml` e rode `bun run test:3instances`.

**Pergunta:** por que um `Mutex` do Node.js não resolveria esse problema com 3 instâncias da API rodando?

### 10. SQS, Inbox e Outbox

**Entenda:** at-least-once, por que Inbox e Outbox são conceitos diferentes de idempotência financeira, e por que não se pode publicar antes do commit.

**Abra:** `src/infrastructure/workers/consumer.ts`, `outbox.ts`, e a tabela de pontos de falha no [README § SQS, Inbox, Outbox](../README.md#sqs-inbox-outbox-e-recuperação-de-falhas).

**Pergunta:** se o processo cair exatamente entre o `INSERT` na `outbox_messages` e o commit da transação, o que acontece com esse evento?

### 11. Workers e recuperação

**Entenda:** o loop principal do worker, o retry de referências fora de ordem, e o que acontece em `SIGTERM`.

**Abra:** `src/worker-main.ts`, `src/infrastructure/workers/references.ts`.

**Execute:** `bun run test:references` e leia o teste de regressão do `WIN`/`BET` em ambas as ordens.

**Pergunta:** por que a regra de validação de `retryPendingReference()` precisa ser idêntica à de `process()`, em vez de uma versão simplificada?

### 12. Testes

**Entenda:** a diferença entre os testes de unidade (sem banco), integração (HTTP + Postgres reais) e mensageria (+ LocalStack).

**Abra:** a pasta `test/` inteira, por ordem de dependência crescente: `money.test.ts` → `wallet.test.ts` → `hash.test.ts` → `integration.test.ts` → `references.test.ts` → `messaging.test.ts`.

**Pergunta:** por que o desafio considera "testes que substituem completamente Postgres e SQS por mocks" uma falha eliminatória?

### 13. Decisões arquiteturais

**Entenda:** o porquê de cada escolha de stack e as limitações que ela traz.

**Abra:** [README § Decisões arquiteturais](../README.md#decisões-arquiteturais-e-trade-offs) e [ARCHITECTURE.md](../ARCHITECTURE.md).

**Pergunta:** se o volume de operações crescesse 100x amanhã, qual seria o primeiro ponto do sistema a sentir?

---

## Glossário

**ACID** — Atomicidade, Consistência, Isolamento, Durabilidade. As quatro garantias que uma transação de banco relacional oferece; neste projeto, é o que faz saldo, ledger, inbox e outbox serem gravados "tudo ou nada".

**DDD (Domain-Driven Design)** — Abordagem de desenho onde as regras de negócio vivem em classes do domínio (`Money`, `Wallet`, `WagerTransaction`), não espalhadas em controllers ou scripts SQL.

**Aggregate Root** — A entidade que concentra as invariantes de um grupo de dados relacionados e é o único ponto de entrada para modificá-los. `Wallet` é o Aggregate Root deste projeto: toda mudança de saldo passa por `debit()`/`credit()`, nunca por um `UPDATE` direto no campo.

**Value Object** — Um objeto definido pelo seu valor, não por uma identidade; dois `Money` com o mesmo valor e moeda são "iguais", mesmo sendo instâncias diferentes. Imutável por definição.

**DTO (Data Transfer Object)** — Classe que descreve a forma de um payload de entrada/saída e carrega as regras de validação (`class-validator`), sem lógica de negócio.

**ORM (Object-Relational Mapper)** — Camada que traduz entre objetos (classes TypeScript) e linhas de tabela SQL. Aqui, o MikroORM — e é importante notar que a entidade do ORM (`WalletRow`) **não é** a entidade de domínio (`Wallet`): são classes diferentes, com responsabilidades diferentes.

**Migration** — Um arquivo versionado que descreve uma mudança de schema, com um caminho de ida (`up`) e de volta (`down`), para que o banco possa evoluir (e regredir) de forma rastreável.

**Ledger** — Registro histórico e imutável de cada movimento financeiro, usado para reconstruir/auditar o saldo independentemente do valor materializado na wallet.

**Idempotency-Key** — Identificador fornecido pelo cliente (aqui, o provedor de jogo) que torna uma operação segura para repetir: a mesma key com o mesmo payload sempre devolve o mesmo resultado, sem reaplicar o efeito.

**Pessimistic Locking** — Estratégia de concorrência que trava a linha disputada (`SELECT ... FOR UPDATE`) antes de ler, forçando outras transações a esperar — em vez de detectar o conflito depois (optimistic locking).

**Race Condition** — Situação em que o resultado depende da ordem/tempo relativo de execuções concorrentes. O cenário de duas `BET`s de R$ 80 sobre um saldo de R$ 100 é uma race condition proposital, usada para provar que o lock funciona.

**Transactional Inbox** — Padrão onde o registro de "essa mensagem já foi recebida" é gravado na mesma transação do efeito que ela causa, evitando que uma mensagem redundante (redelivery) aplique o efeito duas vezes.

**Transactional Outbox** — Padrão onde o evento a ser publicado é gravado na mesma transação da mudança de estado, e um processo separado publica depois — evitando publicar algo que a transação principal ainda pode desfazer.

**FIFO (First In, First Out)** — Tipo de fila SQS que preserva ordem dentro de um `MessageGroupId` e oferece deduplicação por `MessageDeduplicationId`. Usada aqui como otimização de ordenação, não como garantia final de consistência.

**ACK (Acknowledge)** — Confirmação ao broker de que uma mensagem foi processada e pode ser removida da fila. Neste projeto, o ACK (`DeleteMessageCommand`) só acontece depois que a transação no Postgres já comitou.

**DLQ (Dead Letter Queue)** — Fila separada para onde vão mensagens que não podem (ou não devem) ser reprocessadas automaticamente — erro de negócio permanente, ou esgotamento do limite de tentativas de redelivery.

**Redelivery** — Reentrega de uma mensagem SQS que não foi confirmada (ACK) dentro do `VisibilityTimeout`, ou que teve sua visibilidade alterada manualmente após um erro transitório.

**Backoff** — Estratégia de esperar um intervalo crescente entre tentativas (aqui, exponencial, limitado a 60s) em vez de tentar de novo imediatamente, para dar tempo de uma falha transitória se resolver.
