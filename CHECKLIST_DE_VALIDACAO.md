# Checklist de validação antes de entregar

> Marque somente com execução real. **Não atribua ao projeto resultados de testes que não foram observados.**

## Preparação

- [ ] `bun --version` retorna 1.x
- [ ] `bun install` executa sem erros
- [ ] `bun run typecheck` aprova
- [ ] `docker compose up -d --build` sobe serviços, migrations e três APIs
- [ ] `GET /health/live`, `GET /health/ready` e `/health/metrics` funcionam
- [ ] `bun run migration:pending` não lista migrations inesperadas

## Correção financeira

- [ ] `bun run test` aprova os testes Money/Wallet
- [ ] Abertura de wallet gera OPENING e CREDIT na mesma transação
- [ ] BET de 80 + BET de 80 sobre 100: uma PROCESSED, uma REJECTED, saldo 20 e um DEBIT
- [ ] LOSS não cria ledger nem aumenta versão
- [ ] REFUND integral só reverte BET processada, uma vez por tipo
- [ ] ROLLBACK integral reverte BET/WIN/REFUND, sem saldo negativo
- [ ] Reconciliação sempre coincide após testes válidos
- [ ] UPDATE e DELETE de ledger são recusados no banco

## Concorrência / idempotência

- [ ] 50 chamadas iguais simultâneas produzem um único efeito
- [ ] Payload divergente na mesma key retorna 409
- [ ] Replay preserva transactionId e saldo histórico
- [ ] Três processos HTTP independentes executam `bun run test:3instances`
- [ ] Wallets diferentes não dependem de lock global

## Mensageria

- [ ] LocalStack possui entrada, DLQ e fila de eventos
- [ ] Consumer chama mesmo WagerService do HTTP
- [ ] Registro Inbox, saldo, ledger e Outbox compartilham commit
- [ ] Falha após commit antes de ACK gera redelivery sem segunda movimentação
- [ ] Dois publishers publicam sem perder mensagens
- [ ] Falha transitória de SQS mantém outbox pendente com backoff
- [ ] Mensagens inválidas vão para DLQ; transient retries respeitam redrive
- [ ] REFUND fora de ordem é retomada quando BET aparece
- [ ] Referência ausente expira com REFERENCE_NOT_FOUND
- [ ] SIGTERM aguarda operação em curso ou broker recupera após visibility timeout

## Entrega

- [ ] README executável em Windows PowerShell ou Docker Compose
- [ ] ARCHITECTURE explica trade-offs, falhas e limites reais
- [ ] Não incluir `.env` com senhas reais ou `node_modules`
- [ ] Arquivos commitados com lockfile gerado pelo Bun (`bun.lock`)
- [ ] Testes de integração usam PostgreSQL/SQS reais, não mocks
