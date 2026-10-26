# Apresentação do backend pelo Docker

O caminho de apresentação usa containers Linux no Windows, macOS e Linux. O computador precisa de Docker Engine com Compose v2 ou Docker Desktop no modo **Linux containers**. Bun, Node.js e PostgreSQL não precisam estar instalados no host. A console frontend é opcional; este roteiro demonstra o backend avaliado no desafio.

## Antes da apresentação

Na raiz do checkout, confira:

```bash
docker info --format "{{.OSType}}"
docker compose version
```

O primeiro comando deve mostrar `linux`. Prepare as imagens enquanto houver acesso à Internet:

```bash
docker compose pull postgres localstack
docker compose build
docker compose -f docker-compose.test.yml build
```

Esse preparo antecipa downloads. Pelo PowerShell, não é necessário instalar Bun numa distro WSL nem ativar a integração com Ubuntu. O Docker Desktop ainda precisa de seu backend Linux funcionando (WSL2 ou Hyper-V, conforme a instalação). A integração com uma distro só é necessária se você optar por executar o Docker CLI de dentro dela. As imagens precisam estar disponíveis para a arquitetura do computador, com memória e disco livres. No ambiente de referência, testes e validação da aplicação foram executados em sequência porque o driver VFS copia as camadas dos containers; Docker Desktop pode usar outro driver.

## Dois comandos principais

**1. Subir a aplicação e aguardar prontidão:**

```bash
docker compose up -d --build --wait
```

Sobe PostgreSQL, LocalStack, migrations, três APIs e dois workers usando a mesma imagem da aplicação. `--wait` usa os health checks: APIs verificam banco/SQS, e os workers só ficam prontos depois de inicializar suas filas. Para limitar a espera, você pode acrescentar `--wait-timeout 180`. Confira com:

```bash
docker compose ps
```

As APIs ficam em `3001`, `3002`, `3003`, e métricas dos workers em `9091`/`9092`. As portas padrão foram preservadas. Se já houver outro programa ocupando uma delas, ajuste as variáveis de porta do Compose; não execute APIs nativas nessas mesmas portas.

**2. Executar toda a validação, também em Linux:**

```bash
docker compose -f docker-compose.test.yml up --build --exit-code-from tests --attach tests
```

O projeto `jungle-challenge-tests` é separado da aplicação. Executa Bun 1.4.4, três processos de API, workers filhos e todas as suítes em um container Linux. PostgreSQL e LocalStack são containers exclusivos que compartilham somente o loopback desse ambiente de teste. Não publica portas, não monta código do host, não monta socket do Docker e não usa os volumes da demonstração. A rede de runtime dos testes não tem saída para a Internet.

O resultado esperado é `PASS: isolated checks completed` e saída `0` do serviço `tests`. Uma falha conserva o código de erro; o runner não transforma teste reprovado em sucesso. `--attach tests` mostra os resultados sem misturá-los às requisições internas do LocalStack. O cenário de cinco tentativas até a DLQ leva aproximadamente 70 segundos por respeitar o backoff real.

As mesmas flags e comandos funcionam no PowerShell e no terminal Bash. Com Bun instalado, `bun run test:all` ou `bun run test:docker` são atalhos para esse comando Docker, não para executar os workers no Windows.

Se as imagens já estiverem preparadas, substitua `--build` por `--no-build` nos comandos para não depender de downloads ou compilação durante a apresentação.

## Demonstração de uma aposta pela fila

Com a aplicação saudável:

```bash
docker compose exec -e BASE_URL=http://127.0.0.1:3000 api1 bun run demo:sqs
```

O comando cria uma wallet com 100 e envia uma BET de 25 pelo SQS. O worker deve processá-la e o script imprimir `result: PASS`, `via: SQS` e saldo `75.00`. Isso usa os serviços da aplicação, independentemente do projeto de testes.

Durante a suíte, explique as evidências:

| Cenário | Resultado observado | Requisito |
|---|---|---|
| 80+80 sobre 100 | Uma aposta aceita, outra rejeitada; saldo 20 e um débito | Concorrência sobre a mesma wallet |
| 50 envios da aposta de 1 | Uma transação financeira; depois da corrida anterior, saldo 19 e dois débitos | Idempotência, inclusive entre três processos |
| Erro real de INSERT na Outbox | Nenhuma gravação financeira parcial; retry posterior aplica uma vez | Atomicidade |
| SIGKILL após commit | Segundo worker recebe a entrega número 2 e confirma sem novo débito | Recuperação |
| SIGTERM | ACK, `worker_stopped` e saída 0; readiness responde 503 durante bootstrap indisponível | Shutdown e prontidão |
| JSON inválido | Mensagem chega à DLQ na tentativa 1 | Falha permanente de contrato |
| Falha persistente | Cinco recepções com backoff, depois DLQ | Retry e redrive |

## Logs, limpeza e repetição

Para investigar uma reprovação:

```bash
docker compose -f docker-compose.test.yml logs --no-color
docker compose -f docker-compose.test.yml cp tests:/artifacts ./artifacts
```

Os logs das APIs ficam em `/artifacts` no container de testes; os resultados de cada suíte aparecem na saída do Compose. Copie os artefatos antes de remover o projeto. O diretório local `artifacts/` é ignorado pelo Git e pelo build.

Depois da validação:

```bash
docker compose -f docker-compose.test.yml down --volumes
```

Isso remove somente o projeto de testes. Para parar a aplicação, preservando seu banco:

```bash
docker compose down
```

Não use `docker compose down --volumes` no projeto da aplicação se quiser preservar os dados da demonstração.

## Reproduzir apenas um cenário

O seletor `TEST_SUITES` aceita nomes da lista de suítes, separados por vírgula; não executa comandos arbitrários. Por exemplo, para SIGTERM e retry/DLQ:

PowerShell:

```powershell
$env:TEST_SUITES = 'test:sigterm,test:consumer-retry'
docker compose -f docker-compose.test.yml up --build --exit-code-from tests --attach tests
Remove-Item Env:TEST_SUITES
```

Bash:

```bash
TEST_SUITES=test:sigterm,test:consumer-retry docker compose -f docker-compose.test.yml up --build --exit-code-from tests --attach tests
```

Remova o projeto de testes ao terminar, especialmente antes de outra execução em um ambiente com pouco disco. O modo nativo `bun run test:isolated <suítes...>` continua disponível para desenvolvimento em Linux/WSL, mas não é o caminho recomendado para validar sinais com Bun nativo no Windows.


## O que foi validado

Na máquina de referência Linux/amd64, a suíte completa foi executada dentro do container Linux e os cenários de SIGTERM e JSON inválido → DLQ foram repetidos em infraestrutura nova. A API também atingiu o estado healthy com o health check do Compose. O teste do worker cobre readiness 200 após bootstrap e 503 enquanto o SQS não pode inicializar. Isso padroniza o runtime; ainda é necessário ensaiar os mesmos comandos no computador da apresentação, com suas portas e recursos disponíveis.

O cliente SQS respeita o `SQS_ENDPOINT` configurado, mesmo quando o LocalStack anuncia uma URL de fila com hostname de outra rede. Isso preserva tanto o acesso pelo host (`127.0.0.1`) quanto por containers (`localstack`) sem exigir ajustes de DNS para as URLs retornadas pelo broker.
