# NEXT_SESSION.md — Checkpoint de continuidade

> **Atualizado: 2026-08-28 (fim do dia) — encerramento da Etapa 1
> (Renovação em Lote).** Substitui integralmente a versão anterior
> ("pós-Ciclo 3"). Leia este arquivo inteiro antes de qualquer ação.
> Todas as decisões já encerradas estão marcadas como **[FECHADO]** —
> não reabrir sem motivo novo e concreto.

---

## 0. Estado consolidado — as duas frentes

### Frente A — Renovação Sigma individual (1 acesso), ponta a ponta

**[VALIDADA EM PRODUÇÃO]** — Ciclo 3 (28/08 manhã) fechou o fluxo
completo: WhatsApp real → proposta interativa → ACEITO → 1 cobrança
OpenPix (Sandbox) → pagamento → `openpix-webhook` → GitHub Actions
"Renovação Sigma" (Playwright no painel do Rocket) → reconsulta
independente → `renovacao-sigma-resultado` → token terminal
`renovado`, **`expires_at` do Sigma efetivamente +1 mês**, mensagem
"✅ Pagamento confirmado!" recebida no WhatsApp do cliente.

- A falha `resolverIdInterno` do Ciclo 2 **[FECHADO]** — corrigida em
  `3bce8ff` (resolve o id interno pelo DOM renderizado do Playwright)
  + `72e7e20` (seletor `[data-bs-target="#modal-add-pagamento"][cliente_id]`
  para a UI atual do Rocket). Nova Edge Function `renovacao-sigma-contexto`
  (`ae89969`) tira todas as leituras runner→Rocket de trás de uma
  função interna. **Não reinvestigar.**
- **Item aberto (pequeno):** a mensagem final "✅ Pagamento
  confirmado!" é enviada ao cliente mas **não é gravada** em
  `mensagens_conversa` — o Painel de Atendimento mostra só a linha de
  sistema `Resultado da renovação Sigma: sucesso`. Mesmo gap no
  caminho de falha (`_shared/notificacao_transferencia.ts` envia
  `MENSAGEM_TRANSFERENCIA_CLIENTE` sem `inserirMensagem`). **Causa
  confirmada** (investigação read-only, 28/08): em
  `supabase/functions/renovacao-sigma-resultado/index.ts`, o ramo
  `resultado === "sucesso"` chama só `enviarTemplateWhatsApp(...)`, sem
  `inserirMensagem(...)` para esse texto. `listarMensagens` /
  `painel-atendimento-abrir` **não filtram** por `origem` — nada
  esconde, simplesmente não é inserido. **Correção proposta (NÃO
  aplicada):** após `enviarTemplateWhatsApp` bem-sucedido, gravar
  `inserirMensagem(conversation_id, "ia", <texto>, null)` (ou
  `"sistema"` — decidir); idem para `MENSAGEM_TRANSFERENCIA_CLIENTE`
  no caminho de falha. Decidir se persiste o texto renderizado ou os
  parâmetros do template.

### Frente B — Renovação em Lote (múltiplos acessos) = Etapa 1

**[ENCERRADA]** — ver documento completo:
`docs/renovacao_automatica/ENCERRAMENTO_ETAPA1_LOTE.md` (decisões,
arquitetura, UX final, segurança, migration, deploy, testes, teste
real). Resumo:

- **Fluxo:** telefone com 2 acessos + intenção de renovar → lista →
  `0` (ou "os dois"/"ambos"/"todos") → **uma** confirmação de lote →
  ACEITO → **uma** cobrança OpenPix pelo total → **um** pagamento →
  GitHub Actions renova cada filho no Sigma → **uma** mensagem
  consolidada. Seleção `1`/`2` continua indo pelo fluxo individual.
- **Preço do lote — [FECHADO]: NÃO é fixo.** Não existe regra
  comercial de lote. Cada acesso usa o **seu valor real do Rocket**
  (`/status` → `valor`); o **total é a soma exata** desses valores.
  Ex.: **30+30=60, 35+35=70, 30+50=80**. `resolverPrecoLote`
  (`_shared/precos_renovacao.ts`) só soma o que recebe;
  `regraAplicada` = rótulo interno `"soma_valores_rocket"` (nunca vai
  ao cliente); retorna `null` só se há < 2 acessos ou algum acesso sem
  valor real (→ fallback, nunca inventa valor).
- **⚠️ O teste real de R$ 60 (28/08) NÃO valida preço fixo de R$ 30.**
  Rodou contra `orchestrator` **v50**, que ainda tinha a regra fixa
  antiga (R$ 30/acesso). Como os 2 acessos valem R$ 35, o correto é
  **R$ 70**. Esse teste validou o **fluxo** ponta a ponta, **não a
  precificação** — corrigida depois em `8c5037f`.
- **Limite operacional — [FECHADO]:** lote **só para exatamente 2
  acessos** (gate `acessosLote.length !== 2` no `orchestrator`). A
  precificação já generaliza N ≥ 2, mas **N ≥ 3 não é oferecido
  agora** (decisão do usuário). Não liberar sem decisão de produto
  nova.
- **UX final da lista — [FECHADO]:** cada bloco = título numerado →
  `Usuário:` → `Servidor:` → `Plano:` → **`📅 Vencimento: DD/MM/AAAA`**
  (do `/status`, fuso `America/Sao_Paulo`; fallback
  `📅 Vencimento: não informado`) → `💰 Valor: R$ X` (fallback
  `💰 Valor: não informado`). Separador entre blocos, nunca após o
  último. Última linha: `Digite o número do acesso, ou *0* para
  renovar {os dois | todos os N}.` Ordem dos acessos **determinística**
  (`ordenarAcessosMultiplos`: servidor → nome → publicId), idêntica na
  lista, na seleção numérica e no lote.
- **UniTV — [FECHADO para a Etapa 1]:** o **roteamento** por tipo de
  acesso está pronto (`_shared/tipo_acesso.ts` →
  `classificarTipoAcesso`), mas a **renovação automática de UniTV NÃO
  foi implementada** — é escopo da Etapa 2. Acesso UniTV individual →
  mensagem fixa `MENSAGEM_RENOVACAO_UNITV_NAO_INTEGRADA` +
  transferência humana, **sem token, sem cobrança**. Lote com qualquer
  UniTV → **nenhum lote**, mensagem `MENSAGEM_RENOVACAO_LOTE_COM_UNITV`
  + transferência. Heurística conservadora: `'unitv'` só quando o
  servidor normalizado é exatamente `"UNITV"`; qualquer dúvida →
  `'sigma'`.
- **Migration `20260829120000_renovacoes_lote.sql` — [APLICADA em
  produção]** (manual, via `supabase db query --linked -f`, registrada
  em `schema_migrations`, pós-auditoria OK). `renovacoes_lote` (capa) +
  `tokens_renovacao` `+grupo_id/tipo/unitv_sn/unitv_id` (`public_id`
  NULL-able) + `cobrancas_pix` `+grupo_id`.
- **Teste real 2 acessos Sigma — [SUCESSO ponta a ponta]** (28/08,
  telefone `5517981625486`, BLAZE + NewOne, pagamento Sandbox). 1
  lote / 1 cobrança / 2 filhos / 1 PIX (link Woovi, sem BR Code) / 1
  mensagem consolidada; ambos os vencimentos +1 mês no Rocket
  confirmados ao vivo. Detalhe em `ENCERRAMENTO_ETAPA1_LOTE.md` §8.
- **Resíduo de teste — [TRATADO]:** token `b2563a7e-…` (Sandbox
  pré-lote, preso em `autorizada`) → `renovacao_falhou` +
  `motivo_falha`; cobrança `6dd1435f-…` → `cancelada`. Linhas
  preservadas, sem chamada externa.

---

## 1. Estado do git

- **Branch:** `main`. **HEAD:** `8c5037f` (após o commit deste
  checkpoint, o HEAD será o commit de documentação que vem logo
  depois — confirmar com `git log --oneline -3`).
- Cadeia recente:
  `844e101` (UX: PIX em bloco, lista determinística) →
  `101620f` (Etapa 1 — lote + UX) →
  `68caca1` (Etapa 1.5 — roteamento UniTV + ordem determinística) →
  `8c5037f` (lote: preço = soma dos valores reais + linha de
  vencimento) →
  `<commit de docs deste checkpoint>`.
- **Working tree limpo** ao encerrar (confirmar `git status`).
- Diretórios não versionados que permanecem no disco (pré-existentes,
  não tocar): `scripts/.interactive-test-harness/`, `scripts/supabase/`,
  `supabase/functions/poc-sigma-renovacao-real/`.

---

## 2. ⚠️ DEPLOY PENDENTE — primeira ação da próxima sessão

**`main` está À FRENTE da produção.** O `orchestrator` em produção é
**v50** (checkpoint `101620f` / `844e101`). Os commits abaixo estão em
`origin/main` mas **NÃO foram deployados**:

| commit | o que muda no `orchestrator` |
|---|---|
| `68caca1` | roteamento por tipo de acesso (UniTV nunca entra no fluxo Sigma; lote com UniTV não é criado); ordem determinística `ordenarAcessosMultiplos` na lista/seleção/lote |
| `8c5037f` | preço do lote = **soma dos valores reais** (fim do R$ 30 fixo); linha **`📅 Vencimento`** na lista de múltiplos acessos |

**Enquanto não deployar, a produção ainda cobra R$ 30/acesso fixo no
lote e a lista não mostra vencimento.**

Ação: revisar o diff de `supabase/functions/` entre `844e101..HEAD`,
rodar as 13 suites (`for d in scripts/testes/*/; do npx tsx
"${d}teste.mjs"; done` — todas verdes é pré-requisito), e deployar
**só o `orchestrator`** (`_shared` vai junto por ser bundlado):

```
npx supabase functions deploy orchestrator --no-verify-jwt
```

Nenhuma outra função mudou nesses dois commits. Nenhuma migration
nova. Confirmar `orchestrator` v51 (ou maior) em `supabase functions
list` depois.

---

## 3. Versões deployadas em produção (2026-08-28)

```
orchestrator            v50   jwt=OFF   <-- será v51+ após o deploy pendente
webhook                 v14   jwt=OFF
openpix-webhook         v8    jwt=OFF
confirmacao-renovacao   v6    jwt=OFF
renovacao-confirmar     v7    jwt=OFF
renovacao-sigma-resultado v6  jwt=OFF
renovacao-sigma-watchdog  v6  jwt=OFF
renovacao-sigma-contexto  v4  jwt=OFF
renovacao-sigma-cliente   v1  jwt=OFF
status                  v27   jwt=ON
```

Projeto Supabase: `nduxsuxkopuvhwugdkqi` (`inovatv-api-intermediaria`,
região `sa-east-1`). Já `--linked` nesta máquina; na outra máquina,
`npx supabase link --project-ref nduxsuxkopuvhwugdkqi` primeiro.

---

## 4. Itens abertos (reais) e itens fechados (não reabrir)

### Abertos

1. **Deploy pendente** (`68caca1` + `8c5037f`) — seção 2. Prioridade.
2. **Mensagem final de sucesso não gravada no histórico do Painel**
   (Frente A) — causa confirmada, correção proposta não aplicada
   (seção 0, Frente A). Vale para o caminho de sucesso E o de falha.
3. **OpenPix/Woovi ainda em Sandbox** — o link/cobrança dos testes
   apontam para `api.woovi-sandbox.com`. Trocar o secret
   `OPENPIX_APP_ID` para a credencial de produção **antes** de
   qualquer teste com pagamento real. Não é bug do fluxo.

### Fechados — NÃO tratar como pendência

- **Falha `resolverIdInterno`** (Ciclo 2) — corrigida (`3bce8ff`,
  `72e7e20`) e validada no Ciclo 3.
- **Preço do lote** — decidido: soma dos valores reais do Rocket, sem
  regra comercial, sem R$ 30 fixo.
- **Lote limitado a 2 acessos** — decidido: N ≥ 3 não é oferecido
  agora.
- **Roteamento UniTV** — feito; a **renovação** UniTV é Etapa 2
  (frente própria), não pendência da Etapa 1.
- **Resíduo Sandbox `b2563a7e-…`** — limpo (token `renovacao_falhou`,
  cobrança `cancelada`).
- **Migration `20260829120000_renovacoes_lote.sql`** — aplicada e
  auditada.

---

## 5. Próximas frentes (NÃO iniciar agora — esta máquina encerra aqui)

- **Deploy pendente** (seção 2) — é continuidade da Etapa 1, primeira
  coisa a fazer.
- **Etapa 2 — renovação automática de UniTV:** executor real no painel
  de revenda; preencher `unitv_sn`/`unitv_id`; preço do crédito de
  revenda (não há BRL por transação). Nada implementado.
- **Persistência da mensagem final no Painel** (item aberto 2) —
  correção pequena, decisão de `"ia"` vs `"sistema"` pendente.
- **Provedor OpenPix de produção** (item aberto 3).
- **Lote de N ≥ 3** — a precificação já suporta; falta decisão de
  produto para remover o gate `!== 2`.

---

## 6. Ao retomar em outra sessão/máquina

1. Ler este arquivo inteiro + `docs/renovacao_automatica/ENCERRAMENTO_ETAPA1_LOTE.md`.
2. `git fetch origin && git status` nas 4 pastas do ecossistema
   (`inovatv_central`, `inovatv-api-intermediaria`, `inovatv_painel`,
   e `inovatv_meta_business_agent` **se ainda existir** — está em
   descontinuação). Regra permanente: `inovatv_central/CLAUDE.md`,
   seção 0.
3. `git log --oneline -5` aqui — esperar `8c5037f` + o commit de docs
   deste checkpoint no topo, `main == origin/main`.
4. `npx supabase functions list` — conferir as versões da seção 3.
5. **Primeira ação: o deploy pendente (seção 2).** Revisar diff,
   rodar as 13 suites, deployar `orchestrator`, confirmar a nova
   versão.
6. **Nenhuma nova ação real** (mensagem WhatsApp, clique, cobrança,
   pagamento, novo dispatch do workflow, migration executada, `git
   push`) sem autorização explícita própria da sessão — a aprovação
   de um bloco de código/deploy nunca implica autorização para a
   próxima ação sensível (`inovatv_central/CLAUDE.md`, seção 0-B).

---

## 7. Contexto histórico (referências, não ação)

- `docs/renovacao_automatica/PLANO_MESTRE_IMPLEMENTACAO.md` — plano
  geral da renovação automática (Lacunas 1-10).
- `docs/propor_renovacao/` — levantamento e achados do `propor_renovacao`
  (contrato do Gemini, resolução de acesso, persistência de seleção).
- `NEXT_SESSION_PAINEL_HANDOFF.md` (19/08) — handoff antigo do Painel
  de Atendimento; **superado** para a frente de renovação por este
  arquivo. Consultar só para histórico do Painel.
- Bloco 1 (PagBank → OpenPix/Woovi) e Bloco 2 (confirmação por botões
  interativos do WhatsApp) — implementados e implantados antes deste
  checkpoint; `renovacao-confirmar` v7, `webhook` v14 já refletem.
