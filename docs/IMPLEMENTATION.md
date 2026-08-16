# Implementação — IA própria (Orquestrador, estado, transferência humana)

> **Este documento registra decisões de organização/implementação de
> código deste repositório — não decisões de arquitetura de negócio.**
> Arquitetura completa, componentes e decisões de produto vivem em
> `inovatv_central` (`CLAUDE.md`, frente "IA própria (WhatsApp +
> Central)"), commits `9628ab1`, `d5f901c`, `dbcebe5` — este documento
> não duplica esse conteúdo, só registra como ele vira código aqui.

## Estado (2026-08-15): migrations criadas localmente, nada aplicado no banco remoto

Duas tabelas novas, migrations criadas em
`supabase/migrations/` — **ainda não aplicadas no Supabase**, aguardando
inspeção/aprovação antes do primeiro `db push` ou execução manual no
SQL Editor:

- `20260815210000_conversas_estado.sql`
- `20260815210001_mensagens_atendimento_humano.sql`

Schemas batem exatamente com o já aprovado em `inovatv_central`
(Componente 5 §7 e §12), com um ajuste decidido nesta sessão:
`conversation_id` é `uuid` gerado pelo Postgres
(`default gen_random_uuid()`), separado do `telefone` — telefone
identifica o cliente, `conversation_id` identifica a conversa
operacional, mesmo mantendo `UNIQUE(telefone)` como restrição
pragmática de V1 (não existe conceito de múltiplas conversas por
telefone nesta fase; ver comentário no próprio arquivo de migration).

Isolamento: RLS habilitado nas duas tabelas, sem nenhuma policy pra
`anon`/`authenticated` — só `service_role` (usado pelas Edge
Functions) acessa, conforme Componente 1 §17.

## Estrutura de código — `_shared`, só para o código novo (2026-08-15)

**Decisão:** as funções existentes (`match`, `status`, `export-clientes`,
`fase3-mock`, `poc-pagbank-unitv-renew`) continuam exatamente como
estão — um `index.ts` autocontido cada, sem nenhuma refatoração pra
usar código compartilhado. Elas funcionam, não introduzimos risco nelas
só por consistência estética.

O Orquestrador (e o que vier depois — Webhook novo, Interface Humana
Web) nasce com uma pasta `_shared`, porque a complexidade é real e vai
crescer — mas cada módulo mantém responsabilidade única, nunca um
arquivo único "faz tudo":

```
supabase/functions/_shared/
├── types.ts                  — tipos compartilhados (EstadoConversa, MensagemAtendimento, GeminiOutput{tipo,texto})
├── http.ts                   — jsonResponse()/errorResponse()
├── supabase_client.ts        — cliente Supabase (service role)
├── conversas_estado.ts       — buscarEstado, marcarAguardandoHumano, assumir, encerrar
├── mensagens_atendimento.ts  — inserirMensagem, listarMensagens
├── rocket_intermediaria.ts   — wrapper HTTP fino que chama /match e /status via fetch (nunca importa código delas, nunca fala com o Rocket direto)
├── gemini_client.ts          — chamada técnica ao Gemini 3.6 (prompt congelado, saída estruturada, timeout/retry)
├── contexto.ts               — monta o contexto mínimo enviado ao Gemini
└── validador.ts              — validação determinística (segurança/política + factual)
```

Camada de conhecimento empresarial (Componente 2, tabela
`conhecimento_institucional`) fica **fora de escopo por enquanto** —
não faz parte da sequência de implementação atual, não antecipada aqui.

## Sequência de implementação aprovada (2026-08-15)

```
1. Estrutura base do código novo (_shared)     ✅ concluído
2. Migrations das tabelas aprovadas             ✅ aplicadas no Supabase (2026-08-15)
3. Testar as tabelas                            ✅ validado (schema, RLS, FK, insert/rollback)
4. Núcleo mínimo do Orquestrador                ✅ código criado localmente, ainda não implantado
5. Integrar /match, /status e Gemini            ainda não iniciado
```

Um componente por vez, testado e com checkpoint antes de avançar —
nada de várias frentes abertas ao mesmo tempo.

## Etapa 2/3 — migrations aplicadas e validadas (2026-08-15)

As duas migrations foram aplicadas no Supabase via SQL Editor do
painel (CLI não instalada nesta máquina, mesmo método já usado antes
neste repositório para `export-clientes`). Validação completa
executada e aprovada: tabelas existem, `conversation_id` é
`uuid`/`PK`/`gen_random_uuid()`, `UNIQUE(telefone)` confirmado, FK
entre as duas tabelas confirmada, RLS habilitado com zero policies nas
duas, teste de insert/select revertido via `ROLLBACK` (nenhum dado de
teste persistido). Detalhe completo da validação: histórico da sessão
que produziu este documento (`inovatv_central`, conversa desta
implementação).

## Etapa 4 — núcleo mínimo do Orquestrador (2026-08-15, código criado, não implantado)

Nova Edge Function `orchestrator`, usando os módulos `_shared` já
descritos acima. Prova **só o passo 0** do fluxo do Componente 1 §6
(revisado): identifica/estabelece a conversa pelo telefone
(`conversas_estado`), e decide entre registrar mensagem e parar
(`aguardando_humano`) ou sinalizar `normal` e parar aí mesmo —
**deliberadamente sem chamar `/match`, `/status` ou Gemini ainda**
(etapa 5).

Entrada temporária pra testar sem depender do Webhook real (Componente
3, que ainda não existe): `POST /functions/v1/orchestrator` com corpo
`{ "telefone": "...", "conteudo": "..." }`.

```
supabase/functions/
├── _shared/
│   ├── types.ts
│   ├── http.ts
│   ├── supabase_client.ts
│   ├── conversas_estado.ts
│   └── mensagens_atendimento.ts
└── orchestrator/
    └── index.ts
```

**Ainda não implantado no Supabase** — aguardando revisão antes do
primeiro deploy.

## Nada implementado no Supabase além do que está registrado acima

As duas migrations estão aplicadas (etapa 2/3). O código da Edge
Function `orchestrator` e dos módulos `_shared` existe **só
localmente** — nenhum deploy de função foi feito ainda. Nenhuma
credencial nova foi criada ou usada (a função usa
`SUPABASE_SERVICE_ROLE_KEY`, injetada automaticamente pela plataforma
em toda Edge Function, não um secret configurado à mão).
