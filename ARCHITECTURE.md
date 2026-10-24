# Architecture Decision Record — Dia 1

## Status

Esta versão implementa o núcleo do Dia 1 do case; SQS, Inbox/Outbox workers, recovery e observabilidade total serão desenvolvidos e validados no Dia 2 e Dia 3. Não confunda criação de registros em outbox com publicação SQS.

## ADR-001: dinheiro e precisão

`Money` é Value Object imutável, sem acoplamento a Nest/ORM, que lê e serializa `amount` como decimal string com duas casas. `Decimal.js` executa a aritmética; PostgreSQL `NUMERIC(20,2)` e MikroORM `DecimalType` (string) preservam a exatidão. MVP aceita BRL mas o Value Object detecta conflito de moeda.

## ADR-002: concorrência

Unidade de bloqueio: linha `wallets.id`. Cada comando abre transação PostgreSQL e usa MikroORM `LockMode.PESSIMISTIC_WRITE` equivalente a `SELECT ... FOR UPDATE`. Como o lock está no banco, vale para vários processos. Wallets diferentes continuam independentes. Sem lock global, sem read-modify-write sem proteção. Rollback libera locks.

## ADR-003: idempotência

A fonte da verdade é o header `Idempotency-Key`. A hash SHA-256 é calculada sobre JSON canônico de campos de negócio com ordenação lexical de chaves, e exclui headers/metadados de transporte. O PostgreSQL aplica unicidade global em `idempotency_key` e unicidade `(provider_id,external_transaction_id)`. A resposta conserva `response_balance_amount` para replay (saldo original). Após erro de chave única concorrente, a transação derrotada faz rollback e reconsulta a vencedora em EM novo. O resultado da mesma chave com payload divergente é HTTP 409.

## ADR-004: saldo e ledger

O saldo materializado pertence à wallet. Cada alteração gera um ledger na MESMA transação SQL, cujo `CHECK` aplica aritmética correta e trigger bloqueia UPDATE/DELETE. Registro de `LOSS` não altera o saldo, não incrementa versão e não gera ledger. Abertura positiva cria `OPENING`+`CREDIT` atômicos. `POST /reconciliation` recalcula no SQL sob lock e sinaliza divergência, sem reparar.

## ADR-005: referência e reversões

Referências são endereçadas por `(provider_id,external_transaction_id)` e validadas contra provider, wallet, player, rodada e moeda. `REFUND` exige `BET`; `ROLLBACK` aceita `BET`, `WIN` ou `REFUND`. Não há reversão parcial. Uma reversão por tipo/referência é protegida por índice único parcial `WHERE status='PROCESSED'`. Se faltou referência, persiste `PENDING_REFERENCE` e evento (a recuperação será implementada no Dia 2). Se rollback debita mais que o saldo, `REVERSAL_INSUFFICIENT_BALANCE` é rejeição terminal.

## ADR-006: Outbox antecipada

Eventos `WagerTransactionProcessed`, `WagerTransactionRejected`, `WagerTransactionPendingReference`, `WalletBalanceChanged` são inseridos na mesma transação financeira, sem publicar SQS antecipadamente. O publisher do Dia 2 deverá usar `SKIP LOCKED`/lease e garantir consumidores idempotentes por `eventId`, pois publicação duplicada após crash é possível.

## ADR-007: Autenticação

Não implementada no timebox inicial; o `NoopAuthGuard` marca explicitamente a extensão para validação OIDC/JWT com IdP como Keycloak/Zitadel. Rotas health ficam abertas. O no-op deliberadamente NÃO autentica e não deve ser colocado em produção.

## Riscos e trabalho pendente

1. Executar e estabilizar runtime real de Bun 1.x, Nest 11 e MikroORM 7 com PostgreSQL 16; não foi possível rodar neste ambiente.
2. Integrar consumer com Inbox na **mesma** transação que a movimentação. O método `WagerService.process()` deverá aceitar contexto de consumo/EM e registrar Inbox atomicamente; não basta chamar o método e salvar inbox em outra transação.
3. Implementar reprocessamento de referência pendente atualizando a MESMA transação, inclusive resposta-snapshot, eventos, tentativas/backoff/TTL e sem modificar estado terminal.
4. Idempotência e unicidade de reversão dependem de um banco PostgreSQL acessível; executar testes de concorrência entre 3 instâncias, além dos testes incluídos.
5. Controlar lock timeouts, falhas SQLSTATE e observabilidade em carga real.
6. Adicionar readiness SQS, logs estruturados com IDs, métricas e testes de reinício/ACK.
7. Rever schema contra metadados ORM via `migration:check` em ambiente de desenvolvimento; validar mapping de timestamps e migrações reversíveis.
8. Testar PostgreSQL e SQS indisponíveis, e mensagens malformadas/persistentes indo à DLQ no projeto final.
