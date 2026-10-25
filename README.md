# Distributed Wagering Processor

![Bun](https://img.shields.io/badge/Bun-1.x-f472b6?logo=bun&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)
![NestJS](https://img.shields.io/badge/NestJS-11-e0234e?logo=nestjs&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791?logo=postgresql&logoColor=white)
![MikroORM](https://img.shields.io/badge/MikroORM-7-ff6b6b)
![SQS](https://img.shields.io/badge/AWS%20SQS-LocalStack-ff9900?logo=amazonsqs&logoColor=white)
![Docker Compose](https://img.shields.io/badge/Docker%20Compose-ready-2496ed?logo=docker&logoColor=white)

Desafio técnico da Jungle Gaming: um serviço financeiro que recebe apostas de provedores de jogo (via HTTP e via SQS), aplica o resultado no saldo de uma wallet e mantém um ledger auditável de cada movimentação — permanecendo correto mesmo quando mensagens chegam duplicadas, fora de ordem, ou quando o processo morre no meio do caminho.

Este README documenta o que o código **de fato faz**, não o que o enunciado pedia. Onde há diferença entre os dois, ela está marcada explicitamente nas seções [Limitações](#limitações-e-próximos-passos) e [Decisões arquiteturais](#decisões-arquiteturais-e-trade-offs).

## Índice

- [O que este projeto resolve](#o-que-este-projeto-resolve)
- [Arquitetura](#arquitetura)
- [Como executar localmente](#como-executar-localmente)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Modelagem financeira e domínio](#modelagem-financeira-e-domínio)
- [Operações de negócio](#operações-de-negócio)
- [O caminho completo de uma aposta](#o-caminho-completo-de-uma-aposta)
- [PostgreSQL, ACID e integridade](#postgresql-acid-e-integridade)
- [Concorrência e bloqueios](#concorrência-e-bloqueios)
- [Idempotência](#idempotência)
- [SQS, Inbox, Outbox e recuperação de falhas](#sqs-inbox-outbox-e-recuperação-de-falhas)
- [Referências fora de ordem](#referências-fora-de-ordem)
- [API — endpoints e exemplos](#api--endpoints-e-exemplos)
- [Testes e evidências](#testes-e-evidências)
- [Observabilidade](#observabilidade)
- [Decisões arquiteturais e trade-offs](#decisões-arquiteturais-e-trade-offs)
- [Aprendizados técnicos](#aprendizados-técnicos)
- [Limitações e próximos passos](#limitações-e-próximos-passos)
- [Documentação complementar](#documentação-complementar)

---

## O que este projeto resolve

Um provedor de jogo (um cassino, uma mesa de apostas, um motor de slot) envia operações associadas a uma rodada: `BET` (apostou), `WIN` (ganhou), `LOSS` (perdeu), `REFUND` (o provedor cancelou a aposta) e `ROLLBACK` (uma operação anterior precisa ser desfeita). Cada uma dessas operações move dinheiro de verdade — ou decide não mover, no caso de `LOSS`.

O problema não é CRUD. O enunciado original (`challenge.md`) é explícito sobre isso: a entrega das mensagens é **at-least-once**. Isso significa, na prática, que o sistema precisa continuar correto quando:

- a mesma operação chega duas, três, cinquenta vezes;
- uma `WIN` chega antes da `BET` que ela referencia;
- duas instâncias da API recebem, ao mesmo tempo, duas apostas que disputam o mesmo saldo;
- o processo cai entre o commit no banco e a confirmação da mensagem na fila;
- o PostgreSQL ou o SQS ficam temporariamente fora do ar.

Os riscos financeiros que isso levanta são concretos: duplicar um crédito, duplicar um débito, permitir saldo negativo, perder um evento confirmado, ou publicar um evento de saldo alterado antes de o banco ter realmente confirmado a alteração. Qualquer um desses é, pelos critérios do próprio desafio, uma falha eliminatória — não um bug menor.

**Stack:** Bun 1.x, TypeScript em modo estrito, NestJS 11, PostgreSQL 16, MikroORM 7 (`EntityManager.transactional()`, `LockMode`), AWS SQS via LocalStack, Docker Compose, migrations versionadas e reversíveis.

**O que o sistema garante, hoje, com evidência de execução (não só no papel):**

- Dinheiro nunca é representado como `number`/`float` — sempre `Decimal` (via `decimal.js`) no domínio e `numeric(20,2)` no banco.
- Duas apostas concorrentes sobre o mesmo saldo nunca causam saldo negativo nem lost update — testado com 3 processos HTTP reais, não só dentro do mesmo processo.
- A mesma operação enviada 50 vezes em paralelo produz um único efeito financeiro.
- Toda alteração de saldo tem exatamente um lançamento de ledger correspondente, e o ledger é imutável a nível de banco (trigger, não só convenção de código).
- Inbox, alteração financeira, ledger e Outbox fazem parte da mesma transação SQL — um evento nunca é publicado antes do commit.
- O sistema funciona com múltiplas instâncias da aplicação simultaneamente (é um dos cenários obrigatórios do desafio, e está provado em `scripts/race-three.ts` + `docker-compose.yml`, que já sobe 3 APIs e 2 workers).

O que o sistema **não** garante — e por quê — está detalhado na seção [Limitações](#limitações-e-próximos-passos). Autenticação de provedores, por exemplo, foi deliberadamente deixada como um `NoopAuthGuard` documentado: o próprio desafio diz que isso não entra na nota, e eu preferi gastar o tempo nas garantias financeiras.

---

## Arquitetura

O desenho segue quatro camadas, cada uma com uma responsabilidade e sem depender da de cima:

```mermaid
flowchart LR
    subgraph Provedor
        P1[Provider de jogo]
    end

    subgraph Entrada
        HTTP["POST /wagering/transactions<br/>(WageringController)"]
        SQSIN[("wager-transactions.fifo")]
    end

    subgraph Application["src/application"]
        WS["WagerService.process()"]
        WLS["WalletService.create()"]
    end

    subgraph Domain["src/domain"]
        MNY[Money]
        WAL[Wallet]
        WAG[WagerTransaction]
        LED[WalletLedgerEntry]
    end

    subgraph Infra["src/infrastructure"]
        DB[("PostgreSQL<br/>wallets · wager_transactions<br/>wallet_ledger_entries · inbox · outbox")]
        PUB["publishOutboxBatch()"]
    end

    subgraph Saída
        SQSOUT[("wager-events.fifo")]
    end

    P1 -->|HTTP| HTTP --> WS
    P1 -->|SQS| SQSIN -->|consumeOnce| WS
    P1 --> HTTP2["POST /wallets"] --> WLS
    WS --> MNY
    WS --> WAL
    WS --> WAG
    WS --> LED
    WS -->|1 transação| DB
    WLS -->|1 transação| DB
    DB -->|linhas pendentes, SKIP LOCKED| PUB --> SQSOUT
```

| Camada | Responsabilidade | Arquivos principais | Motivo da separação |
|---|---|---|---|
| **Presentation** | Contrato HTTP: DTOs, validação de entrada, mapeamento de erro para status code, guard de auth (no-op documentado) | `src/presentation/controllers.ts`, `dtos.ts`, `error-filter.ts`, `noop-auth.guard.ts` | O controller não decide regra de negócio — só traduz request/response. Isso é o que permite o consumidor SQS chamar exatamente a mesma lógica sem passar por HTTP. |
| **Application** | Orquestra o caso de uso: abre a transação, resolve idempotência, aciona o domínio, grava outbox | `src/application/services.ts` (`WalletService`, `WagerService`, `QueryService`) | É aqui, e só aqui, que HTTP e SQS se encontram. `WagerService.process()` é chamado por `WageringController` e por `consumeOnce()` com os mesmos argumentos de negócio. |
| **Domain** | Entidades e Value Objects com invariantes encapsuladas: `Money` nunca aceita valor inválido, `Wallet` nunca fica negativa, `WalletLedgerEntry` nunca nasce com aritmética errada | `src/domain/money.ts`, `wallet.ts`, `wager.ts`, `ledger.ts`, `events.ts`, `hash.ts`, `errors.ts` | Essas classes não importam `@mikro-orm` nem `@nestjs`. Uma regra financeira não deveria depender de framework — se eu trocar o ORM, `Money.add()` continua funcionando do mesmo jeito. |
| **Infrastructure** | Persistência (entidades MikroORM, migrations), mensageria (cliente SQS, consumer, publisher de outbox, worker de referências), métricas e logging | `src/infrastructure/entities/rows.ts`, `migrations/`, `sqs/`, `workers/`, `metrics.ts`, `observability/` | Tudo que fala com o mundo externo (banco, fila, relógio do sistema) fica isolado aqui, para que o domínio não precise saber que existe um Postgres do outro lado. |

Por que a regra de negócio não pode ficar concentrada no controller: o controller é o lugar onde o contrato HTTP muda (um header novo, um código de status diferente). A regra financeira — "BET debita, LOSS não move nada, REFUND exige referência" — não deveria mudar só porque o transporte mudou. Prova prática disso: o consumidor SQS (`src/infrastructure/workers/consumer.ts`) não duplica nenhuma regra; ele monta o mesmo DTO e chama `new WagerService(em).process(...)`.

---

## Como executar localmente

### Pré-requisitos

- Docker Desktop (ou Docker Engine + Compose) rodando.
- [Bun](https://bun.sh) 1.x instalado no host, se você quiser rodar testes ou a API fora do container.
- PowerShell (os exemplos abaixo são para Windows; os comandos de `bun`/`docker` funcionam iguais em Bash).

### Opção 1 — Tudo no Docker Compose (mais simples)

```powershell
Copy-Item .env.example .env
bun install
docker compose up -d --build
docker compose ps
```

Isso sobe, conforme definido em `docker-compose.yml`: `postgres` (porta `55432` no host, `5432` dentro da rede), `localstack` (porta `4566`), um serviço `migrate` que roda `bun run migration:up` e sai, três instâncias da API (`api1`, `api2`, `api3`, mapeadas para `3001`, `3002`, `3003`) e dois workers (`worker1`, `worker2`, com métricas em `9091`/`9092`).

```powershell
Invoke-RestMethod http://localhost:3001/health/live
Invoke-RestMethod http://localhost:3001/health/ready
powershell -ExecutionPolicy Bypass -File .\scripts\demo.ps1
```

`health/ready` só responde 200 quando PostgreSQL **e** SQS estão alcançáveis (`src/infrastructure/sqs/health.ts` + uma query `SELECT 1`).

### Opção 2 — API no host, infraestrutura no Docker

Para rodar a API diretamente com Bun no Windows (útil para depurar com breakpoint) e só a infraestrutura em container:

```powershell
Copy-Item .env.example .env
bun install
docker compose up -d postgres localstack
bun run migration:up
bun run queues:init
bun run dev
```

Em outro terminal, o worker (consumer SQS + publisher de outbox + retry de referências):

```powershell
bun run start:worker
```

**Por que isso importa — a diferença entre host e rede Docker:** dentro do `docker-compose.yml`, os serviços se enxergam pelo nome (`postgres`, `localstack`), porque o Compose cria uma rede interna com DNS próprio. É por isso que `.env.docker` (usado pelos containers `api1/2/3` e `worker1/2`) tem `DATABASE_URL=postgresql://jungle:jungle@postgres:5432/jungle_wagering` — `postgres` ali é um hostname que só existe dentro dessa rede.

Quando você roda `bun run dev` direto no Windows, o processo Bun não está dentro dessa rede — ele está no host. Por isso `.env.example` (que você copia para `.env` para rodar fora do Docker) aponta para `DATABASE_URL=postgresql://jungle:jungle@127.0.0.1:55432/jungle_wagering`: `127.0.0.1:55432` é a porta que o `docker-compose.yml` expõe ao host (`"${PG_PORT:-55432}:5432"`), não a porta interna `5432`. Confundir os dois é a causa mais comum de `ECONNREFUSED`/`getaddrinfo ENOTFOUND postgres` ao rodar fora do Docker.

Para simular as 3 instâncias fora do Docker:

```powershell
$env:PORT='3001'; bun run start
# em outros dois terminais: PORT 3002 e 3003
```

Nunca misture os dois modos nas mesmas portas — ou a API do Compose, ou a do host, não as duas ao mesmo tempo.

### Comandos disponíveis (de `package.json`)

| Comando | Faz o quê |
|---|---|
| `bun run dev` | API com watch (`src/main.ts`) |
| `bun run start` | API sem watch |
| `bun run start:worker` | Consumer SQS + publisher de Outbox + retry de referências (`src/worker-main.ts`) |
| `bun run typecheck` | `tsc --noEmit`, TypeScript estrito |
| `bun run migration:up` / `migration:down` / `migration:pending` | Aplica, reverte ou lista migrations via MikroORM CLI |
| `bun run queues:init` | Cria as 3 filas SQS no LocalStack (`scripts/init-queues.ts`) |
| `bun run test` | Testes puros de domínio: `Money`, `Wallet`, `payloadHash` — sem banco |
| `bun run test:integration` | HTTP + PostgreSQL reais (`test/integration.test.ts`) |
| `bun run test:messaging` | PostgreSQL + LocalStack reais: inbox, outbox, DLQ, redelivery (`test/messaging.test.ts`) |
| `bun run test:references` | Referências fora de ordem (`test/references.test.ts`) |
| `bun run test:race` | Script standalone: 2 BETs concorrentes + 50x replay via HTTP (`scripts/race.ts`) |
| `bun run test:3instances` | Mesmo cenário, mas contra 3 processos HTTP independentes (`scripts/race-three.ts`) |
| `bun run test:all` | Roda tudo acima, em sequência (precisa da API e dos containers de pé) |
| `bun run demo:sqs` | Demonstração ponta a ponta via SQS (`scripts/demo-sqs.ts`) |
| `bun run format` / `format:check` | Prettier |

### Troubleshooting

| Sintoma | Causa provável | Solução |
|---|---|---|
| `password authentication failed for user "jungle"` | `.env` com credenciais diferentes das do `docker-compose.yml` (`jungle`/`jungle`), ou um Postgres antigo na porta 5432 do Windows interferindo | Confirme `.env` contra `.env.example`; o Compose já expõe o Postgres em `55432` exatamente para não brigar com um Postgres local na 5432 |
| `getaddrinfo ENOTFOUND postgres` ao rodar `bun run migration:*`/testes do host | `.env` copiado de `.env.docker` em vez de `.env.example` — `postgres` só resolve dentro da rede do Compose | Use `.env.example` como base para rodar fora do Docker (host `127.0.0.1:55432`) |
| `address already in use` nas portas 3000-3003, 55432 ou 4566 | Outro processo (ou uma execução anterior não finalizada) ainda ocupando a porta | `docker compose ps`, ou localizar o processo com `Get-NetTCPConnection -LocalPort <porta>` no PowerShell |
| `bun run migration:pending` lista as duas migrations mesmo após `up` | Rodou contra um banco diferente do que `.env`/`.env.docker` apontam | Confira `DATABASE_URL` — é fácil rodar o CLI contra o banco errado quando se alterna entre os dois modos de execução |
| `/health/ready` sempre 503 | PostgreSQL ou LocalStack ainda não estão de pé, ou as filas não foram criadas | `docker compose ps` (ambos devem estar `healthy`); se for rodar fora do Docker, `bun run queues:init` precisa ter sido executado |
| `TypeError: ... is not a function` vindo do MikroORM | Chamada a um método que não existe na versão instalada (ex.: `em.persistAndFlush`, removido no MikroORM 7) | Ver [Aprendizados técnicos](#aprendizados-técnicos) — esse caso específico já aconteceu neste projeto e foi corrigido em `src/application/services.ts` |
| Erro de tipo do AWS SDK em `AttributeNames` | Nome de campo mudou entre versões do `@aws-sdk/client-sqs`; `ApproximateReceiveCount` migrou para `MessageSystemAttributeNames` | Já corrigido em `src/infrastructure/workers/consumer.ts`; se aparecer de novo após atualizar o SDK, é o mesmo tipo de problema |

---

## Estrutura do projeto

```
jungle-wagering/
├── src/
│   ├── domain/                    # Regras de negócio puras, sem framework
│   │   ├── money.ts               # Value Object Money (decimal.js)
│   │   ├── wallet.ts              # Aggregate Root Wallet
│   │   ├── wager.ts                # WagerTransaction (estados e transições)
│   │   ├── ledger.ts              # WalletLedgerEntry (imutável)
│   │   ├── events.ts              # IntegrationEvent + 4 eventos concretos
│   │   ├── hash.ts                # canonicalJson + payloadHash (idempotência)
│   │   └── errors.ts              # DomainError (code + httpStatus)
│   ├── application/
│   │   └── services.ts            # WalletService, WagerService, QueryService — o caso de uso
│   ├── infrastructure/
│   │   ├── entities/rows.ts        # Entidades MikroORM (WalletRow, WagerRow, LedgerRow, OutboxRow, InboxRow)
│   │   ├── migrations/             # 2 migrations versionadas e reversíveis
│   │   ├── sqs/                    # queues.ts (cliente/filas), health.ts
│   │   ├── workers/                # consumer.ts, outbox.ts, references.ts
│   │   ├── observability/          # request-logger.ts
│   │   └── metrics.ts              # Contadores/gauges/histogramas Prometheus
│   ├── presentation/
│   │   ├── controllers.ts          # WalletsController, WageringController, ProviderTransactionsController, HealthController
│   │   ├── dtos.ts                 # MoneyDto, CreateWalletDto, ProcessWagerDto
│   │   ├── error-filter.ts         # Mapeia DomainError/HttpException/erro de infra para a resposta HTTP
│   │   └── noop-auth.guard.ts      # Ponto de extensão de autenticação (ver seção 2 do desafio)
│   ├── app.module.ts
│   ├── main.ts                     # Bootstrap da API
│   └── worker-main.ts              # Bootstrap do worker (consumer + outbox + referências)
├── test/                           # Unidade, integração, mensageria, referências
├── scripts/                        # race.ts, race-three.ts, demo-sqs.ts, init-queues.ts, demo.ps1
├── docker-compose.yml
├── mikro-orm.config.ts
├── ARCHITECTURE.md
└── challenge.md                    # Enunciado original
```

Alguns arquivos merecem contexto além do nome:

**`src/domain/money.ts`** — É o que é: um Value Object imutável que embrulha um `Decimal` (biblioteca `decimal.js`) e uma moeda ISO-4217. Faz: valida no `Money.from()` que o valor é uma string decimal com exatamente 2 casas, não negativa, sem notação científica (regex `^(0|[1-9]\d{0,17})\.\d{2}$`); toda operação (`add`, `subtract`, `negate`) devolve uma instância nova. Existe porque dinheiro representado como `number` do JavaScript tem erro de arredondamento binário (`0.1 + 0.2 !== 0.3`) — inaceitável quando o "erro de arredondamento" é dinheiro de um jogador. Interage com `Wallet` e `WalletLedgerEntry`, que fazem toda a aritmética financeira através dele, nunca diretamente com números.

**`src/domain/wallet.ts`** — É o Aggregate Root da seção 6.2 do desafio. Faz: `Wallet.open()` cria com `version=1`; `debit()`/`credit()` validam moeda e valor positivo, e `debit()` lança `INSUFFICIENT_BALANCE` se o saldo não cobrir o valor; cada operação que move saldo incrementa `_version`. Existe porque a wallet é a unidade de concorrência do sistema inteiro (seção 8 do desafio) — é nela, e não numa tabela global, que o lock pessimista é tomado. Interage com `WagerService.process()`, que chama `debit()`/`credit()` depois de travar a linha da wallet no banco.

**`src/domain/wager.ts`** — A transação financeira em si (`WagerTransaction`). Faz: nasce em `PENDING` via `create()` (que já valida se `REFUND`/`ROLLBACK` tem referência e se `BET`/`LOSS` não tem); expõe `ledgerDirectionFor()`, que decide se a operação é `DEBIT` ou `CREDIT` olhando o próprio `kind` e, para `ROLLBACK`, o `kind` da transação referenciada; `markProcessed()`/`reject()`/`fail()` são transições que lançam erro se chamadas sobre um estado terminal. Existe para que "isso pode mudar de estado" não seja uma pergunta espalhada por `if`s no serviço de aplicação — é uma pergunta que a própria classe responde (`isTerminal()`). Interage com `WalletLedgerEntry` (para saber a direção do lançamento) e é persistida como `WagerRow`.

**`src/domain/ledger.ts`** — `WalletLedgerEntry`, o lançamento. Faz: `create()` recebe `balanceBefore`, `money`, `direction` e `balanceAfter`, e **recusa** se a conta não fechar (`balanceBefore ± money !== balanceAfter`) — a verificação está na factory, não é opcional. Existe porque o ledger é a fonte de verdade auditável; o saldo da wallet é só um cache dessa soma. Interage com `WagerService`, que cria um lançamento por transação processada que move saldo (nunca para `LOSS`, nunca para rejeitadas).

**`src/application/services.ts`** — O arquivo mais importante do projeto, e o único grande (570+ linhas). `WalletService.create()` abre a wallet e, se o saldo inicial for positivo, cria a transação interna `OPENING` com o lançamento `CREDIT` correspondente, tudo na mesma transação SQL. `WagerService.process()` é o caso de uso compartilhado por HTTP e SQS: valida o payload, calcula o hash de idempotência, resolve a idempotência *antes* de tocar na wallet, trava a linha da wallet, resolve referências pendentes, aplica o débito/crédito, grava a transação, o ledger e os eventos de Outbox — tudo dentro de `em.transactional()`. `WagerService.retryPendingReference()` é o caminho assíncrono equivalente, usado pelo worker de referências. `QueryService` responde as consultas HTTP (`GET /wallets/:id`, ledger paginado por cursor, reconciliação).

**`src/infrastructure/entities/rows.ts`** — As entidades do MikroORM (`WalletRow`, `WagerRow`, `LedgerRow`, `OutboxRow`, `InboxRow`). Importante: **isso não é o domínio**. `WalletRow.balance` é uma `string` mapeada como `numeric(20,2)`; é `services.ts` que converte isso para `Money`/`Wallet` (`Wallet.rehydrate()`) antes de aplicar qualquer regra, e converte de volta antes de persistir. Separar os dois evita que uma decoração do ORM (`@Property`) vire, por acidente, uma regra de negócio.

**Controllers (`presentation/controllers.ts`)** — Tecnicamente finos: cada método extrai o DTO, chama o serviço de aplicação e ajusta o status HTTP (ex.: `WageringController.process` devolve 202 se `PENDING_REFERENCE`, 422 se `REJECTED`, 200 nos demais casos). Nenhuma regra financeira aparece aqui.

**`infrastructure/workers/consumer.ts`** — `consumeOnce()`: lê até 5 mensagens da fila de entrada, valida o envelope e o DTO, chama `WagerService.process()` passando um contexto de Inbox, e só manda `DeleteMessageCommand` (ACK) depois que essa chamada retorna — ou seja, depois que o Postgres já confirmou o commit. Erros de negócio (4xx conhecidos) viram DLQ direto; erros transitórios (5xx, timeout) alteram a visibilidade da mensagem com backoff exponencial e deixam o SQS reentregar.

**`infrastructure/workers/outbox.ts`** — `publishOutboxBatch()`: numa transação curta, seleciona até `batchSize` linhas pendentes mais antigas com `FOR UPDATE SKIP LOCKED` (permite múltiplos publishers sem duplicar reivindicação), tenta publicar cada uma no SQS, marca `publishedAt` nas que deram certo e agenda retry (`attempts`/`nextAttemptAt` com backoff) nas que falharam.

**`infrastructure/workers/references.ts`** — `retryReferences()`: busca `WagerRow`s em `PENDING_REFERENCE` com `nextAttemptAt` vencido e chama `WagerService.retryPendingReference()` para cada uma.

**Migrations (`infrastructure/migrations/`)** — Não são só `CREATE TABLE`. Têm `CHECK`, `UNIQUE`, índices parciais e dois triggers (`prevent_ledger_mutation`, `prevent_wager_terminal_change`) que impedem `UPDATE`/`DELETE` diretamente no banco, não só via código. Mais detalhes na seção [PostgreSQL, ACID e integridade](#postgresql-acid-e-integridade).

---

## Modelagem financeira e domínio

### Money

```typescript
// src/domain/money.ts
export class Money {
  private constructor(private readonly value: Decimal, public readonly currency: string) {}
  static from(props: MoneyProps): Money { /* valida e cria */ }
  add(other: Money): Money { this.sameCurrency(other); return new Money(this.value.plus(other.value), this.currency); }
  subtract(other: Money): Money { /* análogo, com minus */ }
}
```

Dinheiro não é representado com `number` porque `number` é um double de 64 bits (IEEE 754) com precisão binária, não decimal. `0.1 + 0.2` em JavaScript dá `0.30000000000000004`. Multiplicado por milhões de apostas, isso não é um detalhe estético — é dinheiro sumindo ou aparecendo por erro de arredondamento. `Money` usa `Decimal` (`decimal.js`), que faz aritmética decimal exata, e serializa sempre como string com duas casas (`"25.00"`), nunca como float.

Validação (`Money.from`): a regex `^(0|[1-9]\d{0,17})\.\d{2}$` rejeita, de uma vez, string vazia, notação científica (`"1e2"`), mais de duas casas (`"1.001"`), zero à esquerda (`"01.00"`) e qualquer valor negativo no contrato de entrada. `NaN`/`Infinity` nem chegam a passar pela regex, já que ela exige só dígitos e um ponto.

Compatibilidade entre moedas: `add`/`subtract`/`isLessThan` chamam `sameCurrency()`, que lança `CURRENCY_MISMATCH` se as moedas diferirem. O domínio continua multi-moeda — é a camada de aplicação (`WagerService`) que, hoje, só aceita `BRL` (`UNSUPPORTED_CURRENCY` se vier outra), como permitido pelo enunciado para reduzir escopo.

Imutabilidade: toda operação devolve uma instância nova; `negate()` é usado internamente (por exemplo, para inverter um `ROLLBACK`) sem nunca passar pela validação de entrada, porque não é dado de contrato — é um valor já validado sendo invertido.

```typescript
Money.from({ amount: '0.10', currency: 'BRL' }).add(Money.from({ amount: '0.20', currency: 'BRL' }))
// -> { amount: '0.30', currency: 'BRL' }  (não 0.30000000000000004)
```

### Wallet

```typescript
// src/domain/wallet.ts
class Wallet {
  static open(playerId: string, initialBalance: Money, now?: Date): Wallet
  static rehydrate(s: WalletState): Wallet   // reconstrói sem revalidar transições
  debit(money: Money, now?: Date): { before: Money; after: Money }
  credit(money: Money, now?: Date): { before: Money; after: Money }
}
```

Uma wallet é o agregado que guarda, em memória, o saldo de um jogador numa moeda — o espelho em código da linha da tabela `wallets`. `_balance` é um `Money`, não um número; `_version` é um inteiro que começa em 1 e sobe só quando o saldo muda (`LOSS`, por exemplo, nunca incrementa `version`, porque não move saldo).

`debit()`/`credit()` validam, nessa ordem: a moeda do movimento bate com a da wallet (`assertSameCurrency`), o valor é positivo (`assertPositive`), e — só no `debit()` — se o saldo é suficiente. Se não for, lança `DomainError('INSUFFICIENT_BALANCE')`, que a camada de aplicação captura e transforma numa transação `REJECTED`, não num erro 500. **Saldo negativo é estruturalmente impossível aqui**: não existe caminho de código que subtraia sem essa checagem antes.

`version` existe para dar visibilidade de que o saldo mudou (serve também de insumo para auditoria/otimização futura), mas a estratégia de concorrência real do projeto é lock pessimista por linha, não optimistic locking por versão — ver [Concorrência e bloqueios](#concorrência-e-bloqueios).

A diferença entre `Wallet` (domínio) e `WalletRow` (persistência, em `rows.ts`) é proposital: `WalletRow.balance` é uma string de banco; `mapWallet()` em `services.ts` faz a ponte, chamando `Wallet.rehydrate()` com um `Money` já reconstituído. Isso significa que `Wallet.debit()` nunca precisa saber que existe PostgreSQL.

### WagerTransaction

Representa uma operação financeira vinda de um provedor — `BET`, `WIN`, `LOSS`, `REFUND`, `ROLLBACK`, mais o `OPENING` interno. Carrega dois identificadores de proveniência (`providerId` + `externalTransactionId`, o par que o provedor reconhece) e um identificador interno (`id`, UUID gerado aqui). `idempotencyKey` e `payloadHash` vêm do mecanismo de idempotência (próxima seção).

Estados (`WagerStatus`): `PENDING` (só existe em memória, nunca é persistido como tal — por hora que vira linha, já virou `PROCESSED`/`REJECTED`/`PENDING_REFERENCE`), `PENDING_REFERENCE` (aceita, esperando a operação que ela referencia), e os três terminais: `PROCESSED`, `REJECTED`, `FAILED`. Terminal, no código, quer dizer: `isTerminal()` retorna `true`, e `markProcessed()`/`markPendingReference()`/`reject()`/`fail()` chamam `assertOpen()`, que lança `INVALID_TRANSACTION_STATE` se o estado atual já for terminal. No banco, isso é reforçado por um trigger — ver a próxima seção.

`failureCode` é o campo que carrega por que uma rejeição aconteceu (`INSUFFICIENT_BALANCE`, `REFERENCE_AMOUNT_MISMATCH`, `ALREADY_REVERSED`, etc.) — a lista completa está na tabela de operações abaixo e na seção de [API](#api--endpoints-e-exemplos).

### Ledger

O ledger (`wallet_ledger_entries`) existe porque o saldo da wallet, por si só, não é auditável — ele é um número que já "esqueceu" como chegou lá. O ledger é a lista completa, imutável, de cada movimento: direção (`DEBIT`/`CREDIT`), valor, saldo antes e saldo depois.

`WalletLedgerEntry.create()` recusa se a aritmética não fechar:

```typescript
// src/domain/ledger.ts
if (!money.isPositive() || !balanceBefore.add(direction === 'CREDIT' ? money : money.negate()).equals(balanceAfter)) {
  throw new DomainError('LEDGER_NOT_BALANCED', ...);
}
```

Ou seja: não existe jeito de criar um lançamento de ledger "errado" e só descobrir depois — a factory nem deixa o objeto nascer. A reconciliação (`POST /wallets/:id/reconciliation`) é exatamente essa verificação, só que olhando para o histórico inteiro: soma todos os `CREDIT` menos todos os `DEBIT` do ledger e compara com `wallets.balance`. Se não bater, a resposta marca `consistent: false`, loga e incrementa a métrica `wagering_reconciliation_mismatch_total` — a divergência nunca é corrigida silenciosamente.

### Exemplo numérico progressivo

Wallet aberta com R$ 100,00:

| # | Operação | Direção | Lançamento? | Saldo antes | Saldo depois | Status |
|---|---|---|---|---|---|---|
| 1 | `OPENING` 100,00 | CREDIT | sim | — | 100,00 | `PROCESSED` |
| 2 | `BET` 25,00 | DEBIT | sim | 100,00 | 75,00 | `PROCESSED` |
| 3 | `WIN` 40,00 (referencia a BET #2) | CREDIT | sim | 75,00 | 115,00 | `PROCESSED` |
| 4 | `BET` 30,00 | DEBIT | sim | 115,00 | 85,00 | `PROCESSED` |
| 5 | `REFUND` 30,00 (referencia a BET #4) | CREDIT | sim | 85,00 | 115,00 | `PROCESSED` |
| 6 | `ROLLBACK` da WIN #3 | DEBIT (inverso de CREDIT) | sim | 115,00 | 75,00 | `PROCESSED` |
| 7 | `LOSS` 15,00 (outra rodada) | — | **não** | 75,00 | 75,00 | `PROCESSED` |

Dois pontos que esse exemplo deixa explícitos, porque são regra e não acidente:

- No passo #3, a `WIN` vale 40,00 enquanto a `BET` que ela referencia valia 25,00. Isso é válido — o enunciado exige igualdade de valor só para `REFUND`/`ROLLBACK`, nunca para `WIN`. Uma `WIN` paga o prêmio, não devolve a aposta.
- No passo #6, o `ROLLBACK` inverte a `WIN` (que era `CREDIT`), então o `ROLLBACK` em si lança um `DEBIT`. `ledgerDirectionFor()` olha o `kind` da transação **referenciada** para decidir isso, não o `kind` do próprio `ROLLBACK`.

---

## Operações de negócio

| Operação | Direção financeira | Lançamento no ledger | Referência obrigatória | Igualdade de valor exigida com a referência |
|---|---|---|---|---|
| `BET` | DEBIT | 1 | não | — |
| `WIN` | CREDIT | 1 | não (opcional, uma `BET`) | **não** |
| `LOSS` | nenhuma | 0 | não | — |
| `REFUND` | CREDIT | 1 | sim, só `BET` | **sim** |
| `ROLLBACK` | inverso da referência | 1 | sim, `BET`/`WIN`/`REFUND` | **sim** |
| `OPENING` (interno) | CREDIT | 1 | — | — |

**`BET`** — Debita o valor do saldo. Validação: moeda igual à da wallet, valor positivo, saldo suficiente. Se faltar saldo: `reject('INSUFFICIENT_BALANCE')` — transação `REJECTED`, sem lançamento, sem alterar saldo, mas **persistida e consultável** (é auditável, não desaparece). Reenvio (mesma `Idempotency-Key`): devolve o resultado original, sem debitar de novo.

**`WIN`** — Credita o valor. Pode (opcionalmente) referenciar uma `BET` da mesma rodada, mas não precisa ter o mesmo valor — é o prêmio, não um reembolso. Se vier com referência, a referência precisa existir, pertencer ao mesmo `providerId`/`playerId`/`walletId`/moeda/`roundId`, e ser do tipo `BET`; caso contrário, `REJECTED` com `INVALID_REFERENCE_KIND` ou `REFERENCE_SCOPE_MISMATCH`. Se a referência ainda não existir, a `WIN` vira `PENDING_REFERENCE` (ver [Referências fora de ordem](#referências-fora-de-ordem)).

**`LOSS`** — Registra o resultado da rodada sem mover saldo e sem lançamento de ledger (`affectsBalance()` retorna `false` para `LOSS`). Existe para que o histórico da rodada feche (o provedor sabe dizer "essa aposta perdeu") sem o sistema fingir que algo financeiro aconteceu.

**`REFUND`** — Credita de volta o valor **exato** de uma `BET` já `PROCESSED`. Exige `referenceExternalTransactionId`. Uma mesma `BET` só pode ser alvo de um `REFUND` processado (índice único parcial no banco, `wagers_one_reversal_per_kind`, garante isso mesmo sob concorrência). Tentar de novo: `REJECTED`/`ALREADY_REVERSED`.

**`ROLLBACK`** — Desfaz uma `BET`, `WIN` ou `REFUND` já `PROCESSED`, aplicando o movimento inverso ao da referência (reverter um `CREDIT` gera um `DEBIT`, e vice-versa). Também exige referência e também só pode acontecer uma vez por transação referenciada. Se o `ROLLBACK` deixaria o saldo negativo (ex.: reverter uma `WIN` depois que o jogador já gastou o crédito em outra `BET`), a rejeição usa um código **diferente** do de `BET` sem saldo: `REVERSAL_INSUFFICIENT_BALANCE`, não `INSUFFICIENT_BALANCE` — são situações operacionalmente diferentes (uma é "aposta grande demais", a outra é "não dá pra desfazer isso sem deixar a wallet negativa") e o provedor precisa distinguir as duas para decidir o que fazer.

**`OPENING`** — Interno. Só existe quando uma wallet é criada com `initialBalance` positivo (`POST /wallets`). Não pode ser submetido via API nem via fila — não é uma operação que um provedor envia, é um efeito colateral da criação da wallet, registrado como transação e lançamento de ledger para que o histórico comece de algum lugar auditável, em vez de a wallet simplesmente "nascer com saldo do nada".

---

## O caminho completo de uma aposta

Uma `BET` de R$ 25,00, chegando por HTTP ou por SQS, termina exatamente no mesmo lugar: `WagerService.process()` (`src/application/services.ts`).

```mermaid
sequenceDiagram
    participant Prov as Provedor
    participant Ctrl as WageringController
    participant Cons as consumeOnce (SQS)
    participant Svc as WagerService.process
    participant Dom as Domínio
    participant DB as PostgreSQL
    participant Out as outbox_messages

    alt Via HTTP
        Prov->>Ctrl: POST /wagering/transactions + Idempotency-Key
        Ctrl->>Svc: process(dto, key)
    else Via SQS
        Prov->>Cons: mensagem em wager-transactions.fifo
        Cons->>Svc: process(dto, key, contexto de inbox)
    end

    Svc->>Dom: Money.from(money) + validações de forma (moeda, referência exigida/proibida, auto-referência)
    Svc->>Svc: payloadHash(campos de negócio) — exclui header e metadados de transporte

    Svc->>DB: BEGIN (em.transactional)
    Svc->>DB: pre-check da idempotencyKey, SEM lock

    alt key já usada, hash diferente
        DB-->>Svc: WagerRow existente, hash não bate
        Svc-->>Ctrl: 409 IDEMPOTENCY_CONFLICT
    else key já usada, mesmo hash
        DB-->>Svc: WagerRow existente, hash igual
        Svc-->>Ctrl: replay (idempotentReplay=true, saldo histórico)
    else key nova
        Svc->>DB: SELECT wallets ... FOR UPDATE (lock pessimista da linha)
        DB-->>Svc: WalletRow travada
        opt origem SQS
            Svc->>DB: SELECT/INSERT inbox_messages (consumerName+messageId)
        end
        Svc->>DB: 2ª verificação da idempotencyKey (agora com o lock)
        Svc->>Dom: WagerTransaction.create(...)
        Svc->>Dom: wallet.debit(25.00)
        Dom-->>Svc: saldo antes / saldo depois
        Svc->>DB: INSERT wager_transactions (status=PROCESSED)
        Svc->>Dom: WalletLedgerEntry.create(...) — valida a aritmética
        Svc->>DB: UPDATE wallets (saldo, version) + INSERT wallet_ledger_entries
        Svc->>Out: INSERT outbox_messages (WalletBalanceChanged, WagerTransactionProcessed)
        Svc->>DB: COMMIT
        Svc-->>Ctrl: PROCESSED + saldo novo
    end

    alt Via HTTP
        Ctrl-->>Prov: 200 { transactionId, status, balance, idempotentReplay }
    else Via SQS
        Cons->>Cons: DeleteMessageCommand — ACK só depois do commit acima
    end
```

Passo a passo, com arquivo e função:

1. **Entrada** — `WageringController.process` (`presentation/controllers.ts:57`) ou `consumeOnce` (`infrastructure/workers/consumer.ts:42`) montam o mesmo payload e chamam `WagerService.process`.
2. **Validação de forma** — `Money.from(command.money)` e uma sequência de `if`s no início de `process()` (`application/services.ts:135-147`): moeda suportada, valor positivo (exceto `LOSS`), referência exigida/proibida conforme o `kind`, sem auto-referência.
3. **Hash canônico** — `payloadHash()` (`domain/hash.ts`) sobre um objeto com só os campos de negócio — `providerId`, `externalTransactionId`, `walletId`, `playerId`, `roundId`, `gameId`, `kind`, `money`, `referenceExternalTransactionId`. O header `Idempotency-Key` e qualquer metadado de transporte nunca entram no hash.
4. **Pre-check de idempotência** — `resolveByIdempotencyKey()` (`application/services.ts`), chamado **antes** de qualquer validação de wallet. Isso é o que garante que reusar a mesma key com payload diferente dá sempre `409`, mesmo que o segundo payload aponte para uma wallet inexistente ou de outro jogador.
5. **Lock pessimista** — `em.findOne(WalletRow, { id }, { lockMode: LockMode.PESSIMISTIC_WRITE })`. É aqui que duas requisições concorrentes na mesma wallet passam a ser sequenciais.
6. **Inbox (só SQS)** — se a chamada veio da fila, verifica `(consumerName, messageId)` na mesma transação.
7. **2ª verificação de idempotência** — mesmo `resolveByIdempotencyKey()`, agora depois do lock, para fechar a janela de corrida entre o passo 4 e o passo 5.
8. **Domínio** — `WagerTransaction.create()`, resolução de referência (se houver), `wallet.debit()`/`credit()`.
9. **Persistência** — `WagerRow` primeiro (por causa da FK do ledger), depois `LedgerRow` via `WalletLedgerEntry.create()`.
10. **Outbox** — `recordOutbox()` grava o(s) evento(s) de integração na mesma transação. Nenhum `SendMessageCommand` acontece aqui — só depois, por um worker separado.
11. **Commit** — implícito no fim do callback de `em.transactional()`.
12. **Resposta/ACK** — o controller devolve o JSON (e o status certo); o consumer só manda `DeleteMessageCommand` depois que `process()` retornou sem erro, ou seja, depois do commit.

---

## PostgreSQL, ACID e integridade

O PostgreSQL não é só "onde os dados ficam" — ele é a segunda linha de defesa das invariantes, caso o código de aplicação tenha um bug. Isso é literal: as migrations têm `CHECK`, `UNIQUE` e *triggers* que recusam operações inválidas mesmo que alguém escreva um `UPDATE` manual.

**Atomicidade** — Se o saldo foi debitado mas a inserção do ledger falhar (por exemplo, a `CHECK` de aritmética do ledger rejeitar), a transação inteira dá rollback: o `UPDATE` na wallet também é desfeito. Isso é testado de verdade em `test/integration.test.ts` ("rollback SQL preserva wallet quando um lançamento falha") — o teste insere deliberadamente um segundo lançamento duplicado pra violar `UNIQUE(wallet_id, transaction_id)` e confirma que o saldo e a `version` da wallet voltaram ao estado anterior.

**Isolamento e locks** — `LockMode.PESSIMISTIC_WRITE` do MikroORM vira `SELECT ... FOR UPDATE` no Postgres; é isso que serializa duas transações concorrentes na mesma linha (ver próxima seção).

**Constraints relevantes (`src/infrastructure/migrations/Migration202610230001.ts`)**:

```sql
CREATE TABLE wallets (
  ...
  CONSTRAINT wallets_player_currency_uk UNIQUE (player_id, currency),
  CONSTRAINT wallets_amount_nonnegative CHECK (balance >= 0),
  ...
);

CREATE TABLE wager_transactions (
  ...
  idempotency_key text NOT NULL UNIQUE,
  ...
  CONSTRAINT wagers_provider_external_uk UNIQUE (provider_id, external_transaction_id),
  CONSTRAINT wagers_amount_valid CHECK (amount >= 0 AND (kind = 'LOSS' OR amount > 0)),
  CONSTRAINT wagers_ref_required CHECK (kind NOT IN ('REFUND','ROLLBACK') OR reference_external_transaction_id IS NOT NULL)
);

CREATE UNIQUE INDEX wagers_one_reversal_per_kind
  ON wager_transactions(reference_transaction_id, kind)
  WHERE kind IN ('REFUND','ROLLBACK') AND status = 'PROCESSED';

CREATE TABLE wallet_ledger_entries (
  ...
  CONSTRAINT ledger_unique_wager UNIQUE (wallet_id, transaction_id),
  CONSTRAINT ledger_math CHECK(
    (direction='CREDIT' AND balance_after=balance_before+amount)
    OR (direction='DEBIT' AND balance_after=balance_before-amount)
  )
);
```

`wagers_one_reversal_per_kind` é um índice único **parcial**: só existe sobre `REFUND`/`ROLLBACK` `PROCESSED`. Isso garante, a nível de banco, que não dá pra reverter a mesma transação duas vezes pelo mesmo tipo — mesmo que dois `REFUND`s concorrentes passem pela validação em memória ao mesmo tempo, um dos dois `INSERT`s vai falhar com `23505` (unique violation).

`ledger_math` significa que nem um bug em `services.ts` consegue gravar um lançamento com aritmética errada — o banco rejeita o `INSERT` antes de aceitar.

**Triggers de imutabilidade**:

```sql
CREATE FUNCTION prevent_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'LEDGER_IMMUTABLE'; END; $$;
CREATE TRIGGER ledger_immutable BEFORE UPDATE OR DELETE ON wallet_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();

CREATE FUNCTION prevent_wager_terminal_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('PROCESSED','REJECTED','FAILED') THEN
    RAISE EXCEPTION 'WAGER_TERMINAL_IMMUTABLE';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER wager_terminal_immutable BEFORE UPDATE OR DELETE ON wager_transactions
  FOR EACH ROW EXECUTE FUNCTION prevent_wager_terminal_change();
```

Testado em `test/integration.test.ts` ("trigger no PostgreSQL impede adulteração do ledger"): o teste roda um `UPDATE wallet_ledger_entries SET amount=900 ...` direto via SQL e confirma que a query lança erro. Isso é imutabilidade estrutural (seção 6.4 do desafio exige isso), não uma convenção que um `UPDATE` esquecido em algum lugar do código poderia violar.

**Dinheiro como `numeric(20,2)`**, nunca `float`/`double` — reforça no schema a mesma regra que `Money` já aplica no domínio.

**Uma ressalva sobre `flush()` vs commit**: `em.flush()` do MikroORM envia o SQL pendente (`INSERT`/`UPDATE`) para o Postgres, mas **não** faz commit — isso só acontece quando o callback de `em.transactional()` termina sem lançar erro. `services.ts` chama `em.flush()` explicitamente em alguns pontos (ex.: depois de persistir `WalletRow`, antes de persistir o `WagerRow` da `OPENING`) porque uma FK composta depende da linha anterior já existir *na transação*, mesmo sem commit ainda — não porque estivesse "salvando" algo de verdade àquele ponto.

---

## Concorrência e bloqueios

Cenário obrigatório do desafio (seção 8): wallet com R$ 100,00, duas `BET`s de R$ 80,00 chegando ao mesmo tempo, de instâncias diferentes.

```mermaid
sequenceDiagram
    participant A as Instância A
    participant B as Instância B
    participant DB as PostgreSQL (linha da wallet)

    Note over DB: saldo = 100.00

    A->>DB: BEGIN; SELECT ... FOR UPDATE
    B->>DB: BEGIN; SELECT ... FOR UPDATE
    DB-->>A: lock concedido
    Note over B,DB: B fica esperando o lock ser liberado
    A->>A: wallet.debit(80.00) -> ok, saldo 20.00
    A->>DB: UPDATE wallets, INSERT ledger (DEBIT), COMMIT
    DB-->>B: lock liberado; B lê saldo já atualizado (20.00)
    B->>B: wallet.debit(80.00) -> INSUFFICIENT_BALANCE
    B->>DB: INSERT wager_transactions (status=REJECTED), COMMIT
    Note over A,B: resultado: 1 PROCESSED, 1 REJECTED, saldo final 20.00, 1 lançamento DEBIT
```

O problema que isso evita é **lost update**: se as duas instâncias lessem o saldo (100,00), calculassem o resultado em memória (20,00 cada) e escrevessem de volta sem nenhum controle, as duas gravariam 20,00 — quando o correto seria uma delas falhar. "Ler, calcular, escrever" sem lock é exatamente o padrão que o desafio proíbe explicitamente (seção 5).

A solução adotada é **pessimistic locking por linha de wallet** (`LockMode.PESSIMISTIC_WRITE`, que o MikroORM traduz para `SELECT ... FOR UPDATE`). A unidade de concorrência é a wallet — duas apostas em wallets diferentes nunca se bloqueiam entre si, porque pegam locks em linhas diferentes. Isso foi testado com 3 processos HTTP reais e independentes (`scripts/race-three.ts`, rodando contra `api1`/`api2`/`api3` do `docker-compose.yml`), não só dentro do mesmo processo Node — o que é importante, porque um mutex em memória (`Mutex`/`Semaphore` de alguma lib JS) resolveria o problema dentro de **um** processo e falharia completamente com 3 instâncias, já que cada instância teria seu próprio mutex, sem relação com o das outras.

Diferenças entre as estratégias, e por que a escolhida foi essa:

| Estratégia | Onde funciona | Por que não foi a escolha principal aqui |
|---|---|---|
| Mutex em memória | Só dentro de 1 processo | Falso senso de segurança com múltiplas instâncias — é exatamente a "garantia que só funciona com 1 instância" que o desafio lista como falha eliminatória |
| Optimistic locking (campo `version`) | Multi-instância | Sob disputa alta na mesma wallet, geraria muitos retries de `OptimisticLockError`; o projeto usa `version` só como registro de que o saldo mudou, não como mecanismo de controle de corrida |
| Pessimistic locking (`FOR UPDATE`) | Multi-instância, multi-processo | Escolhida — serializa só o necessário (a linha da wallet), sem lock global; custo é mais contenção em uma wallet com volume muito alto de operações simultâneas |
| Constraint SQL (`UNIQUE`, `CHECK`) | Sempre, independente de lock | Usada como **segunda linha de defesa**, não como mecanismo principal — é o que recupera corretamente quando duas transações com a mesma `Idempotency-Key` nova tentam inserir ao mesmo tempo em wallets diferentes (que não compartilham lock) |

Retries limitados (`attempt < 3` em `WagerService.process`) cobrem deadlock (`40P01`) e falha de serialização (`40001`) do Postgres — são erros transitórios de infraestrutura, não de negócio. **Isso não elimina a possibilidade teórica de deadlock** entre transações que travam linhas em ordens diferentes; o projeto reduz a superfície (sempre trava a wallet antes de qualquer outra coisa, nessa ordem), mas não existe uma prova formal disso.

---

## Idempotência

| Conceito | O que é no código |
|---|---|
| `Idempotency-Key` | Header HTTP obrigatório (`presentation/controllers.ts`); é "a fonte da verdade" — comparação de payload é feita contra o que está salvo sob essa key, nunca contra o `externalTransactionId` isoladamente |
| Hash canônico | `payloadHash()` sobre um JSON com chaves ordenadas, só campos de negócio (`domain/hash.ts`) |
| Replay idêntico | Mesma key + mesmo hash → devolve a resposta original, `idempotentReplay: true`, **sem** tocar na wallet |
| Conflito de payload | Mesma key + hash diferente → `409 IDEMPOTENCY_CONFLICT`, sempre, independente de qualquer outra validação |
| Persistência | Coluna `idempotency_key` com `UNIQUE NOT NULL` em `wager_transactions` — não é um `Map` em memória |
| Corrida na mesma key nova | Capturada via `23505` (unique violation) no catch do loop de retry; o processo que perdeu a corrida busca o vencedor numa conexão nova e devolve o resultado dele |

**Cenário 1 — mesma key, mesmo payload.** A segunda chamada nem chega a travar a wallet: o pre-check de `resolveByIdempotencyKey()` encontra a `WagerRow` existente, confere que o hash bate, e devolve a resposta salva (`response_balance_amount`, que é o saldo **no momento em que a transação foi processada pela primeira vez** — não o saldo atual). Testado em `test/integration.test.ts` com 50 requisições idênticas em paralelo: um único `transactionId`, um único débito.

**Cenário 2 — mesma key, payload diferente.** `409 IDEMPOTENCY_CONFLICT`. Isso é verdade mesmo quando o segundo payload, isoladamente, também seria invalido por outro motivo — por exemplo, apontar para uma `walletId` que não existe, ou para uma wallet de outro `playerId`. Antes de uma correção aplicada neste projeto, esse caso vazava `404 WALLET_NOT_FOUND` ou `422 PLAYER_WALLET_MISMATCH` em vez de `409`, porque a validação da wallet rodava antes da checagem de idempotência; hoje o pre-check roda primeiro, exatamente para isso não acontecer (ver [Aprendizados técnicos](#aprendizados-técnicos)). Cobertura: 5 testes em `test/integration.test.ts` (amount, `playerId`, `walletId` válida de outro dono, `walletId` inexistente, e o replay-controle).

**Cenário 3 — a `BET` é confirmada, mas a resposta se perde** (timeout de rede entre o commit e o provedor receber a resposta, por exemplo). O provedor reenvia a mesma requisição, com a mesma key e o mesmo payload. Cai no Cenário 1: devolve o resultado já confirmado, sem debitar de novo. É exatamente esse também o cenário que cobre "o worker SQS cai depois do commit, antes do ACK" — `test/messaging.test.ts` simula isso processando a transação diretamente e só depois publicando a mensagem SQS correspondente; o consumer processa a "redelivery", reconhece pela Inbox e pela `idempotencyKey`, e não gera um segundo débito.

Por que o saldo devolvido no replay pode ser diferente do saldo atual: entre a primeira chamada e o replay, outras operações podem ter acontecido na mesma wallet. O replay devolve o que aconteceu **naquela** transação, não uma fotografia do presente — é por isso que `response_balance_amount` é gravado na própria linha da `wager_transactions`, e não recalculado a cada consulta.

---

## SQS, Inbox, Outbox e recuperação de falhas

```mermaid
flowchart TD
    Prov[Provedor] -->|SendMessage| IN[("wager-transactions.fifo")]
    IN -->|ReceiveMessage, long poll até 20s| W["consumeOnce()"]
    W -->|dedup por consumerName+messageId| INBOX[("inbox_messages")]
    W --> SVC["WagerService.process()"]
    SVC --> DB[("PostgreSQL")]
    DB --> OUTBOX[("outbox_messages")]
    OUTBOX -->|SELECT ... FOR UPDATE SKIP LOCKED, lotes| PUBW["publishOutboxBatch()"]
    PUBW -->|SendMessage| EV[("wager-events.fifo")]
    W -.->|erro permanente: 4xx de negócio| DLQ[("wager-transactions-dlq.fifo")]
    IN -.->|RedrivePolicy: maxReceiveCount=5| DLQ
```

**SQS** — Três filas FIFO (`src/infrastructure/sqs/queues.ts`): `wager-transactions.fifo` (entrada), `wager-transactions-dlq.fifo` (DLQ, com `RedrivePolicy` de 5 tentativas) e `wager-events.fifo` (saída, da Outbox). `MessageGroupId` usa o `walletId` — isso ajuda a ordenação do broker, mas **não é a garantia final**: a correção depende do lock no Postgres, não da ordem de entrega do SQS (seção 8 do desafio é explícita sobre isso). `VisibilityTimeout` de 60s dá tempo pro processamento antes do SQS considerar a mensagem "perdida" e reentregar.

**Inbox** (`inbox_messages`, dedup por `(consumer_name, message_id)`) — É uma coisa diferente de idempotência financeira, mesmo que pareçam a mesma ideia. A Inbox deduplica **entregas da fila** (o mesmo `messageId` chegando de novo por causa de um `ChangeMessageVisibility` ou de um crash); a `idempotency_key` deduplica **a operação de negócio** (que pode ter chegado por HTTP, por SQS, com `messageId`s diferentes em reenvios distintos). As duas são verificadas dentro da mesma transação em `WagerService.process()`.

**Outbox** (`outbox_messages`) — Eventos de integração (`WagerTransactionProcessed`, `WagerTransactionRejected`, `WalletBalanceChanged`, `WagerTransactionPendingReference`) são gravados na **mesma transação SQL** da operação financeira. `publishOutboxBatch()` roda depois, numa transação separada e curta, e só manda pro SQS o que já foi commitado. Isso existe porque publicar durante a operação financeira criaria uma janela onde o evento sai mas a transação pode ainda dar rollback — o desafio proíbe isso explicitamente (seção 5): "não publicar eventos antes do commit da transação financeira".

**DLQ** — Mensagens com erro permanente de negócio conhecido (ex.: JSON malformado, DTO inválido) vão direto pra DLQ, sem consumir as 5 tentativas de redrive. Erros de negócio normais (ex.: `INSUFFICIENT_BALANCE`) **não** vão pra DLQ — são `REJECTED` com ACK, porque é um resultado válido, não uma falha.

**Retry** — Dois backoffs independentes, ambos exponenciais e limitados a 60s: um para a visibilidade da mensagem SQS quando o erro é transitório (`consumer.ts`), outro para a publicação da Outbox quando o `SendMessageCommand` falha (`outbox.ts`, campos `attempts`/`nextAttemptAt`).

| Ponto da falha | O que pode acontecer | Como o sistema recupera | Onde está testado |
|---|---|---|---|
| Processo cai depois do commit, antes do ACK | Mensagem é reentregue | Inbox + `idempotencyKey` reconhecem a redelivery; nenhum novo débito | `test/messaging.test.ts` — "redelivery após commit antes do ACK não duplica débito" |
| `SendMessageCommand` da Outbox falha (fila fora do ar, timeout) | Evento fica pendente | `attempts++`, `nextAttemptAt` com backoff; próximo ciclo do worker tenta de novo | `test/messaging.test.ts` — "outbox recupera de falha transitória de publicação", que força uma falha real (fila inexistente) e prova republicação dentro de um deadline |
| Dois publishers reivindicam a Outbox ao mesmo tempo | Nenhum, se o `SKIP LOCKED` funcionar — cada linha pendente é reivindicada por exatamente um dos dois | `claimed1 + claimed2` bate exatamente com o total pendente no instante da corrida | `test/messaging.test.ts` — "dois publishers concorrentes dividem a outbox sem reivindicar a mesma linha duas vezes" |
| Mensagem publicada duas vezes no SQS (ex.: `publishedAt` não gravado a tempo antes de um crash do worker) | Consumidor externo recebe o evento 2x | `eventId` é estável — o consumidor externo precisa deduplicar por ele; o sistema **não promete exactly-once** | Não há consumidor externo real neste repositório para testar — ver [Limitações](#limitações-e-próximos-passos) |
| Referência (`BET`) ainda não chegou | Operação fica `PENDING_REFERENCE` | Worker de referências reprocessa com backoff até achar ou esgotar tentativas | `test/references.test.ts` |
| Worker encerrado (SIGTERM) | — | O ciclo atual (`publishOutboxBatch` + `retryReferences` + `consumeOnce`) termina antes do loop checar o sinal de novo; mensagens em voo não são cortadas no meio | `src/worker-main.ts` — não há teste automatizado de SIGTERM real neste repositório |
| Tentativas de referência esgotadas | Operação ficaria pendente para sempre | `REJECTED`/`REFERENCE_NOT_FOUND`, evento publicado, permanece auditável (nunca é deletada) | `test/references.test.ts` — "ausência de referência termina em REJECTED e permanece auditável" |

Importante dizer com essas palavras: o sistema entrega mensagens **at-least-once**, nunca exactly-once. A garantia real não é "a mensagem chega uma vez" — é "o efeito financeiro é aplicado uma vez", que é uma coisa diferente e mais forte, resolvida no Postgres (idempotência + lock), não no broker.

---

## Referências fora de ordem

Cenário: uma `WIN` de R$ 50,00 chega referenciando uma `BET` de R$ 10,00 que **ainda não existe** no sistema (pode ter sido enviada antes pelo provedor, mas chegou depois por causa de latência de rede, ordem de workers, etc.).

```mermaid
sequenceDiagram
    participant Prov as Provedor
    participant Svc as WagerService
    participant DB as PostgreSQL
    participant Ref as retryReferences (worker)

    Prov->>Svc: WIN 50.00 (referencia uma BET que ainda não existe)
    Svc->>DB: busca a referência -> não encontrada
    Svc->>DB: status = PENDING_REFERENCE, next_attempt_at = agora + 1s
    Svc-->>Prov: 202 PENDING_REFERENCE (saldo inalterado)

    Prov->>Svc: BET 10.00 (chega depois)
    Svc->>DB: status = PROCESSED

    loop a cada ciclo do worker (src/worker-main.ts)
        Ref->>DB: SELECT ... WHERE status='PENDING_REFERENCE' AND next_attempt_at <= now()
        Ref->>Svc: retryPendingReference(winId)
        Svc->>DB: trava a wallet, trava a WagerRow, busca a BET de novo
        alt referência PROCESSED e regras satisfeitas
            Svc->>DB: aplica o crédito, status = PROCESSED
        else referência ainda ausente ou não PROCESSED
            Svc->>DB: referenceAttempts++, novo nextAttemptAt (backoff exponencial, até 60s)
        else tentativas esgotadas (10 por padrão)
            Svc->>DB: status = REJECTED, failureCode = REFERENCE_NOT_FOUND
        end
    end
```

O registro fica em `PENDING_REFERENCE` com `next_attempt_at` calculado (`Math.min(60000, 1000 * 2 ** tentativas)`), e o worker (`retryReferences()` em `infrastructure/workers/references.ts`, acionado dentro do loop de `worker-main.ts`) busca as linhas vencidas e chama `WagerService.retryPendingReference(id, maxAttempts)`.

Um ponto que foi corrigido neste projeto (e vale explicar, porque é fácil errar): a regra de validação usada no `retryPendingReference()` precisa ser **idêntica** à usada no caminho síncrono (`process()`). Isso inclui, por exemplo, que a exigência de valor igual entre a operação e sua referência só vale para `REFUND`/`ROLLBACK`, nunca para `WIN` — uma `WIN` pode (e normalmente vai) ter um valor diferente do da `BET` que ela referencia. Numa versão anterior, o retry aplicava essa checagem de igualdade de valor **sem essa condição**, então uma `WIN` com valor diferente da `BET` passava normalmente se a `BET` já existisse (caminho síncrono) mas era rejeitada por engano se a `WIN` chegasse primeiro e fosse resolvida depois pelo worker — o mesmo par `WIN`/`BET` dava resultados diferentes dependendo só da ordem de chegada. `test/references.test.ts` tem um teste de regressão permanente para isso ("WIN 50 referenciando BET 10: BET-first e WIN-first/PENDING_REFERENCE terminam PROCESSED com o mesmo resultado financeiro"), justamente para impedir que isso volte a quebrar silenciosamente.

Quando as tentativas se esgotam, a transação vira `REJECTED`/`REFERENCE_NOT_FOUND` — permanece no banco, consultável, com um evento `WagerTransactionRejected` publicado. Nunca é deletada; o desafio exige que ela "permaneça auditável" mesmo nesse caso.

---

## API — endpoints e exemplos

Todos os endpoints abaixo (exceto `/health/*`) passam por `NoopAuthGuard` — hoje, sempre permite (ver [Limitações](#limitações-e-próximos-passos)). O `ValidationPipe` global (`main.ts`) tem `whitelist: true` e `forbidNonWhitelisted: true`: campos fora do DTO são rejeitados com 400, não ignorados silenciosamente.

### Criar wallet

`POST /wallets` — `CreateWalletDto`.

```http
POST /wallets
Content-Type: application/json

{
  "playerId": "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
  "initialBalance": { "amount": "1000.00", "currency": "BRL" }
}
```

```json
{
  "id": "0192f291-27dd-7d3f-8071-5f8685deef37",
  "playerId": "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
  "balance": { "amount": "1000.00", "currency": "BRL" },
  "version": 1
}
```

Status: `201`. Se já existir uma wallet para esse `playerId` + moeda: `409 WALLET_ALREADY_EXISTS`.

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:3001/wallets `
  -ContentType 'application/json' `
  -Body (@{ playerId = [guid]::NewGuid().ToString(); initialBalance = @{ amount = '1000.00'; currency = 'BRL' } } | ConvertTo-Json)
```

### Consultar wallet

`GET /wallets/:walletId` → `{ id, playerId, balance, version }`, ou `404 WALLET_NOT_FOUND`.

### Ledger paginado

`GET /wallets/:walletId/ledger?cursor=...&limit=50` — cursor opaco em base64url sobre `(created_at, id)`, ordenado do mais recente para o mais antigo.

```json
{
  "items": [
    { "id": "...", "direction": "DEBIT", "money": { "amount": "25.00", "currency": "BRL" },
      "balanceBefore": { "amount": "100.00", "currency": "BRL" },
      "balanceAfter": { "amount": "75.00", "currency": "BRL" },
      "createdAt": "2026-07-29T15:00:00.000Z" }
  ],
  "nextCursor": "eyJjcmVhdGVkQXQiOi..."
}
```

### Submeter transação

`POST /wagering/transactions` — header `Idempotency-Key` obrigatório, `ProcessWagerDto`.

```http
POST /wagering/transactions
Content-Type: application/json
Idempotency-Key: provider-a:transaction-123

{
  "providerId": "provider-a",
  "externalTransactionId": "transaction-123",
  "playerId": "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
  "walletId": "0192f291-27dd-7d3f-8071-5f8685deef37",
  "roundId": "round-987",
  "gameId": "fortune-chimp",
  "kind": "BET",
  "money": { "amount": "25.00", "currency": "BRL" }
}
```

```json
{
  "transactionId": "0192f298-345e-7e38-af88-e43f851a819d",
  "status": "PROCESSED",
  "balance": { "amount": "975.00", "currency": "BRL" },
  "failureCode": null,
  "idempotentReplay": false
}
```

Status HTTP devolvido pelo `WageringController`: `200` para `PROCESSED` (incluindo replay), `202` para `PENDING_REFERENCE`, `422` para `REJECTED`. Erros de payload/conflito (`400`, `404`, `409`) vêm do `ApiErrorFilter` antes mesmo de chegar nessa lógica.

```powershell
$key = 'provider-a:' + [guid]::NewGuid()
$body = @{ providerId='provider-a'; externalTransactionId=$key.Split(':')[1]; playerId=$playerId; walletId=$walletId;
           roundId='round-1'; gameId='fortune-chimp'; kind='BET'; money=@{amount='25.00';currency='BRL'} } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://localhost:3001/wagering/transactions `
  -Headers @{ 'Idempotency-Key' = $key } -ContentType 'application/json' -Body $body
```

### Consultar transação

`GET /wagering/transactions/:transactionId` (pelo id interno) e `GET /providers/:providerId/wagering/transactions/:externalTransactionId` (pelo id do provedor).

### Reconciliação

`POST /wallets/:walletId/reconciliation` — sem corpo.

```json
{
  "walletId": "0192f291-27dd-7d3f-8071-5f8685deef37",
  "storedBalance": { "amount": "975.00", "currency": "BRL" },
  "calculatedBalance": { "amount": "975.00", "currency": "BRL" },
  "difference": { "amount": "0.00", "currency": "BRL" },
  "consistent": true,
  "checkedEntries": 42
}
```

### Health

`GET /health/live` (processo vivo, sem dependências), `GET /health/ready` (PostgreSQL + SQS alcançáveis, `503` se não), `GET /health/metrics` (texto Prometheus).

### Códigos de falha usados pelo projeto

Não é uma lista fechada no enunciado, mas é a taxonomia real usada em `DomainError` e nos `failureCode` de `WagerTransaction`:

| Código | Quando aparece | HTTP |
|---|---|---|
| `MISSING_IDEMPOTENCY_KEY` | Header ausente ou vazio | 400 |
| `INVALID_MONEY` / `INVALID_CURRENCY` | `money` malformado | 400 |
| `UNSUPPORTED_CURRENCY` | Moeda diferente de `BRL` | 400 |
| `INVALID_AMOUNT` | Valor não positivo fora de `LOSS` | 400 |
| `REFERENCE_REQUIRED` / `REFERENCE_NOT_ALLOWED` / `SELF_REFERENCE` | Combinação `kind` + referência inválida | 400 |
| `IDEMPOTENCY_CONFLICT` | Mesma key, payload diferente | 409 |
| `EXTERNAL_ID_CONFLICT` | Mesmo `(providerId, externalTransactionId)` com outra key | 409 |
| `WALLET_ALREADY_EXISTS` | Wallet duplicada para `playerId`+moeda | 409 |
| `WALLET_NOT_FOUND` / `TRANSACTION_NOT_FOUND` | Recurso inexistente | 404 |
| `PLAYER_WALLET_MISMATCH` / `CURRENCY_MISMATCH` | Payload não corresponde à wallet | 422 |
| `INSUFFICIENT_BALANCE` | `BET` sem saldo | 422 |
| `REVERSAL_INSUFFICIENT_BALANCE` | `ROLLBACK` deixaria saldo negativo | 422\* |
| `REFERENCE_NOT_PROCESSED` / `REFERENCE_SCOPE_MISMATCH` / `INVALID_REFERENCE_KIND` / `ALREADY_REVERSED` | Referência inválida para `WIN`/`REFUND`/`ROLLBACK` | 422\* |
| `REFERENCE_NOT_FOUND` | Referência nunca apareceu dentro do limite de tentativas | — (sempre assíncrono) |
| `RETRY_LIMIT` | Esgotou os retries de conflito transacional | 503 |

\* Esses `failureCode`s podem ser descobertos em dois momentos diferentes. Se a referência já existir no instante da submissão, a rejeição acontece dentro da própria chamada a `POST /wagering/transactions`, que responde `422` ali mesmo. Se a referência só chegar depois (a operação foi `202 PENDING_REFERENCE` primeiro), quem descobre o problema é o worker de referências (`retryPendingReference()`), e não existe uma resposta HTTP para devolver 422 nesse momento — a transação fica `REJECTED` no banco, e o provedor só vê isso consultando `GET /wagering/transactions/:id` (que sempre responde `200`, com o `status`/`failureCode` no corpo) ou `GET /providers/:providerId/wagering/transactions/:externalTransactionId`. `REFERENCE_NOT_FOUND` só existe nesse segundo caminho — por definição, uma referência ausente na submissão síncrona vira `PENDING_REFERENCE`, nunca `REJECTED` na hora.

---

## Testes e evidências

| Suíte | Comando | O que testa | Risco coberto |
|---|---|---|---|
| Unidade | `bun run test` | `Money` (precisão, validação, moeda), `Wallet` (saldo, versão), `payloadHash` (hash estável e sensível a cada campo de negócio) — sem banco | Regras de domínio isoladas do resto |
| Integração | `bun run test:integration` | HTTP + PostgreSQL reais: OPENING, corrida de 2 BETs, 50x replay, WIN/LOSS/REFUND/ROLLBACK, PENDING_REFERENCE, trigger de imutabilidade, rollback de transação, 5 cenários de conflito de idempotência | Correção financeira de ponta a ponta |
| Mensageria | `bun run test:messaging` | PostgreSQL + LocalStack reais: redelivery sem duplicar, dois publishers concorrentes na Outbox, recuperação de falha real de publicação | Inbox/Outbox/at-least-once |
| Referências | `bun run test:references` | REFUND antes da BET (resolve depois), referência que nunca chega (REJECTED), WIN/BET em ambas as ordens de chegada | Consistência entre caminho síncrono e assíncrono |
| Concorrência (standalone) | `bun run test:race` | 2 BETs de R$ 80 concorrentes + 50x replay, via HTTP real | Cenário obrigatório da seção 8 |
| 3 instâncias (standalone) | `bun run test:3instances` | Mesmo cenário, contra 3 processos independentes (`api1`, `api2`, `api3`) | "Correto só com 1 instância" é falha eliminatória — isso prova que não é o caso |

**Resultados verificados nesta sessão de trabalho**, contra PostgreSQL e LocalStack reais (Docker Compose), não mocks:

```
bun run typecheck         -> limpo (TypeScript estrito, sem any/ts-ignore)
bun run test              -> 16 pass, 0 fail  (Money + Wallet + payloadHash)
bun run test:integration  -> 13 pass, 0 fail  (71 expect() calls)
bun run test:references   ->  3 pass, 0 fail  (19 expect() calls)
bun run test:messaging    ->  3 pass, 0 fail  (22 expect() calls) — repetido 8x em sequência, 0 falhas
bun run test:race         -> PASS (1 debit de 80+80, 1 debit de 50x replay, ledger consistente)
bun run test:3instances   -> PASS (mesmo cenário, 3 processos HTTP reais)
migration up -> down -> down -> up -> pending, em banco descartável -> reversível, sem pendências
```

Esses números não são uma meta de cobertura e não substituem rodar a suíte de novo — são o resultado observado ao rodar os comandos acima neste ambiente, nesta data. Se você clonar o repositório, rode os mesmos comandos antes de confiar neles de novo (os containers do Compose precisam estar de pé com as migrations aplicadas).

Invariante final, válida em todos os testes de integração: **`wallet.balance == saldo reconstruído pelo ledger`** — é literalmente o que `POST /wallets/:id/reconciliation` verifica, e é a asserção que fecha os testes de corrida.

---

## Observabilidade

**Liveness/Readiness** — `GET /health/live` (processo responde) e `GET /health/ready` (Postgres + SQS alcançáveis) são endpoints separados de propósito: um orquestrador (Kubernetes, ECS) reinicia o processo se `live` falhar, mas só para de rotear tráfego se `ready` falhar — são decisões operacionais diferentes.

**Logs estruturados** (`src/infrastructure/observability/request-logger.ts`, interceptor global) — JSON com `correlationId` (do header `x-correlation-id`, ou gerado), `method`, `path`, `statusCode`, `durationMs`, `transactionId`, `walletId`, `providerId`. Nunca loga o corpo da requisição nem o payload financeiro completo — só os identificadores necessários pra correlacionar um incidente.

**Métricas Prometheus** (`src/infrastructure/metrics.ts`, expostas em `GET /health/metrics` e nas portas `9090`/`9091`/`9092` dos workers):

| Métrica | Tipo | Para que serve |
|---|---|---|
| `wagering_transactions_total{status}` | Counter | Volume de operações por status final |
| `wagering_duplicates_total` | Counter | Quantos replays de idempotência aconteceram |
| `wagering_retries_total{kind}` | Counter | Retries de SQS vs. de referência pendente |
| `wagering_dlq_total` | Counter | Mensagens que foram direto pra DLQ |
| `wagering_lock_conflicts_total` | Counter | Deadlocks/serialization failures do Postgres |
| `wagering_processing_seconds` | Histogram | Latência de `WagerService.process()` |
| `wagering_outbox_oldest_seconds` | Gauge | Idade do evento mais antigo ainda não publicado — o "outbox lag" |
| `wagering_reconciliation_mismatch_total` | Counter | Divergências encontradas na reconciliação |

Numa investigação real, essas métricas respondem perguntas concretas: `wagering_outbox_oldest_seconds` alto significa que o publisher não está acompanhando o volume de eventos; `wagering_lock_conflicts_total` subindo significa uma hot wallet específica recebendo operações demais ao mesmo tempo; `wagering_dlq_total` subindo significa provedores enviando payloads inválidos, não um problema do sistema.

---

## Decisões arquiteturais e trade-offs

| Decisão | Alternativa considerada | Por que foi adotada | Limitação |
|---|---|---|---|
| PostgreSQL como fonte de verdade financeira | Cache/materialização em outro armazenamento, SQS como fonte de ordenação | Saldo, ledger, inbox e outbox precisam do mesmo commit atômico — só um banco relacional com transação ACID garante isso de forma direta | Toda escrita financeira passa por uma única instância de banco; escalar horizontalmente a escrita exigiria sharding por wallet, não implementado |
| `decimal.js` + `numeric(20,2)` | `number`/`float` | Precisão decimal exata, exigida pelo enunciado e inegociável para dinheiro | Mais alocação por operação que um float nativo — irrelevante no volume deste desafio |
| Pessimistic locking por wallet | Optimistic locking com retry, mutex em memória | Serializa só a wallet disputada, funciona com N instâncias, sem lock global | Mais contenção numa wallet com volume muito alto de operações simultâneas (hot wallet) |
| NestJS | Express puro, Fastify | Módulo, DI e pipes de validação (`class-validator`) prontos, integra bem com `@mikro-orm/nestjs` | Overhead de decorators/reflection que um framework mais fino não teria |
| MikroORM 7 (`EntityManager.transactional()`, `LockMode`) | TypeORM, Prisma (fora do escopo permitido) | Unit of Work e Identity Map explícitos, `LockMode` de primeira classe para o cenário de concorrência do desafio | API mudou entre versões maiores (ex.: `persistAndFlush` saiu na v7) — ver [Aprendizados técnicos](#aprendizados-técnicos) |
| SQS FIFO | SQS standard, outro broker | `MessageGroupId` por wallet ajuda ordenação; FIFO + LocalStack é o que o enunciado pede | Ordenação do broker é otimização, não garantia — a correção real está no Postgres, redundantemente |
| Inbox transacional | Deduplicação só por atributos do SQS (`MessageDeduplicationId`) | O enunciado proíbe depender só do broker para consistência; a Inbox dá uma dedup auditável e no mesmo commit da operação | Mais uma tabela/índice para manter |
| Outbox transacional + publisher separado | Publicar direto no handler da transação | Publicar antes do commit é proibido pelo enunciado (e é um risco real: a transação pode dar rollback depois do publish) | Lag entre o commit e a publicação real — mitigado, não eliminado, pelo polling do worker |
| Ledger imutável (trigger no banco) | Confiar só em não ter `UPDATE`/`DELETE` no código da aplicação | Convenção de código não é garantia; o enunciado exige imutabilidade estrutural | Qualquer correção legítima de dado (rara, mas existe em operação real) precisaria de um lançamento de ajuste, não de editar o histórico |
| Monólito modular (camadas, não microsserviços) | Separar workers/API em serviços distintos desde já | O domínio é pequeno o suficiente para não justificar a complexidade operacional de múltiplos serviços ainda; a separação já existe em código (`application`/`domain`/`infrastructure`), só não em deploy | Se o volume de mensageria crescer muito mais que o de HTTP, separar o worker em um deploy próprio (já é um processo `start:worker` distinto) seria o próximo passo natural |

---

## Aprendizados técnicos

Alguns problemas só apareceram rodando o projeto de verdade contra Postgres e LocalStack reais — não ficaram visíveis só lendo o código:

**API do MikroORM mudou entre versões maiores.** O código usava `em.persistAndFlush(row)` em três pontos de `services.ts` — um método que existia em versões anteriores do MikroORM e foi removido na v7. Isso não aparece como erro de tipo óbvio em todo contexto, mas quebra em runtime (`TypeError: ... is not a function`) assim que qualquer wallet é criada ou qualquer aposta é processada. A correção foi separar em `em.persist(row); await em.flush();`, que é o padrão atual — e o motivo de existir dois passos (persist registra a entidade no Unit of Work, flush manda o SQL) importa aqui: alguns `INSERT`s precisam acontecer antes de outros por causa de FK composta, mesmo dentro da mesma transação ainda sem commit.

**TypeScript estrito pegou um problema real do SDK da AWS.** `AttributeNames: ['ApproximateReceiveCount']` deixou de compilar porque, na versão instalada do `@aws-sdk/client-sqs`, esse atributo foi reclassificado: atributos de fila (`QueueAttributeName`) e atributos de mensagem (`MessageSystemAttributeName`) viraram campos separados (`AttributeNames` vs. `MessageSystemAttributeNames`) na mesma chamada. Sem `tsc --noEmit` rodando de verdade, esse tipo de mudança de contrato de uma dependência passa batido até alguém notar em produção que o contador de tentativas nunca chega.

**A ordem de validação importa mais do que parece.** A checagem de `Idempotency-Key` precisava rodar antes de qualquer validação que dependesse da wallet (existência, dono, moeda) — senão, reusar a mesma key com um payload que também fosse inválido por outro motivo (`walletId` inexistente, por exemplo) devolvia o código de erro errado (`404`/`422` em vez de `409`), mesmo que o efeito financeiro estivesse protegido corretamente. O comportamento correto e o incorreto diferem só no código HTTP devolvido — fácil de não notar sem testar explicitamente essa combinação.

**Um teste "flaky" pode estar certo sobre o código e errado sobre o ambiente.** O teste de dois publishers concorrentes na Outbox falhava de forma intermitente, e a primeira hipótese (timeout de rede do SQS) era plausível, mas errada. A causa real: o banco de desenvolvimento acumula, entre execuções de toda a suíte, um backlog de eventos não publicados de **outros** arquivos de teste — e `publishOutboxBatch()` sempre reivindica as linhas mais antigas primeiro. Com um backlog grande, as duas linhas novas do teste nunca entravam no lote. A causa raiz só apareceu comparando quantas linhas estavam pendentes no banco com o que o teste esperava — não lendo o código do publisher, que estava correto.

**Reproduzir uma falha de infraestrutura de propósito é diferente de esperar que ela aconteça.** Para testar a recuperação de falha de publicação sem depender de sorte (ou de um mock), a solução foi apontar o publisher para uma fila SQS que deliberadamente não existe — o LocalStack recusa de verdade (`QueueDoesNotExist`), o que exercita o mesmo caminho de código de uma falha real de rede, de forma determinística.

**Lockfile faz parte da reprodutibilidade.** `bun.lock` precisa estar versionado — sem ele, duas máquinas rodando `bun install` em datas diferentes podem resolver versões de dependência (como a do próprio `@aws-sdk/client-sqs`, acima) diferentes uma da outra, e um bug de tipagem que não existia ontem aparece hoje sem nenhuma mudança no código do projeto.

---

## Limitações e próximos passos

**Já implementado** (não é lista de intenção — é o que está no repositório e tem teste passando, conforme a seção anterior):

- Correção financeira sob concorrência real, multi-instância.
- Idempotência persistente com precedência correta sobre validações de wallet.
- Outbox/Inbox transacionais, DLQ, retry com backoff.
- Reprocessamento de referências fora de ordem, consistente entre caminho síncrono e assíncrono.
- Observabilidade mínima (logs estruturados, métricas, liveness/readiness).

**Não implementado, por decisão documentada:**

- **Autenticação de provedores.** `NoopAuthGuard` sempre permite. O enunciado explicitamente não pontua essa parte e autoriza omitir, desde que documentada — o ponto de extensão para um IdP (Keycloak/Zitadel, via OIDC) está isolado no guard, sem autenticação artesanal.

**Evolução futura, não implementada:**

- **Claims com lease na Outbox.** Hoje, `publishOutboxBatch()` mantém o lock de linha durante a chamada de rede ao SQS (curta, mas é I/O dentro de uma transação). Em volume muito maior, um esquema de lease/heartbeat evitaria segurar transações abertas durante I/O externo.
- **Tracing distribuído (OpenTelemetry) e dashboard.** Hoje há métricas Prometheus e `correlationId` nos logs, mas não há um dashboard nem spans distribuídos entre API → worker → consumidor externo.
- **Teste de carga com números reais.** Não há medição de throughput/p95/p99 neste repositório — não declaramos um RPS que não foi medido.
- **Shutdown mais granular do worker.** O loop do worker termina o ciclo atual antes de checar `SIGTERM` de novo, o que evita cortar uma mensagem em processamento, mas não há teste automatizado simulando um `SIGTERM` real durante uma chamada de rede em andamento.
- **`OPENING` passando pela factory de domínio.** Hoje, a transação `OPENING` é montada como um registro direto em `WalletService.create()`, sem passar por `WagerTransaction.create()` — um atalho de implementação para um caminho que é estritamente interno (não alcançável via API/fila), mas que foge, no sentido literal, da regra de modelagem da seção 6.0 do desafio (toda transação nasce pela factory).

---

## Documentação complementar

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — decisões técnicas, trade-offs e o registro detalhado do que foi validado, escrito pra quem avalia.
- **[docs/STUDY_GUIDE.md](docs/STUDY_GUIDE.md)** — trilha de leitura sugerida (arquivo por arquivo, pergunta por pergunta) e glossário dos termos usados neste README.
- **[GUIA_DE_APRESENTACAO.md](GUIA_DE_APRESENTACAO.md)** — roteiro para apresentar o projeto em 10-15 minutos, com as perguntas que um revisor sênior provavelmente vai fazer.
- **[challenge.md](challenge.md)** — o enunciado original do desafio.
