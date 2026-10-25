# Demonstração do case para revisão técnica

Roteiro para apresentar o projeto em 10-15 minutos, mais as perguntas que um revisor sênior provavelmente vai fazer. Não é um discurso para memorizar — é uma lista de pontos para estruturar a própria explicação, apoiada no que está em [README.md](README.md).

## Roteiro de 10-15 minutos

1. **0-2 min — Problema de negócio.** Um provedor de jogo envia `BET`/`WIN`/`LOSS`/`REFUND`/`ROLLBACK`. A entrega é at-least-once — a mesma operação pode chegar duplicada ou fora de ordem, e duas instâncias podem tocar a mesma wallet ao mesmo tempo. As invariantes que não podem quebrar: saldo nunca negativo, ledger sempre auditável, nenhum débito repetido, Inbox/Outbox no mesmo commit da operação financeira.

2. **2-4 min — Arquitetura.** Mostre `src/domain` (Money, Wallet, WagerTransaction, WalletLedgerEntry — sem nenhum import de NestJS ou MikroORM), `src/application/services.ts` (o caso de uso compartilhado por HTTP e SQS) e `src/infrastructure` (persistência, mensageria, workers). Explique por que `Money` não conhece framework e por que a unidade de lock é `walletId`, não uma tabela inteira.

3. **4-6 min — Demo ao vivo.** Com `docker compose up -d --build` de pé, rode `powershell -ExecutionPolicy Bypass -File .\scripts\demo.ps1` — ele cria uma wallet, processa uma `BET`, repete a mesma requisição com a mesma `Idempotency-Key` e confere a reconciliação. Mostre o JSON de resposta do replay (`idempotentReplay: true`, mesmo saldo).

4. **6-9 min — Concorrência.** Com `api1`/`api2`/`api3` ativos, rode `bun run test:3instances`. Mostre o resultado: uma `BET` de R$ 80 `PROCESSED`, a outra `REJECTED` por `INSUFFICIENT_BALANCE`, saldo final correto, um único lançamento de débito. Explique o `SELECT ... FOR UPDATE` por trás disso.

5. **9-12 min — Assíncrono.** Mostre as três filas (`wager-transactions.fifo`, dlq, `wager-events.fifo`), a tabela `inbox_messages`, o worker (`src/worker-main.ts`) e a tabela `outbox_messages`. Rode `bun run test:messaging` e explique os dois testes: dois publishers concorrentes dividindo a Outbox, e recuperação depois de uma falha real de publicação (fila inexistente, forçada de propósito).

6. **12-15 min — Falhas e limites.** Explique o worker de referências fora de ordem (`WIN` chegando antes da `BET`), o DLQ, o limite de tentativas, e seja direto sobre o que o sistema **não** garante: entrega exactly-once (é at-least-once, com efeito financeiro idempotente), autenticação de provedor (decisão documentada, fora do escopo pontuado), e número de throughput medido (não existe teste de carga neste repositório).

## Perguntas que um revisor sênior provavelmente vai fazer

**1. Por que pessimistic locking e não optimistic?**
A wallet é o ponto de disputa, e operações monetárias concorrentes na mesma wallet precisam de ordenação local, não de detectar o conflito depois e pedir pro cliente tentar de novo. Um lock por linha evita um fluxo de retry constante em wallets com volume alto ("hot wallet"). Wallets diferentes nunca se bloqueiam entre si, porque o lock é por linha, não por tabela.

**2. Por que FIFO no SQS se o PostgreSQL já resolve a concorrência?**
FIFO com `MessageGroupId=walletId` otimiza a ordenação e reduz a chance de duas mensagens da mesma wallet serem processadas por workers diferentes ao mesmo tempo. Mas é otimização — o enunciado é explícito que o banco precisa garantir a correção independentemente da ordem de entrega, e é isso que o lock + as constraints fazem.

**3. Por que gravar o saldo da resposta (`response_balance_amount`) em vez de recalcular no replay?**
Idempotência exige devolver o resultado **original**, não uma fotografia do presente. Entre a primeira chamada e um replay, outras operações podem ter mudado o saldo da wallet; se o replay consultasse o saldo atual, duas chamadas com a mesma key e o mesmo payload poderiam devolver respostas diferentes, o que quebra a própria definição de idempotência.

**4. O que acontece se o worker morrer entre o commit e o ACK da mensagem SQS?**
O SQS reentrega depois do `VisibilityTimeout` expirar. A Inbox (dedup por `consumerName`+`messageId`) e a `idempotencyKey` reconhecem que aquela operação já foi aplicada, e o consumer só confirma (ACK) sem gerar um novo efeito financeiro. Testado em `test/messaging.test.ts`.

**5. O que acontece se o publisher da Outbox morrer depois de mandar a mensagem pro SQS mas antes de marcar `published_at`?**
A mensagem pode ser reenviada por outro ciclo do worker, porque a linha ainda aparece como pendente. Isso é aceito de propósito: o evento tem um `eventId` estável, e o consumidor externo precisa deduplicar por ele. O sistema garante at-least-once na entrega do evento, não exactly-once — e é explícito sobre essa diferença.

**6. Por que não implementar autenticação?**
O próprio enunciado diz que autenticação não entra na nota (seção 2 do `challenge.md`) e autoriza omitir, desde que documentado. O `NoopAuthGuard` é o ponto de extensão explícito — trocar por OIDC/Keycloak não exigiria tocar em nenhuma regra de negócio, só nesse guard.

**7. Como o sistema evita duplicar o débito quando a mesma aposta é enviada 50 vezes em paralelo?**
Duas camadas: a constraint `UNIQUE(idempotency_key)` no banco garante que só um `INSERT` vence a corrida; o processo que perde captura o erro de violação de unicidade (`23505`), busca o vencedor numa conexão nova e devolve o resultado dele, em vez de tentar de novo. Isso funciona mesmo que as 50 requisições caiam em wallets diferentes por engano (não deveriam, mas o mecanismo não depende disso).

**8. Qual é a diferença entre a Inbox e a verificação de `Idempotency-Key`?**
A Inbox deduplica **entregas de mensagem** (mesmo `messageId` chegando de novo, por redelivery do broker). A `Idempotency-Key` deduplica a **operação de negócio**, que pode ter chegado por HTTP ou por SQS, com `messageId`s diferentes em tentativas diferentes. As duas são checadas na mesma transação, mas resolvem problemas diferentes.

**9. Por que o pre-check de idempotência roda antes de verificar se a wallet existe?**
Porque senão, reusar a mesma `Idempotency-Key` com um payload que também é inválido por outro motivo (uma `walletId` que não existe, por exemplo) devolveria o código de erro desse outro motivo (`404`) em vez de `409 IDEMPOTENCY_CONFLICT` — e o provedor precisa de uma resposta consistente pra saber que não deve reenviar com dados diferentes sob a mesma key, independente de qual outro problema o payload divergente também tenha.

**10. Uma `WIN` de R$ 50 pode referenciar uma `BET` de R$ 10? Isso não devia dar erro?**
Não dá erro, e está certo não dar. A exigência de valor igual entre a operação e a referência só existe para `REFUND`/`ROLLBACK` (que literalmente desfazem algo). Uma `WIN` paga o prêmio da rodada — o valor dela é independente do valor apostado.

**11. O que acontece quando uma `REFUND` ou `ROLLBACK` chega antes da operação que ela referencia?**
A transação fica em `PENDING_REFERENCE`, com a wallet intocada, e um worker (`retryReferences`) reprocessa periodicamente com backoff exponencial até achar a referência ou esgotar o limite de tentativas (10, configurável). Se esgotar, vira `REJECTED`/`REFERENCE_NOT_FOUND`, mas continua auditável — nunca é deletada.

**12. Como você garante que o caminho síncrono e o caminho de retry de referência dão o mesmo resultado?**
Os dois chamam as mesmas validações de escopo/kind/valor sobre a referência. Isso já quebrou uma vez durante o desenvolvimento deste projeto: o retry aplicava a checagem de "valor igual ao da referência" sem restringir a `REFUND`/`ROLLBACK`, então uma `WIN` com valor diferente da `BET` passava no caminho síncrono mas era rejeitada por engano se chegasse primeiro e fosse resolvida pelo worker depois. Hoje existe um teste de regressão permanente (`test/references.test.ts`) exatamente pra isso não voltar a acontecer.

**13. O que o ledger garante que o saldo da wallet, sozinho, não garante?**
Auditabilidade. O saldo é um número que já esqueceu como chegou lá; o ledger é a lista completa e imutável (trigger no banco impede `UPDATE`/`DELETE`) de cada movimento, com saldo antes e depois de cada um. A reconciliação (`POST /wallets/:id/reconciliation`) é a prova disso: soma o ledger inteiro e compara com o saldo materializado.

**14. O sistema garante ausência de deadlock?**
Não. O que existe é retry limitado (3 tentativas) para os códigos de deadlock (`40P01`) e falha de serialização (`40001`) do Postgres, e uma ordem consistente de aquisição de lock (sempre a wallet primeiro). Isso reduz a probabilidade, não elimina a possibilidade teórica — não haveria como afirmar isso sem uma prova formal, que este projeto não tem.

**15. O que você melhoraria com mais tempo?**
Teste de carga real com números medidos (hoje não existe nenhum), claims com lease na Outbox para não segurar transação durante a chamada de rede ao SQS, tracing distribuído, e mover a transação `OPENING` para passar pela mesma factory de domínio que as demais operações usam, em vez do atalho atual.
