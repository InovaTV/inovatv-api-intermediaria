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
4. Núcleo mínimo do Orquestrador                ✅ concluído (2026-08-16, implantado e validado)
5. Integrar /match, /status e Gemini            ✅ concluído (2026-08-16, implantado e testado com evidência real)
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

**Implantado (2026-08-16), como parte do deploy único da Etapa 5** —
ver seção abaixo. O código da Etapa 4 em si (passo 0) não recebeu um
deploy próprio isolado; a primeira vez que `orchestrator` foi
implantado no Supabase já incluía a integração da Etapa 5 no mesmo
deploy. Validado com evidência real nos 3 cenários de teste da Etapa 5
(que exercitam o passo 0 indiretamente — nenhum deles caiu em
`aguardando_humano`, então o branch de passo 0 dedicado a esse estado
segue coberto só pelos testes originais descritos acima, não por novo
teste real desta rodada).

## Etapa 5 — Integração /match, /status e Gemini (2026-08-16, implementado, implantado e testado com evidência real)

**Escopo aprovado explicitamente pelo usuário (Opção 1, 2026-08-16):**
no branch `estado === "normal"` do Orquestrador, encadear `/match →
/status → contexto mínimo → Gemini 3.6 Flash → saída estruturada
{tipo, texto}`, devolvendo isso só pela resposta HTTP do endpoint de
teste temporário. **Deliberadamente fora desta etapa:** validador
determinístico, gravação de `aguardando_humano`/mensagens quando
`tipo === "transferir"`, envio real por WhatsApp, aviso ao operador,
Interface Humana Web — ficam para a próxima etapa, sem exceção.

**Dois pontos que pareciam exigir suposição foram resolvidos com
evidência real**, recuperada do scratchpad de uma sessão anterior que
continha os artefatos do teste de saída estruturada já registrado no
Componente 1 §12 (`inovatv_central`):

- **Model ID confirmado:** `gemini-3.6-flash` — aparece literalmente
  no campo `modelVersion` das respostas reais de API salvas daquele
  teste. Configurado como secret `GEMINI_MODEL_ID`, não hardcoded.
- **Formato do bloco de contexto confirmado** (corpo REST real do
  teste de compatibilidade comportamental, que reaproveitou os casos
  das Rodadas 3/4): `[DADOS CONECTADOS - CLIENTE]` + `Telefone:` em
  linha própria + demais campos separados por `·` numa linha —
  reproduzido tal qual para o caso de 1 acesso; extensão própria (não
  testada anteriormente, feita de forma deliberada e registrada) para
  múltiplos acessos, mantendo o mesmo estilo.

### Arquivos novos

```
supabase/functions/_shared/
├── rocket_intermediaria.ts   — chamarMatch()/chamarStatus(), fetch para as próprias functions match/status, timeout 5s sem retry
├── contexto.ts               — montarContextoCliente(), formato acima, distingue no_match (sem bloco) de unavailable (bloco explícito de indisponibilidade)
└── gemini_client.ts          — chamarGemini(), prompt de sistema CONGELADO (conferido byte a byte contra scratchpad/sysprompt.txt), saída estruturada nativa, timeout 10s + 1 retry
```

`orchestrator/index.ts` atualizado para encadear os três módulos no
branch `normal`. Nenhuma alteração em `match/index.ts`,
`status/index.ts` ou nas migrations já aplicadas.

### Secrets novos

`GEMINI_API_KEY` (chave real, tier pago, conforme decisão de
privacidade já registrada em `inovatv_central`) e `GEMINI_MODEL_ID`
(`gemini-3.6-flash`) — configurados manualmente pelo usuário no painel
do Supabase, projeto confirmado visualmente como
`nduxsuxkopuvhwugdkqi` antes de qualquer secret/deploy. **Nunca
colados nesta conversa, nunca em código/commit.**

### Deploy

Manual, via editor multi-arquivo do painel do Supabase (mesmo padrão
já usado em `match`/`status`/`export-clientes`) — projeto confirmado
antes do deploy. Um bug real de escape foi encontrado e corrigido
durante a colagem (uma linha do `fetch(...)` ficou com `` \` `` em vez
de só a crase); corrigido diretamente no editor via a própria API do
Monaco, reconferido byte a byte contra o conteúdo pretendido antes do
deploy — não afetou o prompt de sistema, que permaneceu íntegro.

### Testes — 3/3 cenários cobertos com evidência real, nenhum cliente fabricado

Telefone `17981625486` (número do próprio usuário, autorizado
nominalmente para este teste — nunca outro cliente real da base) usado
tanto pra `single_match` quanto, depois que um segundo acesso real foi
associado a ele, pra `multiple_matches`. Telefone sintético
`11999990001` (comprovadamente inexistente) usado pra `no_match`.

1. **`single_match`** — `match.outcome: "single_match"`,
   `status.outcome: "success"`/`linkState: "linked"`, Gemini respondeu
   corretamente com o vencimento real (`08/10/2026`, batendo com o
   registro já documentado em `inovatv_central` pra esse mesmo
   telefone/cliente).
2. **`no_match`** — `match.outcome: "no_match"`, `status: []` (nenhuma
   chamada a `/status`), Gemini disse "não encontrei" (nunca "você não
   tem"), decidiu `tipo: "transferir"` sozinho, sem essa decisão ser
   executada (fora de escopo desta etapa).
3. **`multiple_matches`** — `match.outcome: "multiple_matches"`, os 2
   `/status` chamados em paralelo com sucesso, Gemini listou os 2
   acessos completos sem escolher um sozinho (regra "MÚLTIPLOS
   ACESSOS" do prompt congelado).

Em nenhum teste a resposta HTTP devolveu o `cliente` bruto do
`/status` — só outcomes e o `{tipo, texto}` já sanitizado do Gemini
(minimização, Componente 1 §19).

**Estado de teste limpo:** as duas linhas criadas em `conversas_estado`
pelos testes (`17981625486`, `11999990001`) foram removidas por
exclusão explícita (nunca por condição ampla), confirmado
`count = 0` depois. Nenhuma outra linha tocada.

### O que fica explicitamente fora desta etapa

Validador determinístico (Componente 4), gravação de
`aguardando_humano` quando `tipo === "transferir"`, envio real por
WhatsApp (Cloud API), aviso ao operador, Interface Humana Web. Próxima
etapa, só quando autorizada — não iniciada automaticamente após esta.

### Achado de segurança separado, não resolvido nesta etapa

Durante a inspeção de `conversas_estado`, uma aba pré-existente do SQL
Editor (de sessão anterior, não desta implementação) revelou um
`UNITV_DEALER_TOKEN` em texto puro numa query salva
(`npx supabase secrets set UNITV_DEALER_TOKEN=... --project-ref
nduxsuxkopuvhwugdkqi`), provável resíduo da investigação
PagBank/UniTV. Não foi executada, não foi apagada, não foi alterada —
tratamento (rotação do token, limpeza da query salva) fica para uma
sessão separada, por decisão do usuário.
