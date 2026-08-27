# NEXT_SESSION.md — Checkpoint de continuidade (2026-08-27, pós-deploy de preparação do commit `8d85f94`)

> Substitui integralmente a versão anterior (mesma data, pré-deploy).
> **Motivo da atualização:** o usuário autorizou explicitamente, nesta
> mesma sessão, a preparação do ambiente para o item 3 (teste ponta a
> ponta) — geração do secret que faltava e deploy das três functions
> que ainda estavam atrasadas em relação ao commit `8d85f94`. Isso foi
> executado e confirmado. **Nenhum teste real foi executado ainda** —
> a preparação do ambiente é uma etapa própria, distinta da execução
> do teste (que segue exigindo autorização explícita separada).
> **Leia isto primeiro, antes de qualquer suposição ou nova
> investigação.**

## 0. Deploy de preparação concluído (27/08/2026) — ambiente pronto, nenhum teste real executado ainda

- **Secret `RENOVACAO_CONFIRMAR_INTERNAL_TOKEN` gerado e configurado**
  (valor aleatório, `openssl rand -hex 32`, via `supabase secrets
  set`) — confirmado presente em `supabase secrets list` (só o nome;
  o valor nunca foi escrito em arquivo, log ou commit deste
  repositório). Esse secret faltava por completo antes desta sessão —
  sem ele, o clique em ACEITO/CANCELAR não chegaria a lugar nenhum
  (o próprio `webhook/index.ts` detecta a ausência e aborta com log,
  nunca falha de forma perigosa, mas também nunca funciona).
- **`orchestrator`, `webhook` e `renovacao-confirmar` implantados**,
  confirmado via `supabase functions list`:
  - `orchestrator` — v46, `ACTIVE`, `updated_at` 27/08/2026 22:49:48 UTC.
  - `webhook` — v13, `ACTIVE`, `updated_at` 27/08/2026 22:49:58 UTC.
  - `renovacao-confirmar` — v1 (**primeiro deploy**), `ACTIVE`,
    `updated_at` 27/08/2026 22:50:06 UTC.
  - As demais functions do fluxo (`confirmacao-renovacao`,
    `openpix-webhook`, `renovacao-sigma-resultado`,
    `renovacao-sigma-watchdog`) não precisaram de redeploy — já
    estavam no ar desde o Bloco 2 e não foram tocadas pelo commit
    `8d85f94`.
- **Isso foi autorizado explicitamente pelo usuário como preparação de
  ambiente para o item 3 (teste ponta a ponta), não como abertura
  geral de produção.** O número oficial (`17996242415`) nunca foi
  migrado pra Cloud API e não recebe eventos deste Webhook — só o
  número de teste (`17996286135`) é afetado por este deploy.
- **Nenhum teste real foi executado ainda.** Nenhuma mensagem
  enviada, nenhum clique simulado, nenhuma cobrança criada. A
  execução do teste ponta a ponta (seção 3, item 3) continua exigindo
  autorização explícita própria, separada desta preparação — mesma
  regra de sempre (`inovatv_central/CLAUDE.md`, seção 0-B: envio real
  de WhatsApp e alteração real de dados de produção sempre exigem
  checkpoint próprio).
- Pendências que ainda impedem considerar o item 3 concluído: item 2
  (janela de 24h — decidido, não implementado) e o próprio roteiro de
  teste do item 3, que ainda não começou a ser executado. Ver seção 3.

## 1. Estado do git

- HEAD: `8d85f94`, branch `main`, sincronizado com `origin/main` (sem
  divergência, confirmado nesta sessão).
- Working tree limpo neste clone. As pastas de teste temporárias que
  a sessão do Codex mencionou (`scripts/.interactive-test-harness/`,
  `scripts/supabase/`, `supabase/functions/poc-sigma-renovacao-real/`
  não rastreado) **não existem neste clone** — nunca foram
  versionadas (eram descartáveis por design) e não sobrevivem entre
  clones/máquinas.

## 2. Confirmação de renovação por botões interativos do WhatsApp — implementada, commitada (`8d85f94`) e IMPLANTADA (27/08/2026)

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

**Validação por harness local (histórico, antes do deploy):** Node,
fakes para tudo externo — sem `.env`, sem rede real, sem Supabase/
Rocket/Sigma/Meta reais, sem secrets reais. Evolução registrada pela
sessão que implementou: 10 testes (4 passando, 6 falhando por bug do
próprio fake, corrigido) → 10/10 → cobertura ampliada (token expirado,
clique duplicado, falha simulada de cobrança, processamento real do
webhook, HMAC local, roteamento interactive×text) → **12/12 passando**.
**Isso nunca foi evidência de produção** — nenhuma chamada real ao
WhatsApp/Meta, cobrança, Rocket, Sigma ou Supabase foi feita nesse
teste.

**Deploy de preparação concluído em 27/08/2026 (seção 0).** O código
está agora em produção (`orchestrator` v46, `webhook` v13,
`renovacao-confirmar` v1, todas `ACTIVE`), mas **isso ainda não é
teste real** — nenhuma mensagem foi enviada, nenhum clique foi dado,
nenhuma cobrança foi criada desde o deploy. O teste ponta a ponta
real (seção 3, item 3) é a próxima etapa, ainda não iniciada.

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
2. **Comportamento fora da janela de 24h do WhatsApp/Meta — DECIDIDO
   (27/08/2026), NÃO IMPLEMENTADO — segue bloqueando deploy.** Decisão
   do usuário: fora da janela de 24h, o fluxo não envia mensagem livre
   nem mensagem interativa de renovação; comunicação proativa nesse
   cenário usa somente template aprovado, quando fizer sentido
   iniciar/retomar a conversa; sem template adequado e aprovado pra
   esse cenário, o sistema aguarda uma nova mensagem do cliente, sem
   forçar nada; uma vez o cliente reabrindo a janela, o fluxo normal
   (botões ACEITO/CANCELAR) pode prosseguir normalmente. **Não será
   criada lógica para contornar a regra de 24h.**

   **Auditoria do código (27/08/2026) encontrou um gap real, ainda não
   corrigido.** Hoje, quando `enviarMensagemInterativaWhatsApp` falha
   (`envio2.outcome !== "success"`) dentro de
   `processarCobrancaRenovacao` (`orchestrator/index.ts`), o código cai
   em `transferirPorFalha("renovacao:falha_enviar_botoes_confirmacao")`
   — que marca a conversa `aguardando_humano`, tenta enviar
   `MENSAGEM_TRANSFERENCIA_CLIENTE` como **texto livre** (que também
   falharia fora da janela, pelo mesmo motivo) e notifica o José via
   template. Ou seja: hoje, estar fora da janela de 24h é tratado
   exatamente como qualquer outra falha genérica de envio — vira
   transferência humana, não "aguardar nova mensagem do cliente" como
   a política decidida pede.

   **Causa raiz:** `EnvioWhatsAppResultado` (`_shared/whatsapp_client.ts`)
   só distingue `success`/`unavailable` — o código de erro real da
   Graph API (ex.: `131047`, o erro específico da Meta para "fora da
   janela de 24h") é só logado internamente
   (`console.log` em `enviarPayloadWhatsApp`), nunca repassado ao
   chamador. O Orchestrator hoje não tem como saber que uma falha de
   envio foi especificamente "fora da janela" — trata tudo igual.

   **Implementação pendente, escopo ainda não autorizado.** Expor o
   motivo real da falha até o Orchestrator, tratar "fora da janela"
   como caso distinto de qualquer outro `unavailable`, e então esperar
   a próxima mensagem do cliente em vez de transferir. **Nenhum código
   foi alterado por este registro** — decisão de produto e achado
   técnico documentados; a implementação em si fica para quando for
   explicitamente autorizada, como etapa própria, com sua própria
   revisão.
3. **Teste ponta a ponta real pelo WhatsApp — ambiente pronto
   (27/08/2026), execução ainda NÃO iniciada.** Roteiro aprovado pelo
   usuário, registrado aqui na íntegra pra não se perder entre
   sessões/máquinas:

   **Fluxo principal (ACEITO):** cliente de teste inicia conversa real
   pelo WhatsApp → IA identifica intenção de renovação → Orchestrator
   apresenta os dados reais → cliente recebe a mensagem interativa
   (botões ACEITO/CANCELAR) → cliente toca ACEITO → webhook real
   recebe `interactive.button_reply` → webhook encaminha só o ID
   válido pra `renovacao-confirmar` → confirmação aceita uma única vez
   → cobrança criada no ambiente de teste apropriado (OpenPix Sandbox)
   → pagamento realizado/simulado (mecanismo já validado, botão
   "Simular Pagamento") → webhook de pagamento confirma a cobrança →
   renovação real executada no Sigma via Rocket (GitHub Actions/
   Playwright) → novo vencimento reconsultado e confirmado → mensagem
   final chega ao cliente pelo WhatsApp.

   **Testes negativos obrigatórios:**
   - CANCELAR: cliente toca CANCELAR; nenhuma cobrança criada, nenhuma
     renovação ocorre.
   - Clique duplicado: repetir o clique/provocar concorrência; só uma
     transição aceita.
   - Telefone divergente: resposta cujo telefone não corresponde ao
     token; nenhuma renovação ocorre.
   - Token expirado: tentar aceitar após expiração; nenhuma cobrança/
     renovação ocorre.
   - Falha de renovação: condição de falha controlada no Rocket/Sigma;
     confirmar transferência pra atendimento humano, sem o sistema
     inventar sucesso.

   **Critério de conclusão:** o teste principal precisa terminar com
   WhatsApp real → ACEITO → cobrança → pagamento → webhook → renovação
   real no Sigma → reconsulta confirmando novo vencimento → mensagem
   final no WhatsApp — tudo com evidência real, sem intervenção manual
   no meio do caminho feliz. CANCELAR e os cenários negativos também
   precisam apresentar o comportamento esperado. **Harness local
   passando não conta como conclusão deste item.**

   **Preparação de ambiente já concluída (seção 0):** secret
   `RENOVACAO_CONFIRMAR_INTERNAL_TOKEN` configurado; `orchestrator`,
   `webhook`, `renovacao-confirmar` implantados.

   **Cliente de teste — auditoria só-leitura concluída (27/08/2026),
   nada modificado.** Consultado via `/match`/`/status` (endpoints já
   implantados, chave anon pública, zero mutação):

   Telefone de teste: `5517981625486`. `/match` retornou
   `multiple_matches` — **dois acessos ativos no mesmo telefone**:

   | Nome | Plano | Servidor | Valor | Vencimento | Telas | `publicId` |
   |---|---|---|---|---|---|---|
   | Meu Uso Testes | Mensal | BLAZE | R$ 35,00 | 13/09/2026 23:59 -03:00 | 1 | `01a0271b-5a54-7d7e-8e4a-ef4c39730e0b` |
   | Js Informática Rp | Mensal | NewOne | R$ 35,00 | 08/03/2027 23:59 -03:00 | 1 | `01a026ef-8bdd-7641-a4f2-2ae37b184ac0` |

   **ALERTA — `publicId` obsoleto, não reutilizar por suposição:** o
   `publicId` hardcoded em `teste-patch-renovacao-newone/index.ts`
   (`019ff025-ae5a-7e96-a037-8cfec84178d1`, de uma sessão de teste de
   21/08) foi reconfirmado via `/status` como **obsoleto**
   (`linkState: "unlinked"`, 404 no Rocket) — não existe mais. O
   cadastro real atual de "Js Informática Rp / NewOne" tem um
   `publicId` diferente (`01a026ef-...`, tabela acima). Qualquer
   script/valor hardcoded de sessões antigas precisa ser reconfirmado
   antes de usar, nunca reaproveitado por suposição.

   **Decisão do usuário (27/08/2026): o acesso escolhido para o fluxo
   principal do teste ponta a ponta é o NewOne**
   (`publicId 01a026ef-8bdd-7641-a4f2-2ae37b184ac0`, "Js Informática
   Rp", Mensal, R$ 35,00, vencimento 08/03/2027). **O cenário de
   múltiplos acessos permanece no roteiro — não deve ser contornado.**
   Como o telefone tem 2 acessos ativos, a primeira mensagem do
   cliente vai naturalmente cair nesse cenário (a IA lista os dois e
   pergunta qual); o teste precisa passar por essa etapa de verdade
   (identificar/escolher o NewOne) antes de chegar na proposta
   ACEITO/CANCELAR — não pular direto pro acesso único assumindo que
   já está resolvido.

   **Ainda pendente antes de iniciar a execução:** nada além da
   autorização explícita para começar. Execução do teste em si (
   qualquer mensagem, clique, cobrança ou pagamento reais) exige
   autorização própria, separada desta preparação — **nada disso foi
   iniciado ainda**.

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
   (seção 2), ambos já concluídos no código **e já implantados**.
2. Confirmar `git log --oneline -3` e `git status` antes de qualquer
   trabalho novo (regra permanente do projeto,
   `inovatv_central/CLAUDE.md`, seção 0).
3. **Produção já reflete o commit `8d85f94`** (`orchestrator` v46,
   `webhook` v13, `renovacao-confirmar` v1, deploy de 27/08/2026) —
   mas reconferir `supabase functions list` mesmo assim antes de
   qualquer teste real, caso a sessão que retomar não seja a mesma que
   fez este deploy.
4. Status das pendências da seção 3: item 1 (fallback dos links
   antigos) **fechado**, com duas dívidas técnicas aceitas
   deliberadamente; item 2 (janela de 24h) **decidido, mas não
   implementado** — a política está definida, o código ainda não a
   segue (gap real documentado); item 3 (teste ponta a ponta real)
   **ambiente pronto, execução ainda não iniciada** — roteiro completo
   registrado na própria seção 3.
5. **Próxima ação real, quando autorizada:** auditoria só-leitura do
   cliente de teste no Rocket (telefone, plano, valor, vencimento),
   e só depois, com autorização explícita separada, o início da
   execução do roteiro de teste (seção 3, item 3). Nenhuma mensagem
   real, clique ou cobrança deve acontecer sem essa autorização
   específica — a aprovação do deploy de preparação **não** autoriza a
   execução do teste em si.
