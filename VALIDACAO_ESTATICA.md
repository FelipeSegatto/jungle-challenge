# Relatório de verificação da entrega

A verificação sintática inicial foi ampliada com execução real. Para reproduzir na raiz:

```bash
bun install --frozen-lockfile
bun run format:check
bun run typecheck
bun run test:all
```

## O que cada etapa verifica

- **Instalação congelada:** usa as versões e integridades do `bun.lock`, sem resolver dependências novas.
- **Prettier:** padroniza espaços, quebras de linha, aspas e vírgulas. Não substitui compilação nem teste; a correção de estilo foi separada das mudanças funcionais e comparada por árvores sintáticas TypeScript.
- **Typecheck:** valida os tipos no modo estrito configurado pelo projeto.
- **Suíte completa:** executa domínio, HTTP, atomicidade, concorrência, inbox/outbox, reinício, SIGTERM e retry/DLQ com PostgreSQL e LocalStack reais em recursos exclusivos.

O registro de resultados, os comandos por cenário e as limitações ficam em [docs/BACKEND_VALIDATION.md](docs/BACKEND_VALIDATION.md). O [checklist de entrega](CHECKLIST_DE_VALIDACAO.md) deve ser marcado somente após observar cada resultado.

A formatação não corrige erros financeiros e não é uma falha de segurança. Sua reprovação indica diferença de estilo ou código ainda não padronizado. Após formatar, confirme tipos e testes para detectar qualquer regressão. Não edite migrations já aplicadas para corrigir dados ou constraints; adicione uma migration nova quando houver necessidade de evolução do schema.
