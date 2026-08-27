# NEXT_SESSION.md — Checkpoint de continuidade (2026-08-27, auditoria do commit `8d85f94`)

> Substitui integralmente a versão anterior (commitada em `b5b767b`,
> 2026-08-24 — "checkpoint pós-Bloco 2"). **Motivo da substituição:**
> entre aquele checkpoint e esta atualização, uma sessão (usando o
> Codex) implementou e **publicou em `origin/main`** exatamente o
> próximo passo que a versão anterior deste arquivo já tinha aprovado
> (sua seção 4: migrar ACEITO/CANCELAR de link para botões interativos
> do WhatsApp) — mas o commit resultante (`8d85f94`, 25/08/2026) nunca
> atualizou este checkpoint. Isso só foi percebido e auditado nesta
> sessão (27/08/2026), comparando `git log`/`git show` com `supabase
> functions list` — mesma disciplina que a seção 0 da versão anterior
> já tinha usado para constatar o atraso do Bloco 2 em produção.
> **Leia isto primeiro, antes de qualquer suposição ou nova
> investigação.**

## 0. ALERTA — código no `origin/main` está à frente da produção, em dois níveis simultâneos

- `origin/main`/`main` local: HEAD em `8d85f94` — "Implementa
  confirmação de renovação por botões WhatsApp" (25/08/2026 06:45
  -03). **Confirmado commitado e publicado por leitura direta do
  Git** (não por relato de sessão) — corrige uma dúvida que um
  handoff externo (Codex) tinha deixado em aberto.
- **Nenhum componente desse commit está em produção.** Confirmado via
  `supabase functions list` nesta sessão (27/08/2026), comparando
  `updated_at` de cada function com a data dos commits que a tocaram:
  - **`orchestrator`**: `updated_at` = 24/08/2026 09:16 -03 —
    **anterior** até ao Bloco 2 (`6191cab`, 13:51 do mesmo dia), quanto
    mais ao commit dos botões. Continua rodando a versão do **Bloco
    1** (cria a cobrança OpenPix direto, sem token de confirmação) —
    o mesmo atraso que a versão anterior deste arquivo já tinha
    registrado e que **continua não resolvido**.
  - **`webhook`**: `updated_at` = 22/08/2026 — de **antes do Bloco 2
    inteiro**. Não reconhece `interactive.button_reply`, não tem a
    validação de ID `renovacao:(aceitar|cancelar):<64 hex>`.
  - **`renovacao-confirmar`**: **não existe na lista de Edge Functions
    implantadas.** Nunca recebeu o primeiro deploy.
- **Deploy bloqueado até autorização explícita do usuário — para
  qualquer uma das três functions acima, individualmente.** A
  aprovação do código (commit já revisado e aceito) **não** autoriza
  o deploy — são decisões e execuções separadas, mesma regra já em
  vigor no projeto (`inovatv_central/CLAUDE.md`, seção 0-B).

## 1. Estado do git

- HEAD: `8d85f94`, branch `main`, sincronizado com `origin/main` (sem
  divergência, confirmado nesta sessão).
- Working tree limpo neste clone. As pastas de teste temporárias que
  a sessão do Codex mencionou (`scripts/.interactive-test-harness/`,
  `scripts/supabase/`, `supabase/functions/poc-sigma-renovacao-real/`
  não rastreado) **não existem neste clone** — nunca foram
  versionadas (eram descartáveis por design) e não sobrevivem entre
  clones/máquinas.

## 2. Confirmação de renovação por botões interativos do WhatsApp — implementada e commitada (`8d85f94`), NÃO implantada

Substitui a confirmação de renovação por link/URL (Bloco 2, seção 5
abaixo) por uma mensagem interativa nativa do WhatsApp, com exatamente
dois botões — `ACEITO` e `CANCELAR`. O `token_hash` já existente
(`tokens_renovacao`) é reaproveitado; nenhuma tabela nova, nenhum novo
mecanismo de token.

IDs dos botões:
- `renovacao:aceitar:<token_hash>`
- `renovacao:cancelar:<token_hash>`

**Arquivos alterados/criados, revisados diff por diff nesta sessão:**
- `webhook/index.ts` — reconhece `interactive.button_reply`; aceita
  somente IDs no formato estrito
  `renovacao:(aceitar|cancelar):[0-9a-f]{64}`; `button_reply.title`
  nunca é tratado como fonte de verdade; IDs fora do formato são
  ignorados com segurança (log, sem repassar); encaminha a decisão,
  via `X-Internal-Token`, para a nova function `renovacao-confirmar`
  — nunca para o orchestrator/Gemini. Mensagens `text` continuam
  indo para o orchestrator normalmente. Validação de HMAC e
  deduplicação por `message_id` inalteradas.
- `renovacao-confirmar/index.ts` (**nova Edge Function**) — borda HTTP
  interna, nunca chamada pelo cliente; autentica por
  `RENOVACAO_CONFIRMAR_INTERNAL_TOKEN` compartilhado; delega toda a
  regra de negócio ao módulo abaixo.
- `_shared/renovacao_confirmacao.ts` (**novo módulo compartilhado**) —
  unifica a regra de aceite/cancelamento entre o fluxo antigo (link) e
  o novo (botão): busca o token por hash, expira se vencido, reivindica
  aceite/cancelamento de forma atômica (protege contra clique
  duplicado/corrida), checa telefone de origem contra o telefone do
  token, cria a cobrança OpenPix **somente após o ACEITO**, vincula a
  operação ao token, aciona transferência humana em qualquer falha
  (nunca falha em silêncio).
- `_shared/whatsapp_client.ts` — nova função
  `enviarMensagemInterativaWhatsApp` (payload `interactive/button` da
  Cloud API, exatamente dois botões).
- `_shared/mensagens_fixas.ts` — nova mensagem
  `montarMensagemBotoesConfirmacaoRenovacao` (mesmos dados reais já
  usados no fluxo antigo — cliente, servidor, plano, valor,
  vencimento —, sem URL).
- `orchestrator/index.ts` — `processarCobrancaRenovacao` passa a
  enviar a proposta via `enviarMensagemInterativaWhatsApp` em vez de
  texto com link; se o envio dos botões falhar, aciona transferência
  humana (`renovacao:falha_enviar_botoes_confirmacao`) em vez de
  seguir sem confirmação.

**Validação até aqui: só harness local temporário** (Node, fakes para
tudo externo — sem `.env`, sem rede real, sem Supabase/Rocket/Sigma/
Meta reais, sem secrets reais). Evolução registrada pela sessão que
implementou: 10 testes (4 passando, 6 falhando por bug do próprio
fake, corrigido) → 10/10 → cobertura ampliada (token expirado, clique
duplicado, falha simulada de cobrança, processamento real do webhook,
HMAC local, roteamento interactive×text) → **12/12 passando**. **Isso
não é evidência de produção** — nenhuma chamada real ao WhatsApp/Meta,
cobrança, Rocket, Sigma ou Supabase foi feita nesse teste.

## 3. Pendências pré-deploy

Antes de cogitar qualquer deploy do commit `8d85f94`:

1. **Fallback dos links antigos — AUDITADO (27/08/2026), decisão
   fechada.** Auditoria código por código confirmou: `confirmacao-
   renovacao/index.ts` não foi tocado pelo commit `8d85f94` e continua
   aceitando/processando links já emitidos exatamente como antes;
   nenhuma dependência compartilhada que ele usa (`tokens_renovacao.ts`,
   `openpix_client.ts`, `cobrancas_pix.ts`, `conversas_estado.ts`,
   `mensagens_atendimento.ts`) teve mudança incompatível; o
   Orchestrator não gera mais nenhuma URL nova
   (`montarMensagemLinkConfirmacaoRenovacao` ficou órfã, zero
   chamador em todo `supabase/functions`); nenhum caminho de produção
   depende de algo que a nova arquitetura quebre. **Decisão do
   usuário: manter `confirmacao-renovacao` como fallback por enquanto,
   sem prazo de desligamento definido** — decidir isso é etapa futura
   separada, não parte deste deploy. Duas dívidas técnicas aceitas
   deliberadamente, registradas aqui, não bloqueiam deploy:
   - **Duplicação de lógica** — `confirmacao-renovacao/index.ts`
     mantém sua própria cópia completa da regra de negócio (hash,
     busca, expira, reivindica, cria cobrança) em vez de chamar
     `_shared/renovacao_confirmacao.ts` (usado só pelo fluxo novo, via
     `renovacao-confirmar`). O desenho original previa que o endpoint
     web reaproveitasse o módulo compartilhado com `origem: "web"` —
     isso nunca foi implementado. **Aceito deliberadamente:**
     refatorar agora acrescentaria risco sem benefício necessário pro
     deploy; migrar `confirmacao-renovacao` pra usar o módulo
     compartilhado fica para uma etapa posterior, própria, com sua
     própria revisão — não fazer essa mudança de passagem dentro de
     outro trabalho.
   - **Imprecisão de mensagem, baixo risco** —
     `MENSAGEM_JA_EXISTE_SOLICITACAO_RENOVACAO` (enviada quando já
     existe um token ativo pro mesmo acesso) foi alterada pra dizer
     "procure os botões", mas `tokens_renovacao` não distingue se o
     token ativo foi emitido como link ou como botão. Um cliente que
     ainda tenha um link antigo válido (janela de até ~2h,
     `JANELA_EXPIRACAO_MS`) poderia ler essa mensagem de forma
     imprecisa. Autoexpira em até 2h, não bloqueia funcionamento —
     registrado, não corrigido.
2. **Comportamento fora da janela de 24h do WhatsApp/Meta** — ainda
   não definido o que acontece quando a janela de atendimento está
   fechada: falhar e transferir, usar template aprovado com botões, ou
   outro caminho aprovado.
3. **Teste ponta a ponta real pelo WhatsApp** — nenhum dos passos
   abaixo foi validado com cliente/ambiente real: mensagem interativa
   real, clique ACEITO real, clique CANCELAR real, duplicidade,
   telefone divergente, token expirado, cobrança/renovação real no
   ambiente de teste apropriado, retorno ao cliente.

## 4. Mudança de provedor: PagBank → OpenPix/Woovi (Bloco 1) — histórico, sem mudança nesta sessão

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

## 5. Bloco 2 — implementado e commitado (`6191cab`), parcialmente implantado

**Mudança de fluxo:** depois do pagamento confirmado (Bloco 1), o
Orquestrador deixa de criar a cobrança OpenPix diretamente. Em vez
disso, cria um token de renovação (`tokens_renovacao`) e envia ao
cliente um **link de confirmação** — a cobrança só nasce depois do
ACEITO, dentro de `confirmacao-renovacao/index.ts`. Essa inversão de
ordem (ACEITO antes da cobrança existir, não depois do pagamento como
no desenho original das Lacunas 1-9) foi aprovada explicitamente,
segundo o comentário do próprio código-fonte. **Superada
funcionalmente pelo commit `8d85f94` (seção 2 acima), que troca o link
por botões — mas nenhum dos dois está em produção ainda (seção 0).**

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
disparando o fluxo completo novo (proposta → botão/link → ACEITO →
cobrança → pagamento → workflow → Sigma → callback) — isso ainda não
aconteceu, e não pode acontecer enquanto o `orchestrator` de produção
continuar na versão do Bloco 1 (seção 0).

**Pendências herdadas, ainda não resolvidas:**
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
   a investigação PagBank×OpenPix (seção 4, já concluída) nem a
   implementação/testes do Bloco 2 (seção 5) ou dos botões interativos
   (seção 2), ambos já concluídos no código.
2. Confirmar `git log --oneline -3` e `git status` antes de qualquer
   trabalho novo (regra permanente do projeto,
   `inovatv_central/CLAUDE.md`, seção 0).
3. **Não presumir que a produção reflete o commit `8d85f94` nem o
   Bloco 2** — reconferir `supabase functions list` (`updated_at` de
   `orchestrator` e `webhook`, e a existência de `renovacao-confirmar`)
   antes de qualquer teste real pelo WhatsApp.
4. As três pendências da seção 3 precisam de decisão/resolução antes
   de qualquer deploy — nenhuma foi resolvida por esta auditoria.
5. Deploy de `orchestrator`, `webhook` e/ou `renovacao-confirmar` é
   decisão e execução própria, separada — precisa de autorização
   explícita nova, não decorre da aprovação do código em si nem da
   aprovação deste checkpoint.
