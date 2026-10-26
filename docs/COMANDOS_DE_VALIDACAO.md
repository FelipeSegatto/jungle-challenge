# Comandos para validar cada requisito do desafio

Guia prático: cada linha do `challenge.md` que pede uma garantia específica, ligada ao comando real
que a exercita. Todos os comandos abaixo rodam na raiz do projeto (não em `frontend/`).

## 0. Preparação única

```bash
bun install --frozen-lockfile
cp .env.example .env            # se ainda não existir
docker compose up -d --build    # sobe postgres, localstack, migrate, api1/2/3, worker1/2
```

Confirma que subiu certo:
```bash
curl http://localhost:3001/health/live
curl http://localhost:3001/health/ready
```

## 1. Suíte completa, isolada, em Linux real (recomendado — é o que o avaliador provavelmente vai rodar)

```bash
bun run test:all
```

Builda uma imagem Linux própria e roda, em containers descartáveis (Postgres + LocalStack exclusivos,
sem tocar no `docker compose up` da seção 0): `format:check`, `typecheck`, as duas migrations, e as
13 suítes abaixo, em sequência. Isso cobre sozinho praticamente toda a seção 13 do desafio.

Para rodar só uma parte (mesma infraestrutura isolada):
```bash
TEST_SUITES=test:crash-recovery,test:sigterm bun run test:all
```

## 2. Comando por requisito (se quiser rodar peça por peça, sem Docker)

Pré-requisito: `docker compose up -d --build` já rodando (seção 0).

| Requisito do desafio | Seção | Comando |
|---|---|---|
| Money: escala, arredondamento, entradas inválidas, conflito de moeda | 6.1, 13 | `bun test test/money.test.ts` |
| Invariantes da Wallet (saldo nunca negativo, version) | 6.2, 13 | `bun test test/wallet.test.ts` |
| payloadHash / idempotency key com payload divergente | 6.3, 9, 13 | `bun test test/hash.test.ts` |
| Transições terminais, OPENING interno, Inbox/Outbox | 6.3, 6.5 | `bun test test/domain-transitions.test.ts` |
| Migrations, constraints, atomicidade wallet+ledger+inbox+outbox | 5, 11, 13 | `bun run test:integration` |
| Falha real de INSERT na Outbox → rollback completo + retry | 11 | `bun run test:atomicity` |
| Inbox/redelivery, publishers concorrentes sobre a mesma outbox | 10, 11, 13 | `bun run test:messaging` |
| REFUND/ROLLBACK/WIN fora de ordem (PENDING_REFERENCE) | 7.1 | `bun run test:references` |
| Wallets distintas processadas em paralelo | 8, 13 | `bun run test:parallel-wallets` |
| Replay HTTP→SQS, mensagens concorrentes com hashes diferentes | 10, 11 | `bun run test:inbox-replay` |
| Worker morto (SIGKILL) depois do commit, antes do ACK; reinício real com replay preservado | 10, 11, 13 | `bun run test:crash-recovery` |
| SIGTERM com mensagem em andamento: termina, ACK, sai limpo | 10 | `bun run test:sigterm` |
| Retry/backoff real do consumer; JSON malformado direto à DLQ | 10, 13 | `bun run test:consumer-retry` |
| Falha persistente esgota 5 tentativas reais → DLQ real (RedrivePolicy) | 10, 13 | `bun run test:consumer-dlq-persistent` (~70s) |
| **Cenário obrigatório da seção 8**: 100,00 − 80,00 − 80,00 simultâneas, 50x replay | 8, 13 | `bun run test:race` |
| Mesmo cenário acima, mas com **3 processos HTTP independentes** | 8, 13 | `bun run test:3instances` |

## 3. Checar manualmente pela API (sem rodar nenhum teste)

```bash
# Criar wallet
curl -X POST http://localhost:3001/wallets \
  -H "content-type: application/json" \
  -d '{"playerId":"<uuid-v4>","initialBalance":{"amount":"100.00","currency":"BRL"}}'

# Processar uma BET (troque <walletId>/<playerId>)
curl -X POST http://localhost:3001/wagering/transactions \
  -H "content-type: application/json" \
  -H "idempotency-key: demo:tx-1" \
  -d '{"providerId":"demo","externalTransactionId":"tx-1","playerId":"<playerId>","walletId":"<walletId>","roundId":"r1","gameId":"g1","kind":"BET","money":{"amount":"25.00","currency":"BRL"}}'

# Reenviar a MESMA chamada acima -> deve devolver idempotentReplay:true, mesmo transactionId

# Reconciliação
curl -X POST http://localhost:3001/wallets/<walletId>/reconciliation

# Ledger
curl "http://localhost:3001/wallets/<walletId>/ledger?limit=50"

# Métricas (seção 12)
curl http://localhost:3001/health/metrics
```

## 4. Demonstração via SQS real (sem HTTP)

```bash
bun run queues:init     # garante as 3 filas FIFO no LocalStack
bun run start:worker    # em outro terminal — obrigatório, sem worker o script abaixo falha
bun run demo:sqs        # publica 1 mensagem real na fila de entrada e confirma o processamento
```

## 5. Diferencial opcional — teste de carga

Não implementado neste projeto (documentado em `README.md`/`ARCHITECTURE.md` como não medido — não
há `bun run test:load`).

## 6. Frontend (fora da nota, mas útil para apresentar visualmente os itens acima)

**Via Docker (único pré-requisito: Docker + Docker Compose; roda em qualquer máquina)** — já incluído
no `docker compose up -d --build` do passo 0, que agora também builda e sobe o frontend
(`frontend/Dockerfile`, build com Bun + servido por nginx, com proxy interno para `api1`/`api2`/`api3`
pelo nome do serviço na rede do compose):

```bash
docker compose up -d --build
# http://localhost:5173
```

**Ou nativo, para desenvolvimento com hot-reload:**

```bash
cd frontend
bun install
bun run dev    # http://127.0.0.1:5173, com proxy (Vite) para as 3 instâncias do passo 0
```

Páginas que espelham os requisitos: **Distributed Lab** (idempotência, seção 9), **Guided Demo**
etapa 5 (concorrência, seção 8), **System Health** (mensageria/observabilidade, seções 10-12),
**Ledger & Reconciliation** (seção 6.4/9).
