# InovaTV API Intermediária — CLAUDE.md

> **Como usar:** cole este arquivo no início de qualquer nova conversa
> (ou sessão do Claude Code) antes de pedir qualquer alteração neste
> repositório. Para o estado geral de todo o ecossistema InovaTV
> (Central, Painel, esta API), o `CLAUDE.md` consolidado vive em
> `inovatv_central` — este arquivo é o ponto de entrada específico
> deste repositório, não substitui aquele.

---

**Este é o projeto ativo da IA/Orquestrador da InovaTV.**

Este repositório hospeda as Edge Functions do Supabase que sustentam:
- **O Orquestrador da IA própria** (`supabase/functions/orchestrator/`)
  — reconhecimento de intenção, validação determinística, resolução de
  acesso, integração com o Gemini e com o Rocket Gestor. Em produção
  real (`orchestrator` — confirmar versão atual via
  `supabase functions list`).
- **O Webhook do WhatsApp Cloud API / Meta**
  (`supabase/functions/webhook/`).
- **O Webhook de entrada do WhatsApp via WasenderAPI**
  (`supabase/functions/webhook-wasender/`) — canal do número oficial
  **+55 17 99624-2415** (sessão Wasender "Tope Tv" #117404).
  `messages.received` → Orquestrador; `messages.upsert` → comandos de
  operador **`#humano` / `#ia`** (assumir / encerrar atendimento humano
  pelo próprio WhatsApp). Em produção, `webhook-wasender` v7.
  Documentação oficial:
  [`docs/canal_wasender/CANAL_WASENDER_COMANDOS_HUMANO_IA.md`](docs/canal_wasender/CANAL_WASENDER_COMANDOS_HUMANO_IA.md).
- **O Painel de Atendimento** (`painel/`, Next.js) e suas Edge
  Functions de apoio (`painel-atendimento-*`).
- **A integração com o Rocket Gestor** (`/match`, `/status`,
  monitoramento de sessão). **`export-clientes` foi removida do deploy
  em 2026-08-23** — só existia para alimentar a arquitetura Meta
  Business Agent abandonada, sem nenhum consumidor ativo restante;
  código preservado como histórico em
  `supabase/functions/export-clientes/index.ts`, sem função implantada
  correspondente.
- **A frente de Renovação Automática** (PagBank → Rocket → Cloud API)
  — ver seção própria abaixo.

## Documentação oficial da frente de Renovação Automática

A documentação completa desta frente vive em
[`docs/renovacao_automatica/`](docs/renovacao_automatica/):

- [`PLANO_MESTRE_IMPLEMENTACAO.md`](docs/renovacao_automatica/PLANO_MESTRE_IMPLEMENTACAO.md)
  — documento vivo que organiza as 8 Etapas de implementação (0-7 +
  3 paralelas). Etapas 0 e 1 já concluídas — ver
  [`docs/propor_renovacao/`](docs/propor_renovacao/) para a
  documentação de implementação real da Etapa 1 (`propor_renovacao`).
- [`levantamentos/`](docs/renovacao_automatica/levantamentos/) — 23
  documentos de desenho/investigação técnica (PagBank, Rocket, motor
  de lembretes, etc.), datados de 21-22/08/2026. **Atenção:** alguns
  destes documentos se corrigem uns aos outros (ex.:
  `2026-08-22_desenho_pagbank_fluxo_renovacao.md` foi parcialmente
  corrigido por `2026-08-22_desenho_fluxo_corrigido_duas_confirmacoes.md`,
  do mesmo dia) — **a reconciliação de qual desenho prevalece ainda
  não foi feita** (pendente, ver nota abaixo). Não tratar nenhum
  destes 23 documentos como "a palavra final" sem confirmar isso
  primeiro.
- [`levantamentos/2026-08-22_matriz_homologacao_numero_teste.md`](docs/renovacao_automatica/levantamentos/2026-08-22_matriz_homologacao_numero_teste.md)
  — Matriz de Homologação do número de teste (capacidades de
  mídia/Calling API, pré-requisitos para a migração futura do número
  oficial).
- [`levantamentos/2026-08-22_fluxo_renovacao_automatica_pagbank_rocket_cloudapi.md`](docs/renovacao_automatica/levantamentos/2026-08-22_fluxo_renovacao_automatica_pagbank_rocket_cloudapi.md)
  — as 10 Lacunas técnicas/arquiteturais fechadas em 22/08.
- [`CASOS_REAIS_ATENDIMENTO.md`](docs/renovacao_automatica/CASOS_REAIS_ATENDIMENTO.md)
  — log de casos reais de atendimento, candidato a alimentar o
  Conhecimento Institucional (Componente 2) em lote no futuro.
- [`SESSAO_ROCKET_MONITORAMENTO.md`](docs/renovacao_automatica/SESSAO_ROCKET_MONITORAMENTO.md)
  — narrativa completa de como/por que a infraestrutura de sessão do
  Rocket (captura manual, renovação real via HTTP puro, monitoramento
  automático a cada 4h) existe. **Referenciada diretamente pela
  migration `supabase/migrations/20260821150000_rocket_session_monitoramento.sql`,
  já aplicada em produção** — é a fonte de contexto real para essa
  peça de infraestrutura.

## Origem desta documentação (reorganização de 2026-08-23)

Toda a pasta `docs/renovacao_automatica/` foi migrada de
`inovatv_meta_business_agent` (repositório que nasceu por separação
física do `inovatv_central` em 20/08/2026, originalmente dedicado ao
Plano B — IA nativa do WhatsApp Business/Meta Business Agent). Uma
frente conceitualmente diferente (Renovação Automática) passou a
conviver no mesmo repositório a partir de 21/08 sem nunca ser
resegregada — auditoria completa (2026-08-23) confirmou que o código
e a implementação real desta frente sempre estiveram aqui
(`inovatv-api-intermediaria`), nunca em `inovatv_meta_business_agent`
(que não tem nenhuma Edge Function/projeto Supabase próprio).

**Não utilizar `inovatv_meta_business_agent` como fonte de
documentação ou implementação da frente de Renovação Automática.**
Essa pasta pertence a uma frente anterior (Plano B — Meta nativo, cujo
conteúdo genuíno foi consolidado em `inovatv_central/CLAUDE.md`) e
será removida após confirmação final de que nenhuma informação
necessária ficou para trás.

**Pendência real, não resolvida por esta migração:** a reconciliação
de conteúdo entre os documentos conflitantes de `levantamentos/`
(qual desenho do fluxo PagBank prevalece) — a migração só moveu os
arquivos para o lugar certo, não decidiu o conteúdo técnico. Isso
continua sendo trabalho futuro, antes de retomar a Etapa 2 do Plano
Mestre.

## `scripts/meta_business_agent/` — ferramentas legadas, não é arquitetura ativa

`scripts/meta_business_agent/` contém ferramentas legadas da antiga
abordagem Meta Business Agent. Essa arquitetura foi abandonada e esses
scripts não fazem parte da implementação atual da IA da InovaTV.

São os 8 scripts que já existiam fisicamente neste repositório (parte
deles desde antes da reorganização de 2026-08-23, parte migrada de
`inovatv_meta_business_agent` na própria reorganização) mas cuja única
razão de existir é a automação Rocket → Google Drive → Meta Business
Agent (geração/verificação de `CLIENTES_INOVATV.xlsx`, OAuth/Picker do
Google Drive, leitura/substituição de arquivo real, sincronização da
planilha "clientes"): `drive-oauth-autorizar.mjs`,
`gerar-clientes-xlsx.mjs`, `verificar-clientes-xlsx.mjs`,
`picker-selecionar-arquivo.mjs`, `ler-arquivo-producao.mjs`,
`substituir-arquivo-producao.mjs`, `teste-drive-etapa3.mjs`,
`sincronizar-planilha-clientes.mjs`. Isolados numa subpasta própria,
com seu próprio `package.json` (só `exceljs` — nenhum dos 8 usa
`playwright` nem SDK `googleapis`, todos os 8 falam com a API do
Google só via `fetch()` direto), para nunca se misturar com as
dependências e a documentação da frente ativa (Renovação Automática,
que usa `playwright` no `package.json` da raiz de `scripts/`).

Histórico de contexto completo desses 8 scripts (Etapa 3 de
sincronização Rocket → Drive → Meta AI): `inovatv_central/CLAUDE.md`,
seção "Frente — IA do WhatsApp (Meta Business Agent) + automação
Rocket → Google Drive".
