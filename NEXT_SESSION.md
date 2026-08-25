# NEXT_SESSION.md — Checkpoint de continuidade (2026-08-24, atualizado pós-Bloco 2)

> Substitui integralmente a versão anterior deste arquivo (commitada em
> `99d67aa`, logo após o Bloco 1/OpenPix — dizia explicitamente "Bloco 2
> continua não iniciado"). **Isso ficou desatualizado**: o Bloco 2 foi
> implementado e commitado (`6191cab`) na mesma sessão, cerca de 4h
> depois, sem que este checkpoint fosse reescrito para refletir isso —
> achado e corrigido só na sessão seguinte, ao retomar o trabalho.
> **Leia isto primeiro, antes de qualquer suposição ou nova
> investigação.**

## 0. ALERTA — `orchestrator` em produção está atrás do commit atual

**O código do Bloco 2 já está commitado e a maior parte já foi
implantada — mas a função `orchestrator` NÃO foi redeployada.**

- O commit `6191cab` alterou `orchestrator/index.ts` (239 linhas):
  `processarCobrancaRenovacao` deixou de criar a cobrança OpenPix
  diretamente — agora cria um registro em `tokens_renovacao` e envia
  ao cliente um **link de confirmação** (ACEITO/CANCELAR). A cobrança
  só passa a existir depois do ACEITO, dentro de
  `confirmacao-renovacao/index.ts`.
- Confirmado via `supabase functions list`: a função `orchestrator` em
  produção tem `updated_at` = 2026-08-24 09:16 — **anterior** ao
  commit `6191cab` (13:51). A versão rodando ainda é a do Bloco 1
  (cria a cobrança direto, sem token/confirmação).
- As demais peças do Bloco 2 já estão implantadas e ativas:
  - Migration `20260824130000_tokens_renovacao` — aplicada no banco
    real (confirmado via `supabase migration list`).
  - `confirmacao-renovacao`, `renovacao-sigma-resultado`,
    `renovacao-sigma-watchdog` — todas v1, `ACTIVE`.
  - `openpix-webhook` — redeployado (v5, 15:18), já reivindicando o
    início da renovação e disparando o workflow do GitHub Actions
    (`renovacao-sigma.yml`) quando o pagamento é confirmado de
    verdade.
- **Confirmado explicitamente pelo usuário (2026-08-24): isso não foi
  uma decisão deliberada de manter assim — ficou pra trás sem
  querer**, não uma escolha de segurar o deploy até revisão.
- **O redeploy do `orchestrator` continua pendente, não autorizado a
  ser executado ainda.** Nenhum deploy, migration, commit ou push deve
  ser feito a partir deste checkpoint sem autorização explícita nova.

## 1. Estado do git

- HEAD: `6191cab` — "Implementa Bloco 2 do fluxo de renovação
  automática (confirmação ACEITO/CANCELAR + renovação real via GitHub
  Actions/Playwright)", 2026-08-24 13:51. Branch `main`, sincronizado
  com `origin/main` (sem divergência).
- Working tree limpo, exceto duas pastas não rastreadas, ambas já
  esperadas: `scripts/supabase/.temp/` (vazia, resíduo do CLI do
  Supabase) e `supabase/functions/poc-sigma-renovacao-real/` (POC
  abandonada do mecanismo HTTP direto — o próprio commit `6191cab` já
  registra que ficou de fora de propósito, remoção adiada).

## 2. Mudança de provedor: PagBank → OpenPix/Woovi (Bloco 1) — histórico, sem mudança nesta sessão

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

Implementado no commit `f775659`: `_shared/openpix_client.ts`,
`_shared/openpix_webhook_signature.ts` (HMAC/RSA-SHA256 sobre o corpo
bruto), `openpix-webhook/index.ts` (sempre reconsulta o provedor antes
de decidir — o webhook é só o gatilho, nunca a fonte de verdade),
`_shared/cobrancas_pix.ts` migrado do modelo de duas camadas do
PagBank (`order_id`/`charge_id`) para o modelo de camada única da
OpenPix (`transaction_id_provedor`). 91/91 testes locais. Testado
ponta a ponta com o cliente de teste real (Js Informática Rp) pelo
WhatsApp real — cobrança criada, Pix entregue, pagamento confirmado
por webhook + reconsulta, `cobrancas_pix.status` chegou a `'pago'`.
Detalhe completo (incluindo o achado sobre o mecanismo real de
pagamento de teste — botão "Simular Pagamento" no painel do Sandbox,
não o auto-pagamento por tempo nem o endpoint documentado) preservado
no histórico do git (`git show 99d67aa:NEXT_SESSION.md`), não
duplicado aqui.

`_shared/pagbank_client.ts` e `poc-pagbank-criar-cobranca/` continuam
órfãos, preservados — não apagar sem autorização explícita nova.

## 3. Bloco 2 — implementado e commitado (`6191cab`), parcialmente implantado

**Mudança de fluxo:** depois do pagamento confirmado (Bloco 1), o
Orquestrador deixa de criar a cobrança OpenPix diretamente. Em vez
disso, cria um token de renovação (`tokens_renovacao`) e envia ao
cliente um **link de confirmação** — a cobrança só nasce depois do
ACEITO, dentro de `confirmacao-renovacao/index.ts`. Essa inversão de
ordem (ACEITO antes da cobrança existir, não depois do pagamento como
no desenho original das Lacunas 1-9) foi aprovada explicitamente,
segundo o comentário do próprio código-fonte.

**Peças novas:**
- `.github/workflows/renovacao-sigma.yml` + `scripts/renovacao-sigma-workflow.mjs`
  — job real (Playwright) que executa a renovação de verdade no
  Sigma, disparado via `workflow_dispatch` (GitHub Actions).
- `_shared/github_actions_dispatch.ts` — dispara o workflow.
- `_shared/tokens_renovacao.ts` — ciclo de vida do token
  (`autorizada` → `renovacao_em_andamento` → resultado), com
  reivindicação atômica contra disparo duplicado.
- `confirmacao-renovacao/index.ts` — Edge Function pública, HTML puro.
  `GET` só lê/renderiza (seguro mesmo com preview automático de
  link do WhatsApp/crawler); `POST` reivindica o token atomicamente
  (ACEITO ou CANCELAR) e só no caminho ACEITO cria a cobrança OpenPix
  de verdade. Tela simples com dois botões (`form`/`button`), sem
  nenhum segredo exposto ao cliente.
- `renovacao-sigma-resultado/index.ts` — callback do workflow;
  resultado (sucesso/falha/sessão expirada/ambíguo) sempre confirmado
  por reconsulta independente de Rocket e Sigma, nunca por suposição.
- `renovacao-sigma-watchdog/index.ts` — `pg_cron`, 15min, evita token
  preso indefinidamente em qualquer estado intermediário.
- Migration `20260824130000_tokens_renovacao.sql`.

**Revisão e testes locais (227 casos) encontraram e corrigiram 3
riscos reais antes de qualquer evidência ao vivo:** token preso em
`'autorizada'` sem cobrança vinculada; corrida no `INSERT` de
`tokens_renovacao`; resolução do cliente/pacote no Playwright de
produção (a página do Rocket lista dezenas de clientes no mesmo
widget — resolvida deterministicamente por nome+telefone, nunca por
posição/inferência).

**POC real controlada executada, com evidência programática completa
(não só visual):** confirmou que `expires_at` do Sigma muda de forma
coerente numa renovação bem-sucedida — fechando a última lacuna antes
de produção, segundo o commit.

**O que isso NÃO significa:** nenhuma dessas evidências (testes
locais + POC) é um teste real de ponta a ponta pelo WhatsApp real
disparando o fluxo completo novo (proposta → link → ACEITO → cobrança
→ pagamento → workflow → Sigma → callback) — isso ainda não aconteceu,
e não pode acontecer enquanto o `orchestrator` de produção continuar
na versão do Bloco 1 (seção 0).

## 4. Próximo trabalho aprovado (2026-08-24): migrar ACEITO/CANCELAR para botões interativos do WhatsApp

**Decisão do usuário, registrada nesta sessão.** O mecanismo atual de
confirmação (`confirmacao-renovacao/index.ts`) é uma página HTML
própria, alcançada por um **link** enviado ao cliente — o cliente
precisa sair do WhatsApp e abrir um navegador para clicar
ACEITO/CANCELAR. O próximo trabalho aprovado é substituir esse link
por **botões interativos nativos do WhatsApp** (Interactive Reply
Buttons da Cloud API), respondidos diretamente na própria conversa,
sem sair do app.

**Nada disso foi especificado ou implementado ainda** — não inventar
mecanismo, escopo ou desenho técnico além do que está registrado
aqui. Antes de qualquer código: especificar como o clique no botão
chega de volta ao sistema (webhook de `interactive` message, distinto
de `text`), como isso se relaciona com o token já existente em
`tokens_renovacao`, e se a página HTML de `confirmacao-renovacao`
é mantida como fallback ou é substituída — nenhuma dessas perguntas
foi respondida nesta sessão.

## 5. Pendências registradas, não resolvidas nesta sessão

- **Redeploy do `orchestrator`** — pendente, não autorizado a ser
  executado ainda (seção 0). Precisa de autorização explícita própria
  antes de rodar — não presumir que a aprovação da migração para
  botões interativos (seção 4) já autoriza esse deploy.
- Credencial OpenPix usada não tem permissão para `POST
  /api/v1/webhook` (criar webhook via API) — o webhook foi cadastrado
  manualmente pelo painel do Sandbox. Não afeta produção, só o passo
  de configuração inicial.
- `_shared/pagbank_client.ts`/`poc-pagbank-criar-cobranca/` continuam
  órfãos, preservados — não apagar sem autorização explícita nova.
- `supabase/functions/poc-sigma-renovacao-real/` (POC abandonada do
  mecanismo HTTP direto) — decisão de remoção adiada, ainda não
  tomada.
- Mensagem final de confirmação ao cliente (Message Template
  `pagamento_confirmado`, já aprovado pela Meta desde 22/08) — ainda
  não conectada a nenhum ponto do fluxo novo; dispara só depois da
  renovação real confirmada no Sigma (`renovacao-sigma-resultado`),
  não antes.

## 6. Ao retomar em outra sessão/máquina

1. Ler este arquivo por completo antes de qualquer ação — não repetir
   a investigação PagBank×OpenPix (seção 2, já concluída) nem a
   implementação/testes do Bloco 2 (seção 3, já concluídos).
2. Confirmar `git log --oneline -3` e `git status` antes de qualquer
   trabalho novo (regra permanente do projeto,
   `inovatv_central/CLAUDE.md` seção 0).
3. **Não presumir que o `orchestrator` em produção já reflete o Bloco
   2** — reconferir `supabase functions list` (campo `updated_at` da
   função `orchestrator` contra o commit mais recente que tocou
   `orchestrator/index.ts`) antes de qualquer teste real pelo
   WhatsApp.
4. Próximo passo de desenvolvimento real: especificar e implementar a
   migração de ACEITO/CANCELAR para botões interativos do WhatsApp
   (seção 4) — ainda não iniciado.
5. O redeploy do `orchestrator` (seção 0/5) é uma decisão/execução
   separada, com checkpoint próprio — não misturar com a especificação
   dos botões interativos sem confirmação explícita de que os dois
   devem acontecer juntos.
