# Jungle Wagering Console — instruções para quem (humano ou Claude) trabalhar nesta pasta

Este arquivo existe para que qualquer sessão futura de trabalho em `frontend/` não precise reauditar o backend do zero. As regras abaixo foram confirmadas lendo o código e **executando a API de verdade** (não são suposições) — ver as datas/comandos na seção de evidências.

## O que é isto

Um frontend de demonstração (React + Vite) para o desafio técnico "Distributed Wagering Processor" da Jungle Gaming. Existe só para mostrar visualmente, numa entrevista, que o backend funciona — não é parte avaliada do desafio, não substitui os testes reais do backend (`../README.md#testes-e-evidências`), e não deve virar um produto.

Nome da interface: **Jungle Wagering Console**.

## Regras permanentes (não negociáveis sem o usuário reautorizar explicitamente)

1. Não alterar a lógica financeira do backend.
2. Não modificar migrations, entidades de domínio (`src/domain/`), locks ou workers.
3. Não inventar endpoints ou campos que não existam nos DTOs/controllers reais.
4. Não criar autenticação fictícia — o backend não tem autenticação (`NoopAuthGuard`), e o frontend não deve fingir que tem.
5. Não exibir dados simulados como se viessem do PostgreSQL. Se a API estiver fora, mostrar estado de erro/loading, nunca um mock disfarçado de dado real.
6. Nunca usar `number`, `parseFloat` ou aritmética binária para valores monetários — usar `decimal.js` (mesma lib do backend) para qualquer soma/formatação de exibição. Valores monetários são strings decimais (`"25.00"`), tratadas como tal.
7. O React nunca conversa direto com PostgreSQL ou SQS — só com a API HTTP do NestJS, via proxy do Vite.
8. Nenhum segredo, access key ou senha no frontend. O `.env` do frontend só tem a URL de destino do proxy (`VITE_API_PROXY_TARGET`), nada mais.
9. Não adicionar dependências que não estejam na lista da seção "Stack" abaixo sem necessidade concreta e justificada.
10. Não criar abstrações desnecessárias (sem Redux/Zustand, sem router para 3 páginas, sem design system próprio) — é uma ferramenta de demonstração.
11. Não alterar nenhum arquivo fora de `frontend/` sem autorização explícita do usuário.
12. Não introduzir funcionalidade financeira nova — o frontend só expõe o que a API já faz.
13. Toda operação que mova dinheiro (`POST /wagering/transactions`) exige confirmação explícita do usuário na UI antes de disparar a chamada. Nenhuma chamada automática/em background pode mover saldo.
14. Uso só local. O dev server do Vite nunca deve ser iniciado com `--host 0.0.0.0` nem exposto fora de `localhost`, porque a API não tem autenticação.
15. Toda decisão de contrato (formato de campo, código de erro, shape de resposta) documentada aqui foi confirmada no código e/ou numa chamada HTTP real — não por leitura do `challenge.md` isoladamente. Se o backend mudar, estas notas precisam ser revalidadas antes de confiar nelas de novo.

## Stack confirmada

React, TypeScript estrito, Vite, Tailwind CSS, `@tanstack/react-query`, Zod, `lucide-react`, `decimal.js`. Sem router, sem state manager global, sem UI kit. `package.json` próprio dentro de `frontend/`, independente do `package.json` do backend na raiz.

**Testes — duas suítes, de propósito:** `bun test src` (lógica pura pré-existente: schemas de domínio como `scenarioBuilders`/`verdicts`/`prometheus` — sem DOM) e `vitest run` / `bun run test:ui` (Vitest + React Testing Library + MSW, em `frontend/test/`, para schemas Zod, formatação monetária, montagem de requests/headers, estados de componente e comportamento de formulário). `bun run test:all` roda as duas. Nunca migrar a suíte pura para Vitest só por estética — não há benefício concreto e seria puro churn.

**Pinos de versão não-óbvios em devDependencies — não "atualizar" sem reler isto:**
- `vitest@^3` (não `^5`): Vitest 5 exige Vite 6+ (`vite/module-runner` não existe no Vite 5 que este projeto usa). Só subir para Vitest 5 junto com uma subida deliberada do Vite.
- `jsdom@^25` (não a mais nova disponível na época): achado real desta revisão — o `fetch` embutido do jsdom conflitava com o interceptor de baixo nível do MSW (`AbortSignal` de realms diferentes), quebrando qualquer teste MSW que devolvesse corpo JSON. Contornado trocando `fetch`/`Headers`/`Request`/`Response` globais pelos do pacote `undici` em `test/setup.ts` — ver o comentário lá antes de mexer nisso.

## Como a API realmente se comporta (confirmado por execução, não só leitura)

Backend sem `app.enableCors()` em `src/main.ts` — chamar a API direto do dev server do Vite dá erro de CORS. **Use sempre o proxy do Vite** (`/api/*` → `http://localhost:3000` por padrão, configurável via `VITE_API_PROXY_TARGET` para apontar pra `3001`/`3002`/`3003` quando rodando via `docker-compose.yml`). Nunca chame a API com URL absoluta a partir do browser.

Envelope de erro, sempre o mesmo shape, em todos os endpoints:
```json
{ "code": "WALLET_NOT_FOUND", "message": "Carteira não encontrada.", "statusCode": 404, "path": "/wallets/..." }
```

**Confirmado por execução real** (não documentado em lugar nenhum antes): quando o erro vem do `ValidationPipe` (DTO malformado, ou campo desconhecido — o backend tem `forbidNonWhitelisted: true`), `message` é sempre a string genérica `"Bad Request Exception"`, `code` é `"HTTP_VALIDATION_ERROR"`. **O backend não devolve qual campo falhou.** Isso não é bug nem viola o enunciado (a seção 9 do `challenge.md` exige distinguir categorias por status/code, não detalhar campo) — mas significa que a única forma de dar feedback útil de validação pro usuário é validar com Zod **antes** de enviar, espelhando os DTOs reais (`src/presentation/dtos.ts`):

- `MoneyDto`: `amount` deve bater com `^(0|[1-9]\d{0,17})\.\d{2}$` (string decimal, 2 casas, sem negativo, sem notação científica); `currency` com `^[A-Z]{3}$`.
- `CreateWalletDto`: `playerId` (UUID), `initialBalance: MoneyDto`.
- `ProcessWagerDto`: `providerId`/`externalTransactionId`/`roundId`/`gameId` (string não vazia), `playerId`/`walletId` (UUID), `kind` (`BET`|`WIN`|`LOSS`|`REFUND`|`ROLLBACK`), `money: MoneyDto`, `referenceExternalTransactionId?` (string não vazia, opcional — obrigatório só para `REFUND`/`ROLLBACK`, e o backend rejeita se vier em `BET`/`LOSS`).

**Confirmado por execução real:** `createdAt` no retorno de `GET /wallets/:id/ledger` vem como `"2026-10-25 15:13:44.169+00"` — formato de timestamp do Postgres (espaço, sem `T`), não ISO-8601 estrito. `new Date(valor)` parseia certo no browser/Bun, mas **não** use `z.string().datetime()` do Zod nesse campo — ele exige `T` e rejeitaria esse valor real. Use `z.string()` simples e faça `new Date(...)` depois, fora da validação. (Isso não viola o enunciado: a exigência de ISO-8601 na seção 11 é só para o envelope de `IntegrationEvent`, que usa `.toISOString()` corretamente — não para este endpoint de consulta, que não tem formato contratual definido no `challenge.md`.)

`POST /wagering/transactions` devolve `200` para `PROCESSED` (inclusive replay), `202` para `PENDING_REFERENCE`, `422` para `REJECTED` — e o corpo de um `422` tem o mesmo shape de sucesso (`transactionId`, `status`, `balance`, `failureCode` preenchido, `idempotentReplay`). **Não tratar `422` nesse endpoint como erro de rede/formulário** — é uma resposta de negócio válida e deve ser renderizada como tal (ex.: "Rejeitado: saldo insuficiente"), não como um alerta de erro genérico.

Replay idempotente (mesma `Idempotency-Key`, mesmo payload) devolve o **mesmo** `transactionId` e o saldo **daquele momento**, não o saldo atual da wallet — confirmado comparando os dois retornos numa chamada real.

## Endpoints, contratos e exemplos de resposta reais

Ver a tabela completa em [`../README.md#api--endpoints-e-exemplos`](../README.md#api--endpoints-e-exemplos) — os exemplos ali já foram conferidos contra os DTOs e controllers reais. As respostas HTTP exatas (incluindo os casos de erro) foram recapturadas nesta auditoria e estão no histórico desta sessão; se precisar reconfirmar, os comandos `curl` usados estão reproduzíveis com a API local rodando (`bun run start` na raiz do projeto, depois `curl http://localhost:3000/...`).

## Documentação do backend (ler antes de implementar qualquer tela)

- [`../README.md`](../README.md) — arquitetura, domínio, todos os endpoints, exemplos reais.
- [`../ARCHITECTURE.md`](../ARCHITECTURE.md) — decisões e trade-offs do backend.
- [`../docs/STUDY_GUIDE.md`](../docs/STUDY_GUIDE.md) — glossário dos termos (Idempotency-Key, Ledger, FIFO, etc.) usados aqui também.
- [`../challenge.md`](../challenge.md) — enunciado original.

## Status

Auditoria concluída. Implementação **ainda não iniciada** — aguardando instrução explícita do usuário para começar o scaffold (seção "Sequência de implementação" combinada com o usuário).
