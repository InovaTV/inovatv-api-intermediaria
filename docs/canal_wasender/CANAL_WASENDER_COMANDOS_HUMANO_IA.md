# Canal de entrada Wasender + comandos de operador `#humano` / `#ia`

> **Documento mestre desta frente. Fonte canônica: `inovatv-api-intermediaria` (produção).**
> Existe uma cópia idêntica em `inovatv-wasender-lab/docs/canal_wasender/` — se as
> duas divergirem, **esta (produção) prevalece**.
>
> Estado ao escrever este documento: **2026-09-04**. Sempre reconferir versões e
> secrets com `supabase functions list` / `supabase secrets list` antes de agir.

---

## 1. Escopo e status

Este documento cobre:

- **O canal de ENTRADA de mensagens do WhatsApp via WasenderAPI** — a Edge Function
  `webhook-wasender`, que recebe os webhooks do número oficial **+55 17 99624-2415**
  (sessão Wasender "Tope Tv" #ID 117404) e os encaminha ao Orquestrador.
- **Os comandos de operador `#humano` / `#ia`**, digitados pelo próprio número 2415,
  que assumem / encerram o atendimento humano de uma conversa direto pelo WhatsApp,
  sem abrir o Painel de Atendimento.

**Estado: em PRODUÇÃO.** `webhook-wasender` **v7 ACTIVE** no projeto Supabase de
produção `nduxsuxkopuvhwugdkqi`. Recurso `#humano`/`#ia` implantado em 2026-09-04
pelo commit `f9285bf`.

**Fora de escopo deste documento** (frentes separadas, com gate próprio):

- A **migração do canal de SAÍDA** (respostas da IA aos clientes) e o **go-live geral
  do "Plano B" (WasenderAPI)** — isso é decisão/etapa à parte, não auditada aqui. Ver
  `NEXT_SESSION.md` (seção "DECISÃO 2026-09-03 … PLANO A (TOPE TV) / PLANO B
  (WASENDERAPI)") e a frente Meta/Plano B em `inovatv_central/CLAUDE.md`.
- O incidente `130497` da Meta.

O canal de entrada e os comandos `#humano`/`#ia` desta etapa **não alteram** nenhum
desses gates.

---

## 2. Arquitetura atual (canal de entrada)

```
Cliente (WhatsApp)  ──►  WasenderAPI  ──►  POST  https://<ref>.supabase.co/functions/v1/webhook-wasender
                         (sessão 2415)      │
                                            ▼
                                   webhook-wasender  (Edge Function, Supabase)
                                            │
             ┌──────────────────────────────┼───────────────────────────────┐
             ▼                              ▼                               ▼
   evento "messages.received"     evento "messages.update"       evento "messages.upsert"
             │                    (só log, não encaminha)                   │
             ▼                                                              ▼
   guards + dedup(key.id)  ──►  EdgeRuntime.waitUntil                  fromMe === true  e
   chamarOrquestrador(                                                 texto == "#humano"/"#ia" ?
     { telefone, conteudo, nomeContato? })                              │           │
             │                                                         sim         não
             ▼                                                          ▼           ▼
   POST /functions/v1/orchestrator                            dedup(key.id) +   ignorado
   header X-Internal-Token                                    RPC de estado +   (log + 200)
             │                                                confirmação
             ▼
   Orquestrador (Passo 0 → /match → /status → Gemini → validador → resposta)
```

- Resposta HTTP **200 rápida**; o trabalho pesado roda em `EdgeRuntime.waitUntil`
  (fora do ciclo de resposta). Os guards baratos e a **deduplicação** rodam
  **síncronos, antes do 200**.
- Contrato `webhook-wasender → orquestrador`: **inalterado** — mesmo endpoint, mesmo
  header `X-Internal-Token`, mesmo corpo `{ telefone, conteudo, nomeContato? }`.
- `webhook/` (webhook da Meta Cloud API) permanece intocado, como referência — é uma
  função separada.

---

## 3. Separação LAB × PRODUÇÃO

**PRODUÇÃO é a fonte operacional atual. O LAB é ambiente de desenvolvimento/teste.**

| | PRODUÇÃO | LAB |
|---|---|---|
| Repositório | `inovatv-api-intermediaria` | `inovatv-wasender-lab` |
| `origin/main` (ao escrever) | `f9285bf` | `099feae` |
| Projeto Supabase | `nduxsuxkopuvhwugdkqi` | `uleklqdlwyofnkcsdigz` |
| `webhook-wasender` | **v7 ACTIVE**, `verify_jwt=false` | **v8 ACTIVE**, `verify_jwt=false` |
| `orchestrator` | v75 | v12 |
| Payload URL do Wasender aponta para… | **este** (ver §4) | só durante teste supervisionado |
| Dado | produção real | banco próprio, **sem dado de produção** |

**Regra de ouro: só UMA das duas recebe o webhook do Wasender por vez.** Isso é
definido por um único campo — a **Payload URL** na configuração de webhook da sessão
"Tope Tv" (dashboard `wasenderapi.com`). **Hoje aponta para PRODUÇÃO.**

Os 3 arquivos de código desta etapa são **byte-idênticos** entre o LAB (`099feae`) e
produção (`f9285bf`):

- `supabase/functions/webhook-wasender/index.ts`
- `supabase/functions/_shared/comando_atendimento.ts` (novo)
- `supabase/functions/_shared/conversas_estado.ts` (+ `buscarConversaPorTelefone`)

---

## 4. Wasender e sessão 2415

- Conta WasenderAPI: **plano Basic, 1 sessão** (limite de 1).
- Sessão: **"Tope Tv" · #ID 117404 · +55 17 99624-2415 · Connected**.
- Modelo: **QR / multi-device não-oficial** (família Baileys / WhatsApp Web), **não**
  a Cloud API oficial da Meta. Detalhe completo dos payloads, endpoints, limites e
  lacunas: seção **"AUDITORIA DOCUMENTAL DO WASENDERAPI — 2026-09-04"** no
  `NEXT_SESSION.md` do repositório `inovatv-wasender-lab`.

### Configuração de webhook da sessão (dashboard `wasenderapi.com` → "Tope Tv" → Manage Webhook)

| Campo | Valor atual |
|---|---|
| Endpoint Settings | **ON** |
| **Payload URL** | `https://nduxsuxkopuvhwugdkqi.supabase.co/functions/v1/webhook-wasender` (**PRODUÇÃO**) |
| Eventos assinados ("2 Active") | `messages.received` · `messages.upsert` |
| Demais eventos | **desligados** |
| Message Filtering | Ignore Groups · Ignore Broadcasts · Ignore Channels — **todos ligados** |
| Webhook Secret | configurado (não rotacionar, não revelar) |

### Assinatura do webhook

**Não é HMAC.** O único esquema documentado pelo WasenderAPI é **comparação de string
simples**: o header **`X-Webhook-Signature`** carrega **o próprio Webhook Secret em
texto puro**.

`webhook-wasender` valida com `comparacaoTempoConstante(header, WASENDER_WEBHOOK_SECRET)`
(comparação de tempo aproximadamente constante, para não vazar o segredo por timing —
mas continua sendo, em essência, igualdade de string). Rejeita com **HTTP 401** se:
o header não bate com o segredo, **ou** não há header, **ou** o secret não está
configurado.

---

## 5. Eventos `messages.received` e `messages.upsert`

### `messages.received` — mensagens do cliente

Fluxo normal → Orquestrador. Guards síncronos antes do 200:

1. sem `key.id` → ignora (log).
2. `key.fromMe === true` → ignora (é eco da própria saída).
3. grupo (`remoteJid` termina em `@g.us`) → ignora (log).
4. `registrarMensagemSeNova(key.id)` → só as `"nova"` seguem.

Depois, por mensagem nova, em `EdgeRuntime.waitUntil`: mídia → só loga (fora de
escopo); resolve telefone (`resolverTelefone`, ver §7); extrai texto; `pushName`
defensivo → `nomeContato`; `chamarOrquestrador(telefone, texto, nomeContato)`.

### `messages.upsert` — traz entrada **e** saída

Se fosse processado como `messages.received`, cada mensagem seria tratada 2×. Por isso
**continua ignorado no fluxo normal** (termina com o log
`"[webhook-wasender] messages.upsert ignorado de proposito (evita duplicidade)"` +
HTTP 200).

**Única exceção:** comandos de operador `#humano` / `#ia` (ver §9). Eles **só** chegam
por este evento, com `key.fromMe === true`, e são detectados/executados **antes** do
log de "ignorado".

### Payload real observado (04/09/2026, comando `#humano` digitado no 2415)

```json
{ "event": "messages.upsert",
  "data": { "messages": {
    "key": {
      "id": "3EB01C135C6EC8A7C47CC1",
      "fromMe": true,
      "remoteJid": "242326416941236@lid",
      "senderPn": "5517981625486@s.whatsapp.net",
      "cleanedSenderPn": "5517981625486"
    },
    "message": { "conversation": "#humano" }
  } } }
```

`remoteJid` veio como **`@lid`** (identificador de privacidade, **não é telefone**).
O telefone do **cliente** (o outro lado da conversa) está em
`key.cleanedSenderPn` / `key.senderPn`.

---

## 6. Tratamento de `fromMe`

| Ramo | Regra | Efeito |
|---|---|---|
| `messages.received` | `if (key.fromMe === true) continue;` | não reprocessa o eco da própria saída |
| `messages.upsert` | `if (key.fromMe !== true) continue;` — **primeiro guard do laço de comando** | só uma mensagem digitada pelo **próprio número 2415** pode ser comando |

**Consequência: o cliente (`fromMe === false`/ausente) NUNCA aciona `#humano` ou
`#ia`.** Se um cliente digitar literalmente "#humano", isso chega por
`messages.received` como texto comum e segue para o Orquestrador/Gemini — que não têm
nenhuma semântica de comando. Confirmado pelo teste automatizado T11.

---

## 7. `cleanedSenderPn` e normalização de telefone

No comando (`messages.upsert` + `fromMe`), o `remoteJid` é `@lid` (inútil). O
`webhook-wasender` identifica o cliente destinatário **exclusivamente** por:

```
key.cleanedSenderPn  ──►  soDigitos()  ──►  normalizarTelefone()  ──►  telefoneCanonico
```

`normalizarTelefone` (`_shared/telefone.ts`) — regra por **tamanho em dígitos**:

- 11 dígitos → prefixa `55` (`"17981625486"` → `"5517981625486"`).
- 13 dígitos começando com `55` → mantém.
- qualquer outro tamanho → só remove formatação, sem inventar prefixo.

Se `key.cleanedSenderPn` não vier (só `@lid`), o comando é **ignorado com log**
(`"[webhook-wasender] comando sem cleanedSenderPn -- ignorado"`) — degradação
graciosa, sem efeito.

O ramo `messages.received` usa `resolverTelefone(key)` com prioridade
`cleanedSenderPn → senderPn (strip @s.whatsapp.net) → remoteJid @s.whatsapp.net`.
Ambos os caminhos (comando e mensagem de cliente) convergem para a **mesma linha** de
`conversas_estado` porque aplicam a mesma normalização canônica — o mesmo cliente
resolve para o mesmo `telefone` gravado (`"5517981625486"`).

---

## 8. Deduplicação

`registrarMensagemSeNova(key.id)` (`_shared/webhook_dedup.ts`):

- `INSERT ... ON CONFLICT DO NOTHING` na tabela **`webhook_mensagens_processadas`**
  (PK `message_id`) — atomicidade pela própria constraint, sem lock explícito.
- A tabela é **compartilhada** com o webhook da Meta e com o ramo `messages.received`.
  Os `key.id` do WasenderAPI (ex.: `3EB01C135C6EC8A7C47CC1`) são globalmente únicos,
  sem risco de colisão com os `wamid.xxx` da Meta.
- Roda **síncrono, antes do 200** e antes do `EdgeRuntime.waitUntil`.
- Retorno `"nova"` → segue; `"duplicada"` → ignora (retry do Wasender / `messages.upsert`
  com o mesmo id repetido no payload). **Erro real de banco** → o handler responde
  **HTTP 500** (Wasender reenvia), **nunca** trata como duplicata.

**No ramo `messages.upsert`, só os comandos passam pela deduplicação.** Mensagens
`fromMe` normais (não-comando) nunca são registradas — comportamento idêntico ao de
antes desta etapa.

Cobertura: testes T7 (retry do mesmo `key.id`), T8 (`key.id` repetido no mesmo
payload), T16 (erro de dedup → 500).

---

## 9. Comandos `#humano` e `#ia`

Módulo: **`supabase/functions/_shared/comando_atendimento.ts`** (novo nesta etapa).

### `detectarComandoAtendimento(texto)` — detecção ESTRITA

```
t = texto.trim().toLowerCase().replace(/[.,!?;\s]+$/u, "")
t === "#humano"  →  "assumir"
t === "#ia"      →  "encerrar"
qualquer outra coisa  →  null
```

Casam: `#humano`, ` #HUMANO `, `#Humano`, `#humano.`, `#humano!`, `#ia?`, `#ia `.
**Não** casam (viram mensagem `fromMe` normal, ignorada): `#humanos`, `#humano agora`,
`bla #ia`, `##ia`, `#i`, `humano`, `ia`, string vazia, não-string.

### `executarComandoAtendimento(comando, telefoneCanonico)`

1. `buscarConversaPorTelefone(telefoneCanonico)` — **nunca cria** (diferente de
   `buscarOuCriarConversa`). Se `null` → `{ outcome: "sem_conversa", confirmacao:
   MENSAGEM_CMD_SEM_CONVERSA }`.
2. `comando === "assumir"` → `assumirAtendimento(conv.conversation_id,
   "whatsapp-2415")`:
   - `"assumida"` → `assumido` / `MENSAGEM_CMD_HUMANO_OK`
   - `"ja_assumida"` → `ja_em_humano` / `MENSAGEM_CMD_HUMANO_JA`
   - `"nao_encontrada"` (corrida) → `sem_conversa` / `MENSAGEM_CMD_SEM_CONVERSA`
   - exceção → `erro` / `MENSAGEM_CMD_ERRO`
3. `comando === "encerrar"` → `encerrarAtendimento(conv.conversation_id,
   "whatsapp-2415")`:
   - `"encerrada"` → `encerrado` / `MENSAGEM_CMD_IA_OK`
   - `"nao_estava_aguardando_humano"` → `ja_normal` / `MENSAGEM_CMD_IA_JA`
   - `"nao_encontrada"` → `sem_conversa` / `MENSAGEM_CMD_SEM_CONVERSA`
   - exceção → `erro` / `MENSAGEM_CMD_ERRO`

`OPERADOR_COMANDO_WHATSAPP = "whatsapp-2415"` — gravado em
`conversas_episodios.assumido_por` / `encerrado_por`, para o Painel distinguir uma
ação pelo WhatsApp de uma ação pelo Painel.

### Não chama Orquestrador nem Gemini

O caminho do comando (`processarComandoUpsertPosDedup` em
`webhook-wasender/index.ts`) só chama `executarComandoAtendimento` +
`enviarMensagemWhatsApp` (confirmação). **Nunca** `chamarOrquestrador`. Um comando
jamais é encaminhado ao Orquestrador/Gemini como mensagem normal (teste T1:
`fetch` ao orquestrador = 0 chamadas; teste T14: `messages.received` de cliente
**continua** chamando o orquestrador 1×).

---

## 10. Fluxo de atendimento humano

| Situação | RPC | Efeito | Confirmação |
|---|---|---|---|
| `#humano`, conversa em `normal` | `assumir_atendimento` | cria episódio `origem='operador'` (já reivindicado por `whatsapp-2415`), `estado='aguardando_humano'`, `episodio_atual_id`, zera `acesso_selecionado`/`intencao_atual`/`sessao_atividade_em`, insere mensagem `sistema` | `MENSAGEM_CMD_HUMANO_OK` |
| `#humano`, já `aguardando_humano`, episódio aberto **não reivindicado** (ex.: auto-transferência da IA) | `assumir_atendimento` | preenche `assumido_por`/`assumido_em` no episódio existente | `MENSAGEM_CMD_HUMANO_OK` |
| `#humano`, episódio já reivindicado | `assumir_atendimento` → `conversa_ja_assumida` | nenhum | `MENSAGEM_CMD_HUMANO_JA` |
| `#ia`, conversa em `aguardando_humano` com episódio aberto | `encerrar_atendimento_humano` | fecha episódio (`encerrado_em`/`encerrado_por`), `estado='normal'`, `episodio_atual_id=null`, zera colunas de sessão, insere mensagem `sistema` | `MENSAGEM_CMD_IA_OK` |
| `#ia`, conversa já em `normal` | `encerrar_atendimento_humano` → `conversa_nao_esta_aguardando_humano` | nenhum | `MENSAGEM_CMD_IA_JA` |
| `#humano`/`#ia`, telefone sem conversa registrada | — (`buscarConversaPorTelefone` = null) | nenhum | `MENSAGEM_CMD_SEM_CONVERSA` |
| falha real na RPC | — | nenhum | `MENSAGEM_CMD_ERRO` |

**Convívio com o Painel de Atendimento:** as mesmas RPCs. Episódios abertos/fechados
por comando aparecem no Painel com `assumido_por`/`encerrado_por = "whatsapp-2415"`.
Não há acoplamento de código — se as Edge Functions do Painel fossem removidas,
`#humano`/`#ia` continuariam funcionando (dependem só das RPCs no banco e de
`_shared/conversas_estado.ts`).

---

## 11. RPCs utilizadas

**Nenhuma migration nova nesta etapa. Nenhuma RPC alterada.**

- `assumir_atendimento(p_conversation_id uuid, p_operador text) returns
  public.conversas_estado`
- `encerrar_atendimento_humano(p_conversation_id uuid, p_operador text) returns
  public.conversas_estado`

Definidas em `supabase/migrations/20260816140000_painel_atendimento_fatia1.sql`,
atualizadas em `20260823140000_sessao_ia_invalidada_por_atendimento_humano.sql` e
`20260823160000_sessao_ia_intencao_atual_invalidada_por_atendimento_humano.sql`
(versão vigente). Os arquivos de migration são **byte-idênticos** entre LAB e
produção.

Camada TypeScript — `supabase/functions/_shared/conversas_estado.ts`:

- `assumirAtendimento(conversationId, operador)` → `{outcome:"assumida",conversa}` |
  `{outcome:"ja_assumida"}` | `{outcome:"nao_encontrada"}`
  (P0001 com `error.message === "conversa_inexistente"` → `nao_encontrada`; outro
  P0001 → `ja_assumida`; senão `throw`).
- `encerrarAtendimento(conversationId, operador)` → `{outcome:"encerrada",conversa}` |
  `{outcome:"nao_estava_aguardando_humano"}` | `{outcome:"nao_encontrada"}`.
- **`buscarConversaPorTelefone(telefone)` — NOVO nesta etapa.** Só um
  `SELECT ... .eq("telefone", telefone).maybeSingle()`; **nunca cria** linha; retorna
  `ConversaEstado | null`. Nenhuma função existente do arquivo foi tocada.

---

## 12. Comportamento do Orquestrador durante `aguardando_humano`

`supabase/functions/orchestrator/index.ts`, "Passo 0" (Componente 1 §6):

```ts
if (conversa.estado === "aguardando_humano") {
  const mensagem = await inserirMensagem(
    conversa.conversation_id, "cliente", conteudo, conversa.episodio_atual_id,
  );
  return jsonResponse({ outcome: "aguardando_humano", ... });
}
```

Isso roda **antes** de `/match`, `/status`, Gemini e validador. Enquanto a conversa
está `aguardando_humano`, cada mensagem do cliente é **apenas registrada** — **a IA
não responde**. Depois de `#ia` a conversa volta a `normal` e a próxima mensagem do
cliente segue o fluxo normal (Gemini volta a responder).

**Esta etapa NÃO alterou o Orquestrador.** `orchestrator/index.ts` é **byte-idêntico**
entre o LAB (`099feae`) e produção (`f9285bf`) — diff de 0 linhas. Nenhum redeploy do
`orchestrator` foi feito nesta etapa.

---

## 13. Confirmações (textos literais)

Enviadas na própria conversa via `enviarMensagemWhatsApp(telefoneCanonico, texto)`
(`_shared/wasender_client.ts` → `POST /api/send-message`). Aparecem para o atendente
**e** para o cliente. **Best-effort:** se o envio falhar, o handler apenas registra
`"[webhook-wasender] falha ao enviar confirmacao do comando"` — **a mudança de estado
já ocorreu e não é desfeita**.

Os seis textos fixos (`_shared/comando_atendimento.ts`), transcritos literalmente:

| Constante | Texto |
|---|---|
| `MENSAGEM_CMD_HUMANO_OK` | `✅ Atendimento humano ativado nesta conversa. A IA está pausada. Envie #ia para reativá-la.` |
| `MENSAGEM_CMD_HUMANO_JA` | `ℹ️ Esta conversa já está em atendimento humano. Envie #ia quando quiser reativar a IA.` |
| `MENSAGEM_CMD_IA_OK` | `✅ IA reativada nesta conversa. As próximas mensagens do cliente voltam a ser respondidas automaticamente.` |
| `MENSAGEM_CMD_IA_JA` | `ℹ️ Esta conversa já está com a IA ativa. Nenhuma ação foi necessária.` |
| `MENSAGEM_CMD_SEM_CONVERSA` | `⚠️ Não encontrei uma conversa registrada para este número. Nenhuma ação foi feita.` |
| `MENSAGEM_CMD_ERRO` | `⚠️ Não consegui processar o comando agora. Tente novamente em instantes.` |

---

## 14. Prevenção de loop

A confirmação é enviada pelo próprio 2415 → volta como `messages.upsert` +
`fromMe: true` (o mesmo caminho de um comando).

**Não há loop** porque `detectarComandoAtendimento` exige **igualdade exata** de
`#humano` / `#ia` após a normalização. Nenhum dos seis textos de confirmação, depois
de `trim().toLowerCase().replace(/[.,!?;\s]+$/u,"")`, é igual a `#humano` ou `#ia`
(são frases longas; o `#ia` que aparece dentro de `MENSAGEM_CMD_HUMANO_OK` está no
meio da frase). O eco cai em `if (!comando) continue` → **sem deduplicação, sem RPC,
sem novo envio**.

Cobertura: 26 asserts do Nível 1 testam explicitamente cada uma das seis
confirmações → `null`; o teste de handler T13 posta a própria confirmação como
`messages.upsert`+`fromMe` e confirma que nada acontece.

---

## 15. Testes automatizados

Suíte: **`scripts/testes/comando_atendimento_upsert/`** — hoje existe **apenas no
repositório do LAB** (`inovatv-wasender-lab`). Arquivos:

- `mock-loader.mjs` — redireciona `_shared/conversas_estado.ts`,
  `_shared/wasender_client.ts`, `_shared/webhook_dedup.ts` para fakes locais
  (`_shared/telefone.ts` e `_shared/comando_atendimento.ts` são **reais**).
- `fake_conversas_estado.mjs`, `fake_wasender_client.mjs`, `fake_webhook_dedup.mjs`
- `teste.mjs` — shims `globalThis.Deno` (`serve`/`env`) e `globalThis.EdgeRuntime`
  (`waitUntil`), importa o handler real de `webhook-wasender/index.ts`.

Como rodar: `npx tsx scripts/testes/comando_atendimento_upsert/teste.mjs`

**Resultado: 93 asserts, todos passando.**

- **Nível 1 — `detectarComandoAtendimento` (função pura): 26 asserts.** Variações que
  casam/não casam; cada uma das 6 confirmações → `null` (guard de loop).
- **Nível 2 — handler real via `Deno.serve`/`EdgeRuntime` shim: 17 testes, 67 asserts.**

| Teste | Cenário |
|---|---|
| T1 | `#humano`, conversa `normal` → `assumir_atendimento("whatsapp-2415")`, confirmação `HUMANO_OK`, Orquestrador NÃO chamado |
| T2 | `#ia`, conversa `aguardando_humano` → `encerrar_atendimento_humano`, confirmação `IA_OK` |
| T3 | `#humano` já em atendimento humano (`ja_assumida`) → confirmação `HUMANO_JA` |
| T4 | `#ia` já em `normal` (`nao_estava_aguardando_humano`) → confirmação `IA_JA` |
| T5 | telefone sem conversa → nenhuma RPC, confirmação `SEM_CONVERSA` |
| T6 | RPC lança exceção → HTTP 200, confirmação `ERRO` |
| T7 | retry do mesmo `key.id` (dedup) → nenhuma RPC, nenhuma confirmação |
| T8 | `key.id` repetido no mesmo payload → processa 1× |
| T9 | grupo `@g.us` → ignorado, dedup NÃO chamado |
| T10 | só `@lid`, sem `cleanedSenderPn` → ignorado, dedup NÃO chamado |
| T11 | `#humano` do cliente (`fromMe:false`) no upsert → ignorado |
| T12 | mensagem `fromMe` normal ("oi, tudo bem?") → ignorada, dedup NÃO chamado |
| T13 | eco da própria confirmação como `messages.upsert`+`fromMe` → NÃO vira comando (sem loop) |
| T14 | `messages.received` de cliente → Orquestrador **ainda** chamado 1× (ramo inalterado) |
| T15 | assinatura inválida → HTTP 401 |
| T16 | erro real de dedup (banco) → HTTP 500 (Wasender reenvia), RPC NÃO chamada |
| T17 | envio da confirmação falha → HTTP 200, estado já mudou, envio foi tentado |

**Regressão completa do LAB** (`for d in scripts/testes/*/; do npx tsx
"${d}teste.mjs"; done`): **39 PASS / 2 FAIL**. As 2 falhas —
`autocura_healer_nao_age` e `autocura_ocr_nao_age` — são **pré-existentes**, causadas
por `ENOENT` de `.github/workflows/autocura-unitv-*.yml` (arquivos ausentes no LAB),
**sem relação** com esta etapa.

---

## 16. Testes reais realizados (04/09/2026)

### No LAB, antes do deploy de produção

- `#humano` enviado do WhatsApp real do número **2415** → invocação
  `webhook-wasender` (LAB v8) **HTTP 200**; log
  `[webhook-wasender] comando de atendimento humano processado
  {"comando":"assumir","outcome":"assumido"}`; a conversa canônica `5517981625486`
  passou a `aguardando_humano`.
- Uma tentativa anterior (09:13:31) retornou **HTTP 401** — foi **antes** de alinhar
  o `WASENDER_WEBHOOK_SECRET` do projeto LAB ao Webhook Secret da sessão 2415
  (corrigido em seguida; ver §21).
- A 1ª tentativa de **envio da confirmação** (no LAB) falhou com `401 invalid API
  key` — o `WASENDER_API_TOKEN` do projeto LAB estava desatualizado naquele momento
  (corrigido em seguida com o token da sessão 2415).

### Em produção, após o deploy (`webhook-wasender` v6 → v7)

- **Smoke read-only:** `POST` sem `X-Webhook-Signature` → **401**; `GET` → **200**;
  `PUT` → **405** — exatamente o que o código determina.
- **Ciclo de operador validado ao vivo em produção** (teste aprovado pelo usuário):
  `#humano` → o cliente envia mensagem e **não recebe resposta da IA** (conversa em
  `aguardando_humano`) → `#ia` → o cliente envia mensagem e **é respondido pela IA**
  (conversa de volta a `normal`). As **transições de estado** e a **pausa / retomada
  da IA** foram confirmadas neste teste.
- A **confirmação** na conversa (§13) é best-effort. No LAB, a 1ª tentativa falhou com
  `401 invalid API key` (token do projeto LAB desatualizado, corrigido depois — §22).
  Em produção o `WASENDER_API_TOKEN` é o da sessão 2415 (§19) e o comportamento de
  envio / erro está coberto pelos testes T15–T17; a entrega da confirmação em
  produção não foi alvo de observação dedicada nesta etapa.

### Deploy

`webhook-wasender` v6 → **v7 ACTIVE**, `verify_jwt=false`. Commit `f9285bf` em
`origin/main`. Nenhuma outra Edge Function redeployada (sha256 conferido). Nenhum
secret alterado.

---

## 17. Commits relevantes

| Repo | Commit | Descrição | Arquivos |
|---|---|---|---|
| LAB `inovatv-wasender-lab` | **`099feae`** | `feat(webhook-wasender): comandos #humano / #ia pelo proprio WhatsApp (LAB)` | 3 de código + 5 da suíte de testes |
| PROD `inovatv-api-intermediaria` | **`f9285bf`** | `feat(webhook-wasender): comandos #humano / #ia pelo proprio WhatsApp (producao)` | 3 de código, byte-idênticos ao LAB `099feae` |

Contexto pré-existente: `webhook-wasender` **já estava em produção** (v6, só
`messages.received` → Orquestrador) **antes** desta etapa. Esta etapa acrescentou
só o ramo de comando em `messages.upsert`.

---

## 18. Versões das Edge Functions

Sempre reconferir com `supabase functions list --project-ref <ref>`.

**PRODUÇÃO (`nduxsuxkopuvhwugdkqi`) — pós-deploy 04/09/2026:**

| Função | Versão | `verify_jwt` | Nota |
|---|---|---|---|
| `webhook-wasender` | **v7 ACTIVE** | `false` | esta etapa |
| `orchestrator` | v75 | `false` | **inalterada** pelo deploy |
| `match` | v37 | `true` | inalterada |
| `status` | v41 | `true` | inalterada |
| `webhook` (Meta) | v28 | `false` | inalterada |

Nenhuma das 30 outras funções teve o sha256 alterado pelo deploy.

**LAB (`uleklqdlwyofnkcsdigz`):** `webhook-wasender` **v8 ACTIVE** (`verify_jwt=false`);
`orchestrator` v12.

---

## 19. Secrets existentes (nome e função — NUNCA valores)

**PRODUÇÃO (`nduxsuxkopuvhwugdkqi`):**

| Secret | Função | Estado nesta etapa |
|---|---|---|
| `WASENDER_API_TOKEN` | Bearer do `POST /api/send-message` do WasenderAPI | inalterado (`updated_at` 2026-09-04 08:55Z) |
| `WASENDER_WEBHOOK_SECRET` | comparado, em texto puro, ao header `X-Webhook-Signature` | inalterado (`updated_at` 2026-09-04 08:55Z) |
| `WASENDER_BASE_URL` | base da API do WasenderAPI (`https://wasenderapi.com`) | inalterado |
| `ORCHESTRATOR_INTERNAL_TOKEN` | header `X-Internal-Token` da chamada interna `webhook-wasender → orchestrator` | inalterado (`updated_at` 2026-08-17) |

`WASENDER_API_TOKEN` e `WASENDER_WEBHOOK_SECRET` de produção **são as credenciais da
sessão "Tope Tv"/2415** — os digests SHA-256 foram conferidos idênticos aos do LAB.
**Nenhum secret de produção foi alterado nesta etapa.**

**LAB (`uleklqdlwyofnkcsdigz`):** `WASENDER_API_TOKEN` + `WASENDER_WEBHOOK_SECRET`
(também da sessão 2415, definidos durante os testes desta etapa; **sem**
`WASENDER_BASE_URL` — usa o default `https://wasenderapi.com`),
`ORCHESTRATOR_INTERNAL_TOKEN`, `GEMINI_*`, `ROCKET_*`, `SUPABASE_*`. **Sem
`WHATSAPP_*`** (o LAB não consegue tocar a Cloud API da Meta).

**Nota de plataforma:** `supabase functions deploy` re-carimba o `updated_at` dos 7
secrets auto-injetados `SUPABASE_*` (`SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`, `SUPABASE_JWKS`,
`SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_SECRET_KEYS`) — os **valores não mudam**; é
comportamento normal de qualquer deploy.

---

## 20. Procedimento de deploy

```
cd <repo>
npx supabase functions deploy webhook-wasender --project-ref <ref> --no-verify-jwt
```

- `<ref>`: **produção** `nduxsuxkopuvhwugdkqi` · **LAB** `uleklqdlwyofnkcsdigz`.
- O bundle carrega `webhook-wasender/index.ts` + o fecho de imports `_shared/`:
  `comando_atendimento.ts`, `conversas_estado.ts`, `telefone.ts`,
  `wasender_client.ts`, `webhook_dedup.ts`, `supabase_client.ts`, `types.ts`.
- **Verificação pós-deploy:**
  1. `supabase functions list --project-ref <ref>` → `webhook-wasender` com versão
     nova, `ACTIVE`, `verify_jwt=false`.
  2. Nenhuma outra função com sha256 alterado.
  3. `supabase secrets list --project-ref <ref>` → nenhum digest alterado (o
     `updated_at` dos `SUPABASE_*` pode re-carimbar — normal).
  4. Smoke read-only: `curl -X POST .../webhook-wasender` sem header → 401; `GET` →
     200; `PUT` → 405.

**Escopo obrigatório e exclusivo:** só `webhook-wasender`. **Nunca** redeployar
`orchestrator`/`match`/`status`/`webhook` por causa disto. **Nunca** tocar secrets,
migrations, RPCs, banco, configuração do Wasender ou da Meta.

---

## 21. Procedimento para alternar LAB ↔ PRODUÇÃO

O único ponto de comutação é a **Payload URL** da sessão "Tope Tv" no dashboard do
WasenderAPI.

1. `wasenderapi.com` → login do José → **Sessions → Tope Tv (#117404) → Manage
   Webhook**.
2. Alterar **somente** o campo **Payload URL**:
   - **PRODUÇÃO:** `https://nduxsuxkopuvhwugdkqi.supabase.co/functions/v1/webhook-wasender`
   - **LAB:** `https://uleklqdlwyofnkcsdigz.supabase.co/functions/v1/webhook-wasender`
3. Salvar → recarregar a página → conferir que a URL persistiu e que **nada mais**
   mudou.
4. Manter sempre: Endpoint ON · `messages.received` + `messages.upsert` ligados ·
   demais eventos desligados · Message Filtering (Groups/Broadcasts/Channels)
   ligados · **Webhook Secret NÃO rotacionar, NÃO revelar**.

**Pré-requisito do alvo:** o projeto Supabase para onde a URL apontar precisa ter
`WASENDER_WEBHOOK_SECRET` **e** `WASENDER_API_TOKEN` iguais aos da sessão 2415 — senão
o webhook retorna 401 na assinatura e/ou a confirmação falha com `401 invalid API
key`.

> ⚠️ **Apontar a Payload URL para o LAB desvia mensagens REAIS de clientes do fluxo de
> produção enquanto durar.** Fazer só em teste supervisionado e **restaurar para
> produção imediatamente depois**.

**Estado atual: PRODUÇÃO.**

---

## 22. Histórico da alternância temporária LAB ↔ PRODUÇÃO (04/09/2026)

Durante a construção e validação desta etapa, a Payload URL foi comutada
deliberadamente, e no fim **restaurada para produção**:

1. Estado inicial: Payload URL em **produção** (`nduxsuxkopuvhwugdkqi`), `webhook-wasender`
   v6 (sem comandos).
2. **Comutada para o LAB** (`uleklqdlwyofnkcsdigz`) para testar `#humano`/`#ia` ao
   vivo contra o número 2415 sem tocar produção.
   - 1º teste → **HTTP 401** (o `WASENDER_WEBHOOK_SECRET` do LAB não era o da sessão
     2415). Corrigido copiando o Webhook Secret da sessão para o secret do projeto
     LAB.
   - 2º teste → **HTTP 200**, `outcome: "assumido"`; a confirmação falhou com `401
     invalid API key`. Corrigido copiando o API Access Token da sessão 2415 para
     `WASENDER_API_TOKEN` do projeto LAB.
3. **Restaurada para produção** (`nduxsuxkopuvhwugdkqi`) — só o campo Payload URL,
   nada mais; conferida após reload.
4. Revisão técnica (auditoria) do código do LAB → **APROVADO PARA PRODUÇÃO**.
5. Deploy de produção `webhook-wasender` v6 → v7 (commit `f9285bf`).
6. Verificação de secrets de produção: `WASENDER_API_TOKEN` / `WASENDER_WEBHOOK_SECRET`
   já eram os da sessão 2415 (digests conferidos) — **nada alterado**.
7. Teste de produção do ciclo `#humano`/`#ia` → aprovado pelo usuário.

Os secrets `WASENDER_*` do **projeto LAB** ficaram configurados com as credenciais da
sessão 2415 (definidos nesta etapa) — relevante se o LAB for reusado para teste no
futuro (a Payload URL teria que ser re-apontada para o LAB, com o aviso do §21).

---

## 23. Estado final conhecido (2026-09-04)

- **PRODUÇÃO** (`inovatv-api-intermediaria` / `nduxsuxkopuvhwugdkqi`):
  `webhook-wasender` **v7 ACTIVE** com `#humano`/`#ia`. Código do recurso no commit
  `f9285bf` (em `origin/main`, ou à frente — reconferir `git log`). Wasender aponta
  a Payload URL para produção, sessão 2415, eventos `messages.received` +
  `messages.upsert`, secrets intactos.
- **LAB** (`inovatv-wasender-lab` / `uleklqdlwyofnkcsdigz`): `webhook-wasender` **v8
  ACTIVE**. Código do recurso no commit `099feae` (em `origin/main`, ou à frente).
  Working tree limpo (reconferir `git status` — pode haver commits de documentação
  posteriores).
- **Ciclo `#humano` → cliente sem resposta → `#ia` → cliente respondido pela IA:
  validado ao vivo em produção** (teste aprovado pelo usuário).
- Auditoria técnica da implementação: **APROVADO PARA PRODUÇÃO** (deploy escopado a
  `webhook-wasender` + os dois arquivos `_shared`; pré-condição de secrets de
  produção conferida).

---

## 24. Pendências futuras

- **Feature de SAÍDA / go-live geral do "Plano B" (WasenderAPI como canal de resposta
  da IA aos clientes)** — **gate separado, não faz parte desta etapa.** Ver
  `NEXT_SESSION.md`.
- **Sem feedback ao atendente** quando o comando é digitado errado (`#humanos`,
  `#ai`, `# humano` etc.) ou quando falta `cleanedSenderPn` — decisão deliberada
  (match estrito evita falso-positivo e loop).
- **Modelo mono-operador (José):** `#ia` digitado no 2415 encerra o episódio mesmo que
  alguém esteja atendendo aquela conversa pelo Painel. Sem risco hoje (é a mesma
  pessoa); ponto de coordenação num futuro multi-operador.
- **`pushName` não confirmado** no payload do WasenderAPI (ver "AUDITORIA DOCUMENTAL"
  no LAB `NEXT_SESSION.md`) → `nome_snapshot` pode ficar sem fonte neste canal.
- **Decidir se a suíte `scripts/testes/comando_atendimento_upsert/` é copiada para o
  repositório de produção** — hoje existe só no LAB.

*(O ciclo `#humano` → cliente sem resposta → `#ia` → cliente respondido pela IA
**já foi validado ao vivo** e não é pendência — ver §16 e §23.)*

---

## 25. Como continuar em outro computador (sem esta conversa)

1. Clonar / `git pull` nos dois repositórios:
   - `inovatv-api-intermediaria` → `origin/main` deve estar em `f9285bf` (ou à frente).
   - `inovatv-wasender-lab` → `origin/main` deve estar em `099feae`.
2. Ler **este documento** + a seção **"AUDITORIA DOCUMENTAL DO WASENDERAPI —
   2026-09-04"** no `NEXT_SESSION.md` do `inovatv-wasender-lab` (payloads, endpoints,
   limites do WasenderAPI).
3. Conferir o estado ao vivo:
   - `npx supabase functions list --project-ref nduxsuxkopuvhwugdkqi` (produção) e
     `--project-ref uleklqdlwyofnkcsdigz` (LAB) → versões.
   - `npx supabase secrets list --project-ref <ref>` → presença dos secrets (só
     digests; nunca valores).
4. Configuração do Wasender: dashboard `wasenderapi.com`, login do José, sessão "Tope
   Tv" #117404 — confirmar que a Payload URL aponta para **produção**.
5. CLIs necessárias (`supabase` autenticada, `gh`, `vercel`): ver
   `inovatv_central/CLAUDE.md`, seção 6 "Notas técnicas — ambiente". `flutter` **não**
   é necessário neste repositório.
6. Regra 0-B (`inovatv_central/CLAUDE.md`): as ferramentas interativas do Chrome
   (`computer`/`browser_batch`/`javascript_tool`) ligam/desligam junto com a sessão de
   trabalho.

---

## 26. Referências cruzadas

- `inovatv_central/CLAUDE.md` — estado do ecossistema InovaTV, frente Meta/Plano B,
  regra permanente de infraestrutura (nunca VPS / nunca custo recorrente novo).
- `inovatv-wasender-lab/NEXT_SESSION.md` — "AUDITORIA DOCUMENTAL DO WASENDERAPI —
  2026-09-04" (payloads, endpoints, rate limits, lacunas) + histórico do isolamento
  do laboratório.
- `docs/renovacao_automatica/` — frente de Renovação Automática (usa o mesmo
  `_shared/wasender_client.ts` para envio).
- `supabase/migrations/20260816140000_painel_atendimento_fatia1.sql`,
  `20260823140000_*.sql`, `20260823160000_*.sql` — Painel de Atendimento e as RPCs
  `assumir_atendimento` / `encerrar_atendimento_humano`.
