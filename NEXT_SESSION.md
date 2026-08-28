# NEXT_SESSION.md — Checkpoint de continuidade (2026-08-27, pós-Ciclo 1 do teste ponta a ponta)

> Substitui integralmente a versão anterior (mesma data, pós-deploy de
> preparação, pré-execução). **Motivo da atualização:** o Ciclo 1 do
> teste ponta a ponta (item 3) foi executado de verdade pelo WhatsApp
> real — e encontrou um bug real de produção (violação de foreign key
> em `_shared/renovacao_confirmacao.ts`), já corrigido, testado
> (20/20, comprovado contra o código antigo via `git stash`) e
> implantado (`renovacao-confirmar` v2, commit `cbd5937`). O caso do
> Ciclo 1 foi encerrado deliberadamente sem recuperação manual
> (decisão do usuário — `renovacao_falhou` é estado terminal). Um novo
> achado de produto (comunicação silenciosa ao cliente em falha
> automática) ficou registrado como pendência obrigatória. Ciclo 2
> ainda não foi iniciado. **Leia isto primeiro, antes de qualquer
> suposição ou nova investigação.**

## 0. Estado consolidado (27/08/2026)

- **Ambiente de preparação:** secret `RENOVACAO_CONFIRMAR_INTERNAL_TOKEN`
  gerado e configurado (`openssl rand -hex 32`, nunca escrito em
  arquivo/log/commit); `orchestrator` v46, `webhook` v13 e
  `renovacao-confirmar` implantados pela primeira vez em 27/08/2026
  (~22:49-22:50 UTC). Afeta só o número de teste (`17996286135`) — o
  número oficial (`17996242415`) nunca foi migrado pra Cloud API.
- **Ciclo 1 do teste ponta a ponta: executado, encontrou um bug real,
  encerrado.** Detalhe completo (sequência cronológica, causa raiz,
  correção, testes, decisão de não recuperar) na seção 3, item 3.
- **Fix implantado:** `renovacao-confirmar` **v2**, `updated_at`
  27/08/2026 23:44:38 UTC — commit `cbd5937`. Nenhuma outra function
  precisou de redeploy (não consomem o caminho corrigido).
- **Pendência obrigatória nova, ainda não corrigida:** falha que
  aciona transferência humana automática (ex.: o watchdog) não envia
  nenhuma mensagem real ao cliente pelo WhatsApp — só registro
  interno. Detalhe na seção 3.
- **Ciclo 2 do teste ponta a ponta: planejado, execução ainda NÃO
  iniciada.** Exige autorização explícita própria — nenhuma mensagem,
  clique, cobrança ou pagamento deve acontecer sem ela.

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
3. **Teste ponta a ponta real pelo WhatsApp — Ciclo 1 executado e
   ENCERRADO (27/08/2026), bug real de FK encontrado/corrigido/
   implantado; Ciclo 2 planejado, ainda NÃO iniciado.**

   **Cliente de teste, telefone `5517981625486`** (auditoria só-leitura
   via `/match`/`/status`, chave anon pública, zero mutação) — dois
   acessos ativos no mesmo telefone:

   | Nome | Plano | Servidor | Valor | Vencimento | Telas | `publicId` |
   |---|---|---|---|---|---|---|
   | Meu Uso Testes | Mensal | BLAZE | R$ 35,00 | 13/09/2026 23:59 -03:00 | 1 | `01a0271b-5a54-7d7e-8e4a-ef4c39730e0b` |
   | Js Informática Rp | Mensal | NewOne | R$ 35,00 | 08/03/2027 23:59 -03:00 | 1 | `01a026ef-8bdd-7641-a4f2-2ae37b184ac0` |

   **ALERTA — `publicId` obsoleto, não reutilizar por suposição:** o
   `publicId` hardcoded em `teste-patch-renovacao-newone/index.ts`
   (`019ff025-ae5a-7e96-a037-8cfec84178d1`, de uma sessão de teste de
   21/08) foi reconfirmado via `/status` como **obsoleto**
   (`linkState: "unlinked"`, 404 no Rocket). O cadastro real atual de
   "Js Informática Rp / NewOne" usa `01a026ef-...` (tabela acima).

   **Acesso escolhido para o fluxo principal: NewOne**
   (`publicId 01a026ef-8bdd-7641-a4f2-2ae37b184ac0`). O cenário de
   múltiplos acessos permanece obrigatório no roteiro — nunca
   contornado (o teste real precisa passar pela identificação/escolha
   do NewOne antes do ACEITO/CANCELAR).

   ### Ciclo 1 (27/08/2026) — sequência cronológica real, com evidência

   | Horário (UTC) | Evento |
   |---|---|
   | 23:09-23:10 | Mensagem ambígua → sessão de 1h resetada → 2ª tentativa aciona corretamente o cenário de múltiplos acessos |
   | 23:10:50 | Cliente escolhe "2" (NewOne) → bloqueado por um token órfão de 24/08 (autorizado nesta sessão a expirar manualmente, ver histórico acima) |
   | 23:18:53-23:18:55 | Novo token criado, mensagem interativa (botões) enviada com os dados reais do NewOne |
   | 23:19:12 | Cliente toca **ACEITO** — webhook recebe `interactive.button_reply`, `renovacao-confirmar` reivindica atomicamente |
   | 23:19:14 | `cobrancas_pix` criada (`e4f3860a-...`, `pendente`) |
   | 23:19:15 | Cliente recebe a mensagem final com o Pix — **última mensagem que o cliente recebeu neste ciclo** |
   | 23:22:56 | Pagamento simulado confirmado — `cobrancas_pix.status` → `pago` |
   | — | **`tokens_renovacao.operacao_id` nunca foi vinculado** (bug de ordem/FK, ver causa raiz abaixo) — `openpix-webhook` não encontra o token, nenhum workflow disparado, nenhuma mensagem ao cliente |
   | 23:35:01 | `renovacao-sigma-watchdog` (backstop de 15min) encontra o token preso, marca `renovacao_falhou`, abre transferência humana automática |

   **Causa raiz comprovada:** em `_shared/renovacao_confirmacao.ts`, o
   caminho ACEITO chamava `vincularOperacaoAoToken()` **antes** de
   `criarCobrancaPixRegistro()`, violando sempre a foreign key
   `tokens_renovacao.operacao_id → cobrancas_pix(operacao_id)`
   (migration `20260824130000_tokens_renovacao.sql`). A falha era
   engolida por um `.catch()` best-effort — o cliente recebia o Pix
   normalmente, mas o pagamento nunca conseguia avançar sozinho.

   **Corrigido, testado e implantado:**
   - Commit `cbd5937` — reordena (`criarCobrancaPixRegistro` antes de
     `vincularOperacaoAoToken`), torna a falha de vínculo **fatal**
     (transferência humana + token marcado `renovacao_falhou`, nunca
     mais envia a mensagem do Pix quando o vínculo falha), e faz
     `vincularOperacaoAoToken` verificar que exatamente uma linha foi
     afetada (nunca mais sucesso silencioso).
   - Suíte nova `scripts/testes/vinculo_operacao_renovacao/` — roda os
     arquivos reais de produção com um fake de Supabase que reproduz a
     FK de verdade. **Comprovado empiricamente: 7/20 passando com o
     código antigo (via `git stash` temporário) → 20/20 com a
     correção.**
   - **Implantado:** `renovacao-confirmar` **v2**, `updated_at`
     27/08/2026 23:44:38 UTC (único ponto de consumo real da lógica
     corrigida — `orchestrator`/`webhook`/demais functions não
     precisaram de redeploy, não chamam o caminho alterado).

   **Watchdog funcionou exatamente como projetado** — backstop de
   15min encontrou a autorização órfã e a fechou (`renovacao_falhou`),
   liberando o acesso pra nova solicitação. **Comportamento correto,
   não uma falha.**

   **Decisão do usuário (27/08/2026): o caso do Ciclo 1 (token
   `6d35d628-...`, operação `e4f3860a-...`) é encerramento definitivo,
   não recuperado manualmente.** `renovacao_falhou` é estado terminal
   por desenho, sem transição de volta pra `autorizada`/
   `renovacao_em_andamento` — reconstruir isso manualmente seria um
   workaround fora da máquina de estados, descartado deliberadamente.
   `cobrancas_pix e4f3860a-...` (`status: pago`) fica como resíduo
   órfão de teste, inofensivo (índice único ali só cobre
   `status='pendente'`) — não usar em tentativas futuras.

   ### Achado de produto novo — pendência obrigatória, ainda NÃO corrigida

   **Falha que aciona transferência humana automática (ex.: o
   watchdog) não envia nenhuma mensagem real ao cliente pelo
   WhatsApp** — só grava registros internos em `mensagens_conversa`
   (`origem: sistema`/`ia` vazia), visíveis só no Painel de
   Atendimento. Confirmado ao vivo no Ciclo 1: depois de *"vou te
   avisar assim que confirmar"* (23:19:15), o cliente nunca mais
   recebeu nada — nem sucesso, nem falha, nem aviso de transferência.
   `acionarTransferenciaHumana` (a RPC em si) nunca envia mensagem;
   isso é responsabilidade de cada chamador — o `Orchestrator` faz
   isso no seu próprio helper (`transferirPorFalha`,
   `MENSAGEM_TRANSFERENCIA_CLIENTE`), mas nem o
   `renovacao-sigma-watchdog` nem o caminho de falha de vínculo em
   `_shared/renovacao_confirmacao.ts` (commit `cbd5937`) replicam esse
   envio. **Em produção, um erro interno nunca deveria resultar em
   silêncio total pro cliente.** Registrado como pendência obrigatória
   — correção com escopo próprio, ainda não autorizada, não
   implementada.

   ### Ciclo 2 — planejado, execução ainda NÃO iniciada

   Mesmo roteiro do Ciclo 1 (mensagem real → identificação do NewOne →
   proposta → ACEITO → cobrança → pagamento → webhook → renovação real
   no Sigma → reconsulta do vencimento → confirmação ao cliente), com
   um critério adicional aprovado pelo usuário:

   **Antes mesmo de pagar, confirmar por leitura que
   `tokens_renovacao.operacao_id` já bate exatamente com
   `cobrancas_pix.operacao_id`** — não esperar o pagamento pra
   descobrir que o vínculo falhou (foi exatamente esse atraso na
   detecção que permitiu o Ciclo 1 chegar até o pagamento confirmado
   antes do bug aparecer).

   **Testes negativos obrigatórios** (nenhum executado ainda em nenhum
   ciclo): CANCELAR, clique duplicado, telefone divergente, token
   expirado, falha de renovação controlada no Rocket/Sigma.

   **Critério de conclusão do item 3** (inalterado): WhatsApp real →
   ACEITO → cobrança → pagamento → webhook → renovação real no Sigma →
   reconsulta confirmando novo vencimento → mensagem final no
   WhatsApp, com evidência real em cada etapa, sem intervenção manual
   no meio do caminho feliz. **Harness local passando não conta como
   conclusão deste item** — nem 20/20 do teste de regressão do commit
   `cbd5937`, que prova a correção isoladamente, mas não substitui o
   ciclo real de ponta a ponta.

   **Status consolidado, nesta ordem:**
   - ✅ Bug da FK corrigido
   - ✅ Regressão coberta (20/20)
   - ✅ Fix implantado (`renovacao-confirmar` v2)
   - ✅ Watchdog funcionando como projetado
   - ⚠️ Comunicação ao cliente em falha automática ainda precisa ser tratada (pendência obrigatória, acima)
   - ⏳ Ciclo 2 iniciado e pausado — bloqueado por divergência de
     leitura do Rocket entre Supabase e GitHub Actions, não resolvida
     pela rotação de `ROCKET_API_KEY` (ver subseções abaixo)

   **Execução do Ciclo 2 exige autorização explícita própria** —
   nenhuma mensagem, clique, cobrança ou pagamento deve acontecer sem
   ela.

   ### Ciclo 2 — iniciado, pausado por falha real do Rocket (não WhatsApp/pagamento) durante a execução (27/08/2026)

   Ciclo 2 chegou a ser iniciado de fato (mensagem ambígua real →
   identificação → BLAZE selecionado → proposta → ACEITO → cobrança
   criada → pagamento confirmado pelo cliente de teste). Antes de o
   workflow de renovação (GitHub Actions/Sigma) concluir, a execução
   real de `renovacao-sigma-workflow.mjs` retornou `resultado_ambiguo`
   com detalhe **"falha ao ler cliente no Rocket antes da tentativa"**
   — `lerClienteRocket(publicId)` (chamada real, `GET
   /gerenciador/api/v1/cliente/{publicId}` com `X-API-Key:
   ROCKET_API_KEY`) não encontrou o cliente BLAZE dentro do ambiente do
   GitHub Actions, mesmo com HTTP 200 (sem exceção de rede/DNS — o
   próprio `try/catch` amplo do script, que logaria qualquer exceção
   não prevista, nunca disparou).

   **Nenhum novo disparo do workflow de renovação foi feito depois
   disso.** A investigação a partir daqui foi deliberadamente restrita
   a diagnóstico isolado e somente leitura (subseção seguinte), sem
   repetir Sigma/cobrança/pagamento no cliente real.

   ### Rotação de `ROCKET_API_KEY` + diagnóstico isolado — NÃO resolveu a divergência (27-28/08/2026)

   Hipótese trabalhada: a credencial `ROCKET_API_KEY` configurada no
   GitHub Actions estava errada/desatualizada (nunca validada de fato
   até a primeira execução real do workflow, 24/08/2026).

   **Ações realizadas, cada uma com autorização explícita própria:**
   1. Nova chave gerada diretamente na UI do Rocket Gestor (Opções →
      APIKEY) — pelo próprio usuário; o Claude nunca leu nem exibiu o
      valor em nenhum momento (regra permanente de segurança).
   2. `ROCKET_API_KEY` reconfigurado no Supabase e no GitHub Actions
      com o mesmo valor novo — também pelo próprio usuário, pelo mesmo
      motivo. `ROCKET_BASE_URL` intencionalmente **não** tocado (uma
      variável por vez, sem evidência de que estivesse incorreto).
   3. Diagnóstico descartável criado
      (`scripts/diagnostico-leitura-rocket.mjs` +
      `.github/workflows/diagnostico-rocket-leitura.yml`, commit
      `01b77ac`) — reaproveita literalmente a mesma chamada de
      `lerClienteRocket` (mesmo endpoint, mesmo header), sem
      Playwright/Sigma/cobrança/banco, para o `publicId` do BLAZE.
   4. **Duas execuções do diagnóstico, antes e depois da rotação —
      resultado idêntico nas duas:**
      ```json
      { "http_status": 200, "ok": true, "cliente_encontrado": false,
        "nome": null, "servidor": null, "vencimento": null }
      ```
      (runs `33132776520` e `33133412500` do GitHub Actions.)

   **Investigação read-only adicional, confirmando duas coisas por
   fontes independentes:**
   - **Não é bug de parser** — `supabase/functions/status/index.ts`
     (produção, comprovadamente funcional) usa exatamente o mesmo
     campo (`data?.cliente`) que o diagnóstico e
     `renovacao-sigma-workflow.mjs` já usavam.
   - **Não é `publicId` desatualizado** — confirmado por duas fontes
     independentes: `GET /status/{publicId}` (Supabase, mesma chave já
     rotacionada) devolveu o cliente completo e correto
     (`"Meu Uso Testes"`/BLAZE/vencimento `13/09/2026`); `GET
     /match?telefone=5517981625486` (caminho diferente, por telefone)
     devolveu o mesmo `publicId` como um dos 2 candidatos.

   **Conclusão: a rotação/recolagem do `ROCKET_API_KEY` NÃO resolveu a
   divergência.** O ambiente do GitHub Actions continua recebendo
   `HTTP 200` do Rocket sem encontrar o cliente, enquanto o ambiente do
   Supabase, para o mesmíssimo `publicId`, encontra normalmente — com
   uma chave supostamente igual nos dois lados. Hipótese mais provável,
   **não confirmada** (comparar os dois valores de secret diretamente
   não é possível de forma segura): a chave usada pelo GitHub Actions
   pode pertencer a um escopo/conta do Rocket diferente daquele onde
   esse cliente de teste existe — plausível por dar 200 (autenticação
   aceita) sem dado (busca vazia), diferente de uma chave inválida
   (que costuma dar 401/403).

   **Próxima investigação definida, NÃO iniciada:** comparação de
   contexto/conta do Rocket entre o ambiente do Supabase e o do GitHub
   Actions, somente leitura, começando pela origem exata de cada
   secret (quem gerou, quando, associado a qual conta/revenda) e pela
   `ROCKET_BASE_URL`/URL efetivamente usada em cada ambiente. **Nenhuma
   nova tentativa no cliente real (mensagem, Sigma, cobrança,
   pagamento) até essa diferença ser explicada.**

   Diagnóstico descartável (`01b77ac`) **mantido no repositório**,
   ainda não removido — decisão deliberada, para permitir reuso na
   próxima rodada de investigação sem recriar os arquivos.

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
3. **Produção reflete o commit `cbd5937`** em `renovacao-confirmar`
   (v2, `updated_at` 27/08/2026 23:44:38 UTC — inclui o fix da FK) —
   mas reconferir `supabase functions list` mesmo assim antes de
   qualquer teste real, caso a sessão que retomar não seja a mesma que
   fez este deploy.
4. Status das pendências da seção 3: item 1 (fallback dos links
   antigos) **fechado**, com duas dívidas técnicas aceitas
   deliberadamente; item 2 (janela de 24h) **decidido, mas não
   implementado**; item 3 (teste ponta a ponta real) — **Ciclo 1
   executado e encerrado** (bug de FK encontrado, corrigido, testado,
   implantado; caso de teste não recuperado, decisão deliberada),
   **pendência obrigatória nova** (comunicação silenciosa ao cliente
   em falha automática, ainda não corrigida), **Ciclo 2 planejado,
   execução ainda não iniciada** — tudo detalhado na própria seção 3.
5. **Não repetir a investigação de causa raiz do bug de FK** (já
   comprovada, corrigida, testada e implantada) nem a auditoria do
   cliente de teste (seção 3) — partir direto pra decidir o próximo
   passo real: (a) corrigir a pendência obrigatória de comunicação ao
   cliente, ou (b) iniciar o Ciclo 2 do teste ponta a ponta (com o
   critério adicional de confirmar o vínculo `operacao_id` antes do
   pagamento). Nenhuma mensagem real, clique, cobrança ou pagamento
   deve acontecer sem autorização explícita própria para essa
   execução especificamente.
