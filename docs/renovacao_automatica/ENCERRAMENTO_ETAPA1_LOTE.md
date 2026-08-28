# Encerramento — Etapa 1: Renovação em Lote (múltiplos acessos)

> **Status: ENCERRADA (2026-08-28).** Fluxo completo implementado,
> migration aplicada em produção, deploy do checkpoint base feito,
> testes automatizados verdes e **teste real de 2 acessos Sigma
> executado de ponta a ponta com sucesso** (pagamento Sandbox, ambos
> os acessos renovados no Rocket). Dois ajustes finais (preço = soma
> dos valores reais + linha de vencimento na lista) commitados; o
> deploy desses dois ajustes fica para a próxima sessão (ver
> `NEXT_SESSION.md`, seção "Deploy pendente").

Documento de referência única do que foi decidido, construído e
validado na Etapa 1. Nenhuma decisão aqui é pendência — o que ainda
não foi feito está claramente marcado como "fora da Etapa 1".

---

## 1. O que a Etapa 1 entrega

Quando um telefone tem **2 acessos** no Rocket e o cliente demonstra
intenção de renovar, a IA apresenta a lista dos acessos. O cliente
pode:

- **Digitar `1` ou `2`** → renova aquele acesso, sozinho, pelo fluxo
  individual já existente (proposta interativa ACEITO/CANCELAR → 1
  cobrança PIX → 1 pagamento → execução Sigma → confirmação).
- **Digitar `0`** (ou "os dois" / "ambos" / "todos") → **renovação em
  lote**: uma única confirmação, uma única cobrança PIX pelo total, um
  único pagamento, e a execução Sigma de cada acesso do lote.

O lote é **um grupo**: 1 linha de capa (`renovacoes_lote`) + N filhos
(`tokens_renovacao` com `grupo_id`), 1 cobrança OpenPix para o total,
1 pagamento. Cada filho mantém seu próprio `token_hash`, estado e
resultado de renovação; a capa deriva o estado do conjunto dos filhos.

---

## 2. Preço do lote — NÃO é fixo

> **Registro explícito, por decisão do usuário (2026-08-28):** o preço
> do lote **não** é R$ 30,00 por acesso e **não existe nenhuma regra
> comercial de lote** (sem valor fixo, sem desconto, sem "promoção").

**Cada acesso incluído no lote usa o SEU valor real retornado pelo
Rocket** (campo `valor` do `/status`, o mesmo valor que a lista de
múltiplos acessos mostra ao cliente). O **total é a soma exata** desses
valores — nada é recalculado.

| acessos | total |
|---|---|
| R$ 30 + R$ 30 | **R$ 60** |
| R$ 35 + R$ 35 | **R$ 70** |
| R$ 30 + R$ 50 | **R$ 80** |
| valores diferentes quaisquer | soma dos dois |

- `_shared/precos_renovacao.ts` → `resolverPrecoLote(acessos)`: recebe
  o `valorCentavos` real de cada acesso, devolve
  `valorPorAcessoCentavos` (os valores reais, na ordem) e
  `totalCentavos` (a soma). `regraAplicada` passou a ser o rótulo
  interno de auditoria `"soma_valores_rocket"` — nunca vai ao cliente.
- Retorna `null` **apenas** quando há menos de 2 acessos ou algum
  acesso sem valor real utilizável (Rocket devolveu vazio/inválido) —
  nesse caso o Orquestrador cai no fallback de pedir 1 acesso. Nunca
  inventa valor.
- O `orchestrator` passa `paraCentavos(s.cliente.valor)` ao resolvedor;
  a cobrança OpenPix recebe **exatamente** `lote.valor_total_centavos`
  (`_shared/renovacao_confirmacao.ts` usa esse campo direto, sem
  recomputar); a confirmação exibe o valor real por acesso + o total;
  cada filho grava seu `valor_esperado_centavos` real.

### ⚠️ O teste real anterior de R$ 60 NÃO valida preço fixo de R$ 30

O primeiro teste real de 2 acessos Sigma (BLAZE + NewOne, 28/08) rodou
contra o `orchestrator` **v50**, que ainda tinha a versão antiga de
`resolverPrecoLote` (regra fixa: R$ 30,00 por acesso → R$ 60,00). Como
os dois acessos valem R$ 35,00 no Rocket, o correto seria **R$ 70,00**.

**Esse teste validou o FLUXO** (lista → `0` → confirmação única →
ACEITO → 1 cobrança OpenPix → 1 link PIX → pagamento → webhook →
GitHub Actions → execução Sigma dos 2 filhos → `renovacao_concluida`
em cada um → mensagem consolidada), **não a precificação** — a
precificação estava errada no momento do teste e foi corrigida depois
(commit `8c5037f`). Qualquer leitura desse teste como "R$ 30 por
acesso confirmado" está **incorreta**.

### Limite operacional: exatamente 2 acessos

A precificação já **generaliza para N ≥ 2** (a função só soma o que
recebe, não conhece N). Mas a **operação de lote continua limitada a
EXATAMENTE 2 acessos** por um gate no Orquestrador
(`acessosLote.length !== 2` → fallback "escolha 1"). N ≥ 3 **não** é
oferecido agora. Isso é um limite operacional deliberado, **não** uma
regra de preço — decisão do usuário (2026-08-28): "a precificação pode
continuar generalizada para N ≥ 2, mas a operação de lote permanece
limitada a exatamente 2 acessos. Não liberar N ≥ 3 agora."

---

## 3. UX final da lista de múltiplos acessos

Mensagem enviada quando há 2+ acessos e intenção de renovar, sem acesso
citado (`montarMensagemMultiplosAcessosRenovacao`, `_shared/mensagens_fixas.ts`):

```
📋 *Seus acessos*

*1. Meu Uso Testes*
Usuário: 828667229
Servidor: BLAZE
Plano: Mensal
📅 Vencimento: 13/10/2026
💰 Valor: R$ 35,00

─────────────────

*2. Js Informática Rp*
Usuário: 2715749553
Servidor: NewOne
Plano: Mensal
📅 Vencimento: 08/03/2027
💰 Valor: R$ 35,00

Qual desses acessos você gostaria de renovar?

Digite o número do acesso, ou *0* para renovar os dois.
```

- **Ordem de cada bloco:** título numerado em negrito → `Usuário:` →
  `Servidor:` → `Plano:` → `📅 Vencimento:` → `💰 Valor:` (Valor é
  sempre a última linha).
- **`📅 Vencimento: DD/MM/AAAA`** — linha adicionada na Etapa 1
  (commit `8c5037f`). Usa o `vencimento` que o `/status` já retorna
  (nenhuma consulta nova), formatado no fuso `America/Sao_Paulo`.
  Fallback **`📅 Vencimento: não informado`** quando o `/status` não
  devolve vencimento. Cada acesso mostra o seu — nunca vaza para outro
  bloco.
- **`💰 Valor: R$ X`** — valor real do próprio acesso (`/status`),
  fallback `💰 Valor: não informado`.
- **Separador `─────────────────`** entre blocos, nunca após o último.
- **Última linha:** `Digite o número do acesso, ou *0* para renovar
  {rótulo}.` — `{rótulo}` é "os dois" quando N=2, "todos os N" caso
  contrário.

### Seleção

- **Número `1`..`N`** → seleciona o acesso **naquela posição da
  lista**. A ordem é **determinística** (`ordenarAcessosMultiplos`:
  `servidorNome` → `nome` → `publicId`), aplicada de forma idêntica na
  montagem da lista, na seleção numérica e no lote — então a posição
  N é sempre o mesmo acesso mesmo que o `/match` devolva os candidatos
  em ordem diferente entre a mensagem da lista e a mensagem da escolha.
  O acesso escolhido entra no fluxo individual (proposta interativa),
  sem nenhuma lógica de cobrança nova.
- **`0`** (ou "os dois" / "ambos" / "todos", regex `REGEX_SELECAO_LOTE`)
  → renovação em lote dos 2 acessos.
- **Número fora de `1`..`N`** → não é seleção; a lista é re-enviada.
- **`0`/número sem intenção de renovar demonstrada** → não sequestra
  o fluxo; a resposta do Gemini segue normal.

### Confirmação do lote

```
📋 *Confira sua renovação*

Você vai renovar 2 acessos:

*1. Meu Uso Testes*
🖥️ BLAZE · 📦 Mensal
💰 R$ 35,00

*2. Js Informática Rp*
🖥️ NewOne · 📦 Mensal
💰 R$ 35,00

💰 *Total: R$ 70,00*

Toque em *ACEITO* para gerar o PIX, ou em *CANCELAR* para desistir.
```

- Uma **única** confirmação interativa, botões **ACEITO / CANCELAR**
  (ids `renovacao:aceitar:<token_hash>` / `renovacao:cancelar:<token_hash>`
  da capa do lote).
- Valor real por acesso + **Total = soma**. Nunca cita "promoção" ou
  "desconto".

### Mensagem PIX (após ACEITO)

- Mensagem intermediária fixa: `"Certo! Vou preparar seu pagamento via
  Pix. Só um momento..."`
- Depois, **uma única** mensagem PIX com o **link da Woovi**
  (`paymentLinkUrl`), **sem BR Code / copia-e-cola** no corpo, com o
  valor total e a quantidade de acessos. O `qr_code_texto` (EMV) é
  gravado em `cobrancas_pix` mas nunca enviado ao cliente.

### Cancelamento / mensagens fixas

Textos de cancelamento, "já existe solicitação em andamento",
transferência ao cliente etc. — inalterados na Etapa 1.

---

## 4. UniTV — roteamento preparado, renovação NÃO implementada

> **Registro explícito:** a Etapa 1 preparou o **roteamento** por tipo
> de acesso (Sigma × UniTV), mas **a renovação automática de acessos
> UniTV NÃO foi implementada**. Isso é escopo da Etapa 2.

- `_shared/tipo_acesso.ts` → `classificarTipoAcesso(servidorNome)`:
  heurística conservadora — `'unitv'` **só** quando o servidor
  normalizado (sem acento, sem espaço/`.`/`-`/`_`, maiúsculo) é
  exatamente `"UNITV"`; qualquer dúvida → `'sigma'` (caminho
  seguro/existente). Motivo: um acesso UniTV tratado como Sigma geraria
  cobrança indevida; um Sigma tratado como UniTV apenas bloqueia uma
  renovação válida.
- **Acesso UniTV individual** (seleção por número ou por nome de
  servidor): o Orquestrador **nunca** cria token `tipo='sigma'`,
  **nunca** consulta valor, **nunca** cria cobrança. Envia a mensagem
  fixa `MENSAGEM_RENOVACAO_UNITV_NAO_INTEGRADA` e aciona atendimento
  humano (motivo `renovacao:unitv_nao_integrada`) + aviso ao José.
- **Lote com QUALQUER acesso UniTV** (`0` num telefone que tem Sigma +
  UniTV, ou 2× UniTV): **nenhum lote é criado, nenhuma cobrança**.
  Mensagem fixa `MENSAGEM_RENOVACAO_LOTE_COM_UNITV` + transferência
  humana (motivo `renovacao:lote_com_unitv_nao_integrado`). Os acessos
  Sigma continuam renováveis um a um pelo número.
- O schema já nasceu preparado para tipo misto: `tokens_renovacao.tipo`
  (`sigma`|`unitv`), `unitv_sn`, `unitv_id`, `public_id` NULL-able, com
  CHECK `tokens_renovacao_alvo_por_tipo`
  (`(tipo='sigma' AND public_id IS NOT NULL) OR (tipo='unitv' AND
  unitv_sn IS NOT NULL AND unitv_id IS NOT NULL)`). O lote deriva o
  `tipo` de cada filho do servidor (nunca hardcoda `'sigma'`).

---

## 5. Arquitetura / modelo de dados

### Migration `20260829120000_renovacoes_lote.sql` — APLICADA em produção

Aplicada manualmente via `supabase db query --linked -f` após
pré-auditoria, registrada em `schema_migrations`. Pós-auditoria: 2
conversas que já estavam com renovação migradas corretamente, 7
tokens + 7 cobranças históricas intactas, o resíduo Sandbox pré-lote
(`b2563a7e…`) preservado com `grupo_id=NULL`.

- **`renovacoes_lote`** (capa do grupo): `grupo_id` (PK), `telefone`,
  `conversation_id`, `estado` (`aguardando_confirmacao` →
  `autorizada` → `renovacao_em_andamento` → `concluida` /
  `renovacao_falhou` / `expirada`), `valor_total_centavos`,
  `regra_aplicada` (rótulo interno), `operacao_id` (FK →
  `cobrancas_pix`), `token_hash` (único, id do botão), `criado_em`,
  `expira_em`, `decidido_em`, `renovacao_concluida_em`.
- **`tokens_renovacao`** (filhos, quando `grupo_id` não é NULL):
  `+grupo_id` (FK → `renovacoes_lote`), `+tipo` (`sigma`|`unitv`),
  `+unitv_sn`, `+unitv_id`; `public_id` passou a ser NULL-able (só um
  futuro filho UniTV teria `public_id` NULL). Índice único "1
  solicitação ativa por acesso" recriado com `WHERE public_id IS NOT
  NULL`. Filhos têm `operacao_id = NULL` — a cobrança é da capa.
- **`cobrancas_pix`** `+grupo_id` (FK → `renovacoes_lote`). Índice de
  cobrança pendente por acesso mantido + novo por lote. Uma cobrança
  de lote tem `public_id`/`servidor_nome`/`plano_nome` = NULL (é do
  grupo, não de um acesso).
- **RPCs / helpers:** `criarRenovacaoLote` (cria capa + N filhos numa
  transação, com snapshot dos dados e `token_hash` próprio por filho e
  da capa); `buscarLoteAtivoPorPublicId` / `existeLoteAtivoParaPublicId`
  (um acesso em lote ativo pertence **exclusivamente** ao fluxo de
  lote — o fluxo individual nunca cria token novo nem opera sobre ele,
  só informa "já há renovação em andamento"); `buscarTokenAtivoPorPublicId`
  e as varreduras do watchdog filtram `grupo_id IS NULL` (não
  confundem token individual com filho de lote).

### Fluxo de execução (pós-pagamento)

1. Cliente paga o PIX → `openpix-webhook` marca `cobrancas_pix.status =
   pago`, capa e filhos → `renovacao_em_andamento`.
2. **GitHub Actions "Renovação Sigma"** (`renovacao-sigma.yml`) —
   **1 run para o lote inteiro** — renova cada filho no painel do
   Rocket via Playwright (`renovacao-sigma-workflow.mjs`):
   `page.goto` da página do cliente → `resolverIdInternoDoDom`
   (`[data-bs-target="#modal-add-pagamento"][cliente_id]`) →
   `renovacao-sigma-contexto` (sessão do Vault + `sigma/info`) →
   clique "Add Pagamento" → modal → `renovar_painel` marcado → pacote
   Sigma por prefixo → `#btn_adicionar_pagamento`.
3. Reconsulta independente (vencimento no Rocket + `expires_at` no
   Sigma) → `renovacao-sigma-resultado` → cada filho →
   `renovacao_concluida` com `vencimento_confirmado`; capa →
   `concluida`.
4. **Uma única** mensagem consolidada ao cliente
   (`montarMensagemResultadoLote`): "✅ Pagamento confirmado!" + novo
   vencimento por acesso.

### Watchdog / recuperação

`renovacao-sigma-watchdog` tem backstops para lote:
- Lote preso em `renovacao_em_andamento` sem callback após 15 min →
  capa `renovacao_falhou`, filhos em andamento →
  `renovacao_indeterminada`, transferência humana.
- Lote preso em `autorizada` sem cobrança vinculada após 15 min
  (queda entre criar cobrança e vincular) → mesma via da autorização
  órfã individual (aviso de transferência + acesso liberado), **nunca**
  a mensagem consolidada (seria "pagamento confirmado" falso).
- Falha parcial/total do lote → **uma única** mensagem ao cliente
  (`notificarTransferenciaHumana` com `opcoes.avisarCliente`), não uma
  por acesso.

---

## 6. Segurança / disciplina preservada

- **Nada de valor inventado:** preço = soma de valores reais do Rocket;
  se algum acesso não tem valor utilizável, `resolverPrecoLote` →
  `null` → fallback (nunca um total "chutado").
- **Cobrança recebe exatamente o total** — `renovacao_confirmacao.ts`
  usa `lote.valor_total_centavos` direto, sem recomputar.
- **Idempotência / concorrência:** capa e filhos com `token_hash`
  próprios; guardas atômicas (`ja_transferida`, reivindicação de
  ACEITO); re-checagem de estado antes de qualquer envio ao cliente
  (Componente 1 §15-A herdado).
- **UniTV nunca entra no fluxo Sigma** — barrado **antes** de qualquer
  efeito (guard de lote, consulta ao Rocket, criação de token,
  "buscando dados...").
- **Nenhuma credencial/secret em log.** Diagnósticos descartáveis
  apagados após uso.
- **Mensagens fixas ao cliente** nas etapas críticas (preparando
  pagamento, transferência, resultado) — nunca texto do Gemini.

---

## 7. Testes automatizados — 13/13 suites verdes

Rodar: `for d in scripts/testes/*/; do npx tsx "${d}teste.mjs"; done`

| suite | cobre |
|---|---|
| `precos_renovacao` | **soma dos valores reais**: 30+30=60, 35+35=70, 30+50=80, 50+30=80 (ordem), N=3 **só no resolvedor** (prova que soma — não que o Orquestrador oferece lote pra 3), misto sigma+unitv, edge cases (valor null/0/negativo/não-inteiro, < 2 acessos), não muta a entrada |
| `mensagens_renovacao_apresentacao` | lista com **📅 Vencimento** por bloco, ordem Plano→Vencimento→Valor, fallback "não informado" quando null, vencimento/valor não vazam entre blocos, confirmação de lote com **valores diferentes** (35+50 → Total 85), nunca "promoção"/"desconto" |
| `orchestrator_multiplos_acessos` | fluxo real do handler: lista determinística, seleção `1`/`2` casa com a posição mesmo com `/match` fora de ordem (`Teste Y`), `0` → lote com **total = soma real** (35+42 → 7700) e filhos com valor real (`Teste I`/`X`), `Teste J` confirma **N=3 → fallback, nunca lote**, roteamento UniTV individual/lote/2×UniTV (`Testes S–X`), regressão 2×Sigma |
| `renovacoes_lote` | `criarRenovacaoLote`: 1 capa + N filhos, `token_hash` próprios, snapshot por filho, estados iniciais, derivação de estado da capa |
| `tipo_acesso` | `classificarTipoAcesso`: "UNITV"/variações → unitv; qualquer outra coisa (inclusive "UNITV BR", "MEUUNITV", null) → sigma |
| `notificacao_transferencia_humana` | aviso único ao cliente em falha automática, `opcoes.avisarCliente`, cenários de lote |
| `openpix_paymentlink`, `status_valor`, `renovacao-sigma-cliente`, `renovacao-sigma-workflow-leitura`, `rocket-sigma-contexto`, `resolver-id-interno-dom`, `vinculo_operacao_renovacao` | infra de suporte (cobrança, `/status` com valor, ponte Rocket, resolução de id interno, vínculo operação↔token) |

**Nota:** este repositório não tem runner/CI de testes; a suíte roda
manualmente via `npx tsx`. Os módulos puros (`precos_renovacao.ts`,
`tipo_acesso.ts`, `mensagens_fixas.ts`) são importados reais; só as
dependências externas (banco, WhatsApp, Gemini, Rocket) são fakes.

---

## 8. Teste real de 2 acessos Sigma — SUCESSO ponta a ponta (2026-08-28)

**Telefone `5517981625486`**, com os 2 acessos UniTV removidos do
cadastro pelo usuário para isolar o cenário (os acessos UniTV **não**
foram alterados de nenhuma outra forma; foram retirados só para este
teste).

Acessos usados:

| # | nome | servidor | plano | valor (Rocket) | tipo |
|---|---|---|---|---|---|
| 1 | Meu Uso Testes | **BLAZE** | Mensal | R$ 35,00 | sigma |
| 2 | Js Informática Rp | **NewOne** | Mensal | R$ 35,00 | sigma |

Sequência real (contra `orchestrator` **v50** — versão com preço fixo
antigo, ver §2):

1. WhatsApp: "quero renovar" → lista dos 2 acessos (com valor por
   acesso; a linha de vencimento ainda não estava deployada).
2. "0" → **uma** confirmação de lote: 2 acessos, R$ 30,00 cada,
   **Total R$ 60,00** (preço fixo antigo — o correto seria R$ 70,00
   com o preço-soma; ver §2), sem "promoção".
3. **ACEITO** → lote `autorizada`; **1** cobrança OpenPix
   `grupo_id`-vinculada, `valor_esperado_centavos = 6000`,
   `status = pendente`.
4. **1** mensagem PIX com link `woovi-sandbox.com/pay/...` — **sem BR
   Code** no corpo.
5. Pagamento no Sandbox → `cobrancas_pix.status = pago`; lote e 2
   filhos → `renovacao_em_andamento`.
6. GitHub Actions "Renovação Sigma" (**1 run** para o lote,
   `conclusion: success`, ~1m21s) → PATCH no Rocket de cada acesso →
   callbacks `renovacao-sigma-resultado`.
7. Filho BLAZE → `renovacao_concluida`, `vencimento_confirmado`
   **13/11/2026** (era 13/10 → +1 mês). Filho NewOne →
   `renovacao_concluida`, **08/04/2027** (era 08/03 → +1 mês). Capa →
   `concluida`.
8. **1** mensagem consolidada ao cliente: "✅ Pagamento confirmado!"
   com o novo vencimento de cada acesso.
9. `/status` ao vivo confirmou os dois vencimentos +1 mês no Rocket.

**Integridade:** 1 lote, 1 cobrança, 2 filhos, 1 mensagem PIX, 1
mensagem consolidada, 0 tokens individuais ativos, conversa em
`normal`. Nenhuma duplicata, nenhum `UPDATE` manual.

**Ambiente:** a cobrança/link são **Sandbox** (`api.woovi-sandbox.com`).
Antes de qualquer teste com pagamento real, o provedor OpenPix/Woovi
precisa ser trocado para a credencial de produção (secret
`OPENPIX_APP_ID`) — **fora da Etapa 1**.

---

## 9. Resíduo de teste — já tratado

- Token individual `b2563a7e-5466-434d-a307-e912363de913` (BLAZE,
  Sandbox pré-lote, ficava preso em `autorizada`): limpo em
  2026-08-28 — `estado` → `renovacao_falhou` + `motivo_falha`
  registrado; cobrança `6dd1435f-…` → `cancelada`. Linhas preservadas,
  vínculo intacto, nenhuma chamada externa. Detalhe: histórico do git
  / relatório da sessão de 28/08.
- Cobrança do lote de teste `69c0f19d-…` permanece `pago` (esperado —
  a renovação foi aplicada). Conversa `43fcff07-…` sem intervenção
  manual.

---

## 10. Fora da Etapa 1 (não são pendências desta etapa)

- **Deploy dos 2 ajustes finais** (`8c5037f`: preço-soma + vencimento)
  + do Fix A (`68caca1`: roteamento UniTV / ordem determinística) — o
  `main` está à frente da produção (`orchestrator` v50). É a primeira
  ação da próxima sessão — ver `NEXT_SESSION.md`.
- **Etapa 2 — renovação automática de UniTV** (executor real no painel
  de revenda; `unitv_sn`/`unitv_id`; preço do crédito de revenda).
- **Provedor OpenPix de produção** (sair do Sandbox).
- **Lote de N ≥ 3 acessos** (a precificação já suporta; falta decisão
  de produto para remover o gate `!== 2`).
- **Persistência da mensagem final de sucesso no histórico do Painel**
  — gap conhecido do fluxo Sigma individual (a mensagem "✅ Pagamento
  confirmado!" é enviada ao cliente mas não gravada em
  `mensagens_conversa`); mesmo gap no caminho de falha
  (`notificacao_transferencia.ts`). Causa identificada, correção
  proposta, **não aplicada** — ver `NEXT_SESSION.md`.
