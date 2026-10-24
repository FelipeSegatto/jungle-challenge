# Distributed Wagering Processor

Serviço financeiro para operações de apostas, construído com **NestJS**, **Bun 1.x**, **TypeScript estrito**, **MikroORM 7**, **PostgreSQL** e **AWS SQS (LocalStack)**.

A prioridade é preservar as invariantes financeiras sob concorrência, redelivery, reordenação de mensagens e falhas de processo. A API e o consumidor SQS chamam o mesmo caso de uso; o PostgreSQL, e não o broker, é a fonte de verdade.

## Requisitos

- Docker Desktop / Docker Engine com Docker Compose
- Bun 1.x para desenvolver e executar os testes a partir do host
- PowerShell no Windows; terminal Bash/Zsh em Linux/macOS

## Início rápido (recomendado: ambiente isolado)

```powershell
# PowerShell, na raiz do projeto
Copy-Item .env.example .env
bun install
# Sobe PostgreSQL, LocalStack, migrations, 3 APIs e 2 workers
# Na primeira execução, o Compose constrói as imagens.
docker compose up -d --build
docker compose ps
Invoke-RestMethod http://localhost:3001/health/ready
Invoke-RestMethod http://localhost:3001/health/live
Invoke-RestMethod http://localhost:3001/health/metrics
powershell -ExecutionPolicy Bypass -File .\scripts\demo.ps1
```

APIs nas portas **3001, 3002, 3003**. PostgreSQL exposto ao host em **55432** (sem conflito com um PostgreSQL Windows na 5432). SQS em **4566**. Métricas dos dois workers em **9091/metrics** e **9092/metrics**. O endpoint `/health/ready` responde 200 somente quando **PostgreSQL e SQS** estiverem acessíveis.

Se você já tem um projeto anterior com container e volumes próprios, não apague volumes para corrigir credenciais. Este Compose usa o volume `jungle_postgres` no projeto atual e senha de desenvolvimento `jungle`. Em produção, use secrets e credenciais independentes.

## Desenvolvimento com API fora do Docker

```powershell
Copy-Item .env.example .env
bun install
# Nesta modalidade, a API e os scripts rodam no Windows.
docker compose up -d postgres localstack
bun run migration:up
bun run queues:init
bun run dev
```

Abra um segundo terminal para o worker:

```powershell
bun run start:worker
```

O `.env.example` aponta para `127.0.0.1:55432`. `mikro-orm.config.ts` carrega `.env` explicitamente para que tanto o CLI quanto o NestJS usem as mesmas credenciais. Para executar três processos no host:

```powershell
$env:PORT='3001'; bun run start
# Outros dois terminais: PORT 3002 e 3003
```

Nunca execute simultaneamente o ambiente Compose completo e essas APIs locais nas mesmas portas.

## Comandos disponíveis

| Comando | Função |
|---|---|
| `bun run migration:up` | Aplica migrations versionadas |
| `bun run migration:down` | Reverte a última migration (somente ambiente descartável) |
| `bun run migration:pending` | Lista migrations pendentes |
| `bun run dev` | API com watch |
| `bun run start:worker` | Consumer, retry de referências e publisher Outbox |
| `bun run queues:init` | Cria as três filas SQS |
| `bun run typecheck` | TypeScript strict, sem gerar arquivos |
| `bun run test` | Testes unitários de domínio |
| `bun run test:integration` | HTTP + PostgreSQL reais |
| `bun run test:messaging` | PostgreSQL + LocalStack reais, Inbox/Outbox/redelivery |
| `bun run test:references` | Referências fora de ordem, TTL e reprocessamento |
| `bun run test:race` | Duas apostas concorrentes e 50 replays |
| `bun run test:3instances` | Três instâncias independentes |
| `bun run test:all` | Suíte completa (requer API e containers ativos) |

Para rodar testes com o Compose completo, o padrão dos testes HTTP aponta à porta 3000. No PowerShell defina, no terminal dos testes:

```powershell
$env:BASE_URL='http://localhost:3001'
bun run test:integration
bun run test:race
bun run test:3instances
bun run test:messaging
bun run test:references
```

**Não envie resultados de testes como se tivessem passado sem executá-los no seu ambiente.** Verifique os códigos de saída e os estados persistidos.

## Fluxos de negócio

- `POST /wallets`: uma wallet por `(playerId,currency)`; saldo inicial positivo produz `OPENING` + ledger `CREDIT` na mesma transação SQL.
- `BET`: débito condicionado ao saldo disponível.
- `WIN`: crédito, referência à BET opcional.
- `LOSS`: estado processado sem movimentação financeira.
- `REFUND`: crédito integral de BET processada; uma reversão por tipo/referência.
- `ROLLBACK`: movimento inverso integral de BET, WIN ou REFUND; não pode deixar saldo negativo.
- `PENDING_REFERENCE`: operação recebida antes da referência é persistida e reprocessada pelo worker com backoff; expiração é REJECTED/REFERENCE_NOT_FOUND.
- `OPENING`: operação interna, indisponível no contrato HTTP ou na fila de entrada.

Toda operação HTTP necessita `Idempotency-Key`. O hash SHA-256 é calculado sobre o JSON canônico dos campos de negócio; chave igual/payload diferente recebe `409`.

## Endpoints

| Método | Rota | Resposta principal |
|---|---|---|
| POST | `/wallets` | 201 |
| GET | `/wallets/:walletId` | 200 |
| GET | `/wallets/:walletId/ledger?limit=50&cursor=...` | 200 (cursor opaco) |
| POST | `/wallets/:walletId/reconciliation` | 200 |
| POST | `/wagering/transactions` | 200 processada, 202 pendente, 422 rejeitada |
| GET | `/wagering/transactions/:transactionId` | 200 |
| GET | `/providers/:providerId/wagering/transactions/:externalTransactionId` | 200 |
| GET | `/health/live` | 200 sem autenticação |
| GET | `/health/ready` | 200 ou 503 sem autenticação |
| GET | `/health/metrics` | 200 Prometheus text |

**Exemplo de submissão:**

```http
POST /wagering/transactions HTTP/1.1
Content-Type: application/json
Idempotency-Key: provider-a:bet-001

{
  "providerId": "provider-a",
  "externalTransactionId": "bet-001",
  "playerId": "UUID_DO_JOGADOR",
  "walletId": "UUID_DA_WALLET",
  "roundId": "round-1",
  "gameId": "fortune-chimp",
  "kind": "BET",
  "money": { "amount": "25.00", "currency": "BRL" }
}
```

## Filas SQS

- Entrada: `wager-transactions.fifo`
- DLQ: `wager-transactions-dlq.fifo` (redrive após 5 recebimentos)
- Integração: `wager-events.fifo`

Formato da mensagem de entrada:

```json
{
  "messageId": "msg-001",
  "type": "WagerTransactionRequested",
  "occurredAt": "2026-10-24T12:00:00.000Z",
  "data": {
    "providerId": "provider-a",
    "externalTransactionId": "bet-001",
    "idempotencyKey": "provider-a:bet-001",
    "playerId": "UUID_DO_JOGADOR",
    "walletId": "UUID_DA_WALLET",
    "roundId": "round-1",
    "gameId": "fortune-chimp",
    "kind": "BET",
    "money": { "amount": "25.00", "currency": "BRL" }
  }
}
```

O `MessageGroupId` é o ID da wallet, otimizando ordenação. As invariantes continuam sendo garantidas pelas transações e constraints no PostgreSQL. `DeleteMessage` ocorre **depois** do commit. Eventos de saída utilizam `eventId` como identidade de deduplicação e o consumidor externo deve aplicar sua própria deduplicação persistente.

## Observabilidade

Logs JSON de eventos técnicos sem corpo completo de payload financeiro. Métricas: operações por status, replays, retries, DLQ, conflitos transacionais, duração de processamento, divergência de reconciliação e idade da Outbox. Métricas dos workers são expostas separadamente.

## Documentação complementar

- [ARCHITECTURE.md](ARCHITECTURE.md): invariantes, modelos, escolha de locks, Inbox/Outbox, falhas, limites.
- [GUIA_DE_APRESENTACAO.md](GUIA_DE_APRESENTACAO.md): roteiro de demonstração e questões de arquitetura.
- [CHECKLIST_DE_VALIDACAO.md](CHECKLIST_DE_VALIDACAO.md): critérios concretos a conferir antes da entrega.

## Encerramento e dados

```powershell
docker compose down
```

Esse comando mantém os volumes. **Não use `docker compose down -v` em um banco que contenha dados importantes.**
