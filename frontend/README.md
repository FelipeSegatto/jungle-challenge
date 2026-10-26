# Jungle Wagering Console

Frontend de demonstração (React + Vite) para o desafio técnico "Distributed Wagering Processor" da
Jungle Gaming. Existe só para mostrar visualmente, numa entrevista, que o backend funciona — **não
é parte avaliada do desafio**, não substitui os testes reais do backend, e **não está pronto para
produção** (ver [Limitações e segurança](#limitações-e-segurança) abaixo).

## Por que este frontend existe

O desafio é inteiramente avaliado pelo backend (NestJS + PostgreSQL + SQS). Esta interface foi
construída depois, como uma camada de visualização para apresentar o comportamento do backend —
concorrência, idempotência, mensageria assíncrona — sem precisar narrar `curl`s em texto puro numa
entrevista. Toda regra de negócio, toda validação de consistência financeira, e toda garantia de
corretude continuam vivendo exclusivamente no backend; o frontend só chama a API HTTP e formata o
que ela devolve.

## Stack

React 18, TypeScript estrito, Vite 5, Tailwind CSS 3, `@tanstack/react-query` 5, Zod 3,
`lucide-react`, `decimal.js`. Sem router (navegação por estado local — só 7 telas), sem state
manager global (Context API é suficiente), sem UI kit próprio. Testes: `bun:test` (lógica pura) +
Vitest 3 + React Testing Library + MSW (componentes e integração HTTP mockada). Ver
[`CLAUDE.md`](./CLAUDE.md) para o racional completo de cada escolha e os pinos de versão que não
devem ser "atualizados" sem reler o motivo.

## Estrutura de pastas

```
frontend/
├── src/
│   ├── app/                 # App.tsx (shell + navegação), providers.tsx (QueryClient, contexts), navigation.ts
│   ├── components/
│   │   ├── ui/               # Primitivos reaproveitados (Panel, Button, DescriptionList, ErrorState...)
│   │   ├── layout/            # InstancePicker (seletor node-1/2/3)
│   │   └── inspector/         # Request Inspector (painel de requisições HTTP em tempo real)
│   ├── features/
│   │   ├── overview/          # Visão geral (resumo de saúde + navegação rápida)
│   │   ├── guided-demo/       # Guided Demo — roteiro de 6 passos (ver abaixo)
│   │   ├── wallets/           # Criar/consultar wallet
│   │   ├── transactions/      # Formulário de BET/WIN/LOSS/REFUND/ROLLBACK
│   │   ├── ledger/            # Consulta de ledger + Reconciliação
│   │   ├── distributed-lab/   # Idempotency Lab — Cenários A-E
│   │   ├── health/            # Widget compacto de saúde (usado na Overview)
│   │   └── system-health-messaging/  # Página completa de Health + Metrics + Arquitetura de mensageria
│   ├── lib/
│   │   ├── api/                # client.ts (fetch único, sem retry embutido), queryClient.ts, inspectedRequest.ts
│   │   ├── money/               # format.ts — toda formatação monetária via decimal.js
│   │   ├── instance/            # InstanceContext — qual node-1/2/3 está selecionado (localStorage)
│   │   ├── wallet/               # SelectedWalletContext — wallet ativa na aba (memória, não persiste)
│   │   ├── session-history/      # Histórico local de wallets visitadas nesta aba
│   │   ├── transaction-history/  # Histórico local de transações nesta aba
│   │   ├── toast/                 # Notificações in-app
│   │   └── inspector/             # Estado do Request Inspector
│   └── types/                 # api.ts (tipos do contrato real), schemas.ts (Zod espelhando os DTOs)
├── test/                     # Vitest + RTL + MSW — ver seção Testes
├── vite.config.ts            # Proxy /api/node-{1,2,3} -> instâncias reais do backend
└── CLAUDE.md                 # Regras permanentes e achados de contrato confirmados por execução
```

## Pré-requisitos

- [Bun](https://bun.sh) (mesmo runtime do backend).
- O backend já rodando — ver a seção [Como subir o backend](#como-subir-o-backend-primeiro) abaixo.

## Instalação

```bash
cd frontend
bun install
```

## Como subir o backend primeiro

O frontend não funciona sozinho — ele só exibe o que a API real devolve. Na raiz do projeto
(`jungle-wagering/`, não em `frontend/`):

```bash
# Opção 1 — uma única instância (porta 3000), mais simples para explorar a UI:
bun run queues:init      # cria as filas FIFO no LocalStack, uma vez
bun run start             # API em http://localhost:3000
bun run start:worker       # worker SQS, em outro terminal (necessário para a Etapa 6 do Guided Demo)

# Opção 2 — as 3 instâncias via docker-compose (necessário para o Idempotency Lab e o System Health
# mostrarem comparação real entre node-1/node-2/node-3, todas contra o mesmo PostgreSQL):
docker-compose up
```

Confirme a porta de cada modo: a Opção 1 sobe só em `3000` (o proxy do Vite por padrão espera
`3001/3002/3003`, então ajuste `VITE_NODE_1_TARGET` — ver [Configuração](#configuração) — para
apontar `node-1` a `3000` se usar só uma instância).

## Como iniciar o frontend

**Via Docker (recomendado para rodar em outra máquina — só precisa de Docker instalado):** o
`docker compose up -d --build` da raiz do projeto já builda e sobe o frontend junto com o backend
(`frontend/Dockerfile`: build com Bun, servido por nginx, proxy interno para `api1`/`api2`/`api3`
pelo nome do serviço na rede do compose — ver `frontend/nginx.conf`). Abra `http://localhost:5173`.

**Nativo, para desenvolvimento com hot-reload:**

```bash
cd frontend
bun run dev
```

Abra `http://localhost:5173` no navegador. O servidor de dev só escuta em `127.0.0.1` de propósito
(o backend não tem autenticação — ver [Limitações e segurança](#limitações-e-segurança)).

## Configuração

Copie `.env.example` para `.env` e ajuste só se as instâncias do backend estiverem em portas
diferentes do padrão do `docker-compose.yml` (3001/3002/3003):

```bash
VITE_NODE_1_TARGET=http://127.0.0.1:3001
VITE_NODE_2_TARGET=http://127.0.0.1:3002
VITE_NODE_3_TARGET=http://127.0.0.1:3003
```

Nenhuma dessas variáveis é um segredo — são só URLs de destino do proxy HTTP do Vite
(`vite.config.ts`). O React nunca fala direto com essas portas; sempre via `/api/node-1/...` etc.,
reescrito pelo proxy. Isso existe porque o backend não habilita CORS (`src/main.ts`), então chamar a
API direto do `localhost:5173` daria erro de CORS.

## Telas e como usar cada uma

### Overview
Resumo de saúde das 3 instâncias (latência medida pelo navegador + status reportado pela própria
API) e navegação rápida para as outras telas.

### Guided Demo
Roteiro de 6 passos pensado para apresentação ao vivo, reaproveitando os mesmos hooks/componentes
das telas "cruas" (nenhuma lógica financeira duplicada): **1. Overview** (contexto: 3 processos
atrás de 1 PostgreSQL) → **2. Criar wallet** → **3. Processar BET** → **4. Idempotência** (replay da
mesma operação) → **5. Concorrência** (duas BETs simultâneas na mesma wallet, só uma deve
confirmar) → **6. Mensageria** (o mesmo fluxo de BET entrando via SQS em vez de HTTP). Cada passo
mostra o "o quê"/"por quê"/arquivo do backend relevante, e termina com um selo
PASS/FAIL/INCONCLUSIVE (ver explicação abaixo).

### Wallets
Criar uma wallet (`playerId` + saldo inicial) e consultar o estado atual de qualquer wallet por ID.

### Transactions
Formulário para `POST /wagering/transactions`: escolher `BET`/`WIN`/`LOSS`/`REFUND`/`ROLLBACK`,
valor, e (para `REFUND`/`ROLLBACK`) a transação de referência. Mostra a linha do tempo da requisição
e o resultado real — incluindo rejeições de negócio (`422 INSUFFICIENT_BALANCE`), que são estados
válidos, não erros de rede.

### Ledger & Reconciliation
Consulta paginada do ledger de uma wallet, e o painel de Reconciliação (`POST
/wallets/:id/reconciliation`) — soma o ledger inteiro e compara com o saldo materializado. **Toda a
matemática é feita pelo backend**; o frontend só formata e exibe o resultado (ver [Auditoria de
precisão financeira](#auditoria-de-precisão-financeira)). Não existe botão para corrigir uma
divergência — essa tela nunca escreve dado financeiro.

### Distributed Lab (Idempotency Lab)
5 cenários isolados contra a mesma `Idempotency-Key`, cada um provando uma garantia diferente do
backend:
- **A** — operação original.
- **B** — reenviar a mesma operação (replay idempotente — mesmo `transactionId`, nenhum efeito duplicado).
- **C** — conflito de payload (mesma key, valor diferente → `409 INBOX_PAYLOAD_CONFLICT`).
- **D** — replay depois de outra movimentação válida ter acontecido (prova que o replay devolve o
  saldo congelado *daquele momento*, não o saldo atual).
- **E** — identidade divergente (mesma key, `playerId` diferente → outro tipo de conflito).

Um painel de verificação final soma saldo + ledger pós-cenários para confirmar consistência.

### System Health
Cards de saúde por instância (latência real medida pelo navegador + `GET /health/live` e
`GET /health/ready`), métricas Prometheus parseadas de `GET /health/metrics`, um diagrama estático
da arquitetura de mensageria (Provider → SQS → Consumer → Inbox → WagerService → PostgreSQL →
Outbox → Publisher → SQS Events), e instruções para rodar a demonstração de mensageria via terminal
(`bun run demo:sqs` — **exige um worker rodando** em outro terminal, confirmado por execução real
nesta sessão: sem worker, o script falha com `SQS_TRANSACTION_NOT_CONFIRMED`).

## Selos PASS / FAIL / INCONCLUSIVE

Usados no Guided Demo e no Idempotency Lab. **PASS**: a resposta real da API bateu exatamente com o
que o cenário esperava. **FAIL**: bateu com um resultado que contradiz a garantia testada (ex.:
replay gerou um segundo débito). **INCONCLUSIVE**: a chamada teve sucesso mas o resultado não permite
concluir nada com certeza sobre a garantia específica sendo testada (ex.: timing não determinístico
numa corrida de concorrência onde ambas as respostas chegaram fora da ordem esperada para
diagnosticar qual venceu o lock) — não é "deu erro", é "a evidência coletada não é suficiente para
um veredito". Nunca interprete INCONCLUSIVE como falha do backend.

## Testes

Duas suítes, de propósito (ver `CLAUDE.md` para o porquê de não unificar):

```bash
bun run test        # bun:test — lógica pura pré-existente (scenarioBuilders, verdicts, prometheus parser), sem DOM
bun run test:ui      # vitest run — Vitest + RTL + MSW: schemas Zod, formatação monetária, montagem de
                      # requests/headers, Idempotency-Key, estados de componente, comportamento de formulário
bun run test:all     # as duas em sequência
bun run test:ui:watch  # vitest em modo watch, para desenvolvimento
```

Resultado real nesta revisão: `bun run test` → 37 testes, 0 falhas. `bun run test:ui` → 55 testes, 0
falhas (8 arquivos). `bun run typecheck` e `bun run build` também limpos.

Os testes de componente usam MSW para simular respostas HTTP — isso valida comportamento de UI
(estados de loading/erro/sucesso, montagem de request, headers), **nunca correção do backend**. A
prova de que o backend está correto vem só de rodar os testes reais do backend
(`../README.md#testes-e-evidências`) contra PostgreSQL/SQS de verdade.

## Auditoria de segurança

Feita nesta revisão por leitura de código + grep, não por suposição:

- Nenhum segredo, chave de API ou senha no código ou em `.env.example` (só URLs de proxy).
- Nenhum `.env` real commitado (`.gitignore` cobre `.env`; só `.env.example` existe no repo).
- Nenhum acesso direto a PostgreSQL ou SQS — `grep` confirmou zero imports de `pg`/`aws-sdk` no
  frontend; toda comunicação passa por `lib/api/client.ts`, que só fala HTTP com o proxy do Vite.
- Nenhuma função administrativa, botão de ajustar saldo arbitrariamente, ou atalho que escreva dado
  financeiro fora do fluxo real da API.
- `mutations.retry: false` no `QueryClient` global (`lib/api/queryClient.ts`) — nenhum POST
  financeiro é reenviado automaticamente pelo cliente. Confirmado também nos hooks individuais
  (`useCreateWallet`, `useSubmitTransaction`) e num teste dedicado
  (`test/noAutoRetry.test.tsx`).
- Nenhuma chamada financeira dispara em `useEffect`/montagem de página — toda mutação é acionada só
  por clique explícito do usuário num formulário, com proteção contra duplo-clique
  (`mutation.isPending` checado antes de reenviar).
- Nenhum `dangerouslySetInnerHTML`, `eval`, ou `new Function` em todo o `src/`.
- Único uso de armazenamento persistente no navegador é `localStorage` para lembrar qual instância
  (node-1/2/3) está selecionada — nenhum dado financeiro ou de sessão sensível é persistido.
  Histórico de wallets/transações visitadas na aba vive só em memória de React (Context), some ao
  recarregar.
- O Request Inspector tem uma lista de redação (`password`, `token`, `secret`, `accesskey`,
  `authorization`, `apikey`) que mascara qualquer campo sensível antes de exibir uma requisição —
  nenhum contrato atual carrega esses campos, mas o mecanismo já existe defensivamente.
- Sem CORS amplo: o frontend não define CORS (é o backend quem decide, e o backend não tem CORS
  habilitado em lugar nenhum — por isso o proxy existe). O dev server do Vite escuta só em
  `127.0.0.1`, nunca `0.0.0.0`.
- Sem autenticação fictícia: o backend não tem autenticação (`NoopAuthGuard`), e o frontend não
  finge que tem — não há tela de login nem token simulado.
- Uso estritamente local: nada neste frontend foi desenhado para ser exposto fora de `localhost`.

## Auditoria de precisão financeira

- `grep` por `Number(`, `parseFloat(`, `parseInt(`, `.toFixed(` em todo `src/` confirmou: nenhum
  desses é usado em código que manipula dinheiro. As únicas ocorrências de `.toFixed(` são
  `Decimal.prototype.toFixed` (de `decimal.js`, em `lib/money/format.ts` — correto e esperado) e
  formatação de durações/métricas (milissegundos, segundos — não dinheiro). O único `Number(raw)`
  existente é no parser de métricas Prometheus (`prometheus.ts`), que lê contadores/latências, não
  valores monetários.
- Todo valor monetário trafega como string decimal (`"25.00"`) do início ao fim — nunca convertido
  para `number` em nenhum ponto do fluxo de exibição ou de montagem de request.
- O frontend **nunca soma, subtrai ou recalcula saldo por conta própria** — `grep` por operadores
  aritméticos em campos `.amount`/`.balance` não encontrou nenhuma ocorrência. A tela de
  Reconciliação exibe exatamente `storedBalance`/`calculatedBalance`/`difference` como o backend
  devolve; nenhuma matemática client-side.
- Comparações de igualdade entre valores monetários (`verdicts.ts`, no Idempotency Lab) usam
  comparação de string (`===`) entre strings decimais canônicas já formatadas pelo backend — não
  há conversão para `number` nem risco de imprecisão de ponto flutuante nesse caminho.
- O schema Zod de `Money` (`types/schemas.ts`) usa a mesma regex do `MoneyDto` real do backend
  (`^(0|[1-9]\d{0,17})\.\d{2}$`), então um valor inválido nunca chega a ser enviado.
- Testes dedicados em `test/money-format.test.ts` cobrem formatação de valores com e sem milhares,
  incluindo o bug real encontrado e corrigido nesta revisão (espaço duplo quando a moeda não tinha
  símbolo mapeado).

Nenhuma violação encontrada nestas duas auditorias.

## Limitações e segurança

- **Não é produção.** Sem autenticação, sem rate limiting, sem HTTPS — um espelho direto das
  limitações já existentes no backend para este desafio.
- **Não é parte avaliada do desafio.** A avaliação real está no backend; este frontend é um
  complemento visual opcional.
- Uso estritamente local — nunca iniciar o dev server com `--host 0.0.0.0` nem expor a porta 5173
  fora do loopback.
- Auditorias de acessibilidade/responsividade e de performance (polling, re-render) ainda estão
  pendentes nesta revisão — ver `CODEX_HANDOFF.md` para o que falta.

## Documentação relacionada

- [`CLAUDE.md`](./CLAUDE.md) — regras permanentes de trabalho nesta pasta e achados de contrato
  confirmados por execução real da API.
- [`../README.md`](../README.md) — arquitetura, domínio e endpoints do backend.
- [`../ARCHITECTURE.md`](../ARCHITECTURE.md) — decisões e trade-offs do backend.
- [`../docs/STUDY_GUIDE.md`](../docs/STUDY_GUIDE.md) — glossário de termos (Idempotency-Key,
  Ledger, FIFO, Inbox/Outbox, etc.).
