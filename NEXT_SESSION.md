# NEXT_SESSION.md — Checkpoint de continuidade (2026-08-24, atualizado)

> Substitui integralmente a versão anterior deste arquivo (que descrevia
> o Bloco 1 bloqueado no PagBank, nunca comprovado com sucesso). Aquele
> bloqueio foi a origem direta da investigação que levou à troca de
> provedor registrada aqui — não é um histórico solto, é a causa raiz
> do que segue. **Leia isto primeiro, antes de qualquer suposição ou
> nova investigação.**

## 1. Estado do git

- **HEAD após este checkpoint:** commit deste próprio arquivo, logo em
  seguida ao commit `f775659` — "Substitui PagBank por OpenPix no
  Bloco 1 do fluxo de renovação (cobrança Pix real)" (2026-08-24).
  Branch `main`.
- `git push origin main` executado depois do commit do checkpoint —
  ver seção 7 para o hash final confirmado.

## 2. Mudança de provedor: PagBank → OpenPix/Woovi (Bloco 1)

**Causa raiz, comprovada por investigação real (não suposição):** o
PagBank exige `customer.tax_id` (CPF/CNPJ do cliente pagador) em toda
modalidade de cobrança Pix avulsa — confirmado tanto pela documentação
oficial quanto por erro real no Sandbox (`40001 "customer must not be
null"`). Isso é incompatível com o requisito de produto: o cliente
nunca deve preencher CPF, nome, e-mail ou qualquer dado para pagar.
Duas outras modalidades do PagBank (`/checkouts`/Link de Pagamento)
também exigem esse dado, direta ou indiretamente. Investigação
completa registrada em `inovatv_central/CLAUDE.md`.

**OpenPix confirmada como alternativa real**, via POC em Sandbox: cria
cobrança Pix (QR/copia-e-cola) só com `value` + `correlationID`, sem
nenhum dado do cliente. `correlationID` = nosso `operacao_id` — mesmo
padrão de identificador já usado com o PagBank (`reference_id`), só
que agora reforçado pela própria OpenPix (reenviar o mesmo
`correlationID` retorna erro explícito, nunca duplica).

## 3. O que foi implementado no Bloco 1 (commit `f775659`)

- **Novo:** `_shared/openpix_client.ts` — `criarCobrancaOpenPix`/
  `consultarCobrancaOpenPix` (`POST`/`GET /api/v1/charge`).
- **Novo:** `_shared/openpix_webhook_signature.ts` — valida
  `x-webhook-signature` (RSA-SHA256, Web Crypto) contra a chave
  pública real da OpenPix, sobre o corpo bruto.
- **Novo:** `openpix-webhook/index.ts` — recebe o webhook, valida
  assinatura (descarta sem processar se inválida/ausente), e **sempre
  reconsulta** `consultarCobrancaOpenPix` antes de decidir — o webhook
  é só o gatilho, nunca a fonte de verdade. Confere valor pago contra
  `valor_esperado_centavos`; bate → `pago`, diverge → `valor_divergente`.
  Isolamento estrito: só atualiza status, não manda mensagem ao
  cliente nem toca Sigma (isso é Bloco 2).
- **Alterado:** `_shared/cobrancas_pix.ts` — `order_id`/`charge_id`
  (modelo de duas camadas do PagBank) substituídos por
  `transaction_id_provedor` (modelo de camada única da OpenPix, Opção
  A já aprovada). Funções novas: `buscarCobrancaPorOperacaoId`,
  `marcarCobrancaComoPaga`, `marcarCobrancaComoDivergente` — todas só
  atualizam uma linha ainda `pendente` (idempotência natural contra
  reenvio de webhook, sem tabela de dedup dedicada).
- **Alterado:** `supabase/migrations/20260823170000_cobrancas_pix.sql`
  — editada (nunca tinha sido aplicada ao banco antes desta sessão),
  mesma mudança de schema acima.
- **Alterado:** `orchestrator/index.ts` — `processarCobrancaRenovacao`
  chama `openpix_client` em vez de `pagbank_client`. Resto do fluxo
  (checar pendente antes de criar, mensagens fixas, transferência
  humana em falha com os mesmos motivos `renovacao:*`) inalterado.
- **Preservado, não tocado:** `_shared/pagbank_client.ts`,
  `poc-pagbank-criar-cobranca/` — órfãos, decisão explícita de não
  apagar ainda (limpeza fica para depois do Bloco 2 funcionar).

## 4. Testes locais — 91/91 passando

Mesma técnica já estabelecida no repositório (cópia do arquivo real
com só a linha de import redirecionada para fakes, confirmado por
`diff --strip-trailing-cr` que nada mais mudou):

| Suíte | Resultado |
|---|---|
| `openpix_client.ts` (arquivo real, fetch mockado) | 19/19 |
| `openpix_webhook_signature.ts` (arquivo real, chave pública real do POC) | 6/6 |
| `cobrancas_pix.ts` (cópia + Supabase fake) | 17/17 |
| `openpix-webhook/index.ts` (cópia + fakes) | 26/26 |
| `processarCobrancaRenovacao` (cópia de `orchestrator/index.ts` + fakes) | 23/23 |

Scripts ficaram no scratchpad da sessão (fora do repositório git,
efêmeros) — não foram preservados como parte do commit.

## 5. Deploy e teste ponta a ponta REAL — SUCESSO COMPROVADO

**Infraestrutura, nesta ordem:**
1. Migration `20260823170000_cobrancas_pix.sql` aplicada ao banco real
   (`npx supabase db push`) — schema já com `transaction_id_provedor`.
2. Secrets configurados: `OPENPIX_APPID` (Sandbox), `OPENPIX_WEBHOOK_PUBLIC_KEY`
   (PEM da OpenPix).
3. Deploy: `openpix-webhook` (nova, v1) e `orchestrator` (atualizada,
   v41) — ambas `verify_jwt: false` (esperado: `orchestrator` já era
   assim antes, por causa do `X-Internal-Token`; `openpix-webhook` usa
   a assinatura RSA como autenticação real).
4. Webhook cadastrado no painel do Sandbox OpenPix (evento
   `CHARGE_COMPLETED`), apontando pra
   `https://nduxsuxkopuvhwugdkqi.supabase.co/functions/v1/openpix-webhook`.

**Bug real encontrado e corrigido durante o deploy:** o primeiro
`.env` usado para configurar `OPENPIX_WEBHOOK_PUBLIC_KEY` não tinha
aspas ao redor do PEM multi-linha — um parser de `.env` padrão trata
cada linha depois do `=` como uma chave nova, truncando o secret na
primeira linha (`-----BEGIN PUBLIC KEY-----`, só isso). Isso fazia
**toda** validação de assinatura falhar (inclusive o teste de cadastro
de webhook que a própria OpenPix dispara, causando o erro "seu
endpoint precisa retornar 200"). Corrigido reconfigurando o secret com
o PEM entre aspas duplas (formato multi-linha válido de `.env`) —
confirmado via function de diagnóstico descartável (271 caracteres, 6
linhas, `BEGIN`/`END` presentes) e depois via teste real com o
payload+assinatura reais capturados no POC anterior (`HTTP 200`).

**Teste real de ponta a ponta, executado com o cliente de teste real
(Js Informática Rp) pelo WhatsApp de verdade:**

```
Cliente manda "quero renovar meu plano" (WhatsApp real)
   ↓
Webhook WhatsApp → Orquestrador → Gemini decide propor_renovacao
   ↓
processarCobrancaRenovacao: valor real do Rocket (R$ 35,00)
   ↓
criarCobrancaOpenPix → cobrança real no Sandbox
   (operacao_id 096b0e64-b74b-454e-bddd-9a224a4f90b8)
   ↓
persistida em cobrancas_pix (status='pendente')
   ↓
mensagem com o Pix real ENTREGUE no WhatsApp do cliente (confirmado
por print de tela real)
   ↓
[pagamento de teste simulado — ver achado abaixo]
   ↓
Webhook OPENPIX:CHARGE_COMPLETED recebido
   ↓
assinatura RSA validada
   ↓
reconsulta GET /charge/{operacaoId} confirma status=COMPLETED, value=3500
   ↓
valor bate com valor_esperado_centavos (3500=3500)
   ↓
cobrancas_pix.status = 'pago' (atualizado_em 12:38:26.683Z,
~1s depois do paidAt real da OpenPix, 12:38:25.787Z)
```

**Critério de aceite do Bloco 1 cumprido integralmente:** cobrança
criada ✅, Pix entregue ✅, pagamento confirmado por webhook+reconsulta
✅, `cobrancas_pix.status` chegou a `pago` ✅ — confirmado tanto pela
nossa API quanto pela consulta direta à OpenPix quanto visualmente
(print da tela "Pagamento Confirmado" da Woovi).

**Achado real sobre o mecanismo de pagamento de teste — corrige a
hipótese registrada no POC anterior.** O "auto-pagamento por tempo"
observado no primeiro POC (~4 min) **não é confiável/garantido** — uma
cobrança de R$ 35 daquele mesmo POC ficou pendente por quase 1h sem
nunca ser paga sozinha. O mecanismo real e controlável é o botão
**"Simular Pagamento"**, visível no detalhe de qualquer cobrança de
teste no painel do Sandbox (`Cobrança de Teste` → botão verde no
topo). O endpoint documentado (`GET api.woovi.com/openpix/testing`)
continuou retornando `401 "appID inválido"` mesmo com a credencial
correta do Sandbox — não foi usado no teste real, registrado como
discrepância entre documentação e comportamento observado, não
investigado a fundo (não bloqueia nada, o botão do painel resolve).

## 6. O que NÃO foi feito — Bloco 2 continua não iniciado

**Nenhuma linha de código do Bloco 2 existe.** Tudo abaixo permanece
exatamente como estava antes desta sessão, sem nenhuma implementação:

- Leitura/OCR de comprovante (Gemini) — Gemini pode **auxiliar a
  ler**, mas **nunca decide** se o pagamento foi realizado; quem
  decide é sempre a reconsulta determinística ao provedor (já
  implementada no Bloco 1, seção 3 acima).
- `tokens_renovacao` — tabela/mecanismo não criado.
- Botões ACEITO/CANCELAR — não implementados.
- Renovação real no Sigma — não implementada, `cobrancas_pix.status =
  'pago'` **não** dispara nenhuma ação automática hoje (fica só
  registrado).
- Mensagem final de confirmação ao cliente (Message Template
  `pagamento_confirmado`, já aprovado pela Meta desde 22/08) — não
  disparada por nada no Bloco 1. Enviar essa mensagem antes da
  renovação real no Sigma acontecer seria uma afirmação falsa — por
  isso o Bloco 1 deliberadamente para em `cobrancas_pix.status =
  'pago'` e não vai além.
- "Duas confirmações" (PagBank/OpenPix confirma o dinheiro; clique em
  ACEITO confirma a autorização do cliente) — só a primeira metade
  existe agora.

## 7. Ao retomar em outra sessão/máquina

1. Ler este arquivo por completo antes de qualquer ação — não repetir
   a investigação PagBank×OpenPix (já concluída, decisão fechada) nem
   o POC de Sandbox (já comprovado, ver seção 5).
2. Confirmar `git log --oneline -3` e `git status` antes de qualquer
   trabalho novo (regra permanente do projeto, `inovatv_central/CLAUDE.md`
   seção 0).
3. Próximo passo real: **Bloco 2** — desenho já existe em linhas
   gerais (seção 6 acima, "fluxo final desejado" registrado em versões
   anteriores deste checkpoint), mas precisa de especificação própria
   antes de codificar (mesma disciplina de sempre: nenhuma decisão
   arquitetural nova resolvida de passagem).
4. Pendência técnica não bloqueante, registrada: a credencial OpenPix
   usada não tem permissão para `POST /api/v1/webhook` (criar webhook
   via API) — o webhook foi cadastrado manualmente pelo painel. Não
   afeta nada em produção, só o passo de configuração inicial.
5. `pagbank_client.ts`/`poc-pagbank-criar-cobranca/` continuam órfãos,
   preservados — não apagar sem autorização explícita nova.
