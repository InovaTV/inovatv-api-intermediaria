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
6. Validador + transferência atômica + envio    ✅ código concluído e implantado (2026-08-16);
   real ao WhatsApp                                envio real bloqueado externamente pela Meta
                                                     (ver seção "Etapa 6" abaixo) — não é código pendente
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

## Etapa 6 — Validador, transferência atômica, envio real ao WhatsApp (2026-08-16)

Cinco fatias sucessivas, cada uma commitada, testada localmente e
implantada isoladamente antes da próxima — mesma disciplina das etapas
anteriores. Detalhe de arquitetura/decisão de produto por trás de cada
uma: `inovatv_central` `CLAUDE.md`, seção "Implementação da IA própria
— Etapa 6" (resumo) e as especificações dos Componentes 1/4/5 (detalhe
completo).

### Primeira fatia — Validador Determinístico (Componente 4)

Commits `6cd1964`, `284a144`, `c0dfa2c`. `_shared/validador.ts`:
segurança/política (credencial, telefone de outro cliente, valor
monetário) sempre roda; factual (datas, contagem de acessos, plano/
servidor rotulado) só roda quando há algo a checar — nunca outra IA,
só comparação determinística contra o contexto realmente enviado. Duas
correções reais de falso positivo durante a validação: rótulo de
identificação de acesso ("Acesso N/M:") sendo lido como contagem
total, e "1 acesso no servidor X" (item individual) sendo lido como
contagem total — ambas corrigidas com o menor ajuste possível de
regex/âncora, nunca removendo a proteção de ambiguidade. 37/37 testes
locais passando na versão final; testado contra produção com evidência
real (`validacao.aprovado: true`, Gemini listando corretamente os 2
acessos reais do telefone `17981625486`).

### Segunda fatia — integração do Validador ao Orquestrador

Commit `ed42274`. No branch `estado === "normal"`, depois de
`chamarGemini`, a resposta passa por `validarResposta` antes de
qualquer liberação: aprovado devolve `{tipo, texto}` normalmente,
reprovado devolve `{outcome:"bloqueado"}` — a resposta original do
Gemini nunca sai quando reprovada, só o motivo (`validacao.motivo`).
Deliberadamente fora desta fatia: gravação real de `aguardando_humano`
quando reprovado ou `tipo==="transferir"` (fatia seguinte).

### Terceira fatia — transferência humana atômica via RPC

Commit `2f84a94`, migration `20260816120000_acionar_transferencia_humana.sql`
(aplicada diretamente no Supabase via SQL Editor). Substitui a
primeira implementação (3 chamadas HTTP separadas — `UPDATE` +
2×`INSERT`) por uma função Postgres `SECURITY INVOKER` que faz tudo
numa única transação atômica, com guarda `WHERE estado = 'normal'` e
exceção customizada (`errcode P0001`) quando a conversa já não está
mais em `normal` — o Orquestrador distingue esse caso (`ja_transferida`,
concorrência esperada, não é falha) de um erro real da RPC
(`falha_ao_registrar`). Motivo real da mudança: uma revisão de
segurança do próprio usuário encontrou o risco real de falha parcial
na versão anterior (estado marcado sem as mensagens gravadas, se uma
das 3 chamadas falhasse no meio). Testado localmente (16 checks
mockando `client.rpc()`) e com evidência real em produção — timestamps
idênticos entre `conversas_estado` e as duas linhas de
`mensagens_atendimento_humano`, provando atomicidade de verdade.

### Quarta fatia — cliente WhatsApp Cloud API isolado

Commit `097d634`. `_shared/whatsapp_client.ts` (`enviarMensagemWhatsApp`):
só a capacidade técnica de enviar uma mensagem de texto livre via
Graph API — não decide quando/pra quem enviar (isso é do Orquestrador,
fatia seguinte), não usa Message Template, nunca lança exceção (sempre
`{outcome:"success", messageId}` ou `{outcome:"unavailable"}`).
Secrets `WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID` vêm
exclusivamente de `Deno.env`, nunca hardcoded, nunca colados na
conversa. Deliberadamente **não integrado** ao Orquestrador nesta
fatia — 11/11 testes locais (mockando `fetch`/`Deno.env`).

### Quinta fatia — envio real ao cliente

Commit `e99834b`, mais `_shared/mensagens_fixas.ts`
(`MENSAGEM_TRANSFERENCIA_CLIENTE`, texto congelado aprovado
2026-08-16, Componente 1 §16 do `CLAUDE.md`). No Orquestrador: aprovado
+ `tipo==="responder"` envia o texto real do Gemini; `deveTransferir`
e a RPC realmente acionou agora (nunca em `ja_transferida`/erro) envia
a mensagem fixa — nunca o texto do Gemini sobre a transferência.
Resposta ganha o campo `envio: {enviado: boolean}`. 16/16 testes locais
cobrindo os 7 cenários (incluindo a supressão de reenvio duplicado sob
concorrência).

### Log de diagnóstico + achado real do bloqueio (`133010`)

Commit `48db7cb`. Dois testes reais consecutivos devolveram
`envio.enviado: false` sem nenhuma visibilidade da causa — o
`whatsapp_client.ts` engolia qualquer erro da Graph API silenciosamente
(gap do Componente 1 §19, logs/auditoria, ainda não implementado no
resto do Orquestrador). Log temporário adicionado (status/corpo de
erro da Graph API, corpo 200 sem `messageId`, exceções — nunca o
access token), sem mudar o contrato de retorno (11/11 testes locais
continuam passando). Log real capturado em produção:
```json
{"status":400,"statusText":"Bad Request","body":{"error":{"message":"(#133010) Account not registered","code":133010,"type":"OAuthException"}}}
```
Investigado com uma function temporária descartável (`whatsapp-diag`,
mesmo padrão já usado antes neste projeto para `debug-fields`) — só
duas chamadas `GET` de leitura na Graph API, nunca `/register`, nunca
envia mensagem, nunca expõe o token. Resultado real:
```json
{"code_verification_status":"VERIFIED","name_status":"PENDING_REVIEW","verified_name":"InovaTV","platform_type":"NOT_APPLICABLE"}
```
`platform_type: NOT_APPLICABLE` bate exatamente com o erro `133010` —
o número está verificado mas nunca completou o registro próprio da
Cloud API. `whatsapp-diag` apagada logo depois de usada (confirmado
"Viewing 6 functions in total", de volta ao número anterior).

### Estado atual — checkpoint de espera, bloqueado externamente pela Meta

Código completo e implantado (commits `6cd1964` até `48db7cb`). O
envio real ao `17996286135` (número de teste, Cloud API pura, sem
Coexistence) falha por uma revisão de nome de exibição
("InovaTV") ainda pendente na Meta desde 15/08 — tentar trocar o nome
foi explicitamente bloqueado pela própria Meta "porque já existe outra
verificação em andamento", forte indício (não prova formal) de que é a
mesma causa do `133010`. Decisão: aguardar a Meta concluir essa
revisão antes de qualquer nova tentativa de registro — sem abrir
Webhook real, Interface Humana Web ou Camada de Conhecimento Empresarial
enquanto isso. O número oficial `17996242415` nunca foi tocado durante
toda a Etapa 6.

### Aviso ao José via Message Template (Componente 1 §16-A) — implementado, aguardando aprovação da Meta

Commit `3f8e2d2`, mesmo dia do checkpoint de espera acima —
implementado enquanto se aguarda a Meta concluir a revisão do nome
("InovaTV"), sem exigir nenhuma ação nova na conta. `_shared/
whatsapp_client.ts` ganhou `enviarTemplateWhatsApp` (extraído de um
`enviarPayloadWhatsApp` compartilhado com `enviarMensagemWhatsApp`, sem
mudar o comportamento desta última); `_shared/mensagens_fixas.ts`
registrou `NOME_TEMPLATE_NOVA_TRANSFERENCIA`/
`IDIOMA_TEMPLATE_NOVA_TRANSFERENCIA` (`nova_transferencia_humana`/
`pt_BR`, corpo já submetido à Meta em 2026-08-16, ainda "Em análise").
No Orquestrador: dentro do mesmo bloco que já envia a mensagem fixa ao
cliente (só quando a RPC realmente aciona a transferência agora, nunca
em `ja_transferida`/erro), se o secret `WHATSAPP_JOSE_NUMERO` estiver
configurado, dispara o template ao José — best-effort, uma falha aqui
nunca desfaz a transferência nem o envio ao cliente, ambos já
concluídos antes deste passo. Resposta ganha o campo opcional
`avisoJose: {enviado: boolean}`. 22/22 testes locais (mockando
`fetch`/`Deno.env`/a RPC), cobrindo: aviso disparado com o payload
correto quando configurado; nenhum disparo sem `WHATSAPP_JOSE_NUMERO`;
nenhum disparo em `ja_transferida` ou erro de RPC; falha do template
(ex.: ainda não aprovado) não desfaz a transferência nem o envio ao
cliente; nenhum disparo no caso normal de resposta sem transferência.

**Implantado via deploy manual no dashboard** (mesmo método das fatias
anteriores — injeção de conteúdo no editor Monaco com verificação de
hash antes de cada arquivo, depois "Deploy updates"), confirmado pelo
timestamp "a few seconds ago" e pelos três arquivos sem marcador de
alteração pendente. **Sem teste real** — `WHATSAPP_JOSE_NUMERO` não foi
configurado como secret ainda, e o template segue "Em análise" na
Meta; até lá, `enviarTemplateWhatsApp` retorna `unavailable` como
qualquer outra falha da Graph API (mesmo contrato, nunca lança
exceção), sem efeito nenhum sobre o restante do fluxo.

### Achado de segurança separado — fechado em 2026-08-16

Durante a inspeção de `conversas_estado`, uma aba pré-existente do SQL
Editor (de sessão anterior, não desta implementação) revelou um
`UNITV_DEALER_TOKEN` em texto puro numa query salva
(`npx supabase secrets set UNITV_DEALER_TOKEN=... --project-ref
nduxsuxkopuvhwugdkqi`), provável resíduo da investigação
PagBank/UniTV. Tratamento concluído nesta sessão: a query foi
localizada (confirmada por hash SHA-256 contra o digest do Secret
ativo), limpa e salva; o usuário trocou a senha de administrador do
painel de revenda (`panel-web.revenda.site`), única forma de rotação
disponível para esse tipo de credencial. Detalhe completo, incluindo a
consequência aceita de não recapturar um token novo agora:
`docs/pagamentos/POC_PAGBANK_UNITV_TESTE_013_PONTA_A_PONTA.md`.
