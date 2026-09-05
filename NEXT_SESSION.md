# NEXT_SESSION.md — Checkpoint de continuidade

> **✅ CHECKPOINT 2026-09-05 — RENOVAÇÃO REAL VIA WASENDER (ChannelTV,
> R$35) DE PONTA A PONTA, COM DINHEIRO REAL. Duas causas raiz reais
> encontradas e corrigidas na mesma sessão: (1) Account Protection da
> sessão Wasender bloqueava o 2º envio rápido em sequência — DESABILITADO
> na sessão `Tope Tv` `#117404`; (2) `_shared/renovacao_confirmacao.ts`,
> `renovacao-sigma-resultado/index.ts` e `_shared/notificacao_transferencia.ts`
> ainda enviavam pelo cliente Meta (restrito) em vez do Wasender (que já
> funciona) — os 3 migrados (import trocado, contrato idêntico).**
> Também nesta sessão: campo estruturado `esclarecimento` no Gemini
> (caso Elias, IA pode pedir esclarecimento em pergunta ampla/ambígua em
> vez de transferir) e o adaptador de confirmação de renovação via
> Wasender (`_shared/renovacao_wasender_resolver.ts` +
> `webhook-wasender/index.ts`) — ambos já estavam **deployados em
> produção** desde antes desta sessão de fechamento, só faltava
> **commitar** (working tree tinha esse trabalho todo pendente de
> versionamento). Migration `20260904200000_esclarecimento_pendente.sql`
> confirmada aplicada em produção mas ausente deste repositório —
> copiada de `inovatv-wasender-lab` nesta sessão (mesmo conteúdo, só
> versionamento). Detalhe completo na seção **"SESSÃO 2026-09-05 —
> RENOVAÇÃO REAL VIA WASENDER + ESCLARECIMENTO + MIGRAÇÃO META→WASENDER"**
> logo abaixo. **Pendências:** Base Mestra TOPE TV não promovida;
> `renovacao-sigma-watchdog` ainda tem 3 envios diretos ao cliente via
> `whatsapp_client.ts` (Meta) para os próprios textos do watchdog
> (timeout/expiração/lote) — fora do escopo desta migração; outros
> módulos Meta identificados (ver tabela na seção) permanecem fora
> desta etapa; comportamento de "Oi" populando `esclarecimento_pendente`
> registrado para revisão futura, não investigado nesta sessão. Antes
> disso:**
>
> **✅ CHECKPOINT 2026-09-04 — CANAL DE ENTRADA WASENDER: COMANDOS DE
> OPERADOR `#humano` / `#ia` EM PRODUÇÃO.** `webhook-wasender` v6 → **v7
> ACTIVE** (`verify_jwt=false`) no Supabase de produção
> `nduxsuxkopuvhwugdkqi`. Commit **`f9285bf`** em `origin/main`. Escopo
> exclusivo: `webhook-wasender/index.ts` + `_shared/comando_atendimento.ts`
> (novo) + `_shared/conversas_estado.ts` (+`buscarConversaPorTelefone`).
> **Orchestrator / match / status / webhook (Meta) NÃO redeployados;
> secrets / migrations / RPCs / configuração do Wasender INTACTOS.** O
> ciclo `#humano` → cliente sem resposta → `#ia` → cliente respondido
> pela IA foi **validado ao vivo em produção**. **Isto é o canal de
> ENTRADA / comando — NÃO é o go-live do "Plano B" nem a migração do
> canal de SAÍDA, que continuam como gate separado.** Detalhe completo:
> [`docs/canal_wasender/CANAL_WASENDER_COMANDOS_HUMANO_IA.md`](docs/canal_wasender/CANAL_WASENDER_COMANDOS_HUMANO_IA.md)
> · seção **"SESSÃO 2026-09-04 — CANAL DE ENTRADA WASENDER: COMANDOS
> `#humano` / `#ia`"** logo abaixo. Antes disso:**
>
> **🟢 DECISÃO 2026-09-03 — INVESTIGAÇÃO DO `130497` ENCERRADA.** Não
> investigar mais a causa, não fazer testes de envio para diagnóstico,
> não alterar WABA/número/tokens/estrutura/código por causa disso, não
> levantar novas hipóteses. Caminho definido: **Plano A** = tentativa
> prática com a identidade **TOPE TV** (nome de exibição no número
> oficial existente `1261574110375334`, sem tocar em mais nada);
> **Plano B** = **WasenderAPI** (API de terceiro), acionado só se o
> Plano A não restaurar a operação — sem insistência prolongada na
> Meta. Passo 0 (confirmar status do nome) e Passo 1 (submeter "TOPE
> TV") **ainda não executados**. Detalhe completo na seção **"DECISÃO
> 2026-09-03 — ENCERRAMENTO DA INVESTIGAÇÃO `130497` + PLANO A (TOPE
> TV) / PLANO B (WASENDERAPI)"** logo abaixo. O incidente `130497` em
> si continua real (registro técnico mantido abaixo), só não será mais
> investigada a causa. Antes disso:**
>
> **⚠️ INCIDENTE ABERTO (2026-08-31) — a WABA `1599304625307021` /
> número oficial `1261574110375334` está RESTRITA pela Meta de enviar
> mensagens a usuários no Brasil (erro `130497`). Graph API aceita
> (HTTP 200 + wamid), o callback de status volta `failed` com
> `errors[].code=130497`. Confirmado em 2 envios (04:08 e 04:11 UTC).
> NÃO é bug do nosso código — atendimento reativo e saudação inicial
> ficam sem entrega para clientes BR até destravar na Meta (passo
> manual). Ver seção "INCIDENTE META — 2026-08-31" logo abaixo. Antes
> disso:**
>
> **Atualizado: 2026-08-31 — MIGRAÇÃO DO CANAL WHATSAPP PARA O NÚMERO
> OFICIAL CONCLUÍDA. `WHATSAPP_PHONE_NUMBER_ID` → oficial
> (`1261574110375334`); `WHATSAPP_JOSE_NUMERO` → `17981625486`; os
> outros 3 `WHATSAPP_*` inalterados. 10 EFs de produção redeployadas só
> para propagar o secret (sem mudança de código). Smoke reativo +
> consulta real de vencimento + canal de alertas internos (Graph API
> HTTP 200) — todos OK, zero efeito financeiro. Número de teste antigo
> `17996286135` removido da Cloud API e depois bloqueado pela Meta —
> histórico do laboratório, sem impacto, sem ação. Ver seção "SESSÃO
> 2026-08-31 — MIGRAÇÃO DO CANAL WHATSAPP" logo abaixo. Antes disso:**
>
> **2026-08-30 (noite) — OpenPix Sandbox → PRODUÇÃO,
> Blocos 1–4 CONCLUÍDOS. 2 pagamentos reais em produção: Teste 1
> recuperado pela Camada 3 do watchdog (webhook 401 por chave pública
> errada no Bloco 3); chave corrigida → Teste 2 pelo caminho normal do
> webhook, sem watchdog. Fluxo financeiro de produção validado ponta a
> ponta. Também nesta sessão: token UniTV do dealer restaurado por
> recaptura manual (`recaptura_manual`/`jose`, Vault, `token_vivo`
> confirmado). Ver "SESSÃO 2026-08-30 (noite)" logo abaixo.** Antes
> disso, mesma data (tarde):

> **Autocura F4 código+testes + F5
> mecanismo preparado + reconciliação da Renovação. 1ª execução real
> F4.M FEITA: parou em `captcha_sem_confianca` (OCR sem calibração) —
> disciplina de segurança confirmada (0 POST, Vault intocado). Episódio
> `rc=300` na janela = CAUSA INDETERMINADA (usuário fez logout) — NÃO
> vira allowlist. Ver a SESSÃO 2026-08-30 logo abaixo.** Antes disso:
> Etapa 2 (Renovação UniTV)
> implementada e implantada; UniTV validado em produção (Sandbox);
> lote misto Sigma+UniTV com a execução conjunta comprovada e a falha
> do ChannelTV isolada. Substitui integralmente a versão anterior
> (encerramento da Etapa 1, 2026-08-28). Leia este arquivo inteiro
> antes de qualquer ação. Decisões encerradas estão em **[FECHADO]**
> ou na seção **"NÃO REABRIR / JÁ VALIDADO"** — não reabrir sem
> evidência nova e concreta.

---

## SESSÃO 2026-09-05 — RENOVAÇÃO REAL VIA WASENDER + ESCLARECIMENTO + MIGRAÇÃO META→WASENDER

**Sessão de fechamento — commita/documenta trabalho que já estava
deployado em produção desde antes desta sessão (esclarecimento +
adaptador de confirmação Wasender), mais o diagnóstico e correção de
duas falhas reais de transporte encontradas durante um teste real de
renovação com dinheiro de verdade.**

### PRODUÇÃO — estado das Edge Functions ao final desta sessão

| Função | Versão registrada no deploy desta etapa | Versão/hash atuais confirmados (`supabase functions list`) |
|---|---|---|
| `orchestrator` | v76 | v80, `sha256 cc7272ef3b33c43fc72128a81f3720070efa8bcfb94ff2904fe94ffbb07f2241` (mesmo conteúdo — versão só subiu por rotação de chave JWT da plataforma, sem redeploy nesta sessão) |
| `webhook-wasender` | v8 | v12, `sha256 60a7d2abc202ab7bb036a8776713d07f0df9d4adef2110d44b9a38bce7496817` (mesma nota acima) |
| `renovacao-confirmar` | v28 | v28, `sha256 205bdaf38d42e04fb773fb7b455497e4cce3c672faf858c57b077b78296e1e15` |
| `renovacao-sigma-resultado` | v28 | v28, `sha256 b30d810dcba28627aa7fb54a71b8ccfa52f16b4e2f30a4cdffdd901be7082524` |
| `renovacao-sigma-watchdog` | v28 | v28, `sha256 7a0e2d0c87867fc5948bd35e5c3adb471babd227b8c2a3a0dd52cbe02252b2c6` — **bundle atualizado** (herda `_shared/notificacao_transferencia.ts` corrigido), **arquivo-fonte do watchdog não alterado** |

`_shared/notificacao_transferencia.ts` migrado para `wasender_client.ts`
(era `whatsapp_client.ts`/Meta) — afeta as 3 funções acima que o
importam direta ou transitivamente.

### TESTE REAL — renovação ChannelTV, R$35, ponta a ponta

Cliente de teste (`5517981625486`), acesso ChannelTV, R$35,00, token
`4dfa9e56-c498-48cb-b032-8806823bbf60`:

1. Proposta ACEITO/CANCELAR chegou no WhatsApp real (após desabilitar
   Account Protection).
2. ACEITO processado (`estado='autorizada'`, `operacao_id` vinculado).
3. Cobrança PIX real criada no Woovi/OpenPix (R$35,00).
4. Pagamento real efetuado pelo usuário.
5. Cobrança confirmada `status='pago'`.
6. Workflow do GitHub Actions disparado, renovação no Sigma concluída.
7. Vencimento atualizado para **30/12/2026, 20:59:59**
   (`vencimento_confirmado`).
8. Mensagem final "✅ Pagamento confirmado!" chegou no WhatsApp real
   (confirmado pelo usuário e pelo Outgoing Message Activity do
   Wasender).

### PROBLEMAS ENCONTRADOS E RESOLVIDOS

1. **Account Protection da sessão Wasender bloqueava o 2º envio rápido
   em sequência** (menos de ~5s depois do 1º envio) — mesma falha que
   já vinha se repetindo (`renovacao:falha_enviar_botoes_confirmacao`).
   **Resolvido:** desabilitado manualmente na sessão `Tope Tv` `#117404`
   (painel `wasenderapi.com`), confirmado antes/depois + sessão
   continuou conectada. Reenvio de teste da proposta confirmou sucesso
   imediatamente após a mudança.
2. **`_shared/renovacao_confirmacao.ts` ainda usava `whatsapp_client.ts`
   (Meta)** para as mensagens de "preparando pagamento" e do PIX —
   cliente ficava em silêncio mesmo com a cobrança criada com sucesso.
   **Resolvido:** import trocado para `wasender_client.ts` (contrato
   idêntico, mesma assinatura das 3 funções). Reenvio de teste das 2
   mensagens pendentes deste token confirmou sucesso.
3. **`renovacao-sigma-resultado/index.ts` ainda usava `whatsapp_client.ts`
   (Meta)** para o template final "Pagamento confirmado!" e o aviso de
   dessincronia ao José — mesmo risco do item 2, ainda não exercitado
   até este teste. **Resolvido:** import trocado para `wasender_client.ts`.
   Confirmado no teste real (item 8 acima).
4. **`_shared/notificacao_transferencia.ts` ainda usava `whatsapp_client.ts`
   (Meta)** para a notificação de transferência humana (cliente +
   José) — chamado de dentro dos 2 arquivos acima e também de
   `renovacao-sigma-watchdog`. **Resolvido:** import trocado para
   `wasender_client.ts`. Herdado automaticamente por
   `renovacao-confirmar`, `renovacao-sigma-resultado` e
   `renovacao-sigma-watchdog` (bundle refrescado nos 3, sem alterar o
   código-fonte do watchdog).

Todas as 3 correções de import são de uma linha cada, contrato
preservado byte a byte (mesmas assinaturas de função, mesmo tipo de
retorno) — nenhuma mensagem, destinatário, parâmetro de template ou
regra de negócio foi alterada.

### PENDÊNCIAS

- **Base Mestra TOPE TV não promovida** — conteúdo comercial (planos,
  indicação, cancelamento, institucional) segue só no LAB
  (`inovatv-wasender-lab`), não incorporado à
  `conhecimento_institucional` de produção.
- **`renovacao-sigma-watchdog/index.ts` ainda tem 3 envios diretos ao
  cliente via `whatsapp_client.ts` (Meta)** para textos próprios do
  watchdog (mensagem consolidada de lote travado, expiração sem
  pagamento — 2x). Diferente da `notificacao_transferencia.ts` (já
  migrada), estes 3 são chamadas diretas dentro do próprio arquivo do
  watchdog, que **não foi alterado nesta etapa** (decisão explícita).
  Só afeta cenários de falha/timeout do watchdog (backstop, não o
  caminho principal) — nunca exercitado no teste real acima.
- **Outros módulos que ainda usam `whatsapp_client.ts` (Meta)**,
  identificados mas fora do escopo desta etapa:
  `confirmacao-renovacao/index.ts` (fallback de links antigos, lógica
  própria duplicada, não importa os arquivos migrados),
  `painel-atendimento-responder`, `autocura-unitv-monitor`,
  `autocura-unitv-resultado`, `poc-confirmacao-renovacao`.
- **Comportamento de "Oi" populando `esclarecimento_pendente`** —
  observado durante a investigação desta sessão, registrado para
  revisão futura, não investigado a fundo aqui.
- Migration `20260904200000_esclarecimento_pendente.sql` estava
  aplicada em produção mas ausente deste repositório — copiada de
  `inovatv-wasender-lab` (mesmo conteúdo) nesta sessão, junto do commit
  de fechamento.

### Funções descartáveis usadas nos testes desta sessão — já removidas

`teste-reenvio-proposta-channeltv` e `teste-reenvio-pix-channeltv`:
criadas, invocadas uma única vez cada, depois **deletadas do Supabase**
e removidas do working tree local. Não constam em `supabase functions
list` nem no git deste repositório.

---

## SESSÃO 2026-09-04 — CANAL DE ENTRADA WASENDER: COMANDOS `#humano` / `#ia`

> **Documento mestre desta frente:
> [`docs/canal_wasender/CANAL_WASENDER_COMANDOS_HUMANO_IA.md`](docs/canal_wasender/CANAL_WASENDER_COMANDOS_HUMANO_IA.md)**
> — arquitetura, payloads, RPCs, testes, procedimentos de deploy e de
> alternância LAB↔produção, secrets (sem valores), pendências. Esta
> seção é só o "onde paramos".

### O que entrou em produção

- `webhook-wasender` **v6 → v7 ACTIVE** (`verify_jwt=false`), projeto
  Supabase de produção `nduxsuxkopuvhwugdkqi`. Commit **`f9285bf`** em
  `origin/main` (3 arquivos, byte-idênticos ao LAB `099feae`):
  - `supabase/functions/webhook-wasender/index.ts` — o ramo
    `messages.upsert` passa a detectar `#humano` / `#ia` digitados no
    **próprio número 2415** (`key.fromMe === true`) **antes** de ignorar
    o resto. Dedup por `key.id`, telefone via `key.cleanedSenderPn`,
    chama as RPCs `assumir_atendimento` / `encerrar_atendimento_humano`
    (existentes, inalteradas) e envia uma confirmação curta best-effort
    na conversa. `messages.received` / `messages.update` / verificação de
    assinatura / `chamarOrquestrador` **inalterados**.
  - `supabase/functions/_shared/comando_atendimento.ts` — **NOVO**:
    `detectarComandoAtendimento` (match estrito de `#humano`/`#ia`) +
    `executarComandoAtendimento`.
  - `supabase/functions/_shared/conversas_estado.ts` —
    **+`buscarConversaPorTelefone`** (novo export, só `SELECT`, nunca
    cria). Nenhuma função existente tocada.
- **Nada mais foi redeployado.** `orchestrator` v75, `match` v37,
  `status` v41, `webhook` (Meta) v28 — sha256 conferido inalterado.
- **Nenhum secret alterado.** `WASENDER_API_TOKEN` /
  `WASENDER_WEBHOOK_SECRET` de produção já eram as credenciais da sessão
  "Tope Tv"/2415 (digests conferidos).

### Wasender / sessão 2415

- Sessão **"Tope Tv" #ID 117404 · +55 17 99624-2415 · Connected** (plano
  Basic, 1 sessão).
- **Payload URL atual: PRODUÇÃO** —
  `https://nduxsuxkopuvhwugdkqi.supabase.co/functions/v1/webhook-wasender`.
- Eventos assinados: `messages.received` + `messages.upsert`. Demais
  desligados. Message Filtering (Groups/Broadcasts/Channels) ligados.
- Assinatura do webhook: header `X-Webhook-Signature` = o próprio Webhook
  Secret **em texto puro** (não é HMAC).

### Histórico da alternância LAB ↔ produção (durante a etapa, já revertida)

A Payload URL foi comutada **temporariamente para o LAB**
(`uleklqdlwyofnkcsdigz`) para validar `#humano`/`#ia` ao vivo contra o
2415 sem tocar produção; corrigidos no caminho o `WASENDER_WEBHOOK_SECRET`
(1º teste deu 401) e o `WASENDER_API_TOKEN` (confirmação deu
`401 invalid API key`) do **projeto LAB**, alinhando-os à sessão 2415.
Depois **restaurada para produção** (só o campo Payload URL). Os secrets
`WASENDER_*` do projeto LAB ficaram configurados com as credenciais da
sessão 2415 (relevante se o LAB for reusado — re-apontar a Payload URL,
com o aviso de que isso desvia clientes reais).

### Testes

- **Automatizados** (`scripts/testes/comando_atendimento_upsert/`, só no
  repo do LAB): **93 asserts** — 26 da função pura + 17 testes de handler
  (67 asserts). Regressão LAB completa: **39 PASS / 2 FAIL**; as 2 falhas
  (`autocura_healer_nao_age`, `autocura_ocr_nao_age`) são **pré-existentes**
  (`ENOENT` de `.github/workflows/autocura-unitv-*.yml`), sem relação.
- **Reais (04/09/2026):** `#humano` do WhatsApp real do 2415 → invocação
  HTTP 200, `outcome:"assumido"`, conversa → `aguardando_humano`. Após o
  deploy de produção, smoke read-only (401 sem assinatura / 200 GET / 405
  PUT) e o **ciclo completo `#humano` → cliente sem resposta → `#ia` →
  cliente respondido pela IA validado ao vivo em produção** (teste
  aprovado pelo usuário).

### Auditoria técnica

**APROVADO PARA PRODUÇÃO**, condicionado a deploy escopado só a
`webhook-wasender` (+ os 2 `_shared`) e à pré-condição de secrets de
produção — ambas cumpridas.

### Pendências (ver §24 do documento mestre)

- Canal de **SAÍDA** / go-live geral do "Plano B" — **gate separado**,
  não faz parte desta etapa.
- Sem feedback ao atendente para comando digitado errado / sem
  `cleanedSenderPn` (deliberado — match estrito).
- Modelo mono-operador: `#ia` do 2415 encerra episódio mesmo com
  atendimento em curso no Painel.
- `pushName` não confirmado no payload WasenderAPI → `nome_snapshot` pode
  ficar sem fonte neste canal.
- Decidir se a suíte `comando_atendimento_upsert` é copiada para o repo
  de produção (hoje só no LAB).

> O ciclo `#humano` → cliente sem resposta → `#ia` → cliente respondido
> pela IA **já foi validado ao vivo** — **não** é pendência.

---

## DECISÃO 2026-09-03 — ENCERRAMENTO DA INVESTIGAÇÃO `130497` + PLANO A (TOPE TV) / PLANO B (WASENDERAPI)

> Decisão de produto do usuário, registrada nesta data. **Nenhuma
> alteração de código, infraestrutura, WABA, número, tokens ou
> configuração foi feita neste registro — só documentação.** Passo 0
> (confirmar status do nome) e Passo 1 (submeter "TOPE TV") descritos
> abaixo **ainda não foram executados** — cada um exige autorização
> pontual própria.

### 1. Investigação do `130497` — ENCERRADA

Evidência considerada suficiente pelo usuário:
- a Graph API aceita o envio inicialmente (HTTP 200 + WAMID);
- o callback de status assíncrono volta `failed` com `errors[].code=130497`;
- a Meta não informa de forma objetiva a causa específica da restrição;
- continuar investigando Account Quality, políticas, IPTV, nome da
  empresa, WABA ou outras hipóteses não está produzindo resposta
  verificável.

**A partir de agora, nesta frente, NÃO:**
- fazer novas investigações sobre a causa do `130497`;
- fazer testes de envio com o objetivo de diagnosticar a restrição;
- alterar a WABA oficial `1599304625307021` por causa disso;
- alterar número, tokens ou estrutura existente por causa disso;
- levantar novas hipóteses sobre a origem do bloqueio.

O incidente em si continua real e o registro técnico ("INCIDENTE META
— 2026-08-31", logo abaixo) permanece intacto — só a *investigação da
causa* foi encerrada.

### 2. Plano A — tentativa prática com a identidade TOPE TV

Ativos já existentes, considerados **suficientes** para esta etapa —
**não adicionar conteúdo ao site**, não transformar isto em novo
projeto de investigação:
- domínio `topetv.com.br` (registrado, hospedado na Hostinger, no plano
  que antes atendia `inovatv.pro` — site antigo removido pelo usuário);
- site institucional publicado, HTTPS ativo (`/`, `/privacidade.html`,
  `/termos.html` funcionando);
- `contato@topetv.com.br`;
- associação institucional declarada no site ("A TOPE TV é uma marca da
  JS Informática RP" + `contato@jsinformaticarp.com.br`), sem misturar
  as marcas — sem CNPJ/endereço/telefone/serviços/site da JS
  Informática, sem propaganda de IPTV/planos/preços/servidores.

**Escopo da tentativa:** submeter **"TOPE TV"** (com E — nunca "Topa
TV") como **nome de exibição do número oficial existente**
`1261574110375334`, na WABA `1599304625307021`. **Não** cria WABA
nova, **não** cria número novo, **não** toca `phone_number_id`, tokens,
roteamento, Edge Functions, banco nem código — é configuração 100%
Meta-side. `verified_name` retornado pela Graph API mudaria de
"InovaTV" para "TOPE TV" se aprovado; nada no código depende desse
campo.

Sequência (nenhum passo executado ainda; cada um exige autorização
própria):
- **Passo 0 — leitura, não altera nada:** confirmar o estado atual do
  nome de exibição do número oficial. Se "InovaTV" ainda estiver "Em
  análise", a Meta bloqueia submissão de nome novo (já ocorreu em
  2026-08-21 com "InovaTV Central" — erro *"verificação já em
  andamento"*) — nesse caso, esperar a análise fechar. Se rejeitado /
  campo liberado, seguir para o Passo 1. Fonte: WhatsApp Manager
  (usuário) ou `GET` read-only na Graph API
  (`fields=verified_name,name_status,new_name_status`) com token de
  leitura.
- **Passo 1 — a ação real:** submeter "TOPE TV" como nome de exibição
  na WhatsApp Manager (número oficial → Perfil → Editar nome de
  exibição).
- **Passo 2 — aguardar** a análise da Meta (dias a semanas — "InovaTV"
  está pendente desde 2026-08-15). Sem testes de envio nesse período.
- **Passo 3 — teste único de validação, se/quando aprovado:** UM envio
  real ao número pessoal do José, só para ver se a entrega passa (ou
  seja, se o `130497` caiu junto).
  - Entregou → Plano A funcionou; o rebrand de conteúdo
    (`MENSAGEM_SAUDACAO_INICIAL`, `SYSTEM_PROMPT` congelado, 29 entradas
    de `conhecimento_institucional`, Painel, site) vira **etapa
    separada com decisão própria** — não faz parte desta tentativa.
  - Continua `130497` → Plano A falhou → aciona Plano B.

**Nota técnica registrada na análise que precedeu esta decisão:** nome
de exibição e `130497` são mecanismos independentes da Meta —
aprovação de nome ≠ permissão de mensageria por país. Aprovar "TOPE
TV" **não garante** que o `130497` seja levantado. Por isso o Passo 3
(teste único) é o que de fato decide entre Plano A e Plano B.

**Risco registrado (usuário já decidiu prosseguir):** 3ª submissão de
nome de exibição numa conta com 2 rejeições anteriores ("InovaTV" e
"JS Informática RP") + restrição `130497` ativa pode ser lida pelos
sistemas da Meta como tentativa de evasão. Baixo esforço tentar, não é
risco zero.

### 3. Plano B — WasenderAPI (NÃO implementar agora)

Se o Plano A não restaurar a operação (nome aprovado mas entrega
continua bloqueada, ou nome novamente rejeitado), **parar de insistir
na Meta** e migrar o canal de saída para **WasenderAPI** (API de
terceiro para WhatsApp).

- **Por enquanto: apenas registrado como o próximo caminho.** Nenhuma
  conta, credencial, integração, código ou custo novo criado nesta
  data.
- Detalhamento (arquitetura de integração, ponto de troca no
  `_shared/whatsapp_client.ts` / Orquestrador, contrato, custo, riscos
  de banimento de número em API não-oficial) fica para quando/se o
  Plano B for acionado — com sua própria análise e autorização, mesma
  disciplina de sempre.
- Motivo da existência do Plano B: o usuário não quer o projeto parado
  por semanas tentando descobrir um motivo que a própria Meta não
  informa.

### 4. Estado ao registrar esta decisão

- Nenhuma alteração de código/infra/Meta/Rocket/banco/secret.
- Passo 0 e Passo 1 **não executados**.
- `orchestrator` v71 / `webhook` v27 (instrumentação de
  observabilidade) seguem em produção, inalterados.
- Repositórios `inovatv_central`, `inovatv-api-intermediaria`,
  `inovatv_painel`: `HEAD == origin/main`, working tree limpo (sync de
  2026-09-03).
- Ponteiro para esta decisão adicionado em `inovatv_central/CLAUDE.md`.

---

## SESSÃO 2026-08-31 (noite) — SAUDAÇÃO INICIAL + PAINEL + OBSERVABILIDADE WHATSAPP + INCIDENTE META `130497`

> Consolidação de fechamento. Commits do dia: `662c9a5`, `8d5e27b`,
> `c1f2ffd`, `94e11c1` — **todos em `origin/main`**. Deploys: `orchestrator`
> **v71**, `webhook` **v27** (Supabase, `--no-verify-jwt`); Painel
> (Next.js, `inovatv-api-intermediaria/painel/`) publicado no Vercel pela
> integração Git a partir de `8d5e27b`. Nenhuma mudança em Meta, secrets,
> Rocket, banco (exceto limpezas de histórico do Painel descritas abaixo),
> F4/F5. Nenhuma cobrança/renovação.

### 1. Saudação inicial do novo atendimento

**O que é:** primeira mensagem que o cliente recebe ao abrir uma conversa
nova com o número oficial. Texto fixo, temporário (fase de adaptação dos
clientes ao novo modelo de atendimento) — deve ser **encurtado/revisado**
no futuro, editando **apenas** a constante `MENSAGEM_SAUDACAO_INICIAL` em
`supabase/functions/_shared/mensagens_fixas.ts` (ponto único do texto, sem
tocar lógica).

**Texto final aprovado** (`MENSAGEM_SAUDACAO_INICIAL`, commit `8d5e27b`):

```
👋 Olá! Sou o Assistente Virtual da InovaTV 😊

Este é o nosso canal oficial no WhatsApp ✅

✨ A InovaTV mudou a forma de atendimento!

Agora você pode resolver tudo de forma rápida e automática por aqui. Você pergunta, eu respondo — sem precisar esperar por um atendente. 😉

📅 Quer saber quando seu plano vence? É só perguntar.

🔄 Quer renovar seu plano? Eu também posso ajudar você a fazer sua renovação automaticamente por aqui.

🛠️ Precisa de ajuda ou suporte? Também posso ajudar você por aqui.

Para não incomodar você, não enviaremos mais lembretes de vencimento. 📅 É só perguntar quando quiser.

E agora, me diga: como posso ajudar você hoje? 😊
```

**Comportamento (implantado em `orchestrator` v71):**
- **Critério de "primeiro contato":** `contarMensagensDaConversa(conversation_id) === 0`
  (nova função aditiva em `_shared/mensagens_atendimento.ts`) — nenhuma
  linha ainda em `mensagens_conversa` para a conversa. Cliente conhecido
  (≥ 1 mensagem, inclusive pós-atendimento humano) nunca recebe de novo.
- **Ordem de gravação:** a **mensagem do cliente é gravada ANTES da
  saudação** (`inserirMensagem("cliente", …)` → depois a saudação) — no
  Painel aparece `cliente → Assistente Virtual`, nunca o inverso.
- **Mudança pós-teste real (aprovada 2026-08-31):** no primeiro contato a
  requisição faz **só a saudação e ENCERRA (`return "saudacao_inicial"`)**
  — **NÃO chama o Gemini**, não envia uma segunda mensagem do sistema. A
  próxima mensagem do cliente (`count > 0`) segue o fluxo normal do
  Gemini; o bloco não roda de novo, então a Cadeia 1 do fluxo normal
  nunca duplica a gravação do cliente.
- **A saudação só é gravada no histórico se o envio teve sucesso**
  (`envioSaudacao.outcome === "success"`) — mesma disciplina dos demais
  envios do Orquestrador (transferência/renovação).
- Nunca gerada pelo Gemini. `SYSTEM_PROMPT` congelado intocado.
- Testes locais: `scripts/testes/saudacao_inicial/` — 6 cenários, 100%
  verdes (roda o handler real do `orchestrator` + validador + contexto +
  `mensagens_fixas` reais; deps externas fakeadas). Inclui
  `fake_whatsapp_client.mjs` com toggle de falha de envio.
- **NÃO validável em produção enquanto o incidente Meta `130497` (seção 4)
  impedir a entrega.** No teste real de 01:08 BRT a saudação nem chegou a
  ser o caminho exercitado (ver seção 4 / conversa com resíduo).

### 2. Painel de Atendimento

- **Correção visual (frontend apenas, commit `8d5e27b`):**
  `painel/app/conversas/layout.tsx` → `conversasFiltradas` passou a ocultar
  conversas onde `ultima_mensagem_cliente_em === null` **e**
  `ultima_mensagem_texto === null`. Aplica-se aos 3 filtros ("Todas",
  "Não lidas", "Aguardando humano"). **Nenhuma mudança de Edge Function,
  nenhuma mudança de schema, nenhum DELETE.** Publicado no Vercel
  (deployment `dpl_CLfKXE8vHm7wLoSuyNfVvqbSk3Tz`, alias de produção
  `inovatv-api-intermediaria.vercel.app`); bundle deployado confirmado
  contendo o filtro.
- **Histórico do Painel zerado (2 limpezas de banco, transação atômica com
  gate de verificação pré-COMMIT):**
  1. Limpeza geral: `mensagens_conversa` 405→0, `conversas_episodios`
     27→0, `conversas_estado` 10→2. 8 conversas sem dado operacional
     removidas por completo.
  2. Limpeza direcionada das 2 conversas remanescentes (`43fcff07` /
     `5517981625486` e `5f96d721` / `5517981563170`): mensagens e
     episódios dessas 2 apagados; linhas de `conversas_estado`
     **mantidas** (FK), campos de estado/prévia/sessão zerados,
     `estado='normal'`.
- **Preservação das referências operacionais da Renovação Automática:**
  `cobrancas_pix` (16), `tokens_renovacao` (28), `renovacoes_lote` (6) —
  **intactos, fingerprint MD5 idêntico antes/depois** nas duas limpezas.
  As 2 linhas de `conversas_estado` foram mantidas exatamente porque
  `cobrancas_pix`/`tokens_renovacao`/`renovacoes_lote` têm FK
  `ON DELETE NO ACTION` para elas.
- **Estado atual do Painel:** lista **vazia** ("Nenhuma conversa neste
  filtro."), nada selecionado automaticamente. As 2 linhas de
  `conversas_estado` existem no banco mas estão ocultas (ambos
  `ultima_mensagem_*` nulos). Assim que um cliente mandar mensagem, a
  conversa dele volta a aparecer.
- **Defeito pré-existente registrado, NÃO corrigido** (ver seção 5,
  pendência 3): no caminho `responder` puro do Orquestrador, a Cadeia 1
  grava `cliente`+`ia` em `mensagens_conversa` **incondicionalmente**,
  antes/independente do resultado do envio — "aparece no Painel" ≠
  "aceito pela Graph API" nesse caminho.

### 3. Observabilidade de envio WhatsApp (commit `c1f2ffd`)

**Motivo da criação:** após o 1º teste real, a saudação apareceu no Painel
mas não chegou ao WhatsApp; a infraestrutura não tinha como distinguir
"aceito pela Graph API" de "entregue" — os callbacks de status da Meta
(`value.statuses`) eram **reconhecidos e descartados sem log**.

- **`_shared/whatsapp_client.ts`:** `enviarMensagemWhatsApp`, ao receber
  sucesso da Graph API (HTTP 2xx + `messages[0].id`), loga
  `{ evento: "whatsapp_send_accepted", wamid, destinatario, timestamp,
  outcome: "success" }`. Nunca loga corpo da mensagem, token ou secret.
  Retorno inalterado.
- **`webhook/index.ts`:** o bloco `value.statuses` passa a logar
  `{ evento: "whatsapp_delivery_status", wamid, recipient_id, status,
  timestamp }` **por status recebido**; se `failed`, acrescenta
  `errors[].code/title/details`. **Depois do log, mantém exatamente o
  comportamento atual** (reconhece e descarta — sem persistir, sem tabela,
  sem mudança de fluxo).
- **Funções instrumentadas e redeployadas:** `orchestrator` (v71, carrega
  o novo `_shared/whatsapp_client.ts`) e `webhook` (v27). As outras 9
  funções que importam `whatsapp_client.ts` mantêm a cópia antiga — não
  precisam de redeploy para o diagnóstico da saudação.
- Foi essa instrumentação que capturou o `130497` (seção 4).

### 4. INCIDENTE META — WABA restrita para envio a usuários no Brasil (erro `130497`)

> **Não é bug do nosso código. Próximo passo é investigação MANUAL na
> Meta.** Prioridade nº 1 para amanhã.

#### Causa (definitiva, confirmada por log da Meta)

**A Business Account / WABA da Meta está RESTRITA de enviar mensagens a
usuários no Brasil.** Código de erro da Graph API: **`130497` — "Business
account is restricted from messaging users in this country."**

#### Identificadores

- Número oficial: **+55 17 99624-2415**
- `phone_number_id`: **`1261574110375334`** (secret `WHATSAPP_PHONE_NUMBER_ID`,
  inalterado desde a migração de 2026-08-30 23:47 UTC)
- WABA: **`1599304625307021`**
- App Meta: `InovaTV IA - Teste` / `1022259220848151`
- `verified_name` "InovaTV": ainda **"Em análise"** na Meta

#### Evidência

Dois envios distintos do número oficial `1261574110375334` →
`5517981625486` (celular pessoal do José), com a instrumentação
`orchestrator` v71 / `webhook` v27 ativa:

| Envio (UTC) | Graph API (síncrono) | Callback de status (assíncrono, `webhook`) |
|---|---|---|
| **2026-08-31 04:08:25** | **HTTP 200 + `wamid`** (aceito) | `whatsapp_delivery_status` → `status=failed`, `errors[].code=130497` |
| **2026-08-31 04:11:07** | **HTTP 200 + `wamid`** (aceito) | `whatsapp_delivery_status` → `status=failed`, `errors[].code=130497` |

Consistente também com as não-entregas anteriores do mesmo número
(2026-08-31 03:13 resposta do Gemini; 03:47 saudação fixa) — mesma
restrição. A única mensagem que chegou de fato foi a saudação das
**03:13**, provavelmente antes de a restrição entrar em vigor (ou
janela de graça inicial da conta).

#### O que NÃO é a causa

- ❌ Não é o Orquestrador, a saudação inicial, o Gemini, validador,
  throttle nem pacing/ecosystem-health.
- ❌ Não é código. `enviarMensagemWhatsApp` fez o que devia (a Graph
  API respondeu 200 + wamid); o `failed 130497` só aparece no callback
  de status posterior.
- ❌ Não é o número/secret errado — remetente `1261574110375334` e
  destinatário `5517981625486` corretos e inalterados desde a migração
  de 2026-08-30.

#### Impacto

**Nenhuma mensagem iniciada pela empresa a partir do número oficial
`1261574110375334` é entregue a usuários no Brasil enquanto a restrição
estiver ativa.** Isso deixa inoperante, para clientes BR:
- o atendimento reativo real (resposta do Orquestrador/Gemini);
- a saudação inicial de primeiro contato.

O canal está **tecnicamente correto** (webhook recebe, Orquestrador
processa, Graph API aceita) mas **sem entrega** por decisão da Meta.

#### Próximo passo (MANUAL, na Meta — não é trabalho de código)

Investigar em **WhatsApp Manager / Business Manager / suporte da Meta** a
**origem e o motivo da restrição `130497`** da WABA `1599304625307021` /
número `1261574110375334`: verificação de empresa, política de conteúdo,
qualidade/denúncias, país de operação declarado, `verified_name`
("InovaTV" ainda "Em análise"), limites da conta. Sem esse
destravamento, nenhum teste real de entrega faz sentido.

### 5. Número de teste antigo `+55 17 99628-6135` — só histórico

- Chip descartável usado no laboratório da IA própria.
- **Removido da Cloud API** (WhatsApp Business App tirado de propósito).
- **Posteriormente bloqueado pela Meta.**
- Classificado apenas como **histórico de laboratório** — sem impacto na
  operação, **nenhuma ação necessária**, não tentar recuperar/reativar.
  (Já registrado também na seção "SESSÃO 2026-08-31 — MIGRAÇÃO DO CANAL
  WHATSAPP", mais abaixo.)

### 6. Estratégia de produto — lembretes de vencimento

- **Decisão:** **NÃO** construir motor automático de lembretes de
  vencimento neste momento (nem cron, nem template de lembrete, nem
  substituição das réguas do RocketZap).
- O cliente **consulta o vencimento quando quiser**, perguntando à IA
  ("Quer saber quando seu plano vence? É só perguntar" — dito na
  saudação).
- A **Renovação Automática continua disponível** normalmente (fluxo
  OpenPix → Rocket → Cloud API já em produção).
- A **saudação inicial informa essa mudança** ao cliente ("Para não
  incomodar você, não enviaremos mais lembretes de vencimento").
- A frente "Substituição do RocketZap / Motor de lembretes"
  (`docs/renovacao_automatica/`) fica **congelada** — não reabrir sem
  decisão de produto nova.

### 7. Commits / versões / deploys de 2026-08-31 (noite)

| Commit | O que é | Em `origin/main`? |
|---|---|---|
| `662c9a5` | Saudação inicial (1ª versão: primeiro contato, ainda aditiva ao Gemini) + suíte `scripts/testes/saudacao_inicial/` | ✅ |
| `8d5e27b` | Saudação: primeiro contato faz só a saudação + ordem cliente→IA + Painel oculta conversas vazias; texto final aprovado | ✅ |
| `c1f2ffd` | Observabilidade: `whatsapp_send_accepted` (`_shared/whatsapp_client.ts`) + `whatsapp_delivery_status` (`webhook/index.ts`) | ✅ |
| `94e11c1` | Registro do incidente Meta `130497` (só doc — versão inicial desta seção) | ✅ |

**Deploys:**
- `orchestrator`: **v71** ACTIVE, `verify_jwt=false` — carrega saudação
  (v71) + `_shared/whatsapp_client.ts` instrumentado.
- `webhook`: **v27** ACTIVE, `verify_jwt=false` — `whatsapp_delivery_status`.
- **Nenhuma outra Edge Function redeployada** (28 demais nas versões
  anteriores).
- **Painel (Next.js, `inovatv-api-intermediaria/painel/`):** publicado no
  **Vercel** pela integração Git a partir de `8d5e27b` — deployment
  `dpl_CLfKXE8vHm7wLoSuyNfVvqbSk3Tz`, alias de produção
  `inovatv-api-intermediaria.vercel.app` (READY, bundle confirmado com o
  filtro).
- **`inovatv_central` e `inovatv_painel` (repositórios):** **não tocados
  hoje** — HEAD == origin/main (`0b66b55` e `ccb31be` respectivamente).

### 8. Pendências para amanhã (ordem de prioridade)

1. **Investigação manual na Meta do erro `130497`** — próxima prioridade
   absoluta. Sem destravar isso, nada de WhatsApp de saída funciona para
   clientes BR.
2. **Teste da saudação em produção** — **não** considerado validado
   enquanto a restrição `130497` impedir a entrega. Código correto e
   implantado (v71), testes locais 100%.
3. **Correção definitiva da inconsistência do Painel** (Cadeia 1 grava
   `cliente`+`ia` sem confirmar envio, no caminho `responder` puro) —
   avaliar depois, **não implementar agora**. Menor correção já proposta:
   mover os `inserirMensagem` para dentro do `if (envioResultado.enviado)`
   da Cadeia 2. Só conserta o registro enganoso, não a entrega.
4. **Revisão futura da saudação temporária** — encurtar/reduzir o texto
   quando os clientes estiverem acostumados ao novo modelo. Editar
   **apenas** `MENSAGEM_SAUDACAO_INICIAL` em `_shared/mensagens_fixas.ts`.
5. **Mensagens automáticas do Rocket** — por enquanto **não implementar
   lembretes**. Estratégia atual: consulta de vencimento sob demanda pela
   IA (seção 6). Frente do "Motor de lembretes" congelada.
6. *(operacional, não é bug)* Cada teste manual futuro deve partir de uma
   conversa **efetivamente zerada** — o teste de 01:08 caiu no fluxo
   normal (e não no primeiro-contato do v71) porque as 2 linhas do teste
   das 03:47 nunca foram removidas de `43fcff07`. Hoje a conversa
   `43fcff07` (`5517981625486`) foi zerada (limpeza direcionada, seção 2).

---

## SESSÃO 2026-08-31 — MIGRAÇÃO DO CANAL WHATSAPP PARA O NÚMERO OFICIAL

> Consolidação documental antes de troca de máquina. **Nenhum código de
> produção alterado, nenhum teste financeiro, nenhuma mudança na Meta ou
> no Rocket.** Só troca de 2 secrets + redeploy de propagação + testes
> read-only + esta documentação.

### Estado final do canal (lado Meta — verificado por GET read-only)

- Número oficial: **+55 17 99624-2415** · `phone_number_id` =
  **`1261574110375334`** (o de teste era `1297487746776498`).
- WABA = **`1599304625307021`** · App = **`InovaTV IA - Teste` /
  `1022259220848151`** — os mesmos do número de teste; nada recriado.
- `GET /1261574110375334`: `status=CONNECTED`, `code_verification_status`/
  `verified_name`="InovaTV", `platform_type=CLOUD_API`,
  `quality_rating=GREEN`.
- `GET /1599304625307021/phone_numbers`: número oficial na WABA correta,
  `webhook_configuration.application` → `.../functions/v1/webhook`.
- `GET /1599304625307021/subscribed_apps`: App `1022259220848151` **ainda
  inscrito** na WABA.
- `GET /debug_token`: token válido, escopos
  `whatsapp_business_management` + `whatsapp_business_messaging`.
- Meta → Configuração de produção: **Configurar webhooks / Registrar
  número / Adicionar informações de pagamento / Enviar mensagem** —
  todos **concluídos**. Verificação da empresa **concluída**.

### Secrets — só nome + função (valores nunca neste arquivo)

| Secret | Mudança |
|---|---|
| `WHATSAPP_PHONE_NUMBER_ID` | **trocado** → número oficial (`1261574110375334`). Único ponto de leitura no código: `_shared/whatsapp_client.ts`. |
| `WHATSAPP_JOSE_NUMERO` | **trocado** → `17981625486` (destinatário dos alertas internos ao José). Precisou mudar: era o próprio número oficial → colisão remetente=destinatário (Graph API rejeita). `17981625486` já é ativo no WhatsApp, usado só como destinatário; **não** precisa cadastro na Meta/WABA. |
| `WHATSAPP_ACCESS_TOKEN` | **inalterado** — System User, escopo da mesma WABA `1599304625307021`. |
| `WHATSAPP_APP_SECRET` | **inalterado** — nível App. |
| `WHATSAPP_VERIFY_TOKEN` | **inalterado** — handshake do webhook, nível App. |

Aplicados via `supabase secrets set --env-file` (arquivo gitignored em
`scripts/.credentials/`, `shred -u` logo após). Digests pós-troca
conferidos == SHA-256 dos valores esperados; digests dos outros 3
`WHATSAPP_*` + `updated_at` **inalterados**.

### Redeploy de propagação — SEM mudança de código

10 EFs de produção que enviam WhatsApp (leem `WHATSAPP_PHONE_NUMBER_ID`
via `_shared/whatsapp_client.ts`, direto ou transitivo):
`orchestrator`, `openpix-webhook`, `renovacao-confirmar`,
`confirmacao-renovacao`, `renovacao-sigma-watchdog`,
`renovacao-sigma-resultado`, `renovacao-unitv-conta`,
`autocura-unitv-monitor`, `autocura-unitv-resultado`,
`painel-atendimento-responder`. Todas `ACTIVE` / `verify_jwt=false`.
`ezbr_sha256` **idêntico** ao anterior em 8/10; as 2 exceções
(`renovacao-unitv-conta`, `painel-atendimento-responder`) só
recompilaram porque a última publicação delas era anterior a
`origin/main 8313245` — ficaram **alinhadas** a `main`, sem alteração de
fonte (working tree limpo, `HEAD == origin/main == 8313245`).
`webhook` **não** foi redeployada — não lê o secret (número-agnóstico,
`phone_number_id` vem de `value.metadata` do payload).
(Versões subiram +2 nas 10 e +1 no `webhook` que não toquei → rotação
de chave JWT de plataforma da Supabase concomitante; benigno.)

### Testes reais no número oficial — nenhum efeito financeiro

1. **Smoke reativo** — "ola" do celular pessoal (`5517981625486`) → número
   oficial. `webhook_mensagens_processadas` gravou o `message_id`;
   conversa `43fcff07-…` (telefone `5517981625486`), `estado=normal`,
   resposta `ia` "Olá! Sou o assistente virtual da InovaTV…" em ~0,47 s,
   sem transferência.
2. **Consulta real de vencimento** — cliente existente perguntou pelo
   plano → IA listou os **2 acessos reais** (servidor/plano/vencimento/
   telas corretos) e pediu qual consultar. Comportamento idêntico ao
   validado nas Rodadas 3/4.
3. **Canal de alertas internos** — EF descartável `diag-alerta-interno`
   (deployada → 1 invocação → **deletada**; arquivo local removido)
   enviou texto "TESTE DE ALERTA INTERNO" para `WHATSAPP_JOSE_NUMERO`
   (`17981625486`) pelo número oficial como remetente →
   **Graph API HTTP 200**, `contacts[0].wa_id=5517981625486`,
   `messages[0].id` retornado, `error=null`, latência 566 ms.
4. **Estado financeiro** — `cobrancas_pix` / `tokens_renovacao` /
   `renovacoes_lote`: **0** linhas criadas ou alteradas nas 3 h dos
   testes (última atividade real = Bloco 4, 20:38–20:39 UTC).

### Número de teste antigo — histórico do laboratório

- **`+55 17 99628-6135`** (chip descartável, `phone_number_id`
  `1297487746776498`): **removido da Meta/Cloud API** pelo usuário e
  devolvido ao **WhatsApp Business comum** como canal provisório de
  atendimento até o oficial estar 100%.
- **Fato novo:** a **Meta bloqueou posteriormente esse número de
  teste.** Classificado como **histórico do ambiente de teste** — já
  cumpriu a função de laboratório, **sem impacto no número oficial**,
  **sem ação necessária**. **Não tentar reativar/recuperar.**

### Autocura — reafirmação (inalterada nesta sessão)

F3-A **intacta** (`autocura-unitv-monitor` `*/15` +
`autocura-unitv-ocr-agendador` `0 3 * * *` ativos, só observação).
**F4 e F5 congeladas:** `healer_ativo=false`, `modo_observacao=true`,
`return_codes_que_disparam=NULL`, `kill_switch=false`, **nenhum cron de
healer**. F4.M real interrompida com segurança em
`captcha_sem_confianca` — **sem POST de login, Vault intocado**.
`rc=300` = causa **indeterminada** (logout do usuário) → **não entra na
allowlist**.

### Próximo passo recomendado (canal WhatsApp)

Observar o número oficial em atendimento reativo real por um período.
**Templates business-initiated fora da janela de 24 h** podem depender
da aprovação do `verified_name` "InovaTV" pela Meta (mesmo comportamento
do número de teste) — validar no primeiro caso real. Migração do
RocketZap e do número oficial no Rocket permanece **gate próprio**
(seção "Pendências reais restantes" abaixo).

---

## SESSÃO 2026-08-30 (noite) — Token UniTV restaurado + OpenPix Sandbox → PRODUÇÃO (Blocos 1–3)

> F4/F5 da autocura **congeladas** (`healer_ativo=false`,
> `modo_observacao=true`, allowlist `NULL`). F3-A **intacta**
> (`autocura-unitv-monitor` `*/15` + `autocura-unitv-ocr-agendador`
> `0 3 * * *` ativos). Arquitetura de renovação já validada **não
> reaberta**.

### Token UniTV do dealer — RESTAURADO

Após o rc=300 (causa indeterminada, ver SESSÃO da tarde), o `dealer_token`
do painel foi **recapturado manualmente** (José, via snippet de console
que decifra o corpo AES de `POST /api/account` — o token de 32 hex NÃO
está em header, está no campo `dealer_token` do corpo cifrado) e gravado
no **Vault** via `unitv_dealer_token_definir('<token>','recaptura_manual','jose')`.
- `unitv_dealer_token_estado`: `origem='recaptura_manual'`,
  `atualizado_por='jose'`, `atualizado_em=2026-08-30 16:59:42 UTC`.
- Edge secret `UNITV_DEALER_TOKEN` **NÃO tocado**.
- Validado: `unitv_token_diagnostico` → **`token_vivo`, `probe_ok=3`,
  `ancora_status=ok`** em 2 leituras (cron 17:00:43 + disparo manual
  17:02:16 UTC). Renovação UniTV voltou a funcionar.
- Confirmado o formato: **`dealer_token` continua `^[0-9a-f]{32}$`** — o
  painel NÃO mudou o formato. Os headers `Token`/`Authorization` (34
  chars) são credencial de sessão, SEPARADA do `dealer_token`.

### OpenPix — Bloco 1 (código) — `1a66a8f`

`_shared/openpix_client.ts`: `const SANDBOX_BASE_URL` → `const OPENPIX_BASE_URL
= Deno.env.get("OPENPIX_BASE_URL") ?? "https://api.woovi-sandbox.com"` +
os 2 usos renomeados + comentário. **Zero mudança de comportamento sem o
secret.** Nenhuma lógica financeira alterada (confirmado por diff:
3 hunks, só a origem da base URL). Suíte 37/37.

### OpenPix — Bloco 2 (Woovi, José) — CONCLUÍDO

Conta Woovi **produção** criada, webhook cadastrado
(`https://nduxsuxkopuvhwugdkqi.supabase.co/functions/v1/openpix-webhook`,
evento `OPENPIX:CHARGE_COMPLETED`), `OPENPIX_APPID` e
`OPENPIX_WEBHOOK_PUBLIC_KEY` de produção disponíveis.

### OpenPix — Bloco 3 (secrets + deploy) — CONCLUÍDO (2026-08-30 ~18:50 UTC)

**⚠️ Sandbox DESLIGADO a partir daqui — secrets sobrescritos.**

- **Secrets aplicados** (via `supabase secrets set` / `--env-file` de
  arquivo gitignored `scripts/.credentials/_openpix_prod.env`, apagado
  com `shred` logo após; valores nunca exibidos):
  - `OPENPIX_BASE_URL` = `https://api.woovi.com` (novo)
  - `OPENPIX_APPID` — digest `789437aab328…` → **`1ecc1f9dd4b8…`** (mudou)
  - `OPENPIX_WEBHOOK_PUBLIC_KEY` — digest `5213d70de0d7…` → **`6b6961ad2bfc…`** (mudou)
- **Deploy** (`--no-verify-jwt`, todos `ACTIVE`, `verify_jwt=false`):
  `openpix-webhook` **v19**, `confirmacao-renovacao` **v17**,
  `renovacao-sigma-watchdog` **v19**, `orchestrator` **v65**. (Saltos de
  +3 nas versões = redeploys de plataforma concomitantes; o código
  deployado é o `main` HEAD `1a66a8f`.)
  - `openpix-webhook`/`confirmacao-renovacao`/`watchdog` trazem o novo
    `openpix_client.ts` + `7f6cdc0`/`e3bee32` (openpix-webhook).
  - `orchestrator` traz `aa9895d` (`mensagemFalhaResolucaoUnitv` — texto
    de transferência mais preciso; motivo interno inalterado).
- **Smoke `openpix-webhook`:** sem assinatura → **401** · assinatura
  inválida → **401** (⇒ RSA valida contra a PEM de produção e falha em
  lixo, como esperado) · `GET` → **405**.
- **Cron `renovacao-sigma-watchdog` `*/5`** — ativo.
- **Suíte completa `.mjs`: 37/37 verde.**
- **Nenhuma cobrança, pagamento, ACEITO ou renovação real.**

### Bloco 3.1 — deploy incompleto detectado e CORRIGIDO (2026-08-30 ~19:11 UTC)

Um ACEITE de teste (Sigma/ChannelTV, 18:58 UTC) resultou em
`renovacao:falha_criar_cobranca_apos_aceite` — **sem cobrança fantasma,
sem pagamento pendente** (`cobrancas_pix` sem linha nova; `tokens_renovacao`
terminal `renovacao_falhou`; conversa em `aguardando_humano`).

**Causa:** a EF do ACEITE por botão, **`renovacao-confirmar`**, importa
`openpix_client.ts` **transitivamente** (via `_shared/renovacao_confirmacao.ts`)
e **não estava na lista de deploy do Bloco 3** (a reconciliação só listou
os importadores diretos em `index.ts`). Ficou rodando código pré-Bloco-1
com `SANDBOX_BASE_URL` hardcoded → chamou `api.woovi-sandbox.com` com o
`OPENPIX_APPID` **de produção** → Sandbox rejeitou a credencial →
`outcome:"unavailable"`. A produção (`api.woovi.com`) **nunca foi
contatada**.

**Correção:** `supabase functions deploy renovacao-confirmar
--no-verify-jwt`. Verificado:
- `renovacao-confirmar` **v17 → v18**, `ACTIVE`, `verify_jwt=false`,
  `ezbr_sha256` `a375bdb28dd6…` → `1e8e54a1335a…`.
- Bundle contém `_shared/openpix_client.ts` (linha no output do deploy);
  working tree == `1a66a8f` (`git diff --quiet 1a66a8f` OK), `OPENPIX_BASE_URL`
  nas linhas 29/60/134.
- Snapshot de `functions list` antes/depois: **30 funções, 29 idênticas,
  só `renovacao-confirmar` mudou.**
- Suíte `.mjs` **37/37**.
- **Nenhum secret/migration/config alterado** (git limpo nos 3 repos; os
  `SUPABASE_*` com `updated_at` recente são rotação automática da
  plataforma no deploy, não ação nossa; os `OPENPIX_*` seguem de 18:49–50Z).
- **Nenhum novo ACEITE / cobrança / renovação.**

**Auditoria completa dos importadores de `openpix_client.ts` (direto +
transitivo):** `openpix-webhook`, `confirmacao-renovacao`,
`renovacao-sigma-watchdog` (diretos, deployados no Bloco 3) +
`renovacao-confirmar` (transitivo via `_shared/renovacao_confirmacao.ts`,
deployado agora). `_shared/reconciliacao_renovacao.ts` → só o watchdog.
**Nenhuma outra EF ficou stale.**

### Bloco 3.2 — chave pública do webhook estava ERRADA no Bloco 3; CORRIGIDA (2026-08-30 19:59–20:01 UTC)

O `_openpix_prod.env` aplicado por mim no Bloco 3 continha um valor
**errado** de `OPENPIX_WEBHOOK_PUBLIC_KEY` (digest `6b6961ad2bfc…`) —
provável mangle de PEM na montagem do arquivo. Consequência: `openpix-webhook`
rejeitava **todo webhook real** da Woovi com **401** (`crypto.subtle.verify`
= `false` contra a chave errada).

**Fato confirmado pelo usuário:** a chave pública de assinatura de
webhook exibida pela Woovi é **a mesma em Sandbox e Produção**. A chave
correta é a que já estava configurada **antes** do Bloco 3 (digest
`5213d70de0d74ef7fa68637b450f9d919d9897911f78266e66b36960f4bf2bd2`,
`updated 2026-08-24`), validada no POC de 24/08 contra 2 webhooks reais.

- **Correção (usuário, manual, 19:59:11 UTC):** repôs
  `OPENPIX_WEBHOOK_PUBLIC_KEY` com o PEM completo da Woovi (digest volta a
  `5213d70…`).
- **Redeploy `openpix-webhook` v20 → v21** (`--no-verify-jwt`, `ACTIVE`,
  `verify_jwt=false`, `ezbr_sha256` inalterado `7133a9ac2695…` — só o
  contador de versão; nenhuma outra função mudou; smoke 401/401/405).
- **Investigação read-only do código de validação
  (`_shared/openpix_webhook_signature.ts` + `openpix-webhook/index.ts`):
  CÓDIGO CORRETO, sem bug.** Header `x-webhook-signature`; algoritmo
  `RSASSA-PKCS1-v1_5` + SHA-256; assinatura em base64 (`atob`); PEM SPKI
  (`importKey("spki", …)`, remove marcadores + todo whitespace); **corpo
  BRUTO** (`await req.text()` antes de qualquer `JSON.parse`, sem
  reserialização, sem `.trim()`); round-trip UTF-8 lossless. Os 401 do
  Teste 1 foram **100% causados pelo valor errado do secret** — não há
  bug nem pendência de código/entrega. **Incidente histórico, corrigido
  e validado pelo Teste 2** (webhook real da Woovi Produção aceito e
  processado pelo caminho normal).

### Bloco 4 — CONCLUÍDO (2 testes reais em PRODUÇÃO, dinheiro real)

**Fluxo financeiro de produção validado ponta a ponta:** proposta →
ACEITO → cobrança (`api.woovi.com`) → PIX pago → webhook → processamento
→ renovação Sigma → sync Rocket → mensagem final. O caminho normal (sem
watchdog) foi comprovado no Teste 2.

**Teste 1 — `cd24be6d-92d9-4a5f-895c-c6b999b3b0ce`** (ChannelTV/Sigma,
R$ 35,00), ACEITE ~19:23 UTC:
- Cobrança de produção criada OK (`POST api.woovi.com/api/v1/charge` →
  sucesso ⇒ AppID de produção tem escopo de criar cobrança).
- **Webhook `OPENPIX:CHARGE_COMPLETED` NÃO foi processado** — chegou ao
  endpoint mas recebeu **401** (chave errada do Bloco 3, ver Bloco 3.2).
- **Recuperado pela Camada 3 do `renovacao-sigma-watchdog`** no tick
  `*/5` das 19:30:02 UTC: reconsulta `GET /charge/{correlationID}` →
  `COMPLETED` + valor exato → `marcarCobrancaComoPaga` → claim → dispatch.
  Nota de sistema gravada: *"Watchdog: pagamento confirmado na Woovi antes
  da janela de 2h (webhook nao chegou) -- renovacao recuperada e
  disparada."* Renovação concluída 19:31:02; vencimento `2026-09-30` →
  `2026-10-30`; mensagem final gravada. **Recuperação em ~6 min.**
- Reenvio manual da entrega falha pelo dashboard Woovi (método A):
  processamento **no-op / idempotente** confirmado por leitura —
  `cobrancas_pix`, `tokens_renovacao`, `conversas_estado`,
  `mensagens_conversa`, GH Actions: **nada mudou**.
- **O 401 original deste teste é incidente histórico** (chave errada do
  Bloco 3), não uma pendência aberta — o Teste 2, com a chave corrigida,
  recebeu e processou o webhook real da Woovi normalmente.

**Teste 2 — `29065bfb-c583-409c-9379-28387ba46a73`** (ChannelTV/Sigma,
R$ 5,00 — `valor` do cadastro Rocket), ACEITE 20:37:03 UTC, **APÓS a
correção da chave**:
- **Conclusão objetiva: A) caminho normal pelo webhook, SEM watchdog.**
- Timeline: cobrança criada **20:37:04.671** → `marcarCobrancaComoPaga`
  **20:38:07.254** (~62,6 s após a criação) → claim/`renovacao_iniciada_em`
  **20:38:07.340** → mensagem "🔄 Renovação em andamento" **20:38:08.021**
  (**só existe no caminho webhook**) → workflow GH Actions `33334196282`
  **20:38:09Z** → conclusão **20:39:14Z** → `renovacao_concluida`
  **20:39:08.359** → "Resultado da renovação Sigma: sucesso" **20:39:09.456**
  → mensagem final **20:39:10.690**. Vencimento `2026-10-30` →
  **`2026-11-30`**. Total ~2 min 6 s.
- **Watchdog NÃO participou:** `cron.job_run_details` do
  `renovacao-sigma-watchdog` — tick **20:35:00** (cobrança ainda não
  existia) e tick **20:40:00** (tudo já terminal); **nenhum tick entre
  20:37:04 e 20:38:07**. Camada 3 exige a cobrança com ≥ 5 min; foi paga
  em ~62 s. **Ausência** da nota de sistema "Watchdog: …".
- **Sem duplicidade:** após 20:30 UTC — 1 cobrança · 1 token · 0 lotes ·
  1 GH Actions run · 1 workflow · 1 renovação.

### Papel efetivo do `renovacao-sigma-watchdog` (comprovado em produção com dinheiro real)

- **Caminho feliz (webhook OK):** o watchdog **não participa** — o
  `openpix-webhook` marca `pago`, faz o claim atômico e dispara o
  workflow no `EdgeRuntime.waitUntil`, tudo em ~1 min do pagamento
  (Teste 2).
- **Webhook ausente/rejeitado/atrasado:** o watchdog é a **rede de
  segurança** — Camada 3 reconcilia `autorizada` + cobrança vinculada,
  dentro da janela de 2h e ≥ 5 min, **só** se `GET /charge` = `COMPLETED`
  + valor exato; recupera `pago` + dispara o workflow (Teste 1,
  recuperação em ~6 min). Nunca perde um pagamento `COMPLETED` na Woovi.

### Pendências reais restantes (renovação automática)

1. **Número oficial `17996242415`** — migração do **canal WhatsApp**
   para a Cloud API **CONCLUÍDA em 2026-08-31** (ver seção "SESSÃO
   2026-08-31 — MIGRAÇÃO DO CANAL WHATSAPP"). O que **permanece gate
   próprio**: migração das ~15 automações do **RocketZap** e do número
   oficial dentro do **Rocket** (não iniciada).
2. **Registro/notificação do pagamento UniTV no Rocket** — decisão
   anterior, tratamento posterior.
3. **Melhorias de UX/latência** a decidir depois (ex.: latência da
   mensagem final, transversal ao pipeline de resultado).

**Fora da lista de pendências (fechados):**
- Entrega/assinatura do webhook da Woovi Produção — **OK**. O único 401
  (Teste 1) foi incidente histórico causado pela chave pública errada do
  Bloco 3, corrigido às 19:59 e **validado pelo Teste 2** (webhook real
  aceito e processado pelo caminho normal). Não há pendência de
  código/config/entrega.
- ChannelTV config Rocket — resolvido (renovou 2× hoje).
- Mensagem final não gravada em `mensagens_conversa` (§5.5) — não se
  reproduziu; **foi gravada** nos dois testes.

---

## SESSÃO 2026-08-30 (tarde) — Autocura F4 (código+testes) + F5 (mecanismo preparado) + reconciliação da Renovação

> **PARADO PARA REVISÃO antes do 1º login real supervisionado (F4.M).**
> Nada de login/CAPTCHA/POST real foi executado. `healer_ativo=false`,
> `modo_observacao=true`, allowlist `NULL`. Sem cron do healer. F5 não
> ativada. Nenhum pagamento/renovação nesta rodada.

### Autocura — F4 (healer real): CÓDIGO + TESTES CONCLUÍDOS, nada deployado

Construída **em paralelo** à janela de observação da F3-A (F3-A segue
rodando/coletando). Doc oficial atualizado:
`docs/renovacao_automatica/AUTOCURA_UNITV_DEALER_TOKEN.md` (§3.1, §F4.M, §F5).

**Ajuste obrigatório incorporado (§3.1):** **1 ÚNICO `POST` de login por
ciclo**, sem retry de transporte. `postLogin()` é chamado 1× no núcleo,
fora de qualquer loop; qualquer não-sucesso → `login_recusado` (terminal);
transporte/timeout → `login_transporte` (terminal). Trava dura
`postLoginChamado`.

Arquivos novos/alterados (todos `?? ` / `M` — **não commitados quando
este bloco foi escrito**):
- `scripts/lib/autocura-unitv-healer.mjs` — núcleo testável (orquestração
  CAPTCHA→gate alta→1 POST→extrai→shape `^[0-9a-f]{32}$`→`/api/account`
  read-only→grava SÓ o Vault (`origem='autocura'`,`por='healer'`)→relê→
  revalida→callback). Toda `failure_class`.
- `scripts/lib/autocura-unitv-conta-readonly.mjs` — resolvedor read-only
  de `/api/account` **próprio da autocura** (I3/§C.9 — nunca importa
  `unitv-renovar.mjs`; nunca `/renew`).
- `scripts/autocura-unitv-token.mjs` — runner Playwright (liga deps
  reais). Seletores/endpoint de login marcados "CONFIRMAR NO 1º RUN".
- `.github/workflows/autocura-unitv-token.yml` — workflow do healer.
  `workflow_dispatch(ciclo_id)`, `concurrency: autocura-unitv`, `timeout 8min`.
  **Sem cron.** Env: `UNITV_DEALER_LOGIN/SENHA` (só aqui),
  `AUTOCURA_UNITV_HEALER_CALLBACK_TOKEN`, `UNITV_DIAG_ANCHOR_SN`, etc.
- `supabase/functions/_shared/autocura_resultado.ts` (M) — canal `healer`:
  `registrar_fim` + 3ª validação independente (lê Vault + `/api/account`
  read-only) + alerta com dedupe 6h. Caminho de OCR **inalterado**.
  Exporta `outcomePermitidoNoCanal(canal, outcome)`.
- `supabase/functions/autocura-unitv-resultado/index.ts` (M) — aceita
  **os 2 tokens** (`AUTOCURA_UNITV_OCR_CALLBACK_TOKEN` ×
  `AUTOCURA_UNITV_HEALER_CALLBACK_TOKEN`), decide o canal e cruza
  canal×outcome (token de OCR nunca fecha ciclo `disparo`).
- `scripts/testes/autocura_ocr_nao_age/teste.mjs` (M) — os 2 arquivos
  compartilhados saíram desta suíte (viraram OCR+healer); cobertos por
  `autocura_healer_nao_age`.

**Testes (verdes):** `autocura_healer_fluxo` (prova: nunca 2º POST em
NENHUM cenário; token inválido/shape inválido/validação falha → NUNCA
grava Vault; sucesso → grava + revalida; revalidação falha → crítico) ·
`autocura_healer_resultado` (registrar_fim + 3ª validação + alertas +
dedupe + nunca insere métricas de OCR) · `autocura_healer_nao_age`
(varredura estática: sem `/renew`, `/pagamento/add/`, `unitv-renovar`,
cobrança, escrita de secret; `postLogin` 1× fora de loop; grava só o
Vault). **Suíte completa `.mjs`: 37/37.** SQL `autocura_expirar_orfaos`
intacta.

**Falta para o teste manual (F4.M):** secrets de login (ação do usuário:
`UNITV_DEALER_LOGIN`, `UNITV_DEALER_SENHA` só GitHub Actions;
`AUTOCURA_UNITV_HEALER_CALLBACK_TOKEN` GitHub+Edge; `UNITV_DIAG_ANCHOR_SN`
no GitHub = mesmo valor do Edge) + deploy da `autocura-unitv-resultado`
estendida + commit/push do workflow. **Procedimento exato: doc §F4.M**
(guards → `INSERT` direto do ciclo `disparo` [exceção documentada, único
ponto do projeto que cria ciclo `disparo` sem a RPC] → `gh workflow run`
→ o que observar → confirmar → abortar → restaurar). **Não executar sem
autorização.**

### Autocura — F4.M: 1ª execução real supervisionada FEITA (2026-08-30 ~14:57 UTC)

Secrets configurados (`AUTOCURA_UNITV_HEALER_CALLBACK_TOKEN` Edge+GitHub,
`UNITV_DEALER_LOGIN`/`_SENHA`/`UNITV_DIAG_ANCHOR_SN` GitHub), EF
`autocura-unitv-resultado` deployada (**v3**), guards prévios OK
(`renovacao_unitv_em_voo=0`, `ciclo_em_andamento=0`, config inerte).

Ciclo `617451e3-3c4b-480c-a0a5-b6ea76e899ab` · run `33318256671` · 41 s.
**Resultado: `falhou` / `captcha_sem_confianca`.** 12/12 CAPTCHAs
`bucket=n_a` — OCR (templates sintéticos, F3-A sem calibração ainda)
**não leu nenhum CAPTCHA real**. Núcleo abortou **antes do 1º POST**.

Disciplina confirmada em produção: `login_posts=0`; `vault_gravado=false`;
`unitv_dealer_token_estado` inalterado (`bootstrap/jose`); Edge secret
`UNITV_DEALER_TOKEN` digest inalterado; ciclo terminal único, **sem 2ª
tentativa**; config da autocura intocada. **Caminho feliz NÃO exercitado**
(gate de OCR nunca abriu — esperado antes da F3-A calibrar).
`prontidao_f5()` não conta o ciclo como `teste_manual_f4_ok`.

**Episódio `returnCode=300` na janela do teste — CAUSA INDETERMINADA
(correção do usuário):** F2 registrou `14:30 token_vivo → 14:45/15:00
token_morto rc=300`. **O usuário fez LOGOUT da conta UniTV e fechou a aba
durante essa janela.** Portanto:
- `rc=300` fica como **evidência de token inválido/rejeitado** (código do
  `/api/account` quando o `dealer_token` não autentica) — **mantido**.
- **NENHUMA conclusão de TTL** deste episódio (nem ~4–5 h nem outra).
- **Causa: INDETERMINADA** — possível logout manual, não expiração.
- **`300` NÃO entra na allowlist** com base neste evento. Pré-requisito
  (b) da F5 segue **não atendido**.
- Precisa de **outro `token_morto` sem logout e sem novo login** (morte
  orgânica passiva) para avaliar se `300` é o código de sessão
  expirada/inválida.

**Operacional:** token do painel inválido (rc=300) → renovação UniTV
degradada → precisa **recaptura manual** (SOP §15), independente do F4.
**Não repetir login. Não alterar código.**

### Autocura — F5 (ativação): MECANISMO PREPARADO, não aplicado

`supabase/migrations/20260830220000_autocura_unitv_ativacao.sql`
(**NÃO aplicada**) — 4 RPCs `SECURITY DEFINER` só `service_role`:
- `autocura_unitv_ativar_healer('{C}')` — flip **conjunto e atômico**
  (`return_codes_que_disparam`, `modo_observacao=false`, `healer_ativo=true`,
  `kill_switch=false`, `pausado_ate=null`) num único `UPDATE`. Os 2 CHECKs
  de F1 tornam **ativação parcial estruturalmente impossível**. Allowlist
  vazia → `raise` antes de tocar a config.
- `autocura_unitv_desativar_healer('<motivo>')` — kill-switch.
- `autocura_unitv_reverter_para_observacao()` — rollback completo a F3-A.
- `autocura_unitv_prontidao_f5()` — checklist read-only (estado limpo ·
  sem `disparo` automático prévio · janela F3-A 14d/10 execuções · teste
  F4 OK · sem falha de disparo 24h).

**A ativação real** (só após critérios + revisão) = `select
autocura_unitv_ativar_healer('{C}')` **+** criar a EF
`autocura-unitv-healer-orquestrador` + cron `autocura-unitv-healer-check`
(desenhados na doc §F5.5 — **não criados agora** para não deixar código
dormente). **`healer_ativo` NÃO foi virado.**

### Renovação Automática — reconciliação (read-only, sem pagamento/renovação)

**Frente SEPARADA da autocura.** Estado deployado × `main` (`git log` +
`supabase functions list`, 2026-08-30):

| Função | prod agora | NEXT_SESSION dizia | leitura |
|---|---|---|---|
| `orchestrator` | v61 | v57 | +4 deploys — commits `5b6e991`/`aa9895d`/`3b0e01d` já em prod |
| `openpix-webhook` | v15 | v12 (❌ sem `7f6cdc0`) | +3 deploys — `7f6cdc0` (msg intermediária) **provavelmente** já em prod; **confirmar por redeploy idempotente de `main` no go-live** |
| `renovacao-sigma-contexto` | v12 | v9 (=`3b0e01d`) | Iteração 1 (auth Sigma) em prod |
| `renovacao-sigma-resultado` | v15 | v12 | idem |
| `renovacao-sigma-watchdog` | v15 | v10 | Camadas 1/3 em prod, cron `*/5` |
| `renovacao-unitv-conta` | v7 | v5 | UX UniTV (`aa9895d`) em prod |

**`main` HEAD = `ea5f64f`** (F3-A autocura). Working tree tem só os
arquivos da autocura (acima) + 3 dirs órfãos **não meus, não commitados**
(`scripts/.interactive-test-harness/`, `scripts/supabase/.temp/`,
`supabase/functions/poc-sigma-renovacao-real/`) — deixados como estão.

**Causa do "último erro" (lote misto Sigma+UniTV, 2026-08-29, §4.3/§4.5):**
`ChannelTV` → `resultado_ambiguo` (`pacote_vazio`). **Não é bug de
código** — o Rocket conecta no painel Sigma novo (`channeltvbr.store`)
mas **não autentica** (`{"message":"Unauthenticated."}`) com as
credenciais do servidor "ChannelTV" cadastradas no Rocket. É **config do
Rocket (ação do José)**. A **Iteração 1** (`3b0e01d`, em prod) já trata:
`Unauthenticated` → `unavailable` (nunca `pacote_vazio` falso) → retry só
de leitura → transferência humana; clique de renovação ≤1×. O guard
`pacote_vazio → resultado_ambiguo` está **correto**.

**PIX `d5241cc0`** (§0, já concluído em sessão anterior): pago no Woovi
Sandbox, mas chegou `OPENPIX:TRANSACTION_RECEIVED`, não `CHARGE_COMPLETED`.
Terminal (`renovacao_falhou`, limpeza manual). Camada 1 (`e3bee32`, em
prod) agora **loga** eventos ignorados; Camada 3 (watchdog `*/5`)
reconcilia webhook atrasado dentro da janela de 2h. Caso perdido = classe
(ii), aceito.

**Correção necessária nesta rodada: NENHUMA.** As correções (Iteração 1,
Camada 1/3, UX UniTV) já estão commitadas e aparentemente deployadas.

**Novo teste controlado — preparado, SEM pagamento (a rodar quando
autorizado):**
1. `for f in orchestrator openpix-webhook renovacao-sigma-{contexto,resultado,watchdog,cliente} renovacao-unitv-conta renovacao-confirmar confirmacao-renovacao renovacao-rocket-vencimento; do npx supabase functions deploy $f --no-verify-jwt; done` — redeploy **idempotente** de `main` HEAD; a CLI reporta se o bundle mudou → reconcilia deployado × git de vez, confirma `7f6cdc0`.
2. `for d in scripts/testes/*/; do npx tsx "${d}teste.mjs"; done` — 23+ suítes de renovação verdes.
3. Confirmar cron `renovacao-sigma-watchdog` `*/5` ativo (`select * from cron.job`).
4. José: reautenticar o servidor "ChannelTV" no Rocket (domínio `channeltvbr.store`) — reteste do ChannelTV só depois disso.
5. **Go-live real (gate próprio, NÃO nesta rodada):** OpenPix Sandbox→produção (`_shared/openpix_client.ts` tem `SANDBOX_BASE_URL` **hardcoded** → env-driven; conta Woovi produção; `OPENPIX_APPID`/`OPENPIX_WEBHOOK_PUBLIC_KEY` de produção; registrar webhook no dashboard prod) **+** questão do número (teste `17996286135` × oficial `17996242415` — migração do oficial é gate separado, não autorizada). 1 PIX real (José paga) só após isso.

---

## SESSÃO 2026-08-29 (continuação) — gerenciamento de estado + ciclo de vida financeiro + UX UniTV

**O §0 abaixo (investigar o PIX `d5241cc0`) foi CONCLUÍDO nesta sessão.**
Achado: o PIX `d5241cc0` **foi pago no Woovi Sandbox**, mas o webhook
entregue ao `openpix-webhook` era um evento de **transação** (coluna
"Cobrança" vazia), não `OPENPIX:CHARGE_COMPLETED` — e o `openpix-webhook`
ignora silenciosamente (sem log) todo evento ≠ `CHARGE_COMPLETED`. Isso
motivou o trabalho abaixo.

### Peças 1/2/3 — EM PRODUÇÃO (commit `5b6e991`, pushed)
- **Peça 1** (`orchestrator`): mensagem atual com gatilho explícito de
  renovar → `acesso_selecionado`/`intencao_atual` guardados NÃO
  participam da decisão desta requisição.
- **Peça 2** (`orchestrator` + `renovacoes_lote.ts`): `acesso_selecionado`
  só é honrado se a última operação daquele `public_id` não estiver
  terminal (`ultimaOperacaoRenovacaoEhTerminal`). Único write de sessão:
  apresentar a lista zera `acesso_selecionado`.
- **Peça 3** (`renovacao-sigma-watchdog` + `reconciliacao_renovacao.ts` +
  migration `20260829140000_expirar_lote_autorizado.sql`): ciclo de vida
  garantido dos estados não-terminais, janela = `expira_em` (2h). Casos
  A/B/C/D/E, todas as transições CAS. Nunca perde um pagamento COMPLETED
  na Woovi (Caso D concilia o webhook atrasado / a corrida de ms).
- **Deploy:** `orchestrator` **v57** (12:14:58 UTC), `renovacao-sigma-watchdog`
  **v10** (12:15:05 UTC), ambos jwt=OFF. Migration
  `20260829140000_expirar_lote_autorizado.sql` **aplicada** manualmente
  no SQL Editor (verificada: `SECURITY DEFINER`, `search_path=public`,
  execute só p/ `service_role`; corpo com os 2 `and estado = 'autorizada'`;
  NUNCA toca `renovacao_em_andamento` nem `cobrancas_pix`).
- Testes: **24 suítes verdes** (23 pré-existentes + `orchestrator_multiplos_acessos`
  com testes Z1–Z8 + nova suíte `watchdog_lifecycle`, incl. concorrência
  3× e webhook-atrasado).

### Falha real pós-deploy: `0` (1 Sigma + 1 UniTV) caiu no fallback UniTV
- **Não é regressão de código nem contaminação de estado.** Peça 1/2
  funcionou (a lista voltou a aparecer). O `0` entrou corretamente no
  fluxo de lote misto do Bloco 4 e `chamarResolverContaUnitv("gcnv6v")`
  retornou **`indisponivel`** (`motivo` gravado:
  `renovacao:lote_unitv_conta_indisponivel`).
- **Causa do `indisponivel` (evidência de log, 12:22:32 UTC):**
  - `orchestrator → renovacao-unitv-conta`: **SUCESSO** — EF invocada,
    `POST`, `200`. **Não** foi timeout do Orquestrador nem falha nesse hop.
  - `renovacao-unitv-conta → panel-web.revenda.site/api/account`:
    **rejeição RÁPIDA** — a EF inteira rodou em **~291 ms** (muito abaixo
    do timeout de 15 s). Não foi timeout, não foi painel lento.
  - **O erro exato do painel NÃO está disponível nos logs atuais** —
    `unitv_conta.ts` não loga o caminho de falha; a EF só devolveu
    `{outcome:"indisponivel"}`. Compatível com `returnCode != 0`
    (erro transitório do painel) ou HTTP de erro com corpo não-JSON.
  - `gcnv6v` foi resolvido com sucesso às ~02:12 UTC do mesmo dia (mesmo
    caminho, 2×UniTV lote). Transitória, não estrutural. Sem diferença de
    timeout/concorrência/contexto entre resolução individual e a dos
    filhos do lote.
- **Retry de `/api/account` NÃO adicionado** — decisão adiada,
  deliberadamente separada.

### Correção de UX (commit próprio — ver "Estado do git" abaixo)
Distinção de mensagem ao cliente na falha de resolução da conta UniTV,
**mantendo os motivos internos de transferência exatamente como estão**:
- `indisponivel` → **instabilidade temporária** (encaminha + convida a
  tentar de novo).
- `nao_encontrado` / `ambiguo` / `sem_usuario` → **não identificação
  segura** (só encaminha).
- `MENSAGEM_RENOVACAO_UNITV_NAO_INTEGRADA` / `MENSAGEM_RENOVACAO_LOTE_COM_UNITV`
  mantidas no código, **reservadas a um eventual desligamento funcional**
  da integração UniTV — não mais usadas no fluxo de falha de resolução.
- **Não tocados:** `chamarResolverContaUnitv`, `resolverContaUnitv`,
  `renovacao-unitv-conta`, `unitv-renovar.mjs`, timeouts, criptografia,
  lógica de roteamento. **Sem deploy ainda.**

### Frente `openpix-webhook` / reconciliação de pagamento perdido

**Estado real do `d5241cc0` (verificação read-only, Camada 0):** o caso
foi **resolvido MANUALMENTE por José ~10:25 UTC, ANTES do deploy da
Peça 3 (12:15 UTC)** — `cobrancas_pix` → `cancelada` (UPDATE manual),
`renovacoes_lote` → `falhou` + tokens → `renovacao_falhou` (via
`marcar_lote_como_falha` manual, `motivo_falha` = "webhook OpenPix
CHARGE_COMPLETED nunca chegou … limpeza manual pos-investigacao"). A
Peça 3 **nunca tocou o `d5241cc0`** — já era terminal quando entrou no
ar. **NÃO é evidência de que o watchdog tenha recuperado ou expirado
essa operação.** A transação `bc036e5d…` (R$ 70, Confirmado no Woovi
Sandbox) permanece "perdida" do ponto de vista do sistema (classe (ii):
pagamento virou transação não associada, `GET /charge` nunca fica
`COMPLETED`).

**Evidência independente de que a Peça 3 funciona em produção:** às
**12:40:02 UTC**, mesma conversa (`43fcff07`), o watchdog rodou o
**Caso A** e expirou corretamente um token `aguardando_confirmacao`
órfão após a janela de 2h (`expira_em`) — `sistema`: *"Watchdog:
solicitação de renovação sem confirmação após a janela de 2h --
expirada, acesso liberado."*

**Camada 1 — observabilidade do `openpix-webhook`: IMPLEMENTADA (commit
próprio, sem deploy).** Zero mudança de comportamento — só
`console.log` + tipagem opcional + helper puro `idsNaoSensiveis`:
- `event ≠ OPENPIX:CHARGE_COMPLETED` → agora **loga** `[openpix-webhook]
  evento ignorado …` com `event` + ids não sensíveis
  (`correlationID`/`endToEndId`/`transactionID`/`chargeGlobalID`/
  `chargeStatus`), **nunca** nome/CPF/chave Pix do pagador. Antes era
  `return 200` sem nenhum rastro (foi por isso que o diagnóstico do
  `d5241cc0` precisou do dashboard da Woovi).
- `!correlationId`, "recebido -- reconsultando" e "cobrança já
  processada (reenvio)" também passam a deixar rastro. Os 3
  early-returns de `processarCobrancaCompleted` já logavam.
- 5 testes novos (`renovacao_em_andamento`: OBS-1..5), incl. um que
  trava a **não-exposição de PII** e um de **regressão do caminho
  feliz**. 24 suítes verdes.

### Camada 3 — reconciliação antecipada: EM PRODUÇÃO (commit `a87a1df`, pushed) — CHECKPOINT 2026-08-29

Sweep novo, dedicado e **recover-only**, dentro do `renovacao-sigma-watchdog`
(mesmo cron `*/5`, sem Edge Function nova, sem migration). Alvo:
`tokens_renovacao`/`renovacoes_lote` `estado='autorizada'` + `operacao_id`
vinculado, **ainda dentro** da janela de 2h (`expira_em >= now()`),
`criado_em < now() - 5min`. Chama `reconciliarSePago` (novo em
`_shared/reconciliacao_renovacao.ts`): **`COMPLETED` + valor exato →
recupera** pelo mesmo núcleo (`executarRecuperacao`:
`marcarCobrancaComoPaga` CAS → `reivindicarInicio[Lote]` CAS → dispatch)
que o `openpix-webhook` usa; **qualquer outro resultado**
(`ACTIVE`/`EXPIRED`/Woovi indisponível/sem registro/valor divergente) →
**zero escrita**. Nunca expira, cancela ou marca divergência — isso
segue 100% com os Casos B/C/E do sweep de `expira_em` (Peça 3, intocada).

- **Deploy:** `renovacao-sigma-watchdog` **v10 → v11**, `ACTIVE`,
  `verify_jwt = false` (OFF, deploy `--no-verify-jwt`), 2026-08-29
  ~13:39 UTC. Bundle **inclui** `_shared/reconciliacao_renovacao.ts` +
  `tokens_renovacao.ts` + `renovacoes_lote.ts` (manifesto de upload da
  CLI); boot confirmado (smoke `POST` sem token → `401`, antes de
  qualquer lógica). Nenhuma outra função deployada. `ezbr_sha256`
  `a1b21801…` → `d90d0c48…`.
- **Testes: 24/24 suítes verdes** — 9 testes novos da Camada 3 em
  `watchdog_lifecycle` (recupera ind/lote, ainda não pago, cedo demais,
  já expirado fora da query, valor divergente sem efeito, concorrência
  3×, corrida com webhook, Woovi indisponível) + regressão A/B/C/D/E.
- **Verificação read-only pós-deploy (2026-08-29 ~13:46 UTC):**
  - cron `*/5` **ativo** — `cron.job` `jobid 2`,
    `jobname='renovacao-sigma-watchdog'`, `schedule='*/5 * * * *'`,
    `active=true`.
  - watchdog **executando após o deploy** — `cron.job_run_details`:
    runs `succeeded` às 13:40:00 e 13:45:00 UTC (deploy ~13:39 UTC),
    cadência de 5 min consistente antes e depois.
  - **sweep é no-op** — sem item elegível: `H_elegiveis_camada3 = 0`;
    `tokens_renovacao` sem nenhum `autorizada` (todos terminais:
    `renovacao_concluida 8`, `renovacao_falhou 6`, `cancelada 4`,
    `renovacao_indeterminada 3`, `expirada 2`); `renovacoes_lote` idem
    (`concluida 2`, `parcial 2`, `falhou 1`); `cobrancas_pix` sem
    nenhum `pendente` (`pago 11`, `cancelada 2`).
  - **nenhuma alteração financeira decorrente do deploy** — única
    mudança em `cobrancas_pix` nas últimas 6h é `d5241cc0` →
    `cancelada` às **10:25 UTC** (limpeza manual do usuário, **antes**
    do deploy). Zero writes em `cobrancas_pix`/`tokens_renovacao`/
    `renovacoes_lote` após 13:39 UTC.
- **Nenhum teste real após o deploy. Nenhuma cobrança criada. Nenhuma
  ação financeira.**

### Iteração 1 — instabilidade de auth do painel Sigma: EM PRODUÇÃO — CHECKPOINT 2026-08-29

Trata a intermitência de autenticação do painel Sigma (`Unauthenticated`
não-determinístico por requisição, caracterizado ao vivo no ChannelTV).
Suíte completa **24/24 verde**.

**DEPLOY FEITO (2026-08-29, commit `3b0e01d`):**
- `renovacao-sigma-contexto` **v7 → v8** — `ACTIVE`, `verify_jwt=false`
  (`--no-verify-jwt`). Bundle inclui `_shared/rocket_sigma_contexto.ts`
  reclassificado. `ezbr_sha256` `3cc9e8f0…` → `cbff4c8d…`.
- `renovacao-sigma-resultado` **v10 → v11** — `ACTIVE`, `verify_jwt=false`
  (`--no-verify-jwt`). Bundle inclui `_shared/mensagens_fixas.ts` com
  `MENSAGEM_RENOVACAO_INSTABILIDADE`. `ezbr_sha256` `4fd197a1…` →
  `1f343087…`.
- Smoke pós-deploy: `POST` sem `X-Internal-Token` nas duas → **HTTP 401**
  (boot OK, autenticação interna intacta).
- **Nenhuma outra função redeployada** — `orchestrator` v57,
  `renovacao-sigma-watchdog` v11 (Camada 3), `openpix-webhook` v11,
  `renovacao-confirmar` v10, `confirmacao-renovacao` v9 — inalteradas.
- `scripts/renovacao-sigma-workflow.mjs` **já está em `main`** (commit
  `3b0e01d`) — é script do GitHub Actions (`node
  scripts/renovacao-sigma-workflow.mjs` em `renovacao-sigma.yml`), roda
  do checkout de `main`; **será usado automaticamente na próxima
  execução do workflow**, sem deploy Supabase.
- Sem migration, sem alteração de secret, sem teste real/cobrança.
- **Não fazer teste de cobrança/renovação sem nova autorização.**

**REGRA DE SEGURANÇA DEFINITIVA (aprovada pelo usuário, não reabrir):**
> O `POST /gerenciador/pagamento/add/` (`renovar_painel=true`) **NÃO é
> idempotente** — não tem chave de idempotência, consome 1 crédito de
> revenda e empurra +1 mês a **cada** chamada. Repetir = renovação
> dupla. Portanto: **o clique de renovação roda no máximo 1 vez por
> acesso, nunca repetido, em nenhum cenário de dúvida.** **Nenhum retry
> de operação que consome crédito.** Todo retry desta frente fica só na
> **leitura** (Camada A do `sigma/info` + 1 reconsulta extra pós-clique,
> também leitura). Um falso-`falha` residual de POST muito lento é
> coberto pelas redes já existentes (transferência humana + Peça 3 Caso
> D / watchdog reconciliando a cobrança paga) — **nunca** por um 2º
> clique.

- **`_shared/rocket_sigma_contexto.ts`** — `lerSigmaInfo` reclassifica:
  HTTP 401/403, `error:true` com mensagem de auth, ou resposta sem bloco
  `data` → `unavailable` (`motivo: auth_painel|http|resposta_invalida|
  excecao`). `pacote_vazio` **só** com resposta válida (`error != true`)
  + `data` presente + `package` vazio. `Unauthenticated` **nunca mais**
  vira `pacote_vazio`.
- **`renovacao-sigma-contexto/index.ts`** — Camada A: `lerSigmaInfoComRetry`
  (`SIGMA_CTX_RETRY = { tentativas: 4, backoffMs: [0,400,900,1600], jitter: 0.2 }`),
  retry **só** em `unavailable`; `success`/`pacote_vazio` são terminais.
  `unavailable` de auth → `etapa: "sigma_info_auth"` + `tentativas` no
  corpo.
- **`scripts/renovacao-sigma-workflow.mjs`** — `executarCliqueAddPagamento`
  extraída, roda **1×**. Removidos `SIGMA_CLIQUE_RETENTATIVAS`,
  `SIGMA_CLIQUE_BACKOFF_MS`, o laço de re-clique. Após o clique: espera
  orientada ao resultado (`waitForLoadState("load")` + `waitForSelector`
  de toast/alerta, teto `TETO_RESULTADO_MS = 20000`, ambos best-effort
  `.catch`) no lugar do `waitForTimeout(3000)` cego → reconsulta
  independente → `avaliarVeredito`. Se as duas fontes = "nada mudou" com
  painel autenticado → **1 reconsulta extra** (só leitura, respiro
  `SIGMA_RECONSULTA_EXTRA_MS = 4000`, **sem novo clique**) → se ainda
  nada, `resultado: "falha"`. `ctxAntes`/`ctxDepois` `unavailable` →
  `resultado_ambiguo` + `sigmaIndisponivel` (nunca `falha`). XOR →
  `resultado_ambiguo`.
- **`renovacao-sigma-resultado/index.ts`** + **`_shared/mensagens_fixas.ts`**
  — nova `MENSAGEM_RENOVACAO_INSTABILIDADE` (neutra — não nomeia
  UniTV/Sigma, nunca diz "não está disponível"). Individual Sigma
  `resultado_ambiguo` + `sigmaIndisponivel` → cliente recebe essa
  mensagem, transferência com `avisarCliente:false` (sem duplicar a
  frase genérica). Estado (`resultado_ambiguo → renovacao_indeterminada`),
  aviso ao José e Peça 3 **inalterados**.
- **Pré-check Sigma antes da cobrança:** ver decisão arquitetural
  fechada logo abaixo — **DESNECESSÁRIO**, não haverá.
- **Intocados:** UniTV (100%), Camada 3/watchdog, OpenPix, prompt/Gemini,
  Validador, estado conversacional.
- **Testes:** `rocket-sigma-contexto` (spec 1–10), `renovacao-sigma-workflow-leitura`
  (spec 11–16 + G reescrito — provam POST ≤ 1×, `goto` 1×),
  `renovacao_sigma_workflow_misto` (M2/M4), `renovacao_sigma_resultado_unitv`
  (spec-instab/spec-reg/spec18), `mensagens_renovacao_apresentacao`.
  Removidos os testes que pressupunham 2º clique.
- **Sem deploy, sem teste real, sem cobrança.**

### DECISÃO ARQUITETURAL FECHADA — PRÉ-CHECK SIGMA = DESNECESSÁRIO (2026-08-29, aprovada pelo usuário)

Análise read-only completa (o que a Iteração 1 já protege · falhas
possíveis pós-pagamento · o que um pré-check evitaria · custo de
resolver `public_id → idClienteInterno` antes da cobrança · risco de
falso positivo/negativo pela mesma intermitência · impacto em
individual e lote misto · geral para Sigma ou não existir). Conclusão:

- **Não haverá pré-check Sigma antes da cobrança.**
- **Não haverá tratamento especial de ChannelTV (nem de qualquer
  servidor) no Orquestrador.**
- **Prevenção** = qualidade da integração/configuração do servidor no
  Rocket (URL do painel, credenciais/token de revenda). **Recuperação**
  = Camada A (retry só de leitura) + Peça 3 (reconciliação financeira,
  dinheiro nunca perdido).
- **A Iteração 1 é a solução definitiva para a intermitência de
  autenticação**, exatamente com este escopo: `Unauthenticated` nunca
  vira `pacote_vazio`; retry somente de leitura; clique de renovação no
  máximo 1×; dúvida pós-clique → resultado seguro/atendimento, nunca
  2º clique; Peça 3 protege a reconciliação financeira.
- **Só reabrir** se **dados reais em produção** mostrarem falhas
  recorrentes de auth que o retry da Camada A comprovadamente não
  consiga absorver — nunca por especulação.

**Fora de escopo, explicitamente (correção do usuário, 2026-08-29):**
crédito/saldo negativo no Rocket é questão interna do usuário, **vale
para todos os servidores, não só ChannelTV**. Não é bloqueio do fluxo
de Renovação Automática, não entra em nenhuma lista de pendências desta
frente, e **não haverá** teste, pré-check, regra, log ou tratamento
relacionado a saldo negativo. Crédito negativo no Rocket **não impede**
o fluxo da Renovação Automática.

### Pendências desta frente
- Deploy da correção de UX UniTV (`orchestrator` + `mensagens_fixas.ts`,
  commit `aa9895d`) — **ainda não deployado** (`orchestrator` segue v57).
- Deploy da Camada 1 — observabilidade do `openpix-webhook` (commit
  `e3bee32`) — **ainda não deployado** (`openpix-webhook` segue v11).
- Camada 2 (ampliar eventos aceitos) — só depois de capturar um
  `TRANSACTION_RECEIVED` real e seu payload completo (a Camada 1 é o
  pré-requisito).
- Camada 4 (transação não associada) — separada; **sem** heurística de
  valor/janela sem evidência suficiente.
- Retry / distinção de erro do painel UniTV — adiado.

---

## 0. CHECKPOINT DE ENCERRAMENTO — 2026-08-29 (troca de máquina)

### 0.1 Estado APROVADO (fechado, não reabrir sem evidência nova)

- **Renovação Automática Sigma + UniTV integrada** — roteamento por
  tipo de acesso no `orchestrator`, executor no workflow, resultado
  consolidado.
- **UniTV individual** — validada em produção (Sandbox OpenPix).
- **Lote 2×UniTV** — validado em produção (Sandbox).
- **Lote misto Sigma + UniTV** — execução conjunta validada (2 tipos no
  mesmo `processarLote`, callback único com `resultados[]` misto,
  `parcial` derivado, UniTV independente da falha do Sigma).
- **Gerenciamento de estado conversacional** — corrigido (Peças 1/2/3,
  commit `5b6e991`).
- **Camada 3 — reconciliação antecipada** — EM PRODUÇÃO
  (`renovacao-sigma-watchdog`, commit `a87a1df`).
- **Iteração 1 (Sigma auth)** — COMMITADA (`3b0e01d`) **e DEPLOYADA**
  (`renovacao-sigma-contexto` + `renovacao-sigma-resultado`, registro
  em `64d5a02`).
- **Pré-check Sigma = DESNECESSÁRIO** — decisão arquitetural fechada
  (`18331b3`; ver §4.6.1 e o checkpoint da Iteração 1).
- **Regra definitiva:** `POST /gerenciador/pagamento/add/` roda **no
  máximo 1× por acesso**, nunca repetido em nenhum cenário de dúvida.
- **Retry somente em LEITURA** (Camada A do `sigma/info` + 1 reconsulta
  extra pós-clique). Nenhum retry de operação que consome crédito.
- **Suíte: 24/24 verdes** (rodada final desta sessão).

### 0.2 Estado ATUAL da UniTV — `UNITV_DEALER_TOKEN`

- O `UNITV_DEALER_TOKEN` **antigo foi invalidado pelo painel de
  revenda** (não por ação nossa; ver §4.6).
- Um **token novo foi capturado passivamente** (sessão logada, sem
  login automatizado) e **atualizado nos secrets Supabase + GitHub**
  (commit de registro `963e092`; valor nunca gravado em arquivo).
- `renovacao-unitv-conta {"sn":"gcnv6v"}` voltou a **`resolvido`,
  `id=3433363`** (verificação read-only pós-troca).
- **Nenhuma renovação real foi feita depois dessa troca.** O token
  atual está **válido e não deve ser alterado** enquanto a próxima
  etapa (autocura) estiver sendo estudada.

### 0.3 NOVA PENDÊNCIA ARQUITETURAL — autocura do `UNITV_DEALER_TOKEN`

- O `UNITV_DEALER_TOKEN` **é um token de sessão** (32 hex, usado como
  `Authorization` + header `token` + `dealer_token` no corpo — o mesmo
  valor), emitido no **login**. **Pode ser invalidado sem ação nossa**
  (TTL de sessão / eviction / troca de senha).
- **Não existe endpoint de refresh conhecido**; `getDealerInfo`
  consome, não emite; sem tela de API key.
- **Meta:** não depender de recaptura manual recorrente. Intervenção
  manual só como **fallback de emergência**. **Objetivo futuro:
  autocura automática.**
- **U1 CONCLUÍDO:** o CAPTCHA do login é **4 dígitos numéricos
  simples** (grandes, separados, sem ruído, sem linhas; formato
  client-side `[0-9]{4}`; ex. real `7052`). Reclassificado de
  "moderado" para **facilmente automatizável por template matching**
  (10 templates de dígito; refresh "Eu não vejo" é grátis/ilimitado e
  **não** conta como tentativa de login).
- **U3/U4 INCONCLUSIVOS** (deliberado — não fizemos probe de login):
  não sabemos como o servidor diferencia "CAPTCHA errado" de
  "senha/conta inválida", nem o limite de lockout/rate-limit.
- **Comparação A × B (ver §4.6.2):** **B (renovar token SEM login) não
  existe** pelo que se pôde determinar — único lead não verificado é se
  "Lembrar-me" estende muito o TTL. **A (OCR/template + login
  automático controlado) é viável** dado o CAPTCHA trivial, **desde
  que** cap ≤ 2 POSTs de login/ciclo + cooldown + fallback humano +
  secrets `UNITV_DEALER_LOGIN`/`SENHA`.

---

## PONTO EXATO DA RETOMADA (próxima sessão)

> **Fase 2A EM PRODUÇÃO com o Vault como fonte viva** (bootstrap +
> validação `gcnv6v` concluídos 2026-08-30 — ver "### BOOTSTRAP FASE 2A
> CONCLUÍDO" abaixo).
>
> **F0 CONCLUÍDA (2026-08-30):** documento oficial de arquitetura da
> autocura (Fases 3/4) aprovado (José + GPT) e commitado —
> `docs/renovacao_automatica/AUTOCURA_UNITV_DEALER_TOKEN.md` (commit
> `6c0360b`). Invariantes I1–I7 (allowlist obrigatória de `returnCode`;
> modo observação como 1ª etapa; guard financeiro; autocura escreve só o
> Vault; falha → encerra + alerta + fallback manual). Roadmap oficial
> **F0 doc → F1 controles → F2 monitor → F3 observação/OCR → F4 login
> supervisionado → F5 ativação — não pular etapas.**
>
> **F1 CONCLUÍDA E APLICADA EM PRODUÇÃO (2026-08-30)** — migration
> `20260830160000_autocura_unitv_controles.sql` (2 tabelas + 3 índices +
> 3 RPCs + 1 insert singleton, **só CREATE**). Estado inerte confirmado:
> `healer_ativo=false`, `modo_observacao=true`, `return_codes_que_disparam=NULL`,
> `kill_switch=false`, `pausado_ate=NULL`; `autocura_unitv_ciclos` vazia;
> RLS on / 0 policies nas 2 tabelas; RPCs só `service_role`; índice único
> parcial `autocura_unitv_ciclos_um_em_andamento_idx` presente.
> Fotografia read-only antes/depois: **11/11 objetos pré-existentes
> IDÊNTICOS**; Vault/`unitv_dealer_token`/secrets **inalterados**. 3
> suítes SQL F1 + teste de concorrência real do `registrar_inicio`
> (1 vence / 1 `bloqueado (ciclo_em_andamento)` / exatamente 1
> `em_andamento`) + auto-fecho de órfão — todos verdes; 26/26 suítes TS
> verdes. Detalhe: "### F1 — CONTROLES DA AUTOCURA APLICADOS" abaixo.
>
> **F2 CONCLUÍDA E APLICADA EM PRODUÇÃO (2026-08-30)** — EF
> `autocura-unitv-monitor` (v1, `--no-verify-jwt`) + cron
> `autocura-unitv-monitor` `*/15` + migration
> `20260830180000_autocura_unitv_monitor.sql` (1 tabela singleton
> `autocura_unitv_monitor_estado` + 1 RPC `autocura_unitv_monitor_adquirir_lock`
> — aquisição ATÔMICA do lock, sem SELECT→UPDATE). Secrets internos
> novos: `AUTOCURA_UNITV_MONITOR_TOKEN` (Edge) + `autocura_unitv_monitor_token`
> (Vault) — valor próprio (`openssl rand -hex 32`), **não são token de
> login**, não reaproveitados. Fotografia antes/depois: **a01–a08/a10/a11
> IDÊNTICOS**, a09 = exatamente 1 cron novo; Vault `unitv_dealer_token` /
> `UNITV_DEALER_TOKEN` / `UNITV_DEALER_NAME` **inalterados**. Smoke sem
> X-Internal-Token → **401**. 30/30 suítes verdes (incl. teste de
> **concorrência real** do lock: 2 ticks → exatamente 1 adquire → 1
> executa o diagnóstico). **1º tick real já rodou (12:15 UTC): consultou
> o painel (3 probes OK), gravou `unitv_token_diagnostico` `token_vivo`,
> `total_ticks=1`, lock liberado — nenhum alerta.** `autocura_unitv_config`
> segue `healer_ativo=false / modo_observacao=true / return_codes_que_disparam=NULL`;
> `autocura_unitv_ciclos` vazia. Detalhe: "### F2 — MONITOR PROATIVO
> APLICADO" abaixo.
>
> **F2 é SOMENTE OBSERVAÇÃO.** O monitor pode: consultar o painel,
> registrar diagnóstico, confirmar `token_morto` (dupla confirmação),
> alertar o José, atualizar seu próprio estado (`autocura_unitv_monitor_estado`).
> NÃO pode: login, CAPTCHA de login, POST de login, alterar Vault /
> `UNITV_DEALER_TOKEN`, `/api/account/renew`, criar cobrança, disparar
> workflow, criar ciclo de healer.
>
> **F3-A CONCLUÍDA E APLICADA EM PRODUÇÃO (2026-08-30) — MODO OBSERVAÇÃO,
> zero possibilidade estrutural de POST de login.** Migration
> `20260830200000_autocura_unitv_ocr.sql` (tabela `autocura_unitv_ocr_metricas`
> + RPC `autocura_unitv_expirar_orfaos()` + cron `autocura-unitv-ocr-agendador`
> `0 3 * * *`; **só CREATE**). EFs `autocura-unitv-ocr-agendador` (v1) e
> `autocura-unitv-resultado` (v1), `--no-verify-jwt`. Workflow
> `.github/workflows/autocura-unitv-ocr.yml` (**não é healer** — env
> **sem** `UNITV_DEALER_LOGIN`/`SENHA`). Runner `scripts/autocura-unitv-ocr.mjs`
> + pipeline `scripts/lib/unitv-captcha-ocr.mjs` + templates sintéticos
> `scripts/lib/captcha-templates/digitos.json`. `_shared/unitv_token_diag.ts`
> **não tocado nesta etapa** (só o retorno aditivo de F2). Secrets
> internos novos (não são login, `openssl rand -hex 32`): Edge
> `AUTOCURA_UNITV_OCR_AGENDADOR_TOKEN` + `AUTOCURA_UNITV_OCR_CALLBACK_TOKEN`,
> Vault `autocura_unitv_ocr_agendador_token`, GitHub Actions
> `AUTOCURA_UNITV_OCR_CALLBACK_TOKEN`. Fotografia antes/depois:
> **a01–a08/a10/a11 IDÊNTICAS**, a09 = exatamente 1 cron novo;
> `UNITV_DEALER_TOKEN`/`UNITV_DEALER_NAME`/Vault `unitv_dealer_token`
> **inalterados**. Smoke sem X-Internal-Token → **401** (nas 2 EFs).
> **34/34 suítes TS + `autocura_expirar_orfaos` (SQL) verdes.** F1/F2
> intocadas: `autocura_unitv_config` `healer_ativo=false`/`modo_observacao=true`/
> `return_codes_que_disparam=NULL`; `autocura_unitv_ciclos` vazia;
> `autocura_unitv_ocr_metricas` vazia; 2 crons de autocura ativos
> (`autocura-unitv-monitor` `*/15` + `autocura-unitv-ocr-agendador` `0 3 * * *`).
> Detalhe: "### F3-A — OBSERVAÇÃO/OCR APLICADO" abaixo.
>
> **Critério de saída da F3-A (só depois disso é F4):** mínimo **14 dias
> corridos E mínimo 10 execuções completas** de calibração + os critérios
> objetivos do doc §F3-A.12 (segmentação ≥ 0,99; gate_ok ≥ 0,95;
> `score_top1_p50` ≥ 0,97 / `_min` ≥ 0,85; `margem_p10` ≥ 0,10;
> formato_invalido ≤ 0,01; `Σ login_posts = 0`; `runner_sha` estável ≥ 7
> dias; revisão José + GPT de `autocura_unitv_ocr_metricas`). Esses
> números são **evidência de confiabilidade/consistência do solver, NÃO
> prova de acurácia** — a acurácia real só na F4 (login supervisionado).
>
> **PRÓXIMA ETAPA: F3-B (design) + F4.** F3-B (preparação do login —
> componentes/contratos/estados/guards/falhas, **sem código, sem
> execução**) já está especificada no doc §F3-B. **NÃO implementar F3-B
> em código, não criar login/workflow de healer/secrets de login, não
> fazer POST de login, não iniciar F4 — só com aprovação explícita e só
> depois do critério de saída da F3-A.** Sequência: F0 → F1 ✅ → F2 ✅ →
> **F3-A ✅** → F3-B/F4 → F5.

### FASE 2A (fonte viva no Vault, secret = fallback) — EM PRODUÇÃO usando FALLBACK; BOOTSTRAP PENDENTE (2026-08-30)

Detalhe: `supabase/functions/_shared/unitv_dealer_token.ts` +
`supabase/migrations/20260830120000_unitv_dealer_token_vault.sql` +
commit `5a89e6b` + `inovatv_central/CLAUDE.md` (checkpoint 2026-08-30).

- **Fase 2A commitada** — `inovatv-api-intermediaria` `5a89e6b`
  ("Autocura UNITV_DEALER_TOKEN - Fase 2A ..."), pushed. `unitv-renovar.mjs`
  intocado (`git diff` vazio).
- **Migration `20260830120000_unitv_dealer_token_vault.sql` APLICADA** via
  `supabase db query --linked`. Verificado read-only:
  `unitv_dealer_token_estado` existe, RLS on, **0 policies**; RPCs
  `unitv_dealer_token_ler`/`_definir` existem, `SECURITY DEFINER`, só
  `service_role` executa (`anon`/`authenticated` = false); `vault.secrets`
  **sem** `unitv_dealer_token` no momento da aplicação. **NÃO registrada
  no `schema_migrations`** (fluxo manual do repo).
- **`renovacao-unitv-conta` em produção com o código da Fase 2A** —
  **v3 → v5** (v3→v4 foi redeploy de plataforma; o deploy da Fase 2A =
  v4→v5), `ACTIVE`, `verify_jwt=false`, `ezbr_sha256` `5ef156ff…`. Bundle
  inclui `_shared/unitv_dealer_token.ts` (confirmado na saída do deploy).
  **Nenhuma outra função deployada** (siblings +1 versão com sha256 e
  `updated_at` idênticos = rotação de chave JWT da plataforma).
- **Vault ainda SEM `unitv_dealer_token`** — o sistema opera pelo
  **FALLBACK**: `obterDealerToken()` → RPC devolve NULL → lê o Edge
  secret `UNITV_DEALER_TOKEN` (digest `ad542cf70ece8562…`, `updated_at`
  2026-08-29T18:46:58Z, **INALTERADO**). Comportamento operacional atual
  **preservado** — nada foi perdido.
- **`UNITV_DEALER_TOKEN` / `UNITV_DEALER_NAME` INTACTOS.** Nenhum secret
  alterado. Nenhum rollback (a Fase 2A fica exatamente como está).
- **26/26 suítes verdes** (nova suíte `unitv_dealer_token`: Vault vence
  secret / Vault vazio→fallback / indisponível→fallback / cache 30s /
  token nunca em log).
- **PENDENTE — bootstrap do token no Vault.** Motivo: o valor atual do
  `UNITV_DEALER_TOKEN` não está disponível (não salvo; a CLI/Management
  API/GitHub nunca revelam valores de secret). Só é recuperável por
  captura na sessão logada do painel UniTV → fica para o outro
  computador. Até lá, o fallback do Edge secret cobre tudo.
- **PENDENTE — validação read-only do caminho Vault/fallback em
  produção.** Depende do `RENOVACAO_SIGMA_CALLBACK_TOKEN` (interno, não
  acessível pela CLI) para a chamada `gcnv6v` autenticada. Coberto por
  testes unitários (`unitv_dealer_token` #2/#7); falta só a prova
  empírica em produção.
- **NÃO FAZER:** rollback, bootstrap sem o token válido, alterar
  `UNITV_DEALER_TOKEN`, redeploy de outra função, tocar
  `unitv-renovar.mjs`, workaround para obter o `RENOVACAO_SIGMA_CALLBACK_TOKEN`.

### BOOTSTRAP FASE 2A CONCLUÍDO + VALIDAÇÃO gcnv6v — SUCESSO (2026-08-30)

As duas pendências da Fase 2A (bootstrap do Vault + validação read-only
`gcnv6v` em produção) foram **fechadas com sucesso** nesta data, na
outra máquina. Fase 2A deixa de operar por fallback — **o Vault é a
fonte viva agora**.

- **Recaptura passiva do `UNITV_DEALER_TOKEN`** — feita na sessão logada
  do painel (`inovatvstream2`, `panel-web.revenda.site`), sem login
  automatizado: interceptor read-only de `fetch`/XHR observando só os
  headers `token`/`Authorization` + 1 navegação de leitura ("Detalhes
  dos Créditos"). Header capturado = **32 hex minúsculo** → clipboard →
  arquivo gitignored temporário. Valor nunca no chat/log/Git/doc. Página
  recarregada ao final para remover a instrumentação. Sem logout, sem
  renovação, sem cobrança.
- **Bootstrap** — `select public.unitv_dealer_token_definir(<token>,
  'bootstrap', 'jose')` via `supabase db query --linked -f <sql temp
  gitignored>`, saída redirecionada para arquivo (nunca exibida),
  `exit_code=0`. `_unitv_tok.txt` + temporários apagados imediatamente;
  clipboard limpo.
- **Verificação read-only pós-bootstrap:**
  - `vault.secrets`: **1** linha `unitv_dealer_token`,
    `created_at == updated_at == 2026-08-30 09:51:23.94558+00` (criação
    nova, 1ª vez — não foi update). Valor nunca consultado.
  - `unitv_dealer_token_estado`: `id=1`, `origem='bootstrap'`,
    `atualizado_por='jose'`, `atualizado_em` = mesmo carimbo do secret.
  - Edge secrets **`UNITV_DEALER_TOKEN`** (digest `ad542cf70ece8562…`,
    `updated_at` 2026-08-29T18:46:58Z) e **`UNITV_DEALER_NAME`** (digest
    `b0cf3695…`, `updated_at` 2026-08-29T01:24:04Z) — **INTACTOS**,
    idênticos ao registrado antes. Nenhum `secrets set`.
  - **26/26 suítes verdes** (`npx tsx scripts/testes/*/teste.mjs`).
- **Validação read-only `gcnv6v` em produção** — cadeia
  `renovacao-unitv-conta` **v5** (`verify_jwt=false`) →
  `obterDealerToken()` → `resolverContaUnitv("gcnv6v")`. Auth via
  `X-Internal-Token` = `RENOVACAO_SIGMA_CALLBACK_TOKEN` (arquivo local
  `scripts/.credentials/renovacao_sigma_callback_token.txt`, sha256
  `151d8368…` = idêntico ao secret de produção). Corpo `{"sn":"gcnv6v"}`.
  - **Sonda 1** (isolate frio): HTTP **200**,
    `{"outcome":"resolvido","id":3433363,"sn":"gcnv6v"}`, 2,03 s.
  - **Sonda 2** (isolate quente): HTTP **200**, mesma resposta, 0,89 s.
  - `unitv_token_diagnostico`: **0 linhas antes e depois** → o branch
    `unavailable` (token rejeitado / painel fora) **não disparou**.
  - **Nenhuma renovação / `/api/account/renew` / cobrança / ACEITO
    executado.**
- **LIMITAÇÃO registrada (não forçar prova adicional):** a chamada
  read-only comprova que **o token disponível ao consumidor em produção
  é válido** e resolve a conta. **Não comprova de forma independente se
  veio do Vault ou do fallback** do Edge secret — ambos têm o mesmo
  valor (Fase 2A não rotaciona), a resposta é idêntica nos dois
  caminhos, e o único diferenciador (`console.log "[unitv-dealer-token]
  vault indisponível/vazio -> fallback"`) só existe nos Edge Logs, que a
  CLI 2.116 não expõe (`supabase functions` só tem `download`). O
  resultado é **consistente com o caminho do Vault** (código prefere
  Vault; Vault semeado e não-vazio; função v5 empacota
  `_shared/unitv_dealer_token.ts`; isolate frio faz a 1ª leitura pelo
  Vault) — sem nenhum sinal de falha do fallback.

### F0 — DOCUMENTO OFICIAL DE ARQUITETURA DA AUTOCURA (Fases 3/4) — APROVADO E COMMITADO (2026-08-30)

**Dono único:** `docs/renovacao_automatica/AUTOCURA_UNITV_DEALER_TOKEN.md`
(commit `6c0360b`). Aprovado por José + GPT como documento oficial. Este
bloco não duplica o doc — só registra o marco e o próximo passo.

- **Escopo:** detector (reusa `unitv_token_diagnostico`) + confirmação
  dupla anti-falso-positivo + healer (GitHub Actions Playwright, workflow
  separado, OCR de CAPTCHA por template matching) + segurança
  (kill-switch, cooldown, caps, hard-stop, um ciclo por vez) + gravação
  validada só no Vault + observabilidade.
- **Invariantes I1–I7** (não-negociáveis): **I1** allowlist obrigatória
  de `returnCode` de token morto — `healer_ativo=false` até haver um
  código real observado passivamente em produção, revisado e autorizado;
  **I2** modo observação é a 1ª etapa obrigatória (monitor/detector/OCR/
  métricas sim; `POST` de login nunca); **I3** guard financeiro (não
  inicia com renovação UniTV em `aguardando_confirmacao`/`autorizada`/
  `renovacao_em_andamento`; nenhum caminho para `/api/account/renew`);
  **I4** autocura escreve só o Vault, `UNITV_DEALER_TOKEN` intocado;
  **I5** falha → encerra ciclo + alerta + fallback manual, nunca
  reexecuta renovação; **I6** nunca loga token/senha/CAPTCHA resolvido;
  **I7** limites rígidos + cooldown + kill-switch.
- **Roadmap oficial (não pular etapas):** **F0** doc ✅ → **F1**
  controles (tabelas + RPCs, tudo inerte) → **F2** monitor → **F3**
  observação/OCR (≥7 dias, zero `POST`) → **F4** login supervisionado
  (`healer_ativo` ainda `false`) → **F5** ativação (`modo_observacao=false`
  + `healer_ativo=true` juntos, numa revisão).
- Próxima etapa = **F2** (ver abaixo).

### F1 — CONTROLES DA AUTOCURA APLICADOS EM PRODUÇÃO (2026-08-30)

**Dono do detalhe de arquitetura:** `docs/renovacao_automatica/AUTOCURA_UNITV_DEALER_TOKEN.md`
(§7/§8/§10). Migration:
`supabase/migrations/20260830160000_autocura_unitv_controles.sql`.
Este bloco só registra o marco.

- **Migration APLICADA** via `supabase db query --linked -f`. **Só
  CREATE + 1 INSERT** — 2 tabelas (`autocura_unitv_config` singleton,
  `autocura_unitv_ciclos` append-only), 3 índices (2 comuns +
  `autocura_unitv_ciclos_um_em_andamento_idx` **UNIQUE parcial** onde
  `estado='em_andamento'`), 3 RPCs (`autocura_unitv_pode_disparar`
  `STABLE`, `autocura_unitv_registrar_inicio`,
  `autocura_unitv_registrar_fim`). **NÃO registrada no
  `schema_migrations`** (fluxo manual do repo).
- **Fotografia read-only antes/depois** (11 consultas: colunas,
  constraints, índices, funções, grants de rotina, RLS de tabelas,
  policies, triggers, `cron.job`, contagens de
  `tokens_renovacao`/`renovacoes_lote`/`cobrancas_pix`/`unitv_dealer_token_estado`/`unitv_token_diagnostico`,
  `vault.secrets` `unitv_dealer_token`) → **11/11 IDÊNTICAS**. Nenhum
  objeto pré-existente alterado. Vault/secrets/token UniTV **inalterados**
  (re-conferido também pós-testes).
- **Estado inerte confirmado (bloco B):** RLS on + **0 policies** nas 2
  tabelas; as 3 RPCs `SECURITY DEFINER`, `has_function_privilege` =
  `anon:false / authenticated:false / service_role:true`;
  `autocura_unitv_config` = 1 linha `id=1` com `healer_ativo=false`,
  `modo_observacao=true`, `return_codes_que_disparam=NULL`,
  `kill_switch=false`, `pausado_ate=NULL` + defaults
  120/4/2/6/2/12/3/10/20/24/0.920/0.150, `atualizado_por=NULL`;
  `autocura_unitv_ciclos` **vazia**; CHECKs de invariante presentes
  (`_allowlist_obrigatoria`, `_healer_fora_observacao`, `_singleton`,
  `_terminal_coerente`, `_calibracao_sem_login`, `_observacao_sem_login`).
- **3 suítes SQL F1 (rodadas contra produção pós-apply, com reset do
  estado inerte ao fim) — todas verdes:**
  - `suite1_pode_disparar` — todos os motivos alcançáveis:
    `healer_inativo`, `kill_switch`, `pausado` (futuro e `infinity`),
    `ciclo_em_andamento`, `cooldown` (ativo e liberado após 121min),
    `cap_calibracao_diario`, `hard_stop_falhas` (+ quebra da streak por
    `sucesso`), `cap_ciclos_diario`, `cap_post_diario`, e o guard
    financeiro I3 (`renovacao_unitv_em_voo` vs `ok` conforme
    `tokens_renovacao` real — 0 em voo no momento). *(`allowlist_vazia` e
    `modo_observacao` são inalcançáveis na prática pelos CHECKs
    `_allowlist_obrigatoria`/`_healer_fora_observacao` — permanecem como
    defesa em profundidade; testá-los exigiria dropar os CHECKs, o que
    não foi feito.)*
  - `suite2_registrar` — `registrar_inicio` (uuid + snapshot
    `modo_observacao`); 2º `registrar_inicio` bloqueado; `registrar_fim`
    grava métricas + `ended_at`; 2º `registrar_fim` → `P0001 nao esta
    em_andamento`; **auto-fecho de órfão** (`em_andamento` com
    `iniciado_em = now()-21min` → `concluido/indeterminado/orfao` no
    próximo `registrar_inicio`); `registrar_inicio` bloqueado por guard →
    `P0001 bloqueado (kill_switch)`; **hard-stop** engata após 3
    `disparo`/`falhou` (`pausado_ate='infinity'`,
    `atualizado_por='autocura:hard_stop'`); `calibracao`/`falhou` **não**
    engata hard-stop.
  - `suite3_config_invariantes` — CHECKs: `id=2` rejeitado;
    `healer_ativo=true` com allowlist `NULL`/`{}` rejeitado;
    `healer_ativo=true`+`modo_observacao=true` rejeitado; estado-alvo F5
    (`modo_observacao=false`+`healer_ativo=true`+allowlist `{5}`) aceito;
    `terminal_coerente`/`calibracao_sem_login`/`observacao_sem_login`
    rejeitam inserts inválidos.
- **Teste de concorrência real do `registrar_inicio`** (2× em paralelo
  via `xargs -P2`, tabela vazia): exatamente **1 vence** (uuid) + **1
  falha** (`P0001 registrar_inicio: bloqueado (ciclo_em_andamento)`) +
  **exatamente 1 linha `em_andamento`** no banco. O índice único parcial
  + o re-check interno de `pode_disparar` garantem o ciclo único sob
  transações concorrentes.
- **26/26 suítes TS existentes verdes** (a migration não toca nenhum
  caminho TS).
- **Estado final:** `autocura_unitv_ciclos` vazia, `autocura_unitv_config`
  restaurada aos defaults F1 exatos. Nada consome estas estruturas ainda
  (a EF `autocura-unitv-monitor` é F2). Nenhuma EF/workflow/OCR/secret de
  login criado. Nenhuma alteração no fluxo de renovação, no Vault ou no
  token UniTV.

### F2 — MONITOR PROATIVO APLICADO EM PRODUÇÃO (2026-08-30)

**Dono do detalhe de arquitetura:** `docs/renovacao_automatica/AUTOCURA_UNITV_DEALER_TOKEN.md`.
Arquivos: `supabase/migrations/20260830180000_autocura_unitv_monitor.sql`,
`supabase/functions/autocura-unitv-monitor/index.ts` (wrapper fino),
`supabase/functions/_shared/autocura_monitor.ts` (lógica),
`supabase/functions/_shared/unitv_token_diag.ts` (retorno aditivo
`ResultadoDiagnostico`, zero mudança de comportamento).

- **Migration aplicada** via `supabase db query --linked -f`: 1 tabela
  singleton `autocura_unitv_monitor_estado` (RLS on, 0 policies, 1 linha
  `id=1` inerte) + 1 RPC `autocura_unitv_monitor_adquirir_lock()`
  (`SECURITY DEFINER`, só `service_role`) + 1 `cron.schedule`
  `autocura-unitv-monitor` `*/15` (padrão de `renovacao-sigma-watchdog`,
  X-Internal-Token lido do Vault). **Sem `ALTER` de objeto existente,
  sem trigger.** `autocura_unitv_expirar_orfaos()` continua adiada para
  F3 (em F2 nada cria ciclos → sem órfãos reais). NÃO registrada em
  `schema_migrations` (fluxo manual).
- **Lock anti-sobreposição — AQUISIÇÃO ATÔMICA** (correção obrigatória
  da revisão): a RPC faz um único `UPDATE ... WHERE id=1 AND
  (tick_em_andamento_desde IS NULL OR < now()-10min) RETURNING *` →
  1 linha = ganhou (+ contadores/dedupe no retorno, EF **não faz
  SELECT**); 0 linhas = outro tick detém o lock. Liberação **condicional**
  (`.eq("tick_em_andamento_desde", <valor adquirido>)`) — não "rouba" o
  lock de um sucessor que assumiu por staleness. Staleness de 10 min
  vive **só** na RPC.
- **Secrets internos novos** (não são token de login, valor próprio
  `openssl rand -hex 32`, não reaproveitados): `AUTOCURA_UNITV_MONITOR_TOKEN`
  (Edge, digest `014ab78d…`) + `autocura_unitv_monitor_token` (Vault,
  criado 12:09:50 UTC).
- **Fotografia read-only antes/depois** (11 consultas): a01–a08, a10, a11
  **IDÊNTICAS**; a09 (`cron.job`) = exatamente **1 linha nova**
  (`jobid`, `jobname='autocura-unitv-monitor'`, `*/15`, `active=true`).
  Vault `unitv_dealer_token` (`updated_at 09:51:23`) e Edge secrets
  `UNITV_DEALER_TOKEN` (`ad542cf70e…`) / `UNITV_DEALER_NAME` (`b0cf3695…`)
  **inalterados**.
- **Deploy só de `autocura-unitv-monitor`** (`--no-verify-jwt`, **v1**,
  `ACTIVE`). `orchestrator` v60, `renovacao-unitv-conta` v6
  (`ezbr_sha256 5ef156ff…` inalterado — não redeployada apesar do diff
  aditivo em `unitv_token_diag.ts`), `renovacao-sigma-watchdog` v14 etc.
  **nenhuma outra função tocada.**
- **Smoke:** `POST /functions/v1/autocura-unitv-monitor` sem
  `X-Internal-Token` → **401** `{"outcome":"error","message":"Nao autorizado"}`;
  com token errado → **401**.
- **30/30 suítes verdes** — 26 pré-existentes + 4 novas
  (`autocura_monitor_confirmacao` [dupla confirmação: batida-1 mais
  recente, token_vivo posterior invalida a sequência, janela 24h, mesmo
  `probe_return_code`], `autocura_monitor_alerta` [1 alerta por código +
  dedupe 12h; token_vivo zera o dedupe; falha de envio não grava dedupe],
  `autocura_monitor_guard_lock` [kill_switch/pausado; **concorrência real
  do lock: 2 ticks → exatamente 1 adquire → 1 executa o diagnóstico**;
  lock liberado no `finally`], `autocura_monitor_nao_age` [varredura
  estática: não login/CAPTCHA/`/renew`/cobrança/workflow/dispatch/
  `pode_disparar`/`registrar_*`/Vault; único `.update()` é em
  `autocura_unitv_monitor_estado`; aquisição via RPC atômica, sem SELECT]).
  Transpile-check (esbuild) dos 3 arquivos TS: OK.
- **1º tick real (cron 12:15:00 UTC, `succeeded`):** consultou o painel
  (3 probes read-only, `probe_ok=3`), gravou 1 linha `unitv_token_diagnostico`
  `motivo_origem='monitor-proativo'`, `veredito='token_vivo'`,
  `alertado_jose=false`; `autocura_unitv_monitor_estado` → `total_ticks=1`,
  `ultimo_veredito='token_vivo'`, lock adquirido e **liberado**
  atomicamente. Nenhum alerta (token vivo). Comportamento observação-only
  comprovado em produção.
- **F1 intocada:** `autocura_unitv_config` `healer_ativo=false`,
  `modo_observacao=true`, `return_codes_que_disparam=NULL`,
  `kill_switch=false`, `pausado_ate=NULL`; `autocura_unitv_ciclos` **vazia**.

**F2 é SOMENTE OBSERVAÇÃO** (pode: consultar painel / registrar
diagnóstico / confirmar `token_morto` / alertar / atualizar seu próprio
estado — não pode: login / CAPTCHA de login / POST de login / alterar
Vault / alterar `UNITV_DEALER_TOKEN` / `/api/account/renew` / criar
cobrança / disparar workflow / criar ciclo de healer).

### F3-A — OBSERVAÇÃO/OCR APLICADO EM PRODUÇÃO (2026-08-30)

**Dono do detalhe de arquitetura:** `docs/renovacao_automatica/AUTOCURA_UNITV_DEALER_TOKEN.md` §F3-A.
Arquivos: `supabase/migrations/20260830200000_autocura_unitv_ocr.sql`,
`supabase/functions/autocura-unitv-ocr-agendador/index.ts` +
`_shared/autocura_ocr_agendador.ts` + `_shared/autocura_ocr_dispatch.ts`,
`supabase/functions/autocura-unitv-resultado/index.ts` +
`_shared/autocura_resultado.ts`, `.github/workflows/autocura-unitv-ocr.yml`,
`scripts/autocura-unitv-ocr.mjs`, `scripts/lib/unitv-captcha-ocr.mjs`,
`scripts/lib/captcha-templates/digitos.json` (+ `gerar-templates-sinteticos.mjs`).

- **Objetivo:** provar o solver de CAPTCHA **por métricas**, sem login,
  sem saber se o dígito lido está certo. Roda ≥ 14 dias / ≥ 10 execuções.
- **Migration:** tabela `autocura_unitv_ocr_metricas` (RLS on, 0 policies,
  só AGREGADOS — nunca imagem/predição/valor) + RPC
  `autocura_unitv_expirar_orfaos()` (`SECURITY DEFINER`, só `service_role`;
  adiada da F2, necessária agora que F3-A cria ciclos) + cron
  `autocura-unitv-ocr-agendador` `0 3 * * *`. **Só CREATE.**
- **Agendador** (EF + cron 03:00 UTC): `expirar_orfaos` → idade da última
  calibração ≥ `calibracao_intervalo_h` → `pode_disparar('calibracao')`
  (guards F1) → `registrar_inicio('calibracao','agendado')` → dispatch
  `autocura-unitv-ocr.yml`. **Nunca `'disparo'`.** É o 1º componente que
  chama `registrar_inicio` — só para calibração.
- **Runner** (GH Actions Playwright): abre a página de login, coleta 20
  CAPTCHAs pelo `POST /api/dealer-core/security/get-info` (**pré-auth**),
  roda o pipeline OCR, agrega, chama `autocura-unitv-resultado`. **Sem
  `UNITV_DEALER_LOGIN`/`SENHA` no env** → impossível logar. Loga só
  bucket + flags; descarta `predicao` e bytes do PNG.
- **Callback** (EF): `registrar_fim(ciclo_id,'calibracao',…)` + `INSERT`
  em `autocura_unitv_ocr_metricas` (allowlist de 16 colunas) + alerta ao
  José se `estilo_alterado` (dedupe 24h).
- **Pipeline** (`unitv-captcha-ocr.mjs`): binariza → segmenta em 4 →
  NCC vs templates → `score_top1`/`margem` → bucket `alta/media/baixa` →
  validação de formato (`^[0-9]{4}$`, 240×80, fundo em [0,80;0,985],
  0 strike-rows) → detecção de "obviamente inválido" (segmentos ≠ 4,
  score < 0,50, margem ≤ 0,03, borda, all-same+margem-baixa). Templates
  sintéticos (font 5×7) — refináveis com amostras reais durante a
  observação (muda `runner_sha`, reinicia o relógio de "7 dias estável").
- **Secrets internos novos** (não são login, `openssl rand -hex 32`, não
  reaproveitados): Edge `AUTOCURA_UNITV_OCR_AGENDADOR_TOKEN` +
  `AUTOCURA_UNITV_OCR_CALLBACK_TOKEN`; Vault
  `autocura_unitv_ocr_agendador_token` (criado 12:48:48 UTC); GitHub
  Actions `AUTOCURA_UNITV_OCR_CALLBACK_TOKEN` (12:48:50 UTC).
- **Fotografia read-only antes/depois:** a01–a08, a10, a11 **IDÊNTICAS**;
  a09 (`cron.job`) = exatamente **1 linha nova** (`jobid 4`,
  `autocura-unitv-ocr-agendador`, `0 3 * * *`). `UNITV_DEALER_TOKEN`
  (`ad542cf70e…`) / `UNITV_DEALER_NAME` (`b0cf3695…`) / Vault
  `unitv_dealer_token` (`updated_at 09:51:23`) **inalterados**.
- **Deploy só das 2 EFs de F3-A** (`autocura-unitv-ocr-agendador` v1,
  `autocura-unitv-resultado` v1, `--no-verify-jwt`). Nenhuma outra
  função tocada. `renovacao-unitv-conta` `ezbr_sha256 5ef156ff…`
  inalterado.
- **Smoke:** POST sem `X-Internal-Token` → **401** nas 2 EFs (e token
  errado → 401).
- **34/34 suítes TS** (30 + `autocura_ocr_pipeline` / `_agendador` /
  `_resultado` / `_nao_age`) + **`autocura_expirar_orfaos` (SQL, contra
  produção com limpeza) PASS**. Transpile-check (esbuild) das 5 TS de
  F3-A: OK.
- **Estado pós-aplicação:** `autocura_unitv_config` `healer_ativo=false`,
  `modo_observacao=true`, `return_codes_que_disparam=NULL`;
  `autocura_unitv_ciclos` **vazia**; `autocura_unitv_ocr_metricas`
  **vazia**; 2 crons de autocura ativos. A 1ª execução de calibração real
  ocorre às **03:00 UTC** (próximo tick do cron).
- **F3-A NÃO pode:** login / CAPTCHA de login / POST de login / alterar
  Vault / alterar `UNITV_DEALER_TOKEN` / alterar secret /
  `/api/account/renew` / cobrança / disparar o workflow do healer /
  `registrar_inicio('disparo')` / criar ciclo de healer / tocar a F2. O
  CHECK `autocura_unitv_ciclos_observacao_sem_login` (F1) torna
  **estruturalmente impossível** um ciclo de F3-A registrar `login_posts > 0`.

**Critério de saída da F3-A (mínimo 14 dias corridos E mínimo 10
execuções completas):** doc §F3-A.12. Os números de `gate_ok`/`score`/
`margem` são **evidência de confiabilidade/consistência do solver, NÃO
prova de acurácia** — a acurácia real só na F4 (login supervisionado).

**Próxima etapa: F3-B (design, já no doc §F3-B) + F4.** **Não implementar
F3-B em código, não criar secrets de login, não criar o workflow do
healer, não fazer POST de login, não iniciar F4** — só com aprovação
explícita e só depois do critério de saída da F3-A. Sequência: F0 → F1 ✅
→ F2 ✅ → **F3-A ✅** → F3-B/F4 → F5.

### FASE 1 (diagnóstico + observabilidade) — EM PRODUÇÃO (2026-08-30)

Read-only, sem login, sem tocar secret, sem alterar renovação. Detalhe:
`supabase/functions/_shared/unitv_token_diag.ts` +
`supabase/migrations/20260829150000_unitv_token_diagnostico.sql` +
`inovatv_central/CLAUDE.md` (checkpoint 2026-08-29/30).

- Migration `20260829150000_unitv_token_diagnostico.sql` **aplicada** via
  `supabase db query --linked` (tabela `unitv_token_diagnostico`,
  append-only, RLS on, **0 policies**, 14 colunas + 5 CHECKs + 2
  índices; snapshot antes/depois confirmou **nenhuma tabela existente
  alterada**). **NÃO registrada no `schema_migrations`** (mesmo caso da
  `20260829140000`) — consistente com o fluxo manual deste repo.
- `renovacao-unitv-conta` **v2 → v3** (`--no-verify-jwt`, `verify_jwt=false`,
  `ACTIVE`); bundle inclui `_shared/unitv_token_diag.ts` (confirmado na
  saída do deploy) + `_shared/unitv_conta.ts` enriquecido
  (`returnCode`/`httpStatus`/`painelMsg` no `unavailable`, contrato
  público inalterado). Smoke pós-deploy: `POST` sem token → `401`.
- **`UNITV_DEALER_TOKEN` / `UNITV_DEALER_NAME` NÃO alterados.**
- **25/25 suítes verdes** (nova suíte `unitv_token_diag`, ~65 asserts,
  com teste explícito de não-vazamento).
- **PENDÊNCIA — usuário:** o project secret **`UNITV_DIAG_ANCHOR_SN`
  ainda NÃO está configurado**. O valor (um `sn` de conta UniTV
  controlada) não pode passar por chat/log/doc → o próprio usuário
  precisa setar (`supabase secrets set UNITV_DIAG_ANCHOR_SN=<sn>` OU
  dashboard). Até lá o diagnóstico degrada para `ancora_status='ausente'`
  (fallback previsto/testado) — não quebra nada.
- **Código deployado ainda NÃO commitado/enviado** (checkpoint próprio,
  regra 0-B). Arquivos: `_shared/unitv_token_diag.ts` (novo),
  `_shared/unitv_conta.ts` (M), `renovacao-unitv-conta/index.ts` (M),
  migration (novo), `scripts/testes/unitv_token_diag/` (novo),
  `scripts/testes/renovacao_unitv_conta/` (M + fake novo).

### Próximas fases (2/3/4) — NÃO iniciadas

**Primeira investigação da próxima sessão (nesta ordem, NÃO começar
agora):**

1. **Login concorrente** — um novo login invalida o token da sessão
   anterior? (define se a autocura pode rodar sem derrubar a sessão
   manual do José, e vice-versa).
2. **Lockout / rate-limit do login** — existe? qual o limiar? (define o
   cap seguro de tentativas).
3. **Arquitetura da autocura** — monitor (`getDealerInfo` cron) +
   healer (solve CAPTCHA desacoplado do POST + cap rígido + fallback) +
   gate pré-cobrança para renovação com UniTV. Também: verificar (read-
   only) se o payload decodificado de `security/get-info` vaza a
   resposta do CAPTCHA, e se "Lembrar-me" estende o TTL.
4. **Só depois** decidir/implementar OCR + login automático.

**Não iniciado nesta sessão:** especificação técnica das partes
seguras (monitor + gate pré-cobrança) — o usuário interrompeu antes.
Retomar por elas se a investigação 1/2 mostrar que a autocura completa
é arriscada; senão, especificar as duas partes seguras primeiro (elas
não precisam de login).

**Pendências de matriz que continuam abertas (não bloqueiam):**
ChannelTV (config Rocket do servidor "ChannelTV" ainda retorna
`Unauthenticated` no `sigma/info` — §4.5) · mensagem intermediária
"🔄 Renovação em andamento" (`7f6cdc0`, NÃO deployada, `openpix-webhook`
v12) · latência da mensagem final (transversal, pipeline de resultado).

---

## 1. Estado do git (2026-08-29 — fim de sessão)

Todos os repositórios: **`HEAD == origin/main`, working tree limpo**
(ressalva: 3 diretórios untracked pré-existentes em
`inovatv-api-intermediaria`, ver abaixo).

| Repositório | HEAD | Último commit |
|---|---|---|
| `inovatv-api-intermediaria` | *(commit deste checkpoint)* | UNITV_DEALER_TOKEN + Iteração 1 + pré-check + checkpoint de encerramento |
| `inovatv_central` | *(commit deste checkpoint)* | Checkpoint 2026-08-29 fim de sessão + desativa Chrome interativo |
| `inovatv_painel` | `ccb31be` | Remove 3 colunas nao usadas de apps (sem alteração nesta sessão) |

`inovatv_meta_business_agent` — **não existe mais nesta máquina**
(descontinuado; conteúdo já migrado).

### Cadeia de commits — sessão 2026-08-29 (continuação)

```
57effb1  Fecha Gap 1 e Gap 3 do lote misto Sigma+UniTV (só testes)   [início desta sessão]
3b0e01d  Iteração 1: instabilidade de auth do painel Sigma (retry só de leitura) — CÓDIGO
18331b3  Registra decisão arquitetural: PRÉ-CHECK SIGMA = DESNECESSÁRIO — doc
64d5a02  Registra deploy da Iteração 1: renovacao-sigma-contexto v8→v9, renovacao-sigma-resultado v11→v12
2a1f95c  Registra regra: indisponivel na resolução UniTV → hipótese token inválido antes de mexer em código — doc
963e092  UNITV_DEALER_TOKEN invalidado: diagnóstico + recaptura passiva + secrets atualizados — doc + secrets
62695bb  Análise read-only da dependência do UNITV_DEALER_TOKEN: classificação B (token de sessão, sem refresh) — doc
<este>   Checkpoint de encerramento (U1/U3/U4, A×B, PONTO EXATO DA RETOMADA, versões de produção) — doc
```

**Deploys reais desta sessão:** só `renovacao-sigma-contexto` e
`renovacao-sigma-resultado` (Iteração 1, `--no-verify-jwt`, registro em
`64d5a02`). **Secret alterado:** `UNITV_DEALER_TOKEN` (Supabase +
GitHub, registro em `963e092`). Nenhum outro deploy, nenhuma cobrança,
nenhuma renovação real.

Diretórios não versionados que permanecem no disco (pré-existentes,
**não tocar**): `scripts/.interactive-test-harness/`,
`scripts/supabase/`, `supabase/functions/poc-sigma-renovacao-real/`.

---

## 2. Edge Functions — versões deployadas em produção (2026-08-29)

Projeto Supabase: `nduxsuxkopuvhwugdkqi` (`inovatv-api-intermediaria`,
`sa-east-1`). Já `--linked` nesta máquina; na outra máquina rodar
`npx supabase link --project-ref nduxsuxkopuvhwugdkqi` primeiro.

Versões conferidas via `npx supabase functions list` no fim desta
sessão (2026-08-29). Nota: um **redeploy de plataforma** (rotação de
chaves JWT do Supabase, ~21:00 UTC) bumpou **todas** as funções +1
versão com **`ezbr_sha256` inalterado** → código idêntico ao commit
indicado, zero mudança de comportamento.

```
orchestrator                v58  jwt=OFF   código = 8f9c31d (74aca2c + 8f9c31d); NÃO tem aa9895d (msg UniTV refinada, não deployada)
renovacao-sigma-contexto    v9   jwt=OFF   código = 3b0e01d (ITERAÇÃO 1 — Camada A / reclassificação Unauthenticated)
renovacao-sigma-resultado   v12  jwt=OFF   código = 3b0e01d (ITERAÇÃO 1 — MENSAGEM_RENOVACAO_INSTABILIDADE)
renovacao-sigma-watchdog    v12  jwt=OFF   código = a87a1df (CAMADA 3 — reconciliação antecipada)
renovacao-sigma-cliente     v5   jwt=OFF   código = HEAD
renovacao-unitv-conta       v5   jwt=OFF   código = HEAD (5a89e6b) + Fase 1 (diag) + Fase 2A (obterDealerToken: Vault->fallback). Vault vazio -> usa o Edge secret UNITV_DEALER_TOKEN. sha 5ef156ff… (2026-08-30 01:28 UTC)
renovacao-rocket-vencimento v2   jwt=OFF   código = 74aca2c (Bloco 1)
renovacao-confirmar         v11  jwt=OFF   código = HEAD (botões ACEITO/CANCELAR)
confirmacao-renovacao       v10  jwt=OFF   código = HEAD (fallback dos links antigos)
openpix-webhook             v12  jwt=OFF   ❌ NÃO tem 7f6cdc0 (mensagem intermediária) — ver §4.4
webhook                     v18  jwt=OFF   código = HEAD
status                      v32  jwt=ON    código = c8732e0 (`usuario` no contrato)
match                       v28  jwt=ON    código = HEAD
```

Outras (não relacionadas a esta frente): `painel-atendimento-*`
v22-24, `atualizar-sessao-rocket` v13, `monitorar-sessao-rocket` v13,
`diag-cobrancas-pix` v9, `teste-patch-renovacao-newone` v17,
`poc-*` (descartáveis), `fase3-mock` v28.

**Workflow GitHub Actions** `renovacao-sigma.yml` +
`scripts/renovacao-sigma-workflow.mjs`: rodam a partir do checkout de
`origin/main` — **já refletem o Bloco 4 E a Iteração 1** (clique único,
retries só de leitura, reconsulta extra, `sigmaIndisponivel`). Não há
"deploy" deles; a próxima execução do workflow usa a versão de `main`.
GitHub Actions Secret `UNITV_DEALER_TOKEN` atualizado nesta sessão
(`2026-08-29T18:47Z`).

### Função com código commitado ainda NÃO em produção

- **`openpix-webhook`** — prod `v12`. O commit `7f6cdc0` (mensagem
  intermediária "🔄 Renovação em andamento...") **não foi deployado**.
  É o único caso. Ver §4.4.

---

## 3. Secrets existentes (NOMES — valores nunca aqui)

```
GEMINI_API_KEY · GEMINI_MODEL_ID
GITHUB_ACTIONS_DISPATCH_TOKEN · GITHUB_ALERT_TOKEN
OPENPIX_APPID · OPENPIX_WEBHOOK_PUBLIC_KEY
ORCHESTRATOR_INTERNAL_TOKEN
PAGBANK_SANDBOX_TOKEN
PAINEL_EMAIL_AUTORIZADO
RENOVACAO_CONFIRMAR_INTERNAL_TOKEN
RENOVACAO_SIGMA_CALLBACK_TOKEN · RENOVACAO_SIGMA_WATCHDOG_TOKEN
ROCKET_API_KEY · ROCKET_BASE_URL
SESSAO_ROCKET_MONITOR_TOKEN · SESSAO_ROCKET_UPDATE_TOKEN
SUPABASE_ANON_KEY · SUPABASE_DB_URL · SUPABASE_JWKS
SUPABASE_PUBLISHABLE_KEYS · SUPABASE_SECRET_KEYS
SUPABASE_SERVICE_ROLE_KEY · SUPABASE_URL
UNITV_DEALER_NAME · UNITV_DEALER_TOKEN
WHATSAPP_ACCESS_TOKEN · WHATSAPP_APP_SECRET
WHATSAPP_JOSE_NUMERO · WHATSAPP_PHONE_NUMBER_ID · WHATSAPP_VERIFY_TOKEN
```

- `UNITV_DEALER_TOKEN` / `UNITV_DEALER_NAME` — configurados no Supabase
  **e** nos secrets do GitHub Actions (o `.yml` do Bloco 4 os injeta
  no `env` do job). Atualizados 2026-08-29 ~01:2x UTC; frescos.
- `OPENPIX_APPID` — **ainda Sandbox** (Woovi). Trocar para produção só
  quando for operar com pagamento real (decisão à parte, não é bug).

---

## 4. Estado da Etapa 2 (Renovação UniTV) — completo

### 4.1 O que foi implementado (Blocos 1–4) — em produção

- **Executor UniTV** (`scripts/lib/unitv-renovar.mjs`) — **CONGELADO**.
  `sign` MD5 (`MD5("dealer"+id+points_type+points)`), AES-128-CBC
  (chave/IV fixos do protocolo, não nosso secret), `POST
  panel-web.revenda.site/api/account/renew`, decrypt do `data`,
  reconsulta independente do vencimento. Uma única chamada a `/renew`,
  sem retry. **Não reestudar** (ver §7).
- **`renovacao-unitv-conta`** (EF, v1) — resolve `sn` → `id` da conta
  no painel de revenda ANTES de criar token/cobrança. `X-Internal-Token
  == RENOVACAO_SIGMA_CALLBACK_TOKEN` (sem secret novo). `POST {sn}` →
  `{outcome:"resolvido", id} | nao_encontrado | ambiguo | indisponivel`.
- **`renovacao-rocket-vencimento`** (EF, v1) — espelha no Rocket
  (`PATCH cliente/{publicId}`, campo `vencimento`) o vencimento já
  confirmado pelo painel UniTV. Só leitura + 1 PATCH; nunca lê/loga o
  corpo da resposta (contém `senha`/`m3u_url`). Falha aqui →
  `rocketDesync=true` no item, **resultado continua `sucesso`**.
- **`status` v31 / contrato Rocket** — expõe `cliente.usuario`
  (necessário como `sn` do UniTV). `orchestrator` usa fallback
  `/status.usuario ?? /match.candidates…usuario` (Bug do 2×UniTV
  lote, corrigido em `8f9c31d`).
- **`tokens_renovacao`** — `+tipo('sigma'|'unitv')`, `+unitv_sn`,
  `+unitv_id`, `public_id` NULL-able, CHECK
  `tokens_renovacao_alvo_por_tipo`. Migration
  `20260829120000_renovacoes_lote.sql` **já aplicada e auditada** em
  produção (Etapa 1).
- **`orchestrator` v56** — roteamento por tipo:
  - individual UniTV → resolve conta → cria token `tipo=unitv` →
    confirmação interativa → cobrança (mesmo fluxo do Sigma).
  - lote com UniTV → resolve **todas** as contas UniTV; se todas
    resolvem → lote misto/2×UniTV normal (preço = soma dos `valor`
    reais); se alguma falha → **nenhum lote**, `MENSAGEM_RENOVACAO_LOTE_COM_UNITV`
    + transferência.
  - `MENSAGEM_RENOVACAO_UNITV_NAO_INTEGRADA` / `MENSAGEM_RENOVACAO_LOTE_COM_UNITV`
    são **fallback de segurança** (falha de resolução), nunca aparecem
    para um UniTV bem configurado.
- **`scripts/renovacao-sigma-workflow.mjs`** — `processarLote` roteia
  por `filho.tipo`: `sigma` → `renovarUmAcessoSigma` (Playwright);
  `unitv` → `renovarUmAcessoUniTVComSync` (executor congelado + sync
  Rocket). Callback **único** com `resultados[]` de tipos possivelmente
  mistos. `main()` trata UniTV individual antes de `lerSessaoRocket`.
- **`renovacao-sigma-resultado` v10** — deriva estado final
  (`concluida`/`parcial`/`falhou` por `totalOk`); `rocketDesync` →
  nota de sistema + aviso ao José (`renovacao_unitv:rocket_desync`),
  **sem transferência, sem 2ª mensagem ao cliente**, independente do
  estado final; `estadoFinal != concluida` → transferência
  `renovacao_lote:parcial` com `avisarCliente:false`.

### 4.2 Testes locais (suítes) — 23/23 VERDE

Rodar: `for d in scripts/testes/*/; do npx tsx "${d}teste.mjs"; done`
(todas exit 0). Suítes: `mensagens_renovacao_apresentacao`,
`notificacao_transferencia_humana`, `openpix_paymentlink`,
`orchestrator_multiplos_acessos`, `precos_renovacao`,
`renovacao-sigma-cliente`, `renovacao-sigma-workflow-leitura`,
**`renovacao_em_andamento`** (novo — mensagem intermediária, 12
cenários), `renovacao_rocket_vencimento`,
**`renovacao_sigma_resultado_unitv`** (+C6/C7/C8 — Gap 3, resultado
misto), **`renovacao_sigma_workflow_misto`** (novo — Gap 1,
`processarLote` 1 Sigma + 1 UniTV na mesma execução),
`renovacao_sigma_workflow_unitv`, `renovacao_unitv_conta`,
`renovacoes_lote`, `resolver-id-interno-dom`, `rocket-sigma-contexto`,
`rocket_cliente_completo`, `status_valor`, `tipo_acesso`,
`token_renovacao_unitv`, `unitv_conta`, `unitv_renovar`,
`vinculo_operacao_renovacao`.

### 4.3 Testes REAIS realizados (2026-08-29, todos Sandbox OpenPix)

| Cenário | Resultado | Vencimento antes → depois |
|---|---|---|
| **UniTV individual** — Karla Filha, tel `17981625486`, sn `3tnjsc`, servidor UNITV, valor R$ 35,00 | **✅ SUCESSO ponta a ponta** — proposta → ACEITO → cobrança → pagamento simulado → workflow → `/api/account/renew` → reconsulta → sync Rocket → mensagem final | **21/09/2026 → 22/10/2026** (+31 dias; consistente com "1 crédito mensal ≠ 30 dias") |
| **Lote 2×UniTV** — tel `5517981625486` (BLAZE→trocado p/ UniTV + Karla Filha) | **✅ SUCESSO** — 1 lote / 1 cobrança / 2 filhos / 1 PIX / `processarLote` roda os 2 / callback único / `estado = concluida` / 1 mensagem consolidada | ambos **+1 mês**, os dois `vencimento_confirmado` gravados; ambos sincronizados no Rocket |
| **Lote misto Sigma + UniTV** — tel `5517981625486` = ChannelTV (`759334773`) + Karla Filha UNITV (`3tnjsc`); R$ 35 + R$ 35 = **R$ 70** | **⚠️ PARCIAL, esperado** — **UniTV: `sucesso`** (renovou no painel + sincronizou o Rocket, sem `rocketDesync`); **ChannelTV: `resultado_ambiguo`** (`pacote_vazio` — ver §4.5). `renovacoes_lote = parcial`. Mensagem consolidada + transferência `renovacao_lote:parcial` (`avisarCliente:false`) entregues. Rodou **2×** (03:04 e 03:27 UTC), mesmo resultado nas duas | Karla Filha / UNITV — renovada em **vários** testes hoje (individual + 2×lote + misto ×2); vencimento empurrado múltiplas vezes → **reconferir o valor atual no Rocket/painel**. ChannelTV `759334773`: sem renovação (venc segue **31/08/2026 23:59**) |

**O objetivo arquitetural do lote misto está CUMPRIDO:** os dois tipos
chegaram ao mesmo `processarLote`, o callback é único com `resultados[]`
de tipos distintos, `processarResultadoLote` derivou `parcial`
corretamente, a UniTV completou de forma **independente** da falha da
ChannelTV. As suítes `renovacao_sigma_workflow_misto` (M2) e
`renovacao_sigma_resultado_unitv` (C7) preveem exatamente esse
comportamento.

### 4.4 Mensagem intermediária "🔄 Renovação em andamento..." — código pronto, NÃO deployado

- Commit `7f6cdc0`. `MENSAGEM_RENOVACAO_EM_ANDAMENTO` em
  `_shared/mensagens_fixas.ts`; enviada em
  `openpix-webhook` → `iniciarRenovacaoSigma()` **depois** de
  `reivindicarInicio*` ter sucesso e **antes** do dispatch do
  workflow. Caminho único individual/lote, sem branch por tipo.
  **BEST-EFFORT**: falha no WhatsApp/histórico nunca impede
  `dispararWorkflowRenovacaoSigma()`. Grava no histórico só em
  `envio.outcome === "success"`. Reentrega de webhook
  (`reivindicado === null`) não reenvia. Não altera a mensagem final.
- Suíte `renovacao_em_andamento` (12 cenários) verde.
- **Prod `openpix-webhook` = v11 (sem isto).** Deploy é o passo 4 de §6.
- **Nos testes reais de hoje essa mensagem NÃO apareceu** — esperado,
  não é falha.

### 4.5 Problema ChannelTV — `package_vazio` / autenticação do painel Sigma

**Onde a cadeia quebra:** `renovarUmAcessoSigma` (workflow) →
`lerContextoSigma` → EF `renovacao-sigma-contexto` → `lerSigmaInfo`
(`_shared/rocket_sigma_contexto.ts`) →
`GET https://app.rocketgestor.com/gerenciador/cliente/sigma/info/?cliente_id={id}`
→ **HTTP 200 com `{"error": true, "msg": "..."}` (sem `data.package`)**
→ `pacote_vazio` → `renovarUmAcessoSigma` (linha ~306) →
`{resultado:"resultado_ambiguo", detalhe:"Sigma nao informou o pacote atual (package vazio)"}`.
O clique nunca dispara; **nada é escrito no Rocket para a ChannelTV**.

**O guard `pacote_vazio → resultado_ambiguo` está CORRETO** — nunca
chutar pacote. Isto NÃO é bug de código. É config/dados no Rocket:

- **Cliente Rocket:** `759334773` "Jose Antonio Dos Santos",
  `public_id = 01a04b56-5ff4-7b17-9e1d-d2f01e0a9027`, **id interno =
  `1577572`**.
- **Campo "Painel id" (Editar cliente → Dados):** estava **VAZIO**.
  ⚠️ Foi **auto-preenchido para `loL7ZaZ1XM`** por um **submit
  acidental do formulário que o Claude causou** durante o
  reconhecimento (Chrome). Demais campos conferidos e **inalterados**
  (nome, usuário, telefone, vencimento 31/08/2026 23:59, plano Mensal,
  valor R$ 35,00, servidor ChannelTV, 1 tela). **O usuário decide
  amanhã se mantém `loL7ZaZ1XM` ou reverte para vazio.**
- **`GET /sigma/info/?cliente_id=1577572` — evolução do erro:**
  - antes do ajuste do usuário: `msg` = SSL handshake failure a
    `channeltv.top:443/api/auth/login` (`SSLV3_ALERT_HANDSHAKE_FAILURE`).
    O painel mudou de domínio: o usuário apontou
    `https://channeltvbr.store/#/customers` como o painel atual; a
    config do servidor "ChannelTV" no Rocket ainda usava `channeltv.top`.
  - depois do ajuste (mesmo dia): `msg` = `{"message":"Unauthenticated."}`
    — **conexão OK, mas o painel rejeita a autenticação do Rocket**
    (padrão Laravel/Sanctum). As **credenciais da integração desse
    servidor no Rocket** (URL do painel novo + usuário/senha/token de
    revenda) precisam ser corrigidas.
  - `GET /sigma/packages/?cliente_id=1577572` → mesmo erro.
- Comparação com Sigma que funciona: **NewOne** (`painel.onetv.plus`)
  e **BLAZE** foram os únicos servidores Sigma validados neste fluxo.
  `ChannelTV` nunca foi (pendência registrada em
  `docs/renovacao_automatica/SESSAO_ROCKET_MONITORAMENTO.md`). Um
  Sigma saudável retorna `{id, server, package, expires_at, status:"ACTIVE"}`.

### 4.6 `UNITV_DEALER_TOKEN` invalidado — diagnosticado e CORRIGIDO (2026-08-29)

**Sintoma:** lote com acesso UniTV `gcnv6v` (José Antonio, publicId
`01a049f6-…`) caiu em `renovacao:lote_unitv_conta_indisponivel` — 2
reproduções reais (`12:22` e `18:03` UTC) via botão "0" (renovar tudo).
Lista de acessos veio **correta** (ChannelTV + UniTV); não era
`unitv_sem_usuario`.

**Investigação read-only (sem alterar código):**
- Sonda `renovacao-unitv-conta` `sn="gcnv6v"` → **HTTP 200, ~1,1 s,
  `outcome:"indisponivel"`** → descarta hop interno Orq→EF e timeout;
  é rejeição **rápida** na camada painel (`callUnitvApi` →
  `panel-web.revenda.site/api/account` → `returnCode != 0` ou corpo
  não-JSON). O `returnCode`/`errorMessage` literal **não é logado** por
  nenhum ponto da cadeia (`unitv_conta.ts` só lê `returnCode` e
  descarta; zero `console.*`), e a CLI não expõe Edge Logs — dado
  irrecuperável por leitura.
- `gcnv6v` resolveu **OK às 02:12 UTC** (`id=3433363`, renovação
  concluída) com o token setado ~01:22 UTC; `3tnjsc` resolveu até
  03:27 UTC. Falha sustentada de ~12:22 em diante — 3 tentativas +
  sonda ao longo de ~6,5 h.
- **Captura passiva** na sessão logada do painel (`inovatvstream2`):
  interceptor read-only de `fetch`/XHR + 1 busca "Consultar" por
  `gcnv6v` (leitura, sem renovar). Corpo do `POST /api/account`
  descriptografado com a chave/IV AES do bundle deles → `dealer_token`
  de **32 chars** (não-JWT), `dealer_name = "inovatvstream2"`. A busca
  retornou **1 linha** (`gcnv6v` / José Antonio / venc `04/12/2026
  02:31:01` local = bate com a renovação das 02:12) → `returnCode:0`,
  token da sessão **válido agora**.
- **`sha256(token capturado)` ≠ `sha256(secret Supabase)`** (`ad542cf70e…`
  vs `1927c0bb…`) → o secret guardava um `dealer_token` **obsoleto**;
  o painel emite outro, válido.

**Correção operacional (sem deploy de código):**
- `UNITV_DEALER_TOKEN` atualizado no **Supabase** (`supabase secrets
  set`, digest agora `ad542cf70ece8562…`) **e no GitHub Actions**
  (`gh secret set`, `updated_at 2026-08-29T18:47:00Z`).
- `UNITV_DEALER_NAME` **intocado** (`inovatvstream2`, digest
  `b0cf3695…`).
- Valor do token nunca registrado — ponte via arquivo gitignored
  temporário (`scripts/.credentials/`, apagado após uso).
- **Verificação read-only pós-fix:** `renovacao-unitv-conta`
  `sn="gcnv6v"` → **HTTP 200, ~1,2 s, `{"outcome":"resolvido","id":3433363}`**.
  Hipótese confirmada: era credencial de dealer invalidada.

**Natureza / recorrência:** o `dealer_token` do painel de revenda
**não vem de tela de API key** — é capturado passivamente de uma
sessão logada e **pode ser invalidado** (rotação de senha do painel,
TTL de sessão). Se `renovacao-unitv-conta` voltar a dar `indisponivel`
com resposta rápida (200, ~1 s), repetir esta recaptura passiva +
`secrets set` (Supabase + GitHub). **Sem** teste de renovação real
nesta correção — nenhum ACEITO, cobrança ou `/api/account/renew`.

### 4.6.1 Análise read-only da dependência do token — CLASSIFICAÇÃO B (2026-08-29)

**Problema não está encerrado.** Substituímos o token, mas o *porquê*
da invalidação exigia análise. Feita 2ª captura passiva read-only na
sessão logada (`getDealerInfo` + `/api/account` + headers descriptografados;
nenhuma renovação, nenhum cadastro tocado):

- **O `dealer_token` É o token de sessão único do painel.** Valor de
  **32 chars hex** (formato MD5), e **idêntico** em três lugares da
  mesma requisição: header `Authorization`, header `token` **e** campo
  `dealer_token` do corpo. `m5..m7` = SAME. Não é JWT (0 pontos, sem
  payload `exp`).
- **Origem = login.** `getDealerInfo` **consome** o token (manda no
  corpo), não o emite — sua resposta (`dealerInfo`) só tem
  perfil/status (`user_name: inovatvstream2`, `customer: UniTV`,
  `status_title: Normal`, `package_objs`), **sem** campo de token nem
  de expiração. Só um **login novo** (usuário+senha) emite um token
  válido.
- **Sem refresh.** O painel não expõe `/api/refresh`, `/api/token`,
  nem tela de API key. Token curto-de-sessão, não credencial de longa
  duração.
- **2 invalidações observadas:** (a) 2026-08-16, troca de senha do
  painel (ação deliberada — encaixa em C); (b) **2026-08-29, o token
  capturado ~01:22 UTC funcionou às 02:12 e morreu entre 03:27 e
  12:22 UTC sem nenhuma ação nossa** (TTL de sessão / idle timeout /
  sessão única evictada por login em outro lugar / sweep do servidor).
  TTL exato **não medido**.

**Classificação: B (com componente C).** O token **expira/é rotacionado
de tempos em tempos** (horas-a-semanas, não medido) e **não há
mecanismo de refresh** — e qualquer troca de senha futura do painel
também o mata (componente C: parear troca de senha com recaptura).

**Detecção automática hoje (Q4): parcial e reativa.**
`renovacao-unitv-conta` mapeia token rejeitado → `outcome:"indisponivel"`
→ Orquestrador → `renovacao:*unitv_conta_indisponivel` → **transferência
humana + aviso ao José**. Mas: só dispara quando um cliente tenta
renovar UniTV (sem health check proativo); é indistinguível em código
de outage/rate-limit/rede (o `returnCode`/`errorMessage` literal é lido
1× e descartado, zero log); e num lote já pago o cliente fica no meio
do fluxo (Peça 3/watchdog reconciliam a cobrança, renovação ainda
precisa de conclusão manual).

**Opções para Q5 (nenhuma implementada — decisão de etapa própria):**
- **(i) Login automático no runner** — o job do GitHub Actions (já roda
  Playwright pro Sigma) loga em `panel-web.revenda.site` com secrets
  `UNITV_DEALER_LOGIN`/`UNITV_DEALER_SENHA`, captura o token fresco e
  usa/grava no secret. Remove o passo manual; adiciona secret de
  **senha** + dependência de automação de login (captcha/mudança de
  painel = nova falha).
- **(ii) Pré-flight de saúde + auto-refresh** — antes de cada renovação
  (ou agendado), `getDealerInfo` read-only com o token atual; se
  `returnCode != 0`, dispara (i) e retenta. "Morte silenciosa" vira
  "auto-cura com 1 retry".
- **(iii) Monitor sem auto-fix** — job agendado faz `getDealerInfo`
  read-only; em falha, **avisa o José** ("recapturar `UNITV_DEALER_TOKEN`")
  sem corrigir sozinho. Recaptura segue manual, mas **proativa** em vez
  de descoberta por falha de cliente.

**Critério de aprovação (do usuário) — NÃO atendido ainda:** a renovação
automática UniTV não pode depender de credencial que morre
silenciosamente sem estratégia definida. Estado atual = reativo
(descobre quando um cliente falha) + recaptura manual. Antes de
considerar a renovação UniTV **plenamente aprovada**, decidir entre
(i)/(ii)/(iii) — ou, no mínimo, (iii) + SOP de recaptura documentado.
**Pendência aberta, não bloqueia o que já está funcionando com o token
novo.**

**Ainda em aberto (read-only, sem renovação):** medir o TTL real —
capturar token, `getDealerInfo` a cada N min até falhar; distingue
idle-timeout de sessão-única-evictada de sweep. Não feito.

### 4.6.2 U1 concluído · U3/U4 inconclusivos · A × B (2026-08-29)

**U1 — proteção anti-bot do login `panel-web.revenda.site`: CONCLUÍDO.**
- **Sem Turnstile / reCAPTCHA / hCaptcha** — zero desafio JS de
  terceiros (verificado no DOM e no bundle de 1,9 MB). Só Cloudflare
  Insights (RUM, inócuo).
- Único obstáculo: **CAPTCHA de imagem próprio** — campo
  `form_item_validateCode`, PNG 240×80 embutido como `data:image/png;
  base64`, provável origem `POST /api/dealer-core/security/get-info`,
  botão "Eu não vejo" gera outro (grátis, sem throttle observado em
  ~8 refreshes).
- **Evidência visual real:** **4 dígitos numéricos**, grandes,
  separados, legíveis, praticamente sem ruído; formato client-side
  `[0-9]{4}` (confirmado — `ab12`/`abcd` rejeitados, `1234` aceito);
  exemplo `7052`. Cores aleatórias por dígito, irrelevantes após
  binarização. Medições: fundo ~92% branco, `isolatedDarkPx: 0` (zero
  speckle), `strikeLikeRows: 0` (zero linhas).
- **Reclassificação: CAPTCHA fraco / facilmente automatizável.**
  Template matching (10 templates de dígito) + refresh-até-alta-
  confiança (sem POST) → ~100% de CAPTCHA correto antes de qualquer
  login. Sem serviço pago, sem modelo pesado.

**U3 — como o login diferencia os erros: INCONCLUSIVO.**
- A validação client-side barra requisições malformadas antes do
  servidor (senha 8–16 com maiúscula+minúscula+dígito; CAPTCHA exato
  `[0-9]{4}`).
- O probe de submit foi **bloqueado pelo classificador de segurança**
  (submeter formulário de login = ação sensível). Decisão do usuário:
  **não fazer o probe de login agora**, nem com usuário falso.
- Consequência: não sabemos se o servidor retorna código distinto para
  "CAPTCHA errado" vs "credencial errada" vs "conta bloqueada".
  Mitigação de desenho: pré-validar o CAPTCHA localmente (alta
  confiança) → qualquer falha de login passa a ser tratada como
  **credencial/conta, não CAPTCHA** → parar + humano, nunca retentar
  "achando que foi o CAPTCHA".

**U4 — lockout / rate-limit: INCONCLUSIVO (só artefatos).**
- Bundle do frontend **não tem strings de lockout** ("locked",
  "lockout", "bloqueado", "too many attempts", "429", "retry-after" —
  ausentes). `dealerInfo` tem campo `status` (`1` = Normal) — estado,
  não mecanismo.
- Nenhuma doc do painel sobre política de login.
- **Presumir, conservadoramente, que há contador server-side.**

**Cap conservador proposto (para quando A for desenhada):**
- **≤ 2 POSTs de login por ciclo de autocura** (solve de CAPTCHA é
  ilimitado; POST de login não).
- Cooldown ≥ 2 h entre ciclos; teto global ≤ 6 POSTs / 24 h; espaçar
  30–60 s entre POSTs.
- 1ª falha com CAPTCHA de alta confiança → **parar o ciclo** (não usar
  o 2º POST); alerta URGENTE ao José.
- Kill-switch de config; **modo observação** (só solve, sem POST) na
  estreia, por N dias, para calibrar o template matching.
- Autocura só dispara quando o **monitor confirma token morto**
  (`getDealerInfo` `returnCode != 0`), nunca especulativo.

**A × B:**
- **B (obter/renovar token SEM login) — NÃO existe** pelo que se pôde
  determinar: sem endpoint de refresh, `getDealerInfo` consome e não
  emite, sem tela de API key, token 32-hex tem componente de sessão
  (mudou entre capturas → não é função pura). **Único lead não
  verificado:** "Lembrar-me" pode estender muito o TTL — checar read-
  only (exige observar 1–2 logins).
- **A (OCR/template + login automático controlado) — VIÁVEL** dado o
  CAPTCHA trivial, **desde que**: solve 100% desacoplado do POST; cap
  ≤ 2/ciclo + cooldown + kill-switch + modo observação; falha com
  CAPTCHA confiável → parar + humano; secrets novos
  `UNITV_DEALER_LOGIN` / `UNITV_DEALER_SENHA` (Supabase + GitHub) — o
  custo de A, que era o ponto de resistência.
- **Independente de A/B:** as partes que NÃO precisam de login —
  **monitor proativo** (`getDealerInfo` cron → detecta token inválido →
  avisa o José) e **gate pré-cobrança** (no ACEITO, para renovação com
  UniTV, validar o token com chamada read-only; inválido → não cria
  cobrança → encaminha para atendimento; válido → segue) — cobrem os
  Problemas "detectar" e "nunca perder renovação paga" **hoje**, sem
  senha e sem OCR. **A especificação técnica dessas duas partes NÃO
  foi escrita** (usuário interrompeu). É o primeiro trabalho concreto
  se a investigação de login concorrente / lockout mostrar que a
  autocura completa é arriscada.

**NÃO implementado nesta sessão:** OCR, login automático, secrets de
usuário/senha, monitor, gate pré-cobrança. Nenhum token/senha/secret
real registrado neste arquivo.

---

## 5. Outros itens abertos

1. **Segundo PIX `pendente`** — §0 (é a retomada).
2. **ChannelTV** — §4.5 (config Rocket: domínio novo + credenciais +
   "Painel id").
3. **Mensagem intermediária "renovação em andamento"** — commitada
   (`7f6cdc0`), não deployada — §4.4.
4. **Latência da mensagem final** — **pendência transversal de UX**,
   observada em: Sigma individual, Sigma lote, UniTV individual, UniTV
   2×lote, misto. É do **pipeline de resultado**
   (`renovacao-sigma-resultado` + callback do workflow), não específico
   de um tipo. **Investigar/corrigir no encerramento geral da
   Renovação Automática, buscando UMA solução para todo o pipeline —
   nunca patch por tipo de acesso.**
5. **Mensagem final de sucesso não gravada no histórico do Painel**
   (Frente A Sigma individual) — herdada do checkpoint anterior; causa
   confirmada, correção proposta não aplicada. Ver histórico do git
   (`5e829f4`) / commit anterior deste arquivo.
6. **`OPENPIX_APPID` ainda Sandbox** — trocar para produção só quando
   for operar pagamento real.
7. **N ≥ 3 no lote** — precificação já generaliza; gate
   `acessosLote.length !== 2` no `orchestrator` continua. Decisão de
   produto, não reabrir sem isso.

---

## 6. PRÓXIMOS PASSOS — nesta ordem (NÃO executar sem autorização própria da sessão)

1. **Investigar o PIX Sandbox pendente** (`d5241cc0` / pay
   `79d4aa6d…`) — §0. Só leitura: dashboard Woovi Sandbox + estado
   das tabelas.
2. **Investigar/configurar o ChannelTV no Sigma** — começar pelo
   **"Painel id"** do cliente `759334773` (decidir manter `loL7ZaZ1XM`
   ou reverter) **e** pela **autenticação/URL do servidor "ChannelTV"**
   na config de Revendas do Rocket (domínio novo `channeltvbr.store`,
   `/api/auth/login` retornando `Unauthenticated`). Comparar com
   NewOne/BLAZE.
3. **Validar novamente o comportamento Sigma** — um acesso Sigma que
   funcione (NewOne/BLAZE) para confirmar zero regressão do Bloco 4;
   e o ChannelTV depois da config corrigida.
4. **Deploy da mensagem intermediária "🔄 Renovação em andamento..."**
   — rodar as 23 suítes (todas verdes), depois
   `npx supabase functions deploy openpix-webhook --no-verify-jwt`;
   confirmar `openpix-webhook` v12+ em `functions list`. É o único
   deploy pendente.
5. **Investigar a latência da mensagem final** — uma solução única
   para o pipeline de resultado (`renovacao-sigma-resultado` +
   callback do workflow), nunca por tipo.
6. **Revisar a matriz final da Renovação Automática** — cenários
   restantes (misto com Sigma resolvido de verdade; combinações
   quando N ≥ 3 for liberado; produção OpenPix; persistência da
   mensagem final no Painel).

---

## 7. NÃO REABRIR / JÁ VALIDADO

Nenhum destes deve ser reinvestigado sem **evidência nova e concreta**:

- **Mecânica de renovação UniTV** — `POST /api/account/renew`, `sign`
  MD5, AES-128-CBC (chave/IV fixos do protocolo), envelope
  `{returnCode, errorMessage, jumpCode, data}` — **congelada**.
  Comprovada com PoC real (Pedido 013) + testes reais de hoje.
- **`scripts/lib/unitv-renovar.mjs`** — **não reestudar, não alterar.**
  É o executor congelado; o workflow só o chama.
- **Resolução SN → ID** (`renovacao-unitv-conta` / `resolverContaUnitv`,
  gêmeo Deno em `_shared/unitv_conta.ts`) — cross-check byte-a-byte
  com o executor congelado; **comprovada**.
- **Renovação UniTV individual** — **comprovada em produção**
  (Sandbox), 2026-08-29 (Karla Filha, 21/09 → 22/10/2026).
- **Lote 2×UniTV** — **comprovado em produção** (Sandbox), 2026-08-29
  (R$ 35 + R$ 35 = R$ 70, ambos +1 mês, ambos sincronizados).
- **Lote misto Sigma + UniTV** — a **execução conjunta** está
  comprovada: os dois tipos no mesmo `processarLote`, callback único
  com `resultados[]` misto, `processarResultadoLote` derivando
  `parcial`, UniTV concluindo independente da falha do Sigma. A falha
  do ChannelTV é **config/dados** (§4.5), **não** arquitetura do lote.
- **Gap 1 e Gap 3** — fechados por teste
  (`renovacao_sigma_workflow_misto`; `renovacao_sigma_resultado_unitv`
  C6/C7/C8).
- **Falha `resolverIdInterno`** (Ciclo 2, Etapa 1) — corrigida
  (`3bce8ff`, `72e7e20`) e validada.
- **Preço do lote** — soma dos valores reais do Rocket; sem regra
  comercial; sem R$ 30 fixo.
- **Migration `20260829120000_renovacoes_lote.sql`** — aplicada e
  auditada.
- **Assimetria lote×individual na resolução UniTV** — corrigida
  (`8f9c31d`, fallback `/match` no laço do lote; teste V3 de
  regressão).

**Regra de investigação — `renovacao-unitv-conta` = `indisponivel`
(2026-08-29, §4.6):** a recaptura do `UNITV_DEALER_TOKEN` foi
necessária porque **o painel de revenda invalidou o token anterior**
(o `dealer_token` não vem de tela de API key; é capturado de sessão
logada e tem validade limitada — rotação de senha / TTL). Se a
resolução UniTV voltar a retornar `indisponivel` (resposta rápida,
HTTP 200 ~1 s), **a primeira hipótese é token inválido** — refazer a
recaptura passiva + `secrets set` (Supabase + GitHub), **antes de
cogitar qualquer alteração de código** na mecânica UniTV (que segue
congelada).

---

## 8. Ao retomar (outra máquina, amanhã)

1. Ler este arquivo inteiro. Frase de retomada sugerida ao Claude:
   *"Leia o checkpoint de continuidade e vamos retomar exatamente do
   PONTO EXATO DA RETOMADA. Não reabra o que já foi validado."*
2. `git fetch origin && git status` nas pastas do ecossistema
   (`inovatv_central`, `inovatv-api-intermediaria`, `inovatv_painel`).
   Regra permanente: `inovatv_central/CLAUDE.md`, seção 0.
3. `git log --oneline -8` aqui — esperar `57effb1` (+ o commit de docs
   deste checkpoint) no topo, `main == origin/main`.
4. `npx supabase functions list` — conferir contra §2.
   `npx supabase link --project-ref nduxsuxkopuvhwugdkqi` se ainda não
   linkado nesta máquina.
5. **Primeira ação: §0** (investigar o PIX Sandbox pendente).
6. **Nenhuma ação real** (mensagem WhatsApp, clique, cobrança,
   pagamento, novo dispatch do workflow, migration executada, `git
   push`, deploy) sem autorização explícita própria da sessão — a
   aprovação de um bloco de código/deploy nunca implica autorização
   para a próxima ação sensível (`inovatv_central/CLAUDE.md`, seção 0-B).

---

## 9. Contexto histórico (referência, não ação)

- `docs/renovacao_automatica/ENCERRAMENTO_ETAPA1_LOTE.md` — Etapa 1
  (lote Sigma) completa.
- `docs/renovacao_automatica/PLANO_MESTRE_IMPLEMENTACAO.md` — Lacunas
  1-10.
- `docs/renovacao_automatica/SESSAO_ROCKET_MONITORAMENTO.md` —
  reconhecimento dos painéis Sigma (NewOne validado; Blaze/ChannelTV
  pendentes).
- `docs/renovacao_automatica/levantamentos/2026-08-21_renovacao_automatica_painel_primeiro.md`
  — mecanismo `/sigma/info/` + `/sigma/packages/` + `POST /pagamento/add/`
  (`renovar_painel=true` + `sigma_package_id`); o bug do "Painel id"
  do NewOne (era URL, corrigido para `K4WrbeQ3We`).
- `docs/unitv/` — investigação e teste real da mecânica UniTV
  (congelada).
- `docs/propor_renovacao/` — contrato do Gemini, resolução de acesso,
  persistência de seleção.
