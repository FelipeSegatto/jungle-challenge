# AULA COMPLETA — DIA 1 | Jungle Gaming

**Tema:** Do zero ao motor financeiro transacional seguro.

**Duração:** aproximadamente 10–12 horas efetivas (não cronometre o tempo de debugging como “estudo passivo”).

**Meta do dia:** quando você enviar duas apostas de R$ 80 em paralelo contra uma carteira de R$ 100, apenas uma será aplicada; 50 repetições da mesma operação não duplicam débito; ledger + saldo concordam, idempotência responde com a informação original.

## Aula 0 — Leia o problema como um engenheiro (30 min)

Antes de abrir o VS Code, escreva estas invariantes em um papel:

1. Nenhum saldo negativo, jamais.
2. Cada movimento de saldo gera exatamente um ledger no mesmo commit.
3. Mensagens duplicadas não movimentam dinheiro duas vezes.
4. Uma aposta rejeitada não modifica carteira nem ledger.
5. Nenhum evento financeiro é publicado antes da confirmação SQL.
6. Uma wallet é bloqueada independentemente de outra; não existe mutex global.
7. As garantias permanecem sob vários processos.

**Pergunta oral:** Por que `Promise.all` com `getBalance()` e `updateBalance()` não é seguro? Porque duas requisições podem ler o mesmo saldo antes que alguma atualize.

**Entendimento esperado:** SQS ordena certas mensagens, mas a garantia final precisa sobreviver inclusive a entrada HTTP e a múltiplos workers, logo está no PostgreSQL.

## Aula 1 — Entender as ferramentas (45 min)

- **Bun:** runtime, gerenciador de pacotes e test runner do desafio.
- **NestJS:** controllers + dependency injection + validação HTTP.
- **MikroORM:** Unit of Work, Entity Manager, identity map, locks e transactions.
- **PostgreSQL:** integridade persistida: constraints, transações, row-level locks.
- **SQS:** broker assíncrono do Dia 2; não deve ser usado como mecanismo de consistência bancária.

**Experimento mental:** O servidor A dá commit, mas morre antes de responder. O servidor B recebe a mesma chave. A resposta deve vir do banco, não da memória do A.

## Aula 2 — Ambiente e o primeiro endpoint (50 min)

Instale Docker e Bun 1.x, abra a pasta raiz e execute:

```bash
cp .env.example .env
bun install
docker compose up -d postgres
docker compose ps
bun run migration:up
bun run dev
```

Em outro terminal:

```bash
curl http://localhost:3000/health/live
curl http://localhost:3000/health/ready
```

**O que observar:** `/health/live` indica processo vivo; `/health/ready` indica se o PostgreSQL está alcançável (SQS entra no Dia 2). Se as migrations falharem, NÃO passe para lógica de aposta.

**Arquivos para abrir:** `package.json`, `docker-compose.yml`, `mikro-orm.config.ts`, `src/main.ts`, `src/app.module.ts`.

**Exercício:** desenhe as ligações `request -> Nest controller -> service -> MikroORM -> PostgreSQL`. Explique a função do DI.

## Aula 3 — Precisão monetária e Money (60 min)

Abra `src/domain/money.ts`.

**Por que não `number`?** JavaScript usa ponto flutuante binário. `0.1 + 0.2` não é exatamente `0.30`. Para finanças, a quantia entra como `"0.10"` e é armazenada como `NUMERIC(20,2)` no SQL. Não converta para `Number` no caminho.

O método `Money.from({ amount:'80.00', currency:'BRL' })` exige decimal string de escala 2, o construtor é privado, soma/subtração criam novas instâncias. `negate()` é uso interno; não habilita saldo negativo de entrada.

```typescript
const total = Money.from({amount:'0.10',currency:'BRL'})
  .add(Money.from({amount:'0.20',currency:'BRL'}));
console.log(total.toJSON()); // { amount:'0.30', currency:'BRL' }
```

**Faça agora:** rode `bun run test`, abra `test/money.test.ts` e explique cada teste. Adicione testes para moeda divergente, `Infinity`, `NaN`, `1e2`, negativo, string vazia, zero e mais de duas casas decimais.

**Pergunta de entrevista:** Por que usamos `DecimalType` no ORM? Porque no banco ele representa `NUMERIC`, e no JS é recuperado como string decimal sem perda de precisão.

## Aula 4 — Wallet, Aggregate Root e Ledger (90 min)

Abra `src/domain/wallet.ts` e `src/domain/ledger.ts`.

- `Wallet.open`: cria id, jogador, moeda, saldo inicial e versão 1.
- `Wallet.rehydrate`: reconstrói dados já salvos, sem refazer transição.
- `debit`: verifica mesma moeda, quantia positiva e saldo suficiente.
- `credit`: verifica moeda e quantia, incrementa versão.
- `WalletLedgerEntry.create`: confere aritmética `before ± amount == after`.

**Exemplo de 100 → 20:** `debit(80)` retorna before `100`, after `20`; o ledger é `DEBIT 80`, moeda `BRL` e balanço correto.

**Exercício:** tente debitar R$ 110 de R$ 100. O domínio deve lançar `INSUFFICIENT_BALANCE` e deixar o saldo inalterado. Faça o mesmo com `Money` em USD.

**Por que ledger imutável?** Em vez de apagar o histórico quando se desfaz uma aposta, registre outra operação compensatória. Assim a auditoria é reprodutível.

## Aula 5 — Banco relacional e constraints (90 min)

Abra `src/infrastructure/migrations/Migration202610230001.ts` e as entidades em `src/infrastructure/entities/rows.ts`.

**Desenhe as tabelas:** `wallets`, `wager_transactions`, `wallet_ledger_entries`, `inbox_messages`, `outbox_messages`.

Localize no SQL:

- `CHECK(balance >= 0)`: banco impede saldo negativo até se houver bug de aplicação.
- `UNIQUE(player_id,currency)`: impede duas carteiras do mesmo jogador e moeda.
- `UNIQUE(idempotency_key)`: impede chave repetida entre processos.
- `UNIQUE(provider_id,external_transaction_id)`: impede ID externo duplicado.
- `UNIQUE(wallet_id,transaction_id)` no ledger: no máximo um lançamento da transação por wallet.
- `ledger_math`: aritmética do lançamento é coerente.
- `ledger_immutable` trigger: nenhum UPDATE/DELETE no ledger.
- `wagers_one_reversal_per_kind`: um estorno por tipo e referência processada.
- FK `(wallet_id,currency)`: moeda da movimentação deve concordar com wallet.

**Experimento SQL:** execute `bun run migration:down` apenas em banco de treino recém-criado; depois `bun run migration:up` e verifique que os objetos voltaram. Jamais faça `down` na base que precisa preservar.

**Pergunta de entrevista:** Por que ter `CHECK` se o TypeScript já valida? Porque a validação pode ser contornada por múltiplas instâncias, scripts SQL, bugs ou versões antigas do serviço.

## Aula 6 — OPENING e primeiro fluxo HTTP (60 min)

Abra `WalletService.create()` em `src/application/services.ts` e `WalletsController` em `src/presentation/controllers.ts`.

1. Receber `POST /wallets` com `playerId` e `initialBalance`.
2. Validar `Money` (MVP BRL).
3. Abrir transação SQL.
4. Inserir wallet com versão 1.
5. Se `initialBalance > 0`, criar operação interna `OPENING PROCESSED`.
6. Criar ledger `CREDIT` de 0.00 para o saldo inicial.
7. Persistir evento(s) na **outbox**.
8. Dar commit e retornar wallet.

**Teste:** crie carteira com R$ 100, consulte `/ledger` e `/reconciliation`. O ledger deve conter um `CREDIT` de R$ 100, e reconciliação deve informar `consistent: true`.

**Pergunta:** Por que `OPENING` não aparece como tipo da API? Porque o enunciado exige operação exclusivamente interna.

## Aula 7 — ProcessWagerUseCase e os cinco tipos (110 min)

Abra `WagerService.process()` em `src/application/services.ts` e `src/domain/wager.ts`.

**Fluxo de execução em transação:**

```text
BODY + Idempotency-Key
    ↓ validação sintática + Money
    ↓ calcula SHA-256(JSON CANÔNICO)
    ↓ em.transactional(async em => ...)
    ↓ SELECT wallet FOR UPDATE
    ↓ key já existe? hash igual => replay; diferente => 409
    ↓ valida player/wallet/moeda/referência
    ↓ BET => debit ou REJECTED
      WIN => credit
      LOSS => PROCESSED sem ledger
      REFUND => credit para BET referenciada
      ROLLBACK => inverso da operação referenciada
    ↓ persiste wager com status
    ↓ persiste wallet+ledger se saldo mudou
    ↓ grava Outbox em tabela
    ↓ commit
    ↓ resposta HTTP
```

**Por que primeiro bloquear wallet?** Se duas apostas disputam o mesmo saldo, apenas uma pode calcular com segurança por vez. O segundo worker recebe o saldo após o commit do primeiro. Enquanto isso, outras wallets continuam livres.

**REFUND/ROLLBACK:** referência por `(providerId,referenceExternalTransactionId)`; deve ser mesma rodada, mesma wallet, jogador e moeda, referência `PROCESSED`, valor igual e não revertida outra vez pelo mesmo tipo.

**LOSS:** não movimenta saldo nem ledger, mas gera evento `WagerTransactionProcessed`.

**PENDING_REFERENCE:** se o estorno chega antes da aposta, registra `PENDING_REFERENCE`, não move dinheiro e gera evento correspondente. O worker de recuperação dessa pendência faz parte do Dia 2.

**Exercício:** `BET(40)` leva 100→60; `WIN(50)` leva 60→110; `LOSS(10)` mantém 110; `REFUND` da BET restaura 150. Justifique cada ledger.

## Aula 8 — Idempotência persistente (75 min)

Abra `src/domain/hash.ts` e a rotina de `WagerService.process()`.

Mesmo header + mesmo payload: devolver mesmo `transactionId` e **o mesmo saldo observado no momento original**. Exemplo: `BET 10` em saldo 100 devolve 90; depois um `WIN 20` deixa 110; repetição da primeira BET ainda devolve snapshot 90 e `idempotentReplay: true`.

Mesmo header + corpo diferente: 409 `IDEMPOTENCY_CONFLICT`, sem mutação.

**Por que a UNIQUE do Postgres importa mesmo após verificar `findOne()`?** Dois processos podem não encontrar registro, ambos tentarem inserir; o índice único serializa o conflito. Após o perdedor dar rollback, ele relê a operação persistida e compara hash.

**Teste:** crie a mesma aposta 50 vezes simultaneamente (`Promise.all` ou múltiplos processos). Deve haver exatamente um débito. Prove olhando o ledger, não apenas as respostas HTTP.

## Aula 9 — Concorrência REAL e demonstração (75 min)

Com API e PostgreSQL rodando, execute:

```bash
bun run test:race
bun run test:integration
```

O script `scripts/race.ts` cria uma wallet de R$100 e tenta duas apostas R$80 em paralelo; espera uma `PROCESSED`, uma `REJECTED`, saldo R$20 e exatamente um ledger de débito. Depois envia 50 requisições duplicadas de R$1 e espera saldo R$19 (somente um débito).

**Não confunda:** `test:race` testa HTTP concorrente em uma instância. Para **múltiplas instâncias**, execute três terminais com o mesmo banco:

```bash
# Terminal 1
PORT=3001 bun run start
# Terminal 2
PORT=3002 bun run start
# Terminal 3
PORT=3003 bun run start
# Terminal 4
bun run test:3instances
```

O script `scripts/race-three.ts` distribui apostas entre três processos distintos, verifica status, wallet, ledger e reconciliação. Execute-o contra PostgreSQL real antes de considerar a concorrência multi-instância comprovada.

**Pergunta de entrevista:** Se o serviço cai depois do commit e antes da resposta, o que ocorre no retry? A chave idempotente já existe; portanto o retry recupera a resposta original. Se a queda for antes do commit, a transação é revertida.

## Aula 10 — Fechamento, auditoria e checkpoint (45 min)

Valide:

- `bun run test` concluído sem falhas.
- `bun run migration:up` executou com sucesso.
- `/health/live` e `/health/ready` estão OK.
- `POST /wallets` gerou OPENING e ledger.
- BET/WIN/LOSS/REFUND/ROLLBACK principais respondem conforme regras.
- Duas apostas R$80 em saldo R$100 não criam saldo negativo.
- Replays idênticos não duplicam débito e preservam resposta original.
- Hash diferente com mesma key gera 409.
- Ledger imutável é protegido pelo banco.
- `/reconciliation` retorna `consistent:true`.
- O código contém outbox persistida no commit, mas **NÃO** publica eventos ainda.
- `git status` não inclui senha de `.env`; versione o lockfile `bun.lock` após `bun install`.

**Definição de pronto do Dia 1:** a parte financeira tem uma primeira implementação verificável com banco real. Não declare o case inteiro pronto: consumer SQS, inbox, publisher, recovery, métricas e três instâncias em Compose ainda precisam ser implementados/testados.

## Apresentação da banca — explique com suas palavras

**Pergunta 1:** Qual a diferença entre idempotência e lock? Idempotência impede repetir a mesma operação; lock evita que duas operações DISTINTAS disputem incorretamente o saldo.

**Pergunta 2:** Qual a diferença entre saldo e ledger? Saldo é a projeção materializada para consultas rápidas; ledger é trilha auditável e reconstruível.

**Pergunta 3:** Por que não apenas `SQS FIFO`? HTTP também envia transações, mensagens são redeliveradas, e a garantia precisa sobreviver entre instâncias; banco com locks/constraints/ACID é a autoridade.

**Pergunta 4:** Por que Outbox? Registrar evento na mesma transação elimina o intervalo em que saldo foi confirmado mas o evento se perdeu permanentemente antes da publicação. Um worker assíncrono publica depois.

**Pergunta 5:** Por que não implementou login neste dia? O case permite documentar a decisão e autenticação não pontua; um `NoopAuthGuard` marca onde se integraria um IdP externo sem desviar esforço da correção financeira.

**Pergunta 6:** O que precisa melhorar antes de produção? Testes 3 instâncias, retries e backoff, consumidores idempotentes, limites de recurso, shutdown gracioso, alarmes, métricas, observabilidade e autenticação real.

## Referências oficiais

- NestJS + MikroORM: https://docs.nestjs.com/recipes/mikroorm
- MikroORM concurrency: https://mikro-orm.io/docs/transactions
- MikroORM mappings (DecimalType): https://mikro-orm.io/docs/custom-types
- MikroORM migrations: https://mikro-orm.io/docs/migrations
- PostgreSQL locking: https://www.postgresql.org/docs/current/explicit-locking.html
- PostgreSQL constraints: https://www.postgresql.org/docs/current/ddl-constraints.html
