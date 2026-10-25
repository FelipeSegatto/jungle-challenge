# Validação do backend e apresentação

Use Bun 1.4.4 e Docker Engine acessível. A aplicação continua usando os nomes de filas originais quando `SQS_QUEUE_PREFIX` está ausente.

## Execução segura dos testes

Na raiz:

```bash
bun install --frozen-lockfile
bun run typecheck
bun run test:all
```

`test:all` agora cria dois containers exclusivos (PostgreSQL e LocalStack), um banco com nome aleatório terminado em `_test`, três APIs em portas locais disponíveis e um prefixo de filas diferente para cada suíte. Não usa `.env` como destino do banco e não purga filas existentes. O PostgreSQL descartável usa tmpfs de 512 MB; os processos de API/worker reiniciam mantendo esse banco durante o teste. Ao final ou em SIGINT/SIGTERM, remove somente os containers/volumes que criou. Logs das APIs ficam no diretório temporário informado na saída.

Para executar apenas uma parte, também isolada:

```bash
bun run test:isolated test:crash-recovery test:sigterm
bun run test:isolated test:consumer-retry test:consumer-dlq-persistent
bun run test:isolated test:inbox-replay test:atomicity
```

Os scripts individuais de integração são usados internamente pelo runner. O guard exige `BASE_URL` e `BASE_URLS` locais explícitos, além do banco/SQS de teste. Rejeita destinos remotos, credenciais embutidas, caminhos, query e fragmento; `BASE_URLS` precisa ter pelo menos três origens distintas. Os scripts standalone de corrida também verificam seus destinos antes de qualquer requisição. Executá-los sem os destinos de teste explícitos falha antes de acessar o banco/fila. `bun run test` continua executando as unidades sem Docker. Não se deve contornar essa proteção para apontar testes à demonstração.

## Evidência por cenário

| Suíte | Evidência exigida | Requisito |
|---|---|---|
| `test` | Money, Wallet, hash, transições terminais, referência por tipo, inbox/outbox, proteção do ambiente | Seções 6 e 13 |
| `test:integration` | Operações HTTP, constraints, rollback, replay histórico e conflitos | Seções 7, 9 e 13 |
| `test:atomicity` | Falha real de INSERT na Outbox reverte saldo/versão, wager, ledger e inbox; depois do cleanup do trigger, a mesma operação aplica uma vez e seu replay não duplica efeitos | Seção 11 |
| `test:parallel-wallets` | Seis wallets com operações concorrentes; saldo 80 e ledger reconstruído por wallet | Seção 8 |
| `test:inbox-replay` | Replay HTTP→SQS registra inbox; dez replays concorrentes não duplicam ledger/outbox; envelope alterado conflita | Seções 10 e 11 |
| `test:crash-recovery` | SIGKILL após commit, recepção número 2 em outro worker e ACK confirmado; API realmente reiniciada, replay preservado e envelopes da outbox recebidos e comparados na fila de saída | Seções 10, 11 e 13 |
| `test:sigterm` | Mensagem em andamento termina, ACK é confirmado, worker emite `worker_stopped` e sai com código 0 dentro do prazo | Seção 10 |
| `test:consumer-retry` | Rejeição de negócio com ACK; falha transitória com recepções 1 e 2 e intervalo mínimo de backoff; JSON inválido enviado diretamente à DLQ na tentativa 1 | Seção 10 |
| `test:consumer-dlq-persistent` | Recepções 1–5 e intervalos exponenciais; mensagem real na DLQ, sem operação financeira; métrica de backlog inclui redrive automático | Seções 10, 12 e 13 |
| `test:references` | REFUND antes da BET; referência ausente esgota limite; WIN antes/depois da BET | Seção 7.1 |
| `test:messaging` | Inbox/redelivery, publishers concorrentes e falha de publicação com recuperação | Seção 11 |
| `test:race`, `test:3instances` | 100−80−1=19; dois débitos; 50 duplicatas resultam em um efeito; reconciliação consistente | Seções 8 e 13 |

ACK é comprovado pelo evento `sqs_processed`, emitido **depois** da resposta bem-sucedida de `DeleteMessage`, não pela ausência de mensagem em uma recepção do SQS. O teste de crash também exige a contagem real de reentrega. O cenário de reinício confere tanto as linhas da outbox quanto o conteúdo recebido na fila.

O teste SIGTERM exige encerramento gracioso e não aceita morte abrupta seguida de recuperação como substituto. A plataforma de referência é Linux/Docker; uma falha em outro sistema deve ser investigada como incompatibilidade, sem relaxar o teste.

## Métricas e segurança

- `wagering_dlq_total` mantém seu significado: mensagens enviadas diretamente à DLQ pelo consumidor.
- `wagering_dlq_messages`, exposta pelo worker em `/metrics`, mede o backlog atual visível, em trânsito e atrasado da DLQ, incluindo redrive automático. É uma gauge aproximada do SQS, não contador histórico global; não some valores de workers que observam a mesma fila.
- Hooks `TEST_SYNC_*`/`TEST_FAULT_*` são rejeitados fora de `NODE_ENV=test`, endpoints locais, banco `_test` e prefixo de filas `jungle-test-`. Não há endpoint HTTP de controle.
- O harness drena stdout/stderr, usa porta 0 para métricas e faz limpeza após cada teste, inclusive em falhas. O shutdown tem prazo e escalonamento para SIGKILL apenas na limpeza.
- Inbox e outbox possuem factories e transições de domínio; as linhas ORM permanecem adaptadores de persistência. OPENING usa uma factory interna e continua proibido nos DTOs públicos.
- O Dockerfile usa Bun 1.4.4 e copia o lockfile antes de `bun install --frozen-lockfile`.
- `multer` está fixado por override na versão 2.5.0, que corrige o advisory GHSA-q7qp-rjg7-q26m. Não há endpoint de upload adicionado.

## Limites da evidência

Testes reais em LocalStack não substituem validação operacional na AWS. O publisher permanece at-least-once; duplicação de entrega é possível e não equivale a duplicação financeira. Não há promessa de throughput nem de segurança absoluta. O processamento inicial e o reprocessamento de referências ainda compartilham algumas regras por implementação duplicada; uma refatoração maior desse fluxo deve ser feita separadamente, mantendo a cobertura de regressão.


## Imagem Docker

O Dockerfile usa Bun 1.4.4 e instala com lockfile congelado antes de copiar o código. O `.dockerignore` exclui dependências locais, `.git`, logs, saídas de build e arquivos `.env*`, preservando apenas os exemplos. O Compose continua fornecendo `.env.docker` em runtime: esse arquivo não precisa estar dentro da imagem.

```bash
docker build -t jungle-challenge .
docker compose up -d --build
```

Quando o registro npm é acessado por um proxy com CA privada, forneça a CA como segredo temporário do BuildKit:

```bash
docker build --build-arg HTTP_PROXY --build-arg HTTPS_PROXY --build-arg NO_PROXY \
  --secret id=registry_ca,src=/caminho/ca.pem -t jungle-challenge .
```

O segredo é opcional; redes com certificados públicos usam a instalação normal. A CA não é copiada para a imagem nem definida no ambiente de runtime. A verificação TLS e a integridade do lockfile permanecem ativas. Se o builder não resolver o hostname do proxy, corrija o DNS do builder; não desative a verificação TLS para contornar isso.

A imagem foi construída e executada em rede Docker exclusiva com PostgreSQL e LocalStack. Foram exercitados migrations `up → down → down → up → pending`, typecheck, unidades, criação de wallet, BET, replay, consulta de ledger, reconciliação e aposta de 25 via SQS terminando em saldo 75. A ausência dos arquivos de ambiente e da CA de build no runtime também foi verificada.

## Formatação e integridade

`bun run format` aplica o padrão Prettier já configurado: espaços, quebras de linha, aspas e vírgulas. Isso é manutenção de estilo, não correção de regra financeira ou de segurança. A formatação do backend foi comparada por árvores sintáticas TypeScript antes/depois, seguida de typecheck e testes; os arquivos do frontend não foram formatados por esse comando.

## Recursos e limites da execução

No ambiente de validação, o Docker usa VFS, que copia as camadas de cada container. Build, teste da imagem e suíte do host foram executados em sequência para limitar uso de disco. O PostgreSQL descartável usa tmpfs; isso não altera o volume persistente configurado para a aplicação no Compose.

## Verificação desta revisão

Em Linux/Bun 1.4.4, passaram `format:check`, typecheck, 55 testes do backend e os dois scripts de corrida. Atomicidade integral e guards HTTP integram essa suíte permanente. O frontend passou em typecheck, 37 testes Bun, 55 testes Vitest e build, sem alterações em seus arquivos. A auditoria de dependências da raiz não apontou vulnerabilidades após o override de multer. A imagem construída passou nas verificações descritas acima. Esses resultados foram observados e não representam cobertura de todas as combinações de falha possíveis.
