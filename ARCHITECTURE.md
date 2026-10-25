# Decisões de arquitetura — Distributed Wagering Processor

## 1. Objetivo e fronteira do agregado

O fluxo de escrita é centrado na **Wallet**, a unidade de concorrência. Controllers são adaptadores de entrada; `WagerService.process()` é o caso de uso compartilhado por HTTP e SQS. O domínio (`Money`, `Wallet`, `WagerTransaction`, `WalletLedgerEntry`) é independente dos decorators do NestJS e do MikroORM. Adaptadores de banco e de fila estão em `infrastructure`.

Para manter escopo compatível com o desafio, a API aceita apenas **BRL**; `Money` continua multi-moeda e lança erro explícito para misturas de moedas. Autenticação foi intencionalmente postergada, como permitido na seção 2 do case; o `NoopAuthGuard` marca o ponto de integração futura com Keycloak/OIDC. Em produção, o `providerId` precisaria estar vinculado à identidade autenticada do provedor.

## 2. Money e persistência

Os contratos HTTP/SQS usam valores decimais canônicos com **duas casas** como strings, ex. `"25.00"`. `Money` usa `decimal.js` internamente e nunca `number`; operações devolvem instâncias novas. No banco, `numeric(20,2)` e mapeamento `DecimalType` preservam exatidão e retornam strings. Rejeitamos valores negativos no contrato de entrada, notação científica, formatos ambíguos e moeda diferente da wallet.

## 3. Atomicidade e ledger

A criação da wallet com saldo positivo grava wallet, transação `OPENING`, `CREDIT` e Outbox **na mesma transação SQL**. Cada operação financeira efetiva grava `wager_transactions`, alteração da wallet, lançamento de ledger e Outbox juntos. Quando originada por SQS, a gravação da Inbox é feita **no mesmo commit**.

Constraints relevantes:

- `UNIQUE(player_id, currency)` na wallet.
- `CHECK(balance >= 0)` e `CHECK(version >= 1)`.
- `UNIQUE(idempotency_key)` e `UNIQUE(provider_id,external_transaction_id)`.
- FKs compostas para impedir operação de outra carteira/jogador/moeda e para garantir que a entrada do ledger pertence à operação financeira correta.
- `UNIQUE(wallet_id, transaction_id)` no ledger e constraint de aritmética debit/credit.
- Trigger bloqueia `UPDATE`/`DELETE` do ledger; trigger separada proíbe transições a partir de estados terminais de wager.
- Índice parcial de reversões únicas: uma reversão processada de cada tipo para a mesma referência.

Um ledger de partidas dobradas é um diferencial, não obrigatório. Optamos pelo ledger por wallet exigido no desafio e reconciliação pela soma exata de créditos e débitos. Uma divergência é reportada e medida, não corrigida silenciosamente.

## 4. Concorrência por wallet

`WagerService` usa `em.transactional()` com `LockMode.PESSIMISTIC_WRITE` sobre **uma linha** `wallets.id`. Assim, duas operações na mesma carteira são serializadas; carteiras diferentes progridem em paralelo. Não existe mutex global nem dependência da ordenação SQS para correção. As constraints funcionam como segunda linha de defesa contra bugs e conflitos de identidade.

O fluxo de uma BET concorrente R$ 80 + R$ 80 em wallet R$ 100 deve produzir **uma PROCESSED, uma REJECTED, saldo R$ 20 e um DEBIT**. Deadlocks/serialization failures recebem retry limitado. A versão inicia em 1, aumenta somente quando o saldo muda e não substitui o bloqueio.

## 5. Idempotência e replay

O header `Idempotency-Key` é obrigatório na API. `payloadHash` é SHA-256 de JSON canônico (campos financeiros e IDs de negócio, chaves ordenadas; não inclui header/metadados). Chave igual + hash diferente é `409`; chave igual + hash igual retorna **o mesmo transactionId e o saldo observado originalmente** (`response_balance_amount`) com `idempotentReplay: true`.

No SQS, a Inbox usa `UNIQUE(consumer_name,message_id)` e hash da mensagem recebida. Verificação da Inbox e movimentação financeira compartilham a mesma transação. Mesmo que um processo caia depois do commit mas antes do ACK, a segunda entrega é reconhecida sem novo efeito.

## 6. Operações e referências fora de ordem

- `BET` debita; sem saldo é `REJECTED/INSUFFICIENT_BALANCE`.
- `WIN` credita; se referenciar BET, exige escopo compatível.
- `LOSS` registra resultado processado sem ledger e sem incremento de versão.
- `REFUND` credita o total da BET referenciada.
- `ROLLBACK` inverte o movimento de BET, WIN ou REFUND.
- `REFUND` e `ROLLBACK` só processam referências com mesmo provedor, player, wallet, moeda e rodada, mesmo valor e sem duplicação da mesma reversão por tipo.
- `ROLLBACK` que causaria saldo negativo é rejeitado com `REVERSAL_INSUFFICIENT_BALANCE`, distinto do erro de BET.

Referência ausente/não resolvida produz `PENDING_REFERENCE` e o evento correspondente. O retry de referências consulta pendências vencidas e bloqueia primeiro a wallet, depois a própria transação, mantendo a mesma ordenação de lock do caso de uso principal. O worker não cria uma nova transação: atualiza a pendência persistida. A política é até **10 tentativas**, backoff exponencial limitado a 60 segundos; ao esgotar, `REJECTED/REFERENCE_NOT_FOUND` + evento Outbox.

## 7. SQS, tratamento de falhas e DLQ

Utilizamos três filas FIFO: entrada, DLQ e eventos de saída. `MessageGroupId` usa `walletId` para facilitar a ordenação sem ser uma dependência da consistência. Consumer reutiliza `WagerService.process()`. `DeleteMessage` só acontece **depois** de `em.transactional()` confirmar. Rejeições de negócio persistidas são ACK; envelopes irrecuperavelmente inválidos vão à DLQ; infraestrutura transitória provoca retry/backoff de visibilidade e redrive com limite de recebimentos.

O consumer termina mensagens em andamento após SIGTERM quando possível. Se morrer abruptamente, a visibilidade expira e o broker entrega novamente. O resultado é **at-least-once com efeitos financeiros idempotentes**, não a promessa enganosa de entrega exatamente uma vez.

## 8. Transactional Outbox

A Outbox recebe envelopes de `IntegrationEvent` com `eventId`, `eventType`, `version`, `aggregateId`, `correlationId`, `occurredAt` e dados serializáveis. O publisher seleciona registros com `FOR UPDATE SKIP LOCKED` em transações curtas e permite duas ou mais instâncias. Envia somente registros já confirmados pelo PostgreSQL. Em falha de publicação, guarda `attempts` e `nextAttemptAt` para retry exponencial.

Entre `SendMessage` e a gravação de `published_at`, pode haver crash: nesse caso, a publicação pode se repetir. O `MessageDeduplicationId=eventId` reduz duplicatas na janela FIFO; **um consumidor externo continua obrigado a deduplicar por `eventId` permanentemente**.

Trade-off: a transação de claim mantém row locks durante a chamada curta ao SQS. Em ambiente de grande volume, trocaríamos por claims com lease e heartbeat, evitando segurar transações durante I/O. Para o escopo e carga do case, `SKIP LOCKED`, timeout de rede e lotes pequenos tornam o desenho simples e auditável.

## 9. Observabilidade e status

- JSON técnico com IDs necessários e sem payload financeiro completo.
- `/health/live`: processo HTTP respondendo.
- `/health/ready`: conectividade PostgreSQL + SQS.
- `/health/metrics`: Prometheus, mais `/metrics` nas portas dos workers.
- Métricas: operações por status, duplicatas, retries, DLQ, conflitos, outbox lag, latência e divergências.
- HTTP: 400 payload inválido, 409 conflito de idempotência, 422 rejeição de negócio, 202 pendência, 503 dependência transitória.

## 10. Validação executada

Esta implementação foi de fato compilada e testada com Bun, PostgreSQL e LocalStack em execução — não é uma expectativa para quem for rodar depois, é um resultado já observado:

- `bun run typecheck` — limpo (TypeScript estrito, sem `any`/`ts-ignore`).
- `bun run test` (Money/Wallet) — 7/7.
- `bun run test:integration` (HTTP + PostgreSQL reais, 13 testes) — 13/13, incluindo os 5 cenários de `Idempotency-Key` reusada com `amount`/`playerId`/`walletId` divergentes.
- `bun run test:references` (referências fora de ordem) — 3/3, incluindo a regressão permanente de WIN referenciando BET com valor diferente, nos dois sentidos de chegada.
- `bun run test:messaging` (Inbox/Outbox/DLQ contra LocalStack real) — 3/3, reexecutado 8x consecutivas sem falha; o teste de publishers concorrentes força uma falha real de `SendMessageCommand` (fila inexistente, não mock) e prova recuperação via backoff até publicação completa dentro de um deadline controlado.
- `bun run test:race` e `bun run test:3instances` — cenário obrigatório da seção 8 (100,00 → duas BET de 80,00) reproduzido com 3 processos HTTP independentes reais: uma `PROCESSED`, uma `REJECTED`, saldo final correto, um único lançamento de débito, reconciliação consistente.
- Migrations `up → down → down → up → pending` em banco descartável — reversíveis, sem pendências ao final.

A integridade de `Money` e os limites de valor são validados no domínio e no schema; a fronteira de autenticação é um no-op documentado.

## 11. Limitações conhecidas

`FAILED` existe como status terminal auditável, mas eventos SQS irrecuperavelmente malformados seguem para a DLQ em vez de criar uma transação financeira `FAILED` sem identidade válida — nenhum caminho atual chega a produzir esse status na prática. Não existe dashboard gráfico nem OpenTelemetry distribuído. Não existem testes de throughput com resultados mensurados; não declaramos RPS ou p95 sem medição. O broker continua sendo at-least-once, exigindo consumidores idempotentes.

A verificação de `Idempotency-Key` roda antes de qualquer validação dependente da wallet (ver seção 5), mas depende do hash já estar calculado — por isso payload estruturalmente inválido (`money` malformado, moeda não suportada, referência exigida/não permitida, auto-referência) ainda é rejeitado antes do pre-check de idempotência. Isso é intencional: a seção 9 do desafio trata "payload inválido" como categoria distinta e anterior a "conflito de idempotência", e não é possível canonicalizar/hashear um payload malformado.

A transação `OPENING` (abertura de wallet com saldo inicial) é montada como registro direto, sem passar pela factory `WagerTransaction.create()` — é um atalho de implementação para o caminho interno-only, não uma transição de negócio alcançável via API/fila, mas foge estritamente da regra de modelagem da seção 6.0.

Migrations são `Migration202610230001` (base) e `Migration202610240002` (constraints compostas), ambas com `up()` e `down()`. A segunda não edita histórico aplicado.
