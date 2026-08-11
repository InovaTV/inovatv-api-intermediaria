# inovatv-api-intermediaria

API intermediária entre a **InovaTV Central** e o **Rocket Gestor** —
nunca a Central fala com o Rocket diretamente. Arquitetura completa,
decisões e contexto de negócio vivem em `inovatv_central`
(`docs/identidade_sincronizacao/ARQUITETURA_IDENTIDADE_SINCRONIZACAO.md`
e `DESIGN_DECISIONS.md`, Decisão 050/051) — este repositório não
duplica esse conteúdo, só a implementação.

## Estado atual: Fase 3 — esqueleto mínimo

Só prova que o caminho **Central → HTTPS → Edge Function → JSON**
funciona de ponta a ponta. Deliberadamente, nesta fase:

- **Não existe** `/match`, `/link` ou `/status` reais — só uma função
  temporária e descartável (`fase3-mock`), sem relação com os nomes/
  formatos definitivos.
- **Não existe** banco, migration, tabela de vínculo ou cache.
- **Não existe** nenhuma comunicação com o Rocket, nenhuma
  `X-API-Key`.
- A `anon key` do projeto Supabase serve só como barreira básica
  contra chamada anônima — **não é** autenticação definitiva nem
  identidade do dispositivo.

## Estrutura

```
supabase/
  functions/
    fase3-mock/index.ts
```

Projeto Supabase: novo, plano Free, separado do projeto do Painel
(`InovaTV Platform`) — nunca compartilha organização de dados com ele
(ADR-021, `inovatv_painel`).
