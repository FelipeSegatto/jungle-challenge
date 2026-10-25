# Decisões de arquitetura — Distributed Wagering Processor

## Como ler este documento

O `challenge.md` pede, em pontos específicos, que certas decisões sejam justificadas **neste arquivo**, não só implementadas no código:

- Seção 2: se autenticação não for implementada, "documente a decisão no `ARCHITECTURE.md`, descreva o desenho que adotaria e deixe o ponto de extensão explícito no código".
- Seção 4: "A escolha, o mapeamento do `Money` e a estratégia transacional adotada devem ser justificados em `ARCHITECTURE.md`."
- Seção 7: "Qualquer interpretação adicional adotada deve ser documentada."
- Seção 7.1: "Limite de tentativas ou TTL definido e justificado por você."
- Seção 7.2: "A taxonomia [de `failureCode`] é sua — defina-a e documente-a."
- Seção 8: a estratégia de concorrência "deve ser justificada em `ARCHITECTURE.md`."
- Seção 14: "`ARCHITECTURE.md` com decisões, trade-offs e limitações" vale pontos de documentação, separado do `README.md`.

Este documento segue essa lista item por item. Cada decisão é apresentada como: **contexto** (o problema real, não o enunciado reescrito), **alternativas consideradas**, **decisão adotada** (com referência a arquivo e trecho de código), **trade-off** (o que se perde, não só o que se ganha) e, quando aplicável, **onde está validado**.

Se você quer entender o sistema caminhando pelo código com exemplos e diagramas, o lugar certo é o [`README.md`](README.md) e o [`docs/STUDY_GUIDE.md`](docs/STUDY_GUIDE.md). Este arquivo é sobre o *porquê*, não sobre o *como usar*.

---

## 1. Fronteira do domínio: por que HTTP e SQS chamam o mesmo caso de uso

**Contexto.** O desafio exige que o consumidor SQS "reutilize o mesmo use case da entrada HTTP" (seção 10). Isso não é só uma preferência de estilo — é uma garantia de correção: se a regra "`BET` debita, valida saldo, grava ledger" existisse em dois lugares (um para HTTP, outro para SQS), bastaria uma das duas cópias ficar desatualizada para o sistema aceitar, por exemplo, uma aposta sem saldo suficiente vinda só por um dos dois canais.

**Alternativas consideradas.**
- *Duplicar a lógica em cada adaptador* (um `WalletController` com a regra embutida, um `SqsHandler` com a regra reimplementada) — descartado de imediato: é exatamente o cenário de inconsistência acima.
- *Um "serviço de domínio" chamado por ambos, mas com a transação aberta em cada adaptador* — mais próximo do que foi feito, mas deixaria cada adaptador responsável por acertar a ordem de lock/commit, duplicando a parte mais sensível do desenho.
- *Um único caso de uso que já abre e fecha sua própria transação, recebendo um DTO e um contexto opcional de origem* — adotado.

**Decisão.** `WagerService.process(command: ProcessWagerDto, key: string, inbox?: InboxContext)` (`src/application/services.ts`) é chamado, com os mesmos tipos de argumento, por `WageringController.process` (`src/presentation/controllers.ts`) e por `consumeOnce` (`src/infrastructure/workers/consumer.ts`). A única diferença entre as duas chamadas é o parâmetro `inbox`, presente só quando a origem é a fila — porque só nesse caso existe um `messageId` de broker para deduplicar. Fora isso, é literalmente a mesma função, a mesma transação, as mesmas validações.

As camadas inferiores (`src/domain/*.ts`) não importam nada de `@nestjs/*` nem de `@mikro-orm/*`. Isso não é purismo: é o que permite afirmar, com confiança, que uma regra como "LOSS não gera lançamento" não pode silenciosamente divergir entre o caminho HTTP e o caminho SQS — ela só existe em um lugar, `WagerTransaction.affectsBalance()`.

**Trade-off.** Esse desenho exige que o DTO de entrada da fila seja validado com o mesmo rigor do DTO HTTP antes de chegar em `process()` — e de fato `consumer.ts` reconstrói um `ProcessWagerDto` e roda `class-validator` manualmente (`parseEvent`, em `consumer.ts`) antes de chamar o serviço, em vez de confiar que "já é JSON, deve estar certo". Se essa validação explícita for removida por engano, um payload malformado da fila cairia direto numa chamada ao domínio que não tem por que lidar com entrada não validada.

---

## 2. Autenticação (seção 2 do desafio)

**Contexto.** O desafio é explícito: autenticação não entra na nota (seção 14), e implementar ou não é uma escolha do candidato, desde que documentada. Os endpoints de `/health/*` ficam abertos por definição; mensagens da fila são "canal interno confiável", mas a identidade do provedor dentro da mensagem continua sujeita a validação de domínio (isso já está coberto: `providerId` é usado nas checagens de escopo de referência, independente de autenticação).

**Alternativas consideradas.**
- *Implementar autenticação própria* (tabela de usuários, hash de senha) — explicitamente proibido pelo próprio enunciado ("nada de tabela própria de usuários com hash de senha").
- *Integrar um Identity Provider real (Keycloak/Zitadel via OIDC)* — seria o caminho certo para produção, mas consome tempo que o enunciado pede para não ser gasto aqui, já que não pontua.
- *Omitir, com um ponto de extensão explícito e documentado* — adotado.

**Decisão.** `NoopAuthGuard` (`src/presentation/noop-auth.guard.ts`) está aplicado em todos os controllers exceto `HealthController`, e sempre retorna `true`. Ele existe como classe nomeada, injetável, e comentada — não como ausência silenciosa de guard. Trocar por um guard OIDC real não exigiria tocar em nenhum controller, DTO ou regra de negócio: só a implementação de `canActivate()` mudaria.

**O que mudaria em produção.** Hoje, `providerId` vem direto do corpo da requisição, sem verificação de que quem está chamando é de fato esse provedor. Com um IdP real, o fluxo correto seria: o guard decodifica o token (JWT/OIDC), extrai a identidade do provedor autenticado, e o `WagerService.process()` passaria a comparar essa identidade com o `command.providerId` do payload — rejeitando (`403`, não `422`) se um provedor autenticado tentar submeter uma transação em nome de outro. Esse comparativo não existe hoje porque não há identidade autenticada para comparar.

**Trade-off.** Qualquer chamador da API pode se declarar como qualquer `providerId`. Isso é aceitável para o escopo do desafio (seção 2 autoriza), mas é a limitação de segurança mais evidente do sistema — por isso está repetida aqui e na seção de [Limitações](#15-limitações-conhecidas), não escondida.

---

## 3. Money: modelagem e estratégia de persistência

**Contexto.** O desafio proíbe `number`/`float`/`double` para dinheiro, sob pena de falha eliminatória, e pede que a escolha de mapeamento seja justificada aqui.

**Alternativas consideradas.**
- *Inteiro em centavos* (`amount_cents: bigint`) — evita o problema de ponto flutuante, mas exige multiplicar/dividir por 100 em toda borda do sistema (serialização, logs, resposta HTTP), e isso é exatamente o tipo de lugar onde um fator de conversão errado passa despercebido.
- *`number`/`float` do JavaScript* — descartado, é a falha eliminatória que o enunciado cita.
- *Tipo decimal dedicado (`Decimal` via `decimal.js`), serializado como string decimal de escala fixa* — adotado.

**Decisão.** `Money` (`src/domain/money.ts`) embrulha um `Decimal` e expõe só operações que devolvem novas instâncias (`add`, `subtract`, `negate`). A validação de entrada (`Money.from`) usa uma regex fechada — `^(0|[1-9]\d{0,17})\.\d{2}$` — que rejeita, numa única checagem, string vazia, notação científica, mais de duas casas decimais, zero à esquerda e qualquer valor negativo no contrato de entrada. `NaN`/`Infinity` nunca chegam a ser avaliados como número — são rejeitados como string antes disso, porque a regex exige um formato puramente numérico.

No banco, a mesma quantia é `numeric(20,2)` (ver as `migrations/`), e a entidade MikroORM (`WalletRow.balance`, `WagerRow.amount`, `LedgerRow.amount`/`balanceBefore`/`balanceAfter` em `src/infrastructure/entities/rows.ts`) usa `DecimalType`, que o driver do Postgres retorna como `string`, não como `number` do JavaScript — a precisão nunca passa por um float em nenhum ponto do caminho, incluindo a camada ORM, que é um lugar fácil de esquecer.

A conversão entre `Money` (domínio) e a string de banco acontece só em `services.ts` (`mapWallet()`, e os `row.balance = wallet.balance.toJSON().amount` espalhados pelo arquivo) — o domínio nunca lê/escreve a entidade diretamente, e a entidade nunca carrega lógica de validação monetária.

**Escopo de moeda.** O domínio (`Money`) continua genuinamente multi-moeda — `add`/`subtract`/`isLessThan` chamam `assertSameCurrency()` e lançam `CURRENCY_MISMATCH` se as moedas diferirem, e isso é testado (`test/money.test.ts`, `test/wallet.test.ts`). A camada de aplicação (`WagerService`/`WalletService`), porém, hoje só aceita `BRL`, rejeitando qualquer outra moeda com `UNSUPPORTED_CURRENCY` antes mesmo de abrir uma transação. Essa é exatamente a redução de escopo que o enunciado autoriza ("todo o desafio pode assumir uma única moeda... desde que o modelo continue multi-moeda e os conflitos de moeda sejam testados") — a restrição é de aplicação, não de domínio.

**Trade-off.** `Decimal` custa mais alocação por operação que um `number` nativo. Irrelevante no volume deste desafio; relevante só se o sistema precisasse processar várias ordens de magnitude mais operações por segundo — nesse cenário, inteiro em centavos com conversão centralizada numa única camada de serialização seria a alternativa a reconsiderar.

---

## 4. ORM e estratégia transacional

**Contexto.** O desafio permite MikroORM (preferencial) ou TypeORM, e pede que a estratégia transacional seja justificada.

**Alternativas consideradas.**
- *TypeORM* — aceito pelo enunciado, mas com Unit of Work e Identity Map menos explícitos; `LockMode` como conceito de primeira classe é mais direto no MikroORM.
- *Prisma ou outro ORM* — fora do escopo permitido pelo enunciado.
- *MikroORM 7, com `EntityManager.transactional()` e `LockMode` explícito* — adotado.

**Decisão.** Toda operação que muda estado financeiro roda dentro de `this.em.transactional(async (em) => { ... })` (`WalletService.create`, `WagerService.process`, `WagerService.retryPendingReference`, todas em `src/application/services.ts`). Dentro desse callback: leituras com `em.findOne(..., { lockMode: LockMode.PESSIMISTIC_WRITE })` quando é preciso travar uma linha; `em.persist(entity)` registra a entidade no Unit of Work; `em.flush()` envia o SQL pendente **sem** commitar; o commit real só acontece quando o callback inteiro termina sem lançar.

Essa distinção entre `flush()` e commit importa porque algumas inserções dependem de outras já existirem, via FK composta, mesmo sem commit — por exemplo, `WalletRow` precisa existir antes do `WagerRow` da transação `OPENING`, porque há uma FK `(wallet_id, currency)` apontando para `wallets`. `services.ts` chama `em.persist(row); await em.flush();` explicitamente nesses pontos, não porque estivesse "salvando de verdade", mas porque o Postgres precisa ver a linha anterior para aceitar a próxima inserção, mesmo dentro da mesma transação aberta.

**Um ponto que já quebrou aqui.** Em algum momento do desenvolvimento, três desses pontos usavam `em.persistAndFlush(row)` — um método de conveniência que existia em versões anteriores do MikroORM e foi removido na v7. Isso não aparecia como erro de tipo em todo contexto de uso, mas quebrava em runtime (`TypeError: ... is not a function`) assim que qualquer wallet era criada ou qualquer transação processada — ou seja, o caminho principal do sistema inteiro. A correção foi migrar para o padrão explícito de dois passos acima. Isso está registrado aqui porque é exatamente o tipo de mudança de API entre versões maiores de uma dependência que não aparece lendo a documentação por cima — só rodando o código contra a versão real instalada.

**Trade-off.** Acoplamento ao MikroORM nas assinaturas internas de `services.ts` (o `EntityManager` é passado explicitamente). Isso é aceitável porque é só a camada de aplicação que conhece o ORM — o domínio (seção 1) continua isolado — mas significa que trocar de ORM, embora não exija tocar no domínio, exigiria reescrever `services.ts` quase inteiro.

---

## 5. Concorrência: por que pessimistic locking por wallet

**Contexto.** O desafio define a unidade de concorrência como a `walletId` e exige correção sob: duas apostas disputando o mesmo saldo, múltiplos workers na mesma wallet, wallets diferentes em paralelo, e três ou mais instâncias simultâneas — com um cenário obrigatório específico (wallet de R$ 100, duas `BET`s de R$ 80 concorrentes: uma `PROCESSED`, uma `REJECTED`, saldo final R$ 20, um único lançamento de débito, nenhum retry duplicando o débito).

**Alternativas consideradas.**

| Estratégia | Por que foi ou não escolhida |
|---|---|
| Mutex/semáforo em memória (lib JS) | Resolve dentro de **um** processo Node e nada além disso. Com 3 instâncias da API (exigência explícita do desafio), cada processo teria seu próprio mutex, sem relação com os das outras duas — é a "garantia que só funciona com uma instância", listada como falha eliminatória. Descartado de imediato. |
| Optimistic locking (campo `version`, retry em `OptimisticLockError`) | Funciona corretamente com múltiplas instâncias. Mas numa wallet com disputa alta (muitas operações concorrentes na mesma linha), geraria uma sequência de falhas de escrita e retries, em vez de simplesmente serializar o acesso — mais complexidade de retry no cliente/aplicação para o mesmo resultado final. |
| Update atômico condicionado (`UPDATE wallets SET balance = balance - X WHERE id = ? AND balance >= X`) | Resolve a aritmética do saldo num único statement, mas não resolve, por si só, a necessidade de também gravar o ledger e a transação na mesma operação lógica — o controle de concorrência do saldo e a atomicidade do conjunto (saldo + ledger + wager + outbox) acabariam precisando de mecanismos diferentes. |
| Lock global (uma única trava para todas as wallets) | Serializaria operações em wallets completamente independentes sem necessidade — e é explicitamente proibido pelo enunciado (seção 5: "não usar lock global compartilhado por todas as wallets"). |
| Pessimistic locking por linha de wallet (`SELECT ... FOR UPDATE`) | Adotado. |

**Decisão.** `em.findOne(WalletRow, { id }, { lockMode: LockMode.PESSIMISTIC_WRITE })`, dentro de `em.transactional()`, é a primeira operação de banco em `WagerService.process()` (depois do pre-check de idempotência, que não precisa da wallet — ver seção 6) e em `retryPendingReference()`. O MikroORM traduz isso para `SELECT ... FOR UPDATE` no Postgres: a segunda transação que tentar ler a mesma linha com `FOR UPDATE` **espera** até a primeira liberar o lock (commit ou rollback), em vez de ler um valor potencialmente obsoleto.

Isso resolve diretamente o problema de **lost update**: sem lock, duas transações concorrentes poderiam ler o mesmo saldo (100,00), calcular o resultado em memória (20,00 cada) e escrever de volta sem que nenhuma soubesse da outra — as duas gravariam 20,00, quando o correto seria uma delas falhar por saldo insuficiente. O enunciado proíbe esse padrão explicitamente (seção 5: "não implementar saldo como read → calculate → update sem controle de concorrência"), e o lock é o que impede.

A unidade do lock é a **linha da wallet**, não uma tabela inteira nem um recurso global — por isso wallets diferentes nunca se bloqueiam entre si, e o sistema escala em paralelismo proporcional ao número de wallets distintas sendo operadas, não ao número de requisições.

**Retry para erros transitórios de lock.** `WagerService.process` tenta até 3 vezes (`for (let attempt = 0; attempt < 3; attempt++)`) quando o Postgres devolve `40P01` (deadlock detected) ou `40001` (serialization failure) — erros de infraestrutura, não de negócio. Isso não elimina a possibilidade teórica de deadlock entre transações que travem linhas em ordens diferentes; reduz a superfície, porque o código sempre trava a wallet antes de qualquer outra coisa, na mesma ordem, em todos os caminhos — mas não existe (nem é afirmado existir) uma prova formal de ausência de deadlock.

**Segunda linha de defesa.** As constraints do banco (`UNIQUE(idempotency_key)`, `UNIQUE(provider_id, external_transaction_id)`, `CHECK(balance >= 0)`, o índice parcial de reversão única) continuam ativas independentemente do lock, e são o que recupera corretamente quando duas transações **não compartilham** lock de wallet — por exemplo, duas requisições com a mesma `Idempotency-Key` nova apontando (por engano, ou por tentativa de abuso) para wallets diferentes. Nesse caso, quem perde a corrida do `INSERT` recebe uma violação de unicidade (`23505`), não um estado inconsistente — e `services.ts` trata esse erro explicitamente, buscando o resultado do vencedor numa conexão nova em vez de propagar o erro de banco cru.

**Validado em:** `test/integration.test.ts` ("BET 80 + BET 80 simultâneas: só uma passa"), `scripts/race.ts` (mesmo cenário, requisições HTTP reais em paralelo) e `scripts/race-three.ts` (o mesmo cenário contra 3 processos HTTP independentes, via `docker-compose.yml`) — este último é o que prova que a solução não depende de estar tudo no mesmo processo.

---

## 6. Idempotência: `Idempotency-Key`, `payloadHash`, e por que a ordem de verificação importa

**Contexto.** O desafio exige idempotência persistente (não cache em memória), com o `Idempotency-Key` como fonte da verdade, e exige que a API distinga claramente conflito de idempotência de outras rejeições.

**Alternativas consideradas para a verificação de duplicidade.**
- *Cache em memória (`Map<string, Response>`)* — proibido explicitamente (seção 5) e inútil com múltiplas instâncias: cada processo teria seu próprio cache, sem visibilidade do que outra instância já processou.
- *Verificar só `(providerId, externalTransactionId)`, sem key dedicada* — o enunciado pede explicitamente um header `Idempotency-Key` separado, exatamente para permitir reenvio controlado por quem está integrando, independente de como o payload de negócio está estruturado.
- *`UNIQUE(idempotency_key)` na tabela de transações, com hash do payload de negócio para distinguir replay de conflito* — adotado.

**Decisão.** `payloadHash()` (`src/domain/hash.ts`) é SHA-256 sobre um JSON canônico — chaves ordenadas alfabeticamente, recursivamente, incluindo dentro de objetos aninhados como `money` — calculado só sobre campos de negócio (`providerId`, `externalTransactionId`, `walletId`, `playerId`, `roundId`, `gameId`, `kind`, `money`, `referenceExternalTransactionId`). O header `Idempotency-Key` em si e qualquer metadado de transporte (timestamps de requisição, `messageId` do SQS) nunca entram no hash — dois canais diferentes (HTTP e SQS) carregando a mesma operação de negócio produzem o mesmo hash.

A coluna `idempotency_key` em `wager_transactions` é `UNIQUE NOT NULL` — não é um `Map`, sobrevive a reinício de processo e é visível para todas as instâncias porque é a mesma linha de banco.

**A ordem da verificação é uma decisão própria, não só um detalhe de implementação.** A primeira versão deste projeto verificava a existência da wallet (existe? pertence a esse player? moeda compatível?) antes de verificar se a `idempotencyKey` já tinha sido usada com um payload diferente. O efeito colateral: reusar a mesma key com um payload que **também** fosse inválido por outro motivo (uma `walletId` inexistente, por exemplo) devolvia o código de erro desse outro motivo (`404 WALLET_NOT_FOUND` ou `422 PLAYER_WALLET_MISMATCH`) em vez de `409 IDEMPOTENCY_CONFLICT` — mesmo que o efeito financeiro estivesse protegido corretamente em ambos os casos. Isso viola a exigência da seção 9 de que a API distinga **com clareza e de forma consistente** conflito de idempotência de outras categorias de rejeição — um provedor que decide "não reenviar com esse payload" baseado no código de erro não deveria receber códigos diferentes para o mesmo problema de fundo (key reusada incorretamente), só porque o payload também violava outra regra.

A correção: `resolveByIdempotencyKey()` (`src/application/services.ts`) roda como a **primeira** operação dentro da transação de `WagerService.process()`, antes do `em.findOne(WalletRow, ...)`. Se a key já existe e o hash não bate, `IDEMPOTENCY_CONFLICT` é lançado imediatamente — a wallet nunca é consultada. Se o hash bate, a resposta original é devolvida — também sem tocar na wallet, o que tem o efeito colateral positivo de um replay puro não competir pelo lock pessimista da seção 5.

Essa checagem é repetida uma segunda vez, **depois** de o lock da wallet ser adquirido — não por redundância descuidada, mas para fechar a janela de corrida entre o pre-check (sem lock) e o momento em que o lock é obtido: duas requisições com a **mesma key nova** podem passar pelo pre-check simultaneamente (nenhuma das duas encontra nada ainda) e só uma das duas efetivamente grava a transação; a segunda, ao chegar à verificação pós-lock, já encontra a primeira e devolve o resultado dela em vez de tentar inserir de novo. A `UNIQUE(idempotency_key)` do banco é a terceira e última linha de defesa, para o caso em que as duas requisições nem compartilham lock de wallet (seção 5).

**Trade-off.** A validação de forma do payload (moeda suportada, referência exigida/proibida por `kind`, auto-referência) continua rodando **antes** do cálculo do hash e, portanto, antes do pre-check de idempotência — porque não é possível canonicalizar/hashear um payload que ainda não se sabe se é estruturalmente válido. Isso significa que reenviar a mesma key com um payload que também é malformado de forma nunca vai gerar `409` — vai gerar o `400` correspondente ao problema de forma. Essa precedência é consistente com a seção 9 do desafio tratar "payload inválido" como categoria **anterior** e distinta de "conflito de idempotência".

**Validado em:** `test/integration.test.ts`, bloco "IDEMPOTÊNCIA — mesma key, payload divergente, independente da wallet" (5 testes: amount, `playerId`, `walletId` válida de outro dono, `walletId` inexistente, replay idêntico) e `test/hash.test.ts` (o hash em si, isolado, sem banco).

---

## 7. Regras de negócio: interpretações adicionais adotadas

O desafio define as regras principais na seção 7, mas deixa espaço de interpretação em alguns pontos. Cada escolha abaixo é uma decisão de implementação, não uma regra explícita do enunciado — documentada aqui porque a seção 7 exige isso ("qualquer interpretação adicional adotada deve ser documentada").

**`WIN` pode referenciar uma `BET` de valor diferente, sem erro.** O enunciado exige igualdade de valor explicitamente só para `REFUND`/`ROLLBACK` ("o valor de REFUND/ROLLBACK deve ser igual ao valor da referência"). Para `WIN`, a leitura adotada foi: uma `WIN` representa o prêmio pago pela rodada, que é independente do valor apostado — exigir igualdade aqui não faria sentido de negócio (nenhum jogo paga de volta exatamente o que foi apostado como "vitória"). `WagerTransaction.ledgerDirectionFor()` nunca usa o valor da referência para decidir o crédito de uma `WIN`, só o `kind`.

**Uma `BET`/`LOSS` não pode carregar `referenceExternalTransactionId`.** O enunciado não proíbe isso explicitamente, mas também não define nenhum significado para uma `BET` ou `LOSS` referenciar outra transação — a leitura adotada foi tratar isso como payload inválido (`REFERENCE_NOT_ALLOWED`, 400), em vez de ignorar silenciosamente o campo.

**Auto-referência é rejeitada explicitamente.** Uma transação não pode referenciar o próprio `externalTransactionId` (`SELF_REFERENCE`, 400). O enunciado não cobre esse caso; sem essa checagem, uma `ROLLBACK` que, por erro do provedor, referenciasse a si mesma criaria uma dependência circular sem sentido de negócio (a transação precisaria estar `PROCESSED` para servir de referência, mas ainda não existe no momento em que está sendo criada).

**Escopo de referência exige `providerId`, `playerId`, `walletId`, moeda **e** `roundId` idênticos.** O enunciado pede que a referência "pertença ao mesmo provider, player, wallet, moeda e rodada" — a implementação verifica literalmente os cinco campos (`REFERENCE_SCOPE_MISMATCH` se qualquer um diferir), não uma aproximação por subconjunto.

**`REFUND` só referencia `BET`; `ROLLBACK` referencia `BET`, `WIN` ou `REFUND`; `WIN` só referencia `BET`.** Os dois primeiros estão explícitos no enunciado. A restrição de `WIN` (só pode referenciar `BET`, nunca outra `WIN` ou `REFUND`) é uma decisão de implementação consistente com o papel de `WIN` como resultado de uma aposta específica, não como reversão de outra coisa.

**Uma referência só pode ser revertida uma vez por tipo de reversão, não uma vez no total.** O enunciado diz "uma referência não pode ser revertida duas vezes pelo mesmo tipo de operação" — lido literalmente como: a mesma `BET` pode, em tese, receber um `REFUND` processado **e**, depois, um `ROLLBACK` processado (tipos diferentes de reversão), mas nunca dois `REFUND`s nem dois `ROLLBACK`s sobre a mesma referência. É por isso que o índice único parcial do banco (`wagers_one_reversal_per_kind`) inclui `kind` na chave, não só `reference_transaction_id`.

---

## 8. Referências fora de ordem: limite de tentativas e backoff

**Contexto.** A seção 7.1 do desafio pede explicitamente que o limite de tentativas (ou TTL) seja definido e justificado por quem implementa.

**Decisão.** `REFERENCE_MAX_ATTEMPTS` (variável de ambiente, padrão **10**) é o número de vezes que o worker de referências (`retryReferences()`, `src/infrastructure/workers/references.ts`, chamando `WagerService.retryPendingReference()`) tenta resolver uma transação `PENDING_REFERENCE` antes de desistir. O backoff entre tentativas é exponencial, com piso de 1 segundo e teto de 60 segundos: `Math.min(60000, 1000 * 2 ** tentativas)`.

**Por que 10, e por que exponencial com teto de 60s.** O cenário que esse limite precisa cobrir é latência real de rede/ordem de chegada entre operações relacionadas do mesmo provedor (uma `WIN` processada por um worker diferente, ou alguns segundos depois, da `BET` que ela referencia) — não uma situação em que a referência nunca vai existir. Dez tentativas com backoff exponencial a partir de 1s somam pouco mais de 1 minuto até a primeira pausa de 60s, e continuam tentando por vários minutos depois disso — tempo generoso para uma diferença de chegada real entre mensagens relacionadas, sem deixar uma transação verdadeiramente órfã (referência que o provedor nunca vai enviar, por engano ou bug do lado dele) pendurada indefinidamente consumindo um ciclo do worker a cada poucos segundos. O teto de 60s evita que, numa fila com muitas pendências antigas, o worker gaste tempo desproporcional reconsultando a mesma linha repetidamente em alta frequência.

**Esgotado o limite:** `REJECTED`/`REFERENCE_NOT_FOUND`, permanece no banco (nunca deletada), com um evento `WagerTransactionRejected` publicado — a seção 7.1 exige exatamente isso ("REJECTED com um failureCode que identifique a referência inexistente, e evento correspondente publicado").

**Trade-off.** Um provedor que legitimamente demora mais de ~10 minutos para enviar a operação referenciada (atraso extremo, não apenas latência) vai receber uma rejeição definitiva e precisaria reenviar a operação dependente com um novo `externalTransactionId`/`Idempotency-Key` — o sistema não reabre uma transação já `REJECTED`. Não há mecanismo de "segunda chance" além disso; se esse cenário fosse comum em produção, o parâmetro `REFERENCE_MAX_ATTEMPTS`/o teto de backoff seriam os primeiros candidatos a ajustar, e são configuráveis sem mudança de código justamente por isso.

**Validado em:** `test/references.test.ts` — resolução depois da chegada da referência (ambas as ordens de chegada, incluindo a regressão de `WIN` com valor diferente do da `BET`) e esgotamento de tentativas com `maxAttempts` reduzido para o teste ser rápido.

---

## 9. Taxonomia de `failureCode` (seção 7.2 do desafio)

**Contexto.** A seção 7.2 exige que toda rejeição carregue um `failureCode` "estável e legível por máquina, suficiente para o provedor decidir se reenvia, corrige o payload ou desiste", e que essa taxonomia seja definida e documentada por quem implementa.

**Decisão.** Os códigos usados pelo projeto (em `DomainError.code` e em `WagerTransaction._failureCode`) se agrupam em quatro categorias, pensadas a partir da pergunta que mais importa para o provedor: **o que eu faço a seguir?**

| Categoria | O provedor deve... | Códigos |
|---|---|---|
| Payload estruturalmente inválido | Corrigir o payload antes de reenviar — reenviar sem corrigir vai falhar do mesmo jeito | `MISSING_IDEMPOTENCY_KEY`, `INVALID_MONEY`, `INVALID_CURRENCY`, `UNSUPPORTED_CURRENCY`, `INVALID_AMOUNT`, `REFERENCE_REQUIRED`, `REFERENCE_NOT_ALLOWED`, `SELF_REFERENCE` |
| Conflito de identidade | Não reenviar a mesma `Idempotency-Key`/`externalTransactionId` com dados diferentes — usar uma key nova se a intenção é uma operação genuinamente diferente | `IDEMPOTENCY_CONFLICT`, `EXTERNAL_ID_CONFLICT`, `WALLET_ALREADY_EXISTS`, `INBOX_PAYLOAD_CONFLICT`, `INBOX_MESSAGE_CONFLICT` |
| Recurso referenciado não encontrado ou não pertencente | Verificar os IDs enviados (wallet, player) — não é um problema de o sistema estar indisponível | `WALLET_NOT_FOUND`, `TRANSACTION_NOT_FOUND`, `PLAYER_WALLET_MISMATCH`, `CURRENCY_MISMATCH` |
| Rejeição de regra de negócio, definitiva | Desistir dessa operação específica — reenviar não vai mudar o resultado, porque a condição que causou a rejeição é sobre o estado atual do sistema, não sobre o formato do payload | `INSUFFICIENT_BALANCE`, `REVERSAL_INSUFFICIENT_BALANCE`, `REFERENCE_NOT_PROCESSED`, `REFERENCE_SCOPE_MISMATCH`, `REFERENCE_AMOUNT_MISMATCH`, `INVALID_REFERENCE_KIND`, `ALREADY_REVERSED`, `REFERENCE_NOT_FOUND` |

Dois pares de códigos existem especificamente para que o provedor não precise adivinhar, a partir de uma mensagem de texto, qual das duas situações aconteceu:

- **`INSUFFICIENT_BALANCE` vs. `REVERSAL_INSUFFICIENT_BALANCE`.** Os dois significam "saldo não cobre a operação", mas são operacionalmente diferentes: o primeiro é uma aposta nova maior que o saldo disponível (decisão do jogador/jogo); o segundo é uma reversão (`ROLLBACK`) que deixaria o saldo negativo porque o jogador já usou o crédito em outra coisa (uma situação de estado acumulado, não da aposta em si). A seção 7 do desafio pede explicitamente essa distinção ("com um failureCode distinto do de uma aposta sem saldo — são situações operacionalmente diferentes").
- **`REFERENCE_NOT_FOUND` vs. os demais erros de referência.** `REFERENCE_NOT_FOUND` só é produzido depois que o limite de tentativas da seção 8 se esgota — nunca na submissão síncrona (uma referência ausente na hora vira `PENDING_REFERENCE`, não uma rejeição imediata). Os demais (`REFERENCE_SCOPE_MISMATCH`, `INVALID_REFERENCE_KIND`, `REFERENCE_AMOUNT_MISMATCH`, `ALREADY_REVERSED`) podem ocorrer tanto na submissão síncrona (a referência já existe, mas viola uma regra) quanto, mais tarde, pelo worker (a referência só apareceu depois, mas também viola a regra quando é finalmente encontrada) — nos dois casos, a resposta HTTP original pode já ter sido `202`, e a rejeição final só fica visível consultando a transação depois (`GET /wagering/transactions/:id`).

**Infraestrutura, não negócio.** `RETRY_LIMIT` (503) não é um `failureCode` de uma transação rejeitada — é um erro de conflito transacional persistente (deadlock/serialização) que esgotou as 3 tentativas da seção 5. Isso é proposital: o provedor **deve** reenviar esse caso (é seguro, porque a idempotência garante que não há duplo efeito), diferente de qualquer item das quatro categorias acima.

**Trade-off.** Essa taxonomia não é validada contra uma lista externa — é definida e usada de forma consistente dentro deste projeto, mas um provedor real precisaria de um contrato publicado (ex.: um enum versionado, ou um OpenAPI) para depender dela em produção. Hoje esse contrato é este documento e a tabela equivalente no `README.md`.

---

## 10. Mensageria: SQS, Inbox, Outbox, DLQ

**Contexto.** O desafio proíbe depender só do SQS FIFO para consistência, proíbe publicar eventos antes do commit, e exige recuperação correta após crash em qualquer ponto do fluxo.

**Inbox: por que é diferente de idempotência financeira.** `inbox_messages`, com `UNIQUE(consumer_name, message_id)`, deduplica **entregas do broker** — o mesmo `messageId` reaparecendo por redelivery (SQS reentrega se o `VisibilityTimeout` expirar antes do ACK). Isso é um problema diferente de idempotência financeira: duas entregas com `messageId`s diferentes podem representar a mesma operação de negócio (reenvio manual do provedor, por exemplo), e duas entregas com o mesmo `messageId` são, por definição, a mesma tentativa de entrega. A `idempotency_key` resolve o primeiro problema; a Inbox resolve o segundo. Os dois são verificados dentro da mesma transação de `WagerService.process()`, e a gravação da Inbox entra no mesmo commit da alteração financeira — uma mensagem nunca é "aceita" sem que o efeito dela (ou a ausência dele, no caso de replay) também esteja commitado.

**Outbox: por que não publicar direto no handler.** Publicar o evento dentro da mesma chamada que processa a transação financeira criaria uma janela onde o evento já saiu para o SQS mas a transação SQL ainda pode reverter (ex.: uma falha de rede no meio do `em.transactional()`, depois do `SendMessageCommand` mas antes do commit) — um consumidor externo reagiria a algo que nunca aconteceu de verdade no banco. A decisão foi gravar o evento (`outbox_messages`) **na mesma transação** da operação financeira, e publicar de verdade só depois, por um processo separado (`publishOutboxBatch()`, `src/infrastructure/workers/outbox.ts`), que só lê e publica linhas cujo commit já é garantido (porque, se a linha existe na tabela, a transação que a criou já comitou).

`publishOutboxBatch()` usa `SELECT ... FOR UPDATE SKIP LOCKED` para selecionar o lote a publicar — isso permite dois ou mais publishers rodando ao mesmo tempo (dois workers, por exemplo) sem que um espere o outro nem que os dois reivindiquem a mesma linha: cada linha pendente é travada por exatamente um publisher, e o outro, ao encontrá-la já travada, simplesmente a ignora naquele ciclo (não espera, não falha — `SKIP LOCKED` é desenhado para isso). Linhas que falham ao publicar (`SendMessageCommand` lançando erro) recebem `attempts += 1` e um `nextAttemptAt` com backoff exponencial, e permanecem pendentes para o próximo ciclo — nunca são descartadas.

**Trade-off deliberado.** A transação de claim mantém o lock de linha durante a chamada de rede ao SQS (curta, mas é I/O dentro de uma transação aberta). Em volume muito maior que o deste desafio, a alternativa seria um esquema de claim com lease/heartbeat — marcar a linha como "em processamento por X até T" sem manter uma transação SQL aberta durante o I/O, liberando-a se T passar sem confirmação. Para o escopo atual, `SKIP LOCKED` com lotes pequenos e timeout de rede curto (`AbortSignal.timeout(5000)` em `outbox.ts`) é mais simples e mais fácil de auditar, e o trade-off (segurar um lock de linha por alguns milissegundos de rede) não se paga ainda.

**Garantia real: at-least-once, nunca exactly-once.** Entre o `SendMessageCommand` ter sucesso e a gravação de `published_at` no mesmo lote, o processo pode cair — nesse caso, a linha continua parecendo pendente, e outro ciclo (ou outro publisher) pode publicar o mesmo evento de novo. O `MessageDeduplicationId=eventId` reduz duplicatas dentro da janela de deduplicação do FIFO, mas não é uma garantia permanente — um consumidor externo real precisaria deduplicar por `eventId` de forma durável, da mesma forma que este próprio sistema deduplica entrada por Inbox. O desafio é claro que o broker é at-least-once; a contribuição deste desenho é garantir que o *efeito financeiro* seja aplicado exatamente uma vez, o que é uma garantia mais forte e mais difícil do que "a mensagem chega uma vez" — e é essa, não a segunda, que o sistema de fato entrega.

**DLQ e classificação de erro no consumer.** `consumeOnce()` (`src/infrastructure/workers/consumer.ts`) classifica cada falha em três categorias: erro de negócio conhecido e terminal (ACK normal, a rejeição é um resultado válido, não uma falha de processamento — ex.: `INSUFFICIENT_BALANCE`); envelope/payload irrecuperavelmente malformado (vai direto para a DLQ, sem gastar as tentativas de redrive do SQS, porque não há nada que uma nova tentativa mudaria); erro transitório de infraestrutura (altera a visibilidade da mensagem com backoff exponencial, deixando o SQS reentregar — depois de 5 tentativas, o `RedrivePolicy` da fila move automaticamente para a DLQ).

**Validado em:** `test/messaging.test.ts` — redelivery depois do commit sem duplicar efeito, dois publishers concorrentes dividindo a Outbox sem perder nem duplicar reivindicação de linha, e recuperação de uma falha **real** de publicação (apontando deliberadamente para uma fila SQS inexistente — não um mock — e confirmando que o evento é republicado com sucesso num ciclo seguinte, dentro de um deadline controlado).

---

## 11. Ledger imutável e reconciliação

**Contexto.** A seção 6.4 exige que o ledger seja estruturalmente imutável — "sem campos mutáveis e sem métodos de transição... a imutabilidade é estrutural, não uma convenção."

**Decisão.** `WalletLedgerEntry` (`src/domain/ledger.ts`) não expõe nenhum método que altere um lançamento depois de criado — só leitura. `create()` recusa a própria criação se a aritmética não fechar (`balanceBefore ± money !== balanceAfter`), então não existe, em memória, um caminho para um objeto `WalletLedgerEntry` "errado" existir, nem por um instante.

Isso, por si só, garante imutabilidade na camada de aplicação, mas não impede um `UPDATE wallet_ledger_entries SET ...` escrito direto em SQL — por alguém depurando em produção, por um script de manutenção malfeito, por um bug futuro em outro lugar do código que nem passa por `WalletLedgerEntry`. Por isso a imutabilidade é reforçada **também** no banco: um trigger (`prevent_ledger_mutation`, nas migrations) lança excessão em qualquer `UPDATE` ou `DELETE` sobre `wallet_ledger_entries`, independente de quem ou o quê estiver tentando. O mesmo padrão protege as transições de `wager_transactions` fora de um estado terminal (`prevent_wager_terminal_change`).

**Reconciliação como prova viva da invariante.** `POST /wallets/:id/reconciliation` (`QueryService.reconcile`, em `services.ts`) soma todo o histórico do ledger (`CREDIT` menos `DEBIT`) e compara com `wallets.balance`. Isso não é um relatório estático — é a mesma invariante que fecha todos os testes de corrida ("`wallet.balance == saldo reconstruído pelo ledger`"), exposta como endpoint para que divergências sejam descobertas em operação, não só em teste. Uma divergência não é corrigida silenciosamente: é reportada na resposta (`consistent: false`), logada, e contabilizada na métrica `wagering_reconciliation_mismatch_total`.

**Por que não um ledger de partidas dobradas.** Double-entry bookkeeping (cada operação lançada em duas contas, nunca uma só) é citado no desafio como diferencial, não requisito. A decisão foi implementar o ledger por wallet exigido como obrigatório e investir o tempo restante nas garantias de concorrência/idempotência, que valem mais pontos na seção 14.

---

## 12. Observabilidade

**Decisão.** Logs estruturados em JSON (`src/infrastructure/observability/request-logger.ts`) carregam `correlationId`, `method`, `path`, `statusCode`, `durationMs`, `transactionId`, `walletId`, `providerId` — nunca o corpo da requisição nem um payload financeiro completo, só os identificadores necessários para correlacionar um incidente entre logs de instâncias diferentes. Métricas Prometheus (`src/infrastructure/metrics.ts`) cobrem exatamente a lista mínima da seção 12: transações por status, duplicatas, retries, mensagens em DLQ, conflitos de lock, outbox lag e latência de processamento — mais uma métrica própria de divergência de reconciliação, que não estava na lista mínima mas é diretamente útil para a invariante da seção 11.

`/health/live` e `/health/ready` são endpoints separados de propósito, não por capricho: um orquestrador de produção (Kubernetes, ECS) reinicia o processo quando `live` falha, mas só retira a instância do roteamento de tráfego quando `ready` falha — são decisões operacionais diferentes, e colapsar as duas num só endpoint obrigaria o orquestrador a reiniciar um processo saudável só porque uma dependência externa (Postgres/SQS) está temporariamente fora.

**Trade-off.** Não há tracing distribuído (OpenTelemetry) nem dashboard — `correlationId` nos logs permite reconstruir manualmente o caminho de uma requisição entre API e worker, mas não há visualização automática disso. Ver [Limitações](#15-limitações-conhecidas).

---

## 13. Validação executada

Esta implementação foi de fato compilada e testada com Bun, PostgreSQL e LocalStack em execução — não é uma expectativa para quem for rodar depois, é um resultado já observado nesta sessão de trabalho:

- `bun run typecheck` — limpo (TypeScript estrito, sem `any`/`ts-ignore`).
- `bun run test` (Money/Wallet/`payloadHash`) — 16/16.
- `bun run test:integration` (HTTP + PostgreSQL reais, 13 testes) — 13/13, incluindo os 5 cenários de `Idempotency-Key` reusada com `amount`/`playerId`/`walletId` divergentes.
- `bun run test:references` (referências fora de ordem) — 3/3, incluindo a regressão permanente de `WIN` referenciando `BET` com valor diferente, nos dois sentidos de chegada.
- `bun run test:messaging` (Inbox/Outbox/DLQ contra LocalStack real) — 3/3, reexecutado 8x consecutivas sem falha; o teste de publishers concorrentes força uma falha real de `SendMessageCommand` (fila inexistente, não mock) e prova recuperação via backoff até publicação completa dentro de um deadline controlado.
- `bun run test:race` e `bun run test:3instances` — cenário obrigatório da seção 8 (100,00 → duas `BET`s de 80,00) reproduzido com 3 processos HTTP independentes reais: uma `PROCESSED`, uma `REJECTED`, saldo final correto, um único lançamento de débito, reconciliação consistente.
- Migrations `up → down → down → up → pending` em banco descartável — reversíveis, sem pendências ao final.

A integridade de `Money` e os limites de valor são validados no domínio e no schema; a fronteira de autenticação é um no-op documentado (seção 2 deste documento).

---

## 14. Trade-offs — tabela-resumo

| Decisão | Alternativa preterida | Ganho | O que se perde |
|---|---|---|---|
| Pessimistic locking por wallet | Optimistic locking / mutex em memória | Correção garantida com N instâncias, sem lock global | Mais contenção numa wallet com volume muito alto de operações simultâneas |
| `decimal.js` + `numeric(20,2)` | Inteiro em centavos | Nenhuma conversão de escala em nenhuma borda do sistema | Mais alocação por operação que um inteiro/float nativo |
| MikroORM 7 com `LockMode` explícito | TypeORM | `SELECT ... FOR UPDATE` de primeira classe, API mais direta para o cenário de concorrência do desafio | API muda entre versões maiores (já aconteceu uma vez neste projeto — seção 4) |
| Pre-check de idempotência antes do lock de wallet | Verificar idempotência só depois do lock | `409` consistente mesmo quando o payload divergente também seria inválido por outro motivo; replay não compete pelo lock | Nenhum identificado — é estritamente uma correção sobre o desenho anterior |
| Outbox transacional + publisher separado, `SKIP LOCKED` | Publicar direto no handler da transação | Nunca publica algo que pode ser revertido; publishers concorrentes sem coordenação externa | Lock de linha mantido durante I/O de rede (mitigado, não eliminado) |
| DLQ imediata para erro de payload, backoff para erro transitório | Backoff para todo tipo de erro | Não desperdiça tentativas de redrive em algo que nunca vai se corrigir sozinho | Exige classificação de erro cuidadosa no consumer — um erro mal classificado como "transitório" retry inutilmente, mal classificado como "permanente" perde a chance de recuperação |
| `NoopAuthGuard` documentado | Integração OIDC real | Tempo investido em correção financeira/concorrência, que pontuam; ponto de extensão explícito | Nenhuma verificação real de identidade do provedor hoje |
| Monólito modular (camadas em código, não em deploy) | Workers/API como serviços separados desde já | Complexidade operacional proporcional ao que o desafio exige | Se o volume de mensageria crescer muito mais que o de HTTP, separar o deploy do worker (já é um processo distinto, `start:worker`) seria o próximo passo natural |

---

## 15. Limitações conhecidas

`FAILED` existe como status terminal auditável no modelo (`WagerStatus`), mas nenhum caminho de código atual o produz de fato: eventos SQS irrecuperavelmente malformados seguem para a DLQ em vez de criar uma transação financeira `FAILED` sem identidade de negócio válida (não há `walletId`/`playerId` confiável para associar a transação, já que o próprio payload é o que está malformado). Isso é uma decisão, não um esquecimento — mas significa que esse estado é alcançável na modelagem e inalcançável na prática.

Não existe dashboard gráfico nem OpenTelemetry distribuído (seção 12). Não existem testes de throughput com resultados medidos — não é declarado nenhum número de RPS/p95/p99 porque nenhum foi de fato medido neste repositório.

A verificação de `Idempotency-Key` roda antes de qualquer validação dependente da wallet (seção 6 deste documento), mas depende do payload já ter passado pela validação de forma (seção 6, último parágrafo) — um payload estruturalmente inválido nunca chega a gerar `409`, mesmo reusando uma key já conhecida.

A transação `OPENING` (abertura de wallet com saldo inicial) é montada como um registro direto em `WalletService.create()`, sem passar pela factory `WagerTransaction.create()` — um atalho de implementação para um caminho estritamente interno (não alcançável via API/fila, seção 6.3 do desafio: "`OPENING` é interno: não pode ser submetido pela API nem pela fila"), mas que foge, no sentido literal, da regra de modelagem da seção 6.0 ("toda transação nasce pela factory").

O guard de autenticação é um no-op (seção 2 deste documento) — qualquer chamador pode se declarar como qualquer `providerId`, sem verificação de identidade.

A transação de claim da Outbox mantém lock de linha durante a chamada de rede ao SQS (seção 10 deste documento) — aceitável no volume deste desafio, primeiro ponto a reconsiderar sob carga muito maior.

Não há teste automatizado simulando um `SIGTERM` real do worker durante uma chamada de rede em andamento — o comportamento esperado (o ciclo atual termina antes do loop checar o sinal de novo) está implementado em `src/worker-main.ts`, mas não exercitado por um teste que mate o processo de fato no meio de uma operação.

Migrations são `Migration202610230001` (schema base) e `Migration202610240002` (constraints compostas adicionais), ambas com `up()` e `down()` reversíveis. A segunda não edita o histórico já aplicado pela primeira — qualquer ajuste de constraint depois da primeira migration em produção deveria sempre ser uma migration nova, nunca uma edição retroativa de uma já aplicada.
