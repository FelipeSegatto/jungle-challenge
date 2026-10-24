# Jungle Gaming — Dia 1: núcleo financeiro e concorrência

> Projeto didático de base para o case **Distributed Wagering Processor**, não solução final do case. Stack: Bun 1.x, TypeScript strict, NestJS, PostgreSQL, MikroORM 7 e migrações reversíveis. O LocalStack aparece no Compose como preparação para o Dia 2; nenhum publisher/consumer SQS é implementado neste pacote.

## Começar do zero

1. Instale Bun 1.x, Docker Desktop/Engine + Compose e uma IDE.
2. Rode `cp .env.example .env`.
3. Rode `bun install` (isso cria `bun.lock`; versione-o).
4. Rode `docker compose up -d postgres`.
5. Rode `bun run migration:up`.
6. Rode `bun run test`.
7. Rode `bun run dev`.
8. Em outro terminal rode `bun run test:race`.
9. Para 3 instâncias, rode `PORT=3001 bun run start`, `PORT=3002 bun run start`, `PORT=3003 bun run start` em terminais separados, e `bun run test:3instances` num quarto terminal.
10. Rode `bun run test:integration` com o app aberto.

## URLs úteis

- `GET /health/live`
- `GET /health/ready` (**Dia 1 verifica só PostgreSQL; Dia 2 acrescentar SQS**)
- `POST /wallets`
- `GET /wallets/:walletId`
- `GET /wallets/:walletId/ledger?limit=50&cursor=...`
- `POST /wallets/:walletId/reconciliation`
- `POST /wagering/transactions` com header `Idempotency-Key`
- `GET /wagering/transactions/:transactionId`
- `GET /providers/:providerId/wagering/transactions/:externalTransactionId`

## Crie uma wallet

```bash
curl -sS -X POST http://localhost:3000/wallets \
  -H 'content-type: application/json' \
  -d '{"playerId":"0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1","initialBalance":{"amount":"100.00","currency":"BRL"}}'
```

Pegue o `id` retornado e coloque em `WALLET_ID`:

```bash
export WALLET_ID='COLE_UUID_DA_WALLET_AQUI'
curl -sS -X POST http://localhost:3000/wagering/transactions \
  -H 'content-type: application/json' -H 'Idempotency-Key: provider-a:bet-1' \
  -d "{\"providerId\":\"provider-a\",\"externalTransactionId\":\"bet-1\",\"playerId\":\"0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1\",\"walletId\":\"$WALLET_ID\",\"roundId\":\"round-1\",\"gameId\":\"fortune-chimp\",\"kind\":\"BET\",\"money\":{\"amount\":\"25.00\",\"currency\":\"BRL\"}}"
```

Rode exatamente a mesma solicitação outra vez: a resposta deverá ter `idempotentReplay:true`, mesmo quando houver movimentos posteriores na wallet. Consulte `/ledger` e `/reconciliation`.

## O que foi implementado

- `Money` decimal imutável, entradas `string` de escala 2, conflito de moedas.
- `Wallet` como aggregate root e `WalletLedgerEntry` imutável.
- `WagerTransaction` com factories, metadados imutáveis, status e transições terminais.
- `OPENING`, `BET`, `WIN`, `LOSS`, `REFUND`, `ROLLBACK` (para referência existente).
- Referência ainda inexistente vira `PENDING_REFERENCE`, reprocessamento automático será realizado **no Dia 2**.
- Idempotência por `Idempotency-Key` + SHA-256 de JSON canônico dos dados de negócio, UNIQUE no PostgreSQL e resposta original persistida.
- `PESSIMISTIC_WRITE` na linha da wallet; ledger, status, saldo e outbox no mesmo commit.
- Migrations SQL `up`/`down`, `CHECK` e índices, trigger de ledger imutável e de estado terminal imutável.
- Testes unitários, integração real e script de 50 chamadas concorrentes.

## O que ainda NÃO foi implementado

- SQS consumer, Inbox atômica na recepção SQS, Outbox publisher, backoff, DLQ, shutdown do consumer.
- Worker de reprocessamento de `PENDING_REFERENCE` e limite/TTL.
- Observabilidade completa (métricas de duplicatas, retry, DLQ, conflitos de lock, outbox lag etc.).
- Readiness de SQS, múltiplos processos Docker Compose com carga e testes de crash recovery.
- Integração real com IdP. O `NoopAuthGuard` deixa o ponto de extensão explícito e **não oferece segurança**.
- Testes de carga p95/p99, dashboards, integração com Keycloak.

**Atenção:** o pacote foi escrito para seguir as APIs documentadas de MikroORM v7, mas não foi possível instalar pacotes ou iniciar Docker/Bun no ambiente que gerou esta entrega. A sintaxe TypeScript foi verificada por transpilation estática; a validação final do runtime, migrations, testes de integração e compatibilidade deve ocorrer no seu computador. Não considere as condições eliminatórias comprovadas antes de executar `test:integration` e `test:race`.

## Decisões

Leia `ARCHITECTURE.md` e `AULA_DIA_1.md` antes de modificar o fluxo transacional. Não acrescente publicação SQS dentro de `em.transactional()`.
