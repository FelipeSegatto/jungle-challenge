# Demonstração do case para revisão técnica

## Roteiro de 12–15 minutos

1. **0–2 min — Contexto.** Diferencie idempotência de concorrência. Defina invariantes: saldo >= 0, ledger auditável, nenhum débito repetido e mesmo commit para Inbox/Outbox.
2. **2–4 min — Arquitetura.** Mostre `src/domain`, `src/application/services.ts`, entidades/migrations e `src/infrastructure/workers`. Explique por que `Money` não conhece NestJS e por que a unidade de lock é `walletId`.
3. **4–6 min — Demo.** Execute `powershell -ExecutionPolicy Bypass -File .\scripts\demo.ps1`; mostre OPENING, BET, replay idempotente e reconciliação.
4. **6–9 min — Concorrência.** Com `api1,api2,api3` ativos, execute `bun run test:3instances`. Mostre um débito para 50 duplicatas e uma aposta de R$ 80 rejeitada sob disputa.
5. **9–12 min — Assíncrono.** Mostre mensagens em `wager-transactions.fifo`, a Inbox, os workers, Outbox pendente/publicada e o teste de redelivery após commit antes do ACK.
6. **12–15 min — Falhas.** Explique recuperação de referências, DLQ, limite de tentativas e exatamente o que o sistema não garante (`at-least-once`, sem consumidor externo confiável sem Inbox própria).

## Perguntas que um sênior provavelmente fará

**Por que pessimistic locking e não optimistic?** A carteira é o ponto de disputa e operações monetárias precisam de ordenação local; um lock por linha evita retries frequentes em hot wallets. Locks em carteiras independentes não se bloqueiam. Para carga alta, poderíamos estudar update condicional com estratégias de retry.

**Por que FIFO se PostgreSQL já bloqueia?** FIFO otimiza ordenação e reduz colisões. O banco garante correção independentemente da fila e cobre também a API HTTP.

**Por que gravar o saldo da resposta?** Idempotência exige replay do resultado original, não consulta ao saldo atual após novas transações.

**O que ocorre se o worker morrer entre commit e ACK?** Reentrega. Inbox e idempotência persistentes impedem novos efeitos.

**O que ocorre se o publisher morrer depois do envio e antes de `published_at`?** Possível reenvio. Eventos possuem `eventId` e o consumidor precisa deduplicar.

**Por que não fez autenticação?** O case não a pontua e autoriza omissão documentada. Foi mantido um ponto de extensão para OIDC/Keycloak, priorizando correção financeira.

**O que ainda melhoraria?** Load testing real, claims de Outbox com lease, tracing, autenticação OIDC de provedores e métricas agregadas centralmente.
