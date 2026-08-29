# NEXT_SESSION.md — Checkpoint de continuidade

> **Atualizado: 2026-08-29 (fim do dia) — Etapa 2 (Renovação UniTV)
> implementada e implantada; UniTV validado em produção (Sandbox);
> lote misto Sigma+UniTV com a execução conjunta comprovada e a falha
> do ChannelTV isolada.** Substitui integralmente a versão anterior
> (encerramento da Etapa 1, 2026-08-28). Leia este arquivo inteiro
> antes de qualquer ação. Decisões encerradas estão em **[FECHADO]**
> ou na seção **"NÃO REABRIR / JÁ VALIDADO"** — não reabrir sem
> evidência nova e concreta.

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

### Pendências desta frente
- Deploy da correção de UX (`orchestrator` + `mensagens_fixas.ts`).
- Endurecer `openpix-webhook` para não ignorar silenciosamente eventos
  ≠ `CHARGE_COMPLETED` (a raiz do `d5241cc0`) — não iniciado.
- Retry / distinção de erro do painel UniTV — adiado.
- Limpeza do estado travado do `d5241cc0` (cobrança `pendente` +
  lote/tokens `autorizada` antigos) — a Peça 3 agora resolve isso
  automaticamente no próximo ciclo do watchdog (janela `expira_em`), mas
  não foi verificado ao vivo.

---

## 0. PONTO EXATO DA RETOMADA

**Primeira ação amanhã (só leitura, nenhuma ação real sem autorização
própria):**

> **Investigar o segundo PIX que ficou `pendente`** — o fluxo de teste
> das ~03:35 UTC de 2026-08-29 gerou uma cobrança que **nunca foi
> confirmada** pelo nosso sistema:
> - `cobrancas_pix.operacao_id = d5241cc0-3a46-401a-bbed-4a00ce3dd8c2`,
>   `status = pendente` (criada 03:35:22 UTC).
> - PIX pay URL: `https://woovi-sandbox.com/pay/79d4aa6d-ed2e-47b5-afe2-222a5b38422c`
>   (`79d4aa6d…` = id da charge na Woovi; `d5241cc0…` = nosso
>   `operacao_id`/`correlationID`).
> - `renovacoes_lote` desse fluxo: `estado = autorizada` (não avançou).
> - **Nenhum workflow run novo** (`gh run list --workflow=renovacao-sigma.yml`
>   confirma só `33231493655` de 03:28:48).
> - `conversas_estado` da conversa `43fcff07-80e5-4d0a-b814-62323ef6c3a9`
>   voltou a `normal`.
>
> **Hipótese:** o webhook `OPENPIX:CHARGE_COMPLETED` dessa cobrança
> não chegou ao `openpix-webhook` (ou o pagamento simulado no painel
> Woovi Sandbox não foi concluído). Checar no dashboard da Woovi
> Sandbox: a cobrança consta paga? o webhook foi disparado/entregue?
> URL configurada (`https://nduxsuxkopuvhwugdkqi.supabase.co/functions/v1/openpix-webhook`),
> tentativas, código de resposta. Se paga lá e `pendente` aqui →
> problema de entrega/assinatura de webhook, não do fluxo de lote.

---

## 1. Estado do git (2026-08-29)

Os três repositórios: **`HEAD == origin/main`, working tree limpo,
`0 0` ahead/behind.**

| Repositório | HEAD | Último commit |
|---|---|---|
| `inovatv-api-intermediaria` | `57effb1` | Fecha Gap 1 e Gap 3 do lote misto Sigma+UniTV (so testes) |
| `inovatv_central` | `ce61faa` | Registra 2xUniTV lote VALIDADO + correcao da assimetria lote/individual + latencia como pendencia transversal de UX |
| `inovatv_painel` | `ccb31be` | Remove 3 colunas nao usadas de apps (Database ja limpo) |

`inovatv_meta_business_agent` — **não existe mais nesta máquina**
(descontinuado; conteúdo já migrado).

### Cadeia de commits desta frente (do checkpoint anterior até hoje)

```
5e829f4  Docs: encerramento da Etapa 1 (checkpoint anterior)
8c02568  Etapa 2 Bloco 1 — fundação: executor do painel UniTV (scripts/lib/unitv-renovar.mjs, CONGELADO)
         + _shared/rocket_vencimento.ts + EF renovacao-rocket-vencimento
c8732e0  Etapa 2 Bloco 2 — expõe `usuario` no contrato Rocket/status
ffa2f26  Etapa 2 Bloco 3 — criação/adequação do token UniTV (tipo/unitv_sn/unitv_id) + EF renovacao-unitv-conta
74aca2c  Etapa 2 Bloco 4 — integração completa (commit único, sem janela "cobra e cai no stub"):
         roteamento no orchestrator (individual + lote) + executor no workflow + resultado + .yml env
8f9c31d  Corrige assimetria lote×individual na resolução UniTV: fallback /match no laço do lote  → orchestrator v56
7f6cdc0  Adiciona mensagem intermediária "🔄 Renovação em andamento..." no openpix-webhook  → NÃO DEPLOYADO
57effb1  Fecha Gap 1 e Gap 3 do lote misto Sigma+UniTV (só testes; nada a deployar)
```

Diretórios não versionados que permanecem no disco (pré-existentes,
não tocar): `scripts/.interactive-test-harness/`, `scripts/supabase/`,
`supabase/functions/poc-sigma-renovacao-real/`.

---

## 2. Edge Functions — versões deployadas em produção (2026-08-29)

Projeto Supabase: `nduxsuxkopuvhwugdkqi` (`inovatv-api-intermediaria`,
`sa-east-1`). Já `--linked` nesta máquina; na outra máquina rodar
`npx supabase link --project-ref nduxsuxkopuvhwugdkqi` primeiro.

```
orchestrator                v56  jwt=OFF   ✅ = HEAD (74aca2c + 8f9c31d)
renovacao-sigma-resultado   v10  jwt=OFF   ✅ = HEAD (74aca2c — rocketDesync)
renovacao-unitv-conta       v1   jwt=OFF   ✅ = HEAD (Bloco 3/4) — EF NOVA
renovacao-rocket-vencimento v1   jwt=OFF   ✅ = HEAD (Bloco 1) — EF NOVA
status                      v31  jwt=ON    ✅ = HEAD (c8732e0 — `usuario`)
renovacao-confirmar         v10  jwt=OFF   ✅
renovacao-sigma-contexto    v7   jwt=OFF   ✅
renovacao-sigma-cliente     v4   jwt=OFF   ✅
renovacao-sigma-watchdog    v9   jwt=OFF   ✅
confirmacao-renovacao       v9   jwt=OFF   ✅ (fallback dos links antigos)
webhook                     v17  jwt=OFF   ✅
match                       v27  jwt=ON    ✅
openpix-webhook             v11  jwt=OFF   ❌ NÃO tem 7f6cdc0 (mensagem intermediária) — ver §4
```

Outras (não relacionadas a esta frente): `painel-atendimento-*`
v21-23, `atualizar-sessao-rocket` v12, `monitorar-sessao-rocket` v12,
`diag-cobrancas-pix` v8, `teste-patch-renovacao-newone` v16,
`poc-*` (descartáveis), `fase3-mock` v27.

**Workflow GitHub Actions** `renovacao-sigma.yml` + o script
`scripts/renovacao-sigma-workflow.mjs`: rodam a partir do checkout de
`origin/main` (`57effb14`) — **já refletem o Bloco 4** (branch UniTV
em `processarLote` + `renovarUmAcessoUniTVComSync` + env
`UNITV_DEALER_*`). Não há "deploy" deles.

### Função com código commitado ainda NÃO em produção

- **`openpix-webhook`** — prod `v11`. O commit `7f6cdc0` (mensagem
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
