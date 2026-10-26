# Comandos para validar cada requisito do desafio

Guia prático: requisitos do enunciado ligados às suítes que os exercitam. Todos os comandos abaixo rodam na raiz do projeto (não em `frontend/`).

## 0. Preparação única

```bash
docker compose up -d --build --wait
# sobe postgres, localstack, migrate, api1/2/3, worker1/2 e frontend
```

Confirma que subiu certo:

```bash
curl http://localhost:3001/health/live
curl http://localhost:3001/health/ready
```

## 1. Suíte completa, isolada, em Linux real (recomendado — é o que o avaliador provavelmente vai rodar)

```bash
docker compose -f docker-compose.test.yml up --build --exit-code-from tests --attach tests
```

Builda uma imagem Linux própria e roda, em containers descartáveis (Postgres + LocalStack exclusivos,
sem tocar no `docker compose up` da seção 0): `format:check`, `typecheck`, as duas migrations, e as
13 suítes abaixo, em sequência. Isso cobre sozinho praticamente toda a seção 13 do desafio.

Para rodar só uma parte (mesma infraestrutura isolada):

```bash
TEST_SUITES=test:crash-recovery,test:sigterm docker compose -f docker-compose.test.yml up --build --exit-code-from tests --attach tests
```

O sucesso é indicado por `PASS: isolated checks completed` e saída `0` do serviço `tests`.
Para PowerShell, defina `$env:TEST_SUITES = 'test:crash-recovery,test:sigterm'` antes do comando
Docker e remova com `Remove-Item Env:TEST_SUITES` depois. A atribuição inline acima é de Bash.
Remova `TEST_SUITES` para executar todas as suítes.

## 2. Suíte por requisito

A coluna abaixo identifica a suíte a selecionar em `TEST_SUITES` pelo comando Docker da seção 1.
Os nomes não são instruções para rodar os executores diretamente no banco da aplicação.
O Compose de testes cria seu próprio ambiente; a aplicação da seção 0 não precisa estar ativa.

| Requisito do desafio | Seção | Suíte (`TEST_SUITES`) |
|---|---|---|
| Money: escala, arredondamento, entradas inválidas, conflito de moeda | 6.1, 13 | `test` |
| Invariantes da Wallet (saldo nunca negativo, version) | 6.2, 13 | `test` |
| payloadHash canônico | 6.3, 9 | `test` |
| Idempotency key com payload divergente | 9, 13 | `test:integration` |
| Transições terminais, OPENING interno, Inbox/Outbox | 6.3, 6.5 | `test` |
| Migrations, constraints, atomicidade wallet+ledger+inbox+outbox | 5, 11, 13 | `test:integration` |
| Falha real de INSERT na Outbox → rollback completo + retry | 11 | `test:atomicity` |
| Inbox/redelivery, publishers concorrentes sobre a mesma outbox | 10, 11, 13 | `test:messaging` |
| REFUND/WIN fora de ordem (PENDING_REFERENCE) | 7.1 | `test:references` |
| Wallets distintas processadas em paralelo | 8, 13 | `test:parallel-wallets` |
| Replay HTTP→SQS, mensagens concorrentes com hashes diferentes | 10, 11 | `test:inbox-replay` |
| Worker morto (SIGKILL) depois do commit, antes do ACK; reinício real com replay preservado | 10, 11, 13 | `test:crash-recovery` |
| SIGTERM com mensagem em andamento: termina, ACK, sai limpo | 10 | `test:sigterm` |
| Retry/backoff real do consumer; JSON malformado direto à DLQ | 10, 13 | `test:consumer-retry` |
| Falha persistente esgota 5 tentativas reais → DLQ real (RedrivePolicy) | 10, 13 | `test:consumer-dlq-persistent` (~70s) |
| **Cenário obrigatório da seção 8**: 100,00 − 80,00 − 80,00 simultâneas, 50x replay | 8, 13 | `test:race` |
| Mesmo cenário acima, mas com **3 processos HTTP independentes** | 8, 13 | `test:3instances` |

## 3. Checar manualmente pela API (sem rodar nenhum teste)

Os exemplos a seguir são de Bash e exigem substituir os placeholders. Para uma demonstração
com IDs gerados automaticamente em Bash ou PowerShell, siga o [README](../README.md#demonstrações-pelo-backend).

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

## 4. Demonstração de uma BET via SQS real

```bash
docker compose exec -e BASE_URL=http://127.0.0.1:3000 api1 bun run demo:sqs
```

Esperado: `result: PASS`, `via: SQS`, saldo `75.00`. O script cria a wallet por HTTP,
envia a BET pelo SQS e consulta o saldo. Os workers já estão ativos no Compose.

## 5. Diferencial opcional — teste de carga

Não implementado neste projeto (documentado em `README.md`/`ARCHITECTURE.md` como não medido — não
há `bun run test:load`).

Depois dos testes, copie os logs se necessário e descarte somente o projeto de testes:

```bash
docker compose -f docker-compose.test.yml cp tests:/artifacts ./artifacts
docker compose -f docker-compose.test.yml down --volumes
```

Os scripts de corrida terminam em `19.00`: primeiro verificam a disputa de 80+80 sobre 100
(saldo `20.00`, um débito), depois uma BET de 1 repetida 50 vezes (saldo `19.00`, dois débitos).

## 6. Frontend (fora da nota, mas útil para apresentar visualmente os itens acima)

**Via Docker (único pré-requisito: Docker + Docker Compose; usa containers Linux em hosts compatíveis)** — já incluído
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
