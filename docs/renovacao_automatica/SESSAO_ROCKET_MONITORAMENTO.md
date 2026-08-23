# Sessão do Rocket — captura manual, renovação real via HTTP puro e monitoramento automático

> **Migrado de `inovatv_meta_business_agent/CLAUDE.md` (seções 15-16),
> 2026-08-23, como parte da reorganização que descontinua aquele
> repositório.** Conteúdo preservado integralmente — nenhum fato,
> data ou achado alterado nesta migração, só a moldura (era seção de
> um `CLAUDE.md`, agora é documento próprio). É a narrativa completa
> de **por que** a infraestrutura de monitoramento de sessão do Rocket
> existe — referenciada diretamente pela migration
> `supabase/migrations/20260821150000_rocket_session_monitoramento.sql`,
> já aplicada em produção.

## 1. Renovação automática — inversão de arquitetura "painel primeiro, Rocket depois" (levantamento técnico, 2026-08-21)

> **Atualização (mesmo dia, sessão seguinte):** a pendência real que
> fechava esta seção ("reproduzir isso a partir de um sistema nosso
> exigiria manter uma sessão autenticada do Rocket... não testado
> ainda") **foi resolvida e comprovada** — ver **seção 2**, abaixo.
> Esta seção 1 permanece como está, como registro histórico do
> levantamento original; não reescrita retroativamente.

**Decisão de arquitetura do usuário, ainda não implementada:**
abandonar a ideia de o Rocket (ou a Meta) decidir/calcular a
renovação. A nova direção a investigar é `painel IPTV renova primeiro
→ nosso sistema lê o estado real resultante → Rocket é atualizado só
para espelhar exatamente esse estado → Rocket comunica o cliente
(RocketZap, já existente)`. Integração de gateway de pagamento
(Mercado Pago/Asaas/paggpay), cogitada numa etapa anterior desta
mesma investigação, foi **explicitamente descartada** pelo usuário —
não faz parte deste caminho.

**Levantamento técnico completo:**
[`levantamentos/2026-08-21_renovacao_automatica_painel_primeiro.md`](levantamentos/2026-08-21_renovacao_automatica_painel_primeiro.md)
— não duplicado aqui. Cobre: reconstituição completa da PoC real de
renovação da UniTV (`POST /api/account/renew`, já comprovada
anteriormente); confirmação, por documentação oficial e interface real
do Rocket, de que a "Integração Sigma" do Rocket serve **só** para
gerar teste grátis (nunca renovação) e que a UniTV nunca teve
integração nativa configurada lá; reconhecimento ao vivo (só leitura)
do painel Sigma real do servidor NewOne (`painel.onetv.plus`) —
stack, endpoints `/api/*` observados, confirmação de que existe um
recurso `customers`, e a conclusão de que BotBot é um SaaS externo
(não um endpoint do painel) enquanto os links antigos `/api/chatbot/*`
são só para teste grátis, legados; mapeamento dos campos do
`PATCH /gerenciador/api/v1/cliente/{public_id}` do Rocket relevantes
para espelhar uma renovação (`vencimento`, `plano`, `valor`, `telas`,
`servidor`); achado de que PATCH cru não dispara RocketZap (só o fluxo
"ADD Pagamento" dispara, e esse está com um bug real hoje); tabela
comparativa UniTV × Sigma (NewOne/Blaze/Channel TV) com o que está
comprovado vs. inferido vs. ainda não testado.

**Nada foi implementado nem executado.** Nenhuma renovação real em
nenhum painel Sigma, nenhum PATCH novo no Rocket, nenhuma Edge
Function. Pendências para retomar (todas exigindo autorização
explícita e específica antes de qualquer ação real): 1 renovação de
teste real no NewOne com captura de rede (mesma metodologia da UniTV)
para descobrir o endpoint real de renovação do Sigma; leitura
(read-only) do detalhe de um cliente real no Sigma para confirmar os
campos pós-renovação; descobrir o que "ADD Pagamento → Renovar no
Painel" chama de fato no backend do Rocket; repetir o reconhecimento
para Blaze e Channel TV; aprofundar a tela ChatBot/BotBot do Sigma
("Criar Resposta") para confirmar se existe ou não um link de
renovação equivalente ao de teste grátis.

**Atualização — endpoint interno real encontrado + causa-raiz do bug
confirmada (mesmo dia, sessão seguinte, seção 10 do levantamento).**
Pesquisa externa no canal oficial do Rocket Gestor no Telegram
confirmou (texto literal, posts #190/#196) que o gatilho da
"RENOVAÇÃO AUTOMÁTICA com Painel Sigma/Uniplay" é sempre clicar
**"Adicionar pagamento"** — não existe (nos posts lidos) uma API
separada divulgada para isso. Achado real, ao vivo, ao abrir esse
modal para o cliente de teste (sem clicar Salvar): a própria
interface dispara `GET /gerenciador/cliente/sigma/info/?cliente_id={id_interno}`
(autenticado por **sessão/cookie**, não pela `X-API-Key` pública),
que devolveu o mesmo erro real já visto antes
(`"The route customers/https://painel.onetv.plus could not be found"`).
**Causa-raiz confirmada:** o campo **"Painel id"** do cadastro desse
cliente (que deveria guardar o ID numérico do cliente no Sigma) está
preenchido com a URL do painel (`https://painel.onetv.plus/`), não um
número — o backend do Rocket monta a rota errada a partir disso.
Também ficou confirmado, e importante para não confundir: a
"renovação automática de clientes" citada como "em testes" numa
publicação antiga do Rocket **evoluiu pro "Portal do Cliente"**
(gateway de pagamento — Mercado Pago/UpDePix/FastDePix/Lynx), **não**
é o mesmo mecanismo do "Renovar no Painel" com Sigma — o usuário já
descartou o caminho de gateway, e essa distinção evita confundir os
dois. Nada foi corrigido/salvo — nenhuma escrita real feita. Detalhe
completo, tabela de perguntas-respostas e pendências atualizadas: ver
seção 10 do levantamento (link acima).

**Atualização — cadeia completa do lado Rocket lida no código-fonte +
ID real do cliente no Sigma encontrado (mesma sessão, seção 11 do
levantamento).** Autorizado a continuar sem esperar. Lendo o
HTML/JS da própria página do Rocket (sem interceptar rede — é tudo
código-fonte já carregado), confirmada a cadeia completa: `GET
cliente/sigma/info` → `GET cliente/sigma/packages` (endpoint novo,
nunca visto antes) → `POST /gerenciador/pagamento/add/` (submissão de
formulário HTML tradicional, não AJAX/JSON — autenticada por sessão +
CSRF do Django) com os campos reais `renovar_painel` e
`sigma_package_id` entre outros. **O ID real do cliente de teste no
Sigma foi encontrado por leitura direta no painel** (`K4WrbeQ3We`,
string alfanumérica, não um número) — confirma que o "Painel id"
salvo hoje no Rocket para esse cliente está errado (é a URL do
painel). **"Assistente de Renovação (Beta)" do Sigma foi aberto só
por leitura e descartado como caminho** — é uma ferramenta de
campanha de recuperação via WhatsApp/BotBot com link de pagamento pro
próprio cliente (mesma família do gateway já descartado), não uma
renovação direta pelo revendedor. **Correção aplicada, com autorização explícita e específica do
usuário: `Painel id` do cliente de teste corrigido para `K4WrbeQ3We`
— confirmado que resolveu o bug.** Reabrindo "ADD Pagamento" (só
leitura, sem selecionar pacote nem salvar), os pacotes reais do Sigma
carregaram pela primeira vez (15 dias/1/3/6/12 meses, com/sem adultos,
custo em créditos). **Teste controlado real EXECUTADO com sucesso, autorizado
explicitamente pelo usuário (seção 12 do levantamento) — cadeia
completa confirmada de ponta a ponta.** Selecionado o pacote "1 MÊS -
P2P & IPTV SEM ADULTOS" e clicado Salvar no cliente de teste. Único
POST real: `POST /gerenciador/pagamento/add/?id_cliente=1553554` →
`200`. Quatro confirmações reais, nesta ordem: "Cliente renovado com
sucesso no SIGMA" → "Dados do cliente atualizado" → "Mensagem enviada
com sucesso" → "Pagamento salvo com sucesso". **Verificado de forma
independente nos dois sistemas:** Rocket mostrou vencimento
`08/11/2026 20:59` (antes `08/10/2026 23:59`, +1 mês); Sigma
(reconsultado à parte) mostrou plano "1 MÊS - P2P & IPTV SEM ADULTOS",
vencimento `08/11/2026 23:59:59`, créditos do revendedor `14 → 13` (1
crédito debitado). **Achado real novo:** diferença de exatamente 3h
entre o vencimento do Sigma (`23:59:59`) e o do Rocket (`20:59`) —
compatível com uma dupla conversão de fuso horário (`America/Sao_Paulo`,
UTC-3) na sincronização — bug real do próprio Rocket, não causado por
nós. **Confirma, com execução real:** não existe endpoint separado de
renovação (é o mesmo POST de "adicionar pagamento", com efeito
condicional no servidor); a mensagem de confirmação ao cliente já é
enviada automaticamente pelo Rocket (RocketZap), sem precisar de nada
da Meta. **Pendência real que segue:** este teste foi feito logado no
navegador (sessão/cookie) — reproduzir isso a partir de um sistema
nosso exigiria manter uma sessão autenticada do Rocket (não API Key),
e enviar o `csrfmiddlewaretoken` corretamente — não testado ainda.
Detalhe completo: seção 12 do levantamento.

**Levantamento — viabilidade de manter sessão autenticada do Rocket
por script (mesma sessão, seção 13 do levantamento).** Login real do
Rocket é Django padrão (`/accounts/login/`, campos `username`/
`password`/`csrfmiddlewaretoken`) — **mas exige passar por um desafio
real do Cloudflare Turnstile, marcado `required`** (achado principal,
confirmado no HTML real da tela de login, buscada sem cookies). Isso
impede um script HTTP simples (axios/fetch puro) de logar sozinho.
Cookie de sessão (`sessionid`) é `HttpOnly` (padrão seguro, não
bloqueia automação de verdade, só bloqueia leitura via JS da própria
página); `csrftoken` é legível normalmente. Duração da sessão e
comportamento sob automação prolongada **não confirmados**, só
inferência (padrão Django, ~2 semanas). **Veredito: B — viável, mas
exige intervenção periódica** (não A, por causa do Turnstile; não C,
porque um navegador headless real consegue logar como qualquer
navegador legítimo e o cookie resultante pode ser reutilizado por
várias chamadas HTTP simples depois). Arquitetura sugerida (não
implementada): login headless raro/agendado (ex. GitHub Actions, sem
custo novo) alimentando um secret de sessão, consumido por chamadas
HTTP leves e frequentes na Edge Function real. Nenhuma tentativa real
de login por script foi feita — só leitura do HTML da tela de login e
dos cookies já existentes. Detalhe completo: seção 13 do
levantamento.

---

## 2. Sessão do Rocket capturada manualmente + renovação real via HTTP puro + monitoramento automático — COMPROVADO, implementado e no ar (2026-08-21, sessão seguinte)

> **Isto não é mais hipótese.** Diferente da seção 1 (levantamento),
> tudo listado abaixo como COMPROVADO foi **executado de verdade**,
> com evidência real e verificação independente — e a parte de
> monitoramento está **implementada, deployada e rodando em
> produção** (Cron Job ativo a cada 4h). Levantamento técnico
> completo (toda a investigação, passo a passo, incluindo as duas
> tentativas que falharam): seção 14 do documento
> [`levantamentos/2026-08-21_renovacao_automatica_painel_primeiro.md`](levantamentos/2026-08-21_renovacao_automatica_painel_primeiro.md) —
> não duplicado aqui, este é só o resumo de estado.

### O que está COMPROVADO (executado, com evidência real)

1. **Login manual do Rocket com Cloudflare Turnstile** — sempre feito
   por um humano (José), nunca por script. Confirmado necessário:
   duas tentativas de automatizar (Playwright headless e depois
   headed/visível, mesmo com credenciais reais digitadas) foram
   **bloqueadas pelo Turnstile nas duas vezes** — o bloqueio é do
   próprio navegador automatizado (sinais tipo `navigator.webdriver`),
   não do comportamento de digitação. **Nenhuma tentativa de contornar
   isso foi feita** — decisão explícita de não seguir por aí.
2. **Captura de `sessionid` + `csrftoken`** — 100% manual, via DevTools
   do navegador real do usuário (Application → Cookies), depois que a
   automação do navegador se mostrou bloqueada.
3. **Reutilização desses cookies por HTTP puro, sem navegador e sem
   novo Turnstile** — comprovado primeiro numa chamada de somente
   leitura (`GET /gerenciador/cliente/sigma/info/`), depois numa
   navegação completa da UI real (dashboard, lista de clientes,
   abertura do modal "Adicionar pagamento", seleção de pacote —
   tudo via sessão injetada, sem login).
4. **Armazenamento seguro no Supabase Vault** — `sessionid`/
   `csrftoken` nunca em tabela comum, nunca em log, nunca em
   resposta de API. Só acessíveis via duas RPCs `SECURITY DEFINER`
   restritas a `service_role` (`rocket_sessao_definir`/
   `rocket_sessao_ler`, neste repositório).
5. **`POST /gerenciador/pagamento/add/?id_cliente=...` utilizando a
   sessão armazenada** — executado de duas formas nesta investigação:
   (a) manualmente pela UI real do Rocket, uma vez, na sessão anterior
   (seção 1 acima, seção 12 do levantamento); (b) **via script,
   reutilizando a sessão capturada, sem nenhuma interação humana no
   momento da chamada** — repetição da mesma cadeia, desta vez
   inteiramente por automação server-side.
6. **Renovação real do cliente no Sigma através do Rocket** —
   confirmada por reconsulta independente ao painel Sigma
   (`painel.onetv.plus`): plano trocado para o pacote selecionado,
   crédito do revendedor debitado.
7. **Atualização do vencimento no Rocket** — confirmada por reconsulta
   independente à página do cliente no Rocket (recarregada do zero).
8. **Pagamento registrado no Rocket** — confirmação "Pagamento salvo
   com sucesso" recebida na resposta real.
9. **Mensagem de confirmação enviada pelo Rocket** — confirmação
   "Mensagem enviada com sucesso" (RocketZap, automático, sem
   depender de nada da Meta).
10. **Verificação independente do resultado no Rocket e no Sigma** —
    feita nas duas execuções do teste (manual e via script), sempre
    reconsultando os dois sistemas de forma separada da chamada que
    fez a renovação.
11. **Monitoramento automático da sessão a cada 4 horas** —
    implementado e **deployado em produção**: Edge Function
    `monitorar-sessao-rocket`, acionada pelo primeiro Cron Job real
    deste projeto (`pg_cron`+`pg_net`, habilitados nesse momento pela
    primeira vez no Supabase).
12. **Detecção de sessão inválida** — regra: só conta como inválida
    um redirect real para `/accounts/login/` ou HTML reconhecível da
    tela de login; **falha de rede nunca marca a sessão como
    inválida** (testado).
13. **Alerta via GitHub Issues somente na transição válida →
    inválida** — testado de ponta a ponta: sessão corrompida
    deliberadamente → issue criada (`InovaTV/inovatv-api-intermediaria`,
    label `sessao-rocket`); segundo ciclo, ainda inválida → **nenhuma
    issue duplicada**, confirmado.
14. **Restauração automática do estado quando uma nova sessão válida é
    cadastrada** — testado: ao restaurar a sessão real via
    `scripts/atualizar-sessao-remota.mjs`, o estado voltou sozinho
    para `valida`, com os campos de alerta limpos, pronto para
    alertar de novo numa queda futura.

### Limitações conhecidas — registradas explicitamente, não escondidas

- **O login continua sendo manual quando a sessão expira.** Não existe
  (e não foi buscado) nenhum jeito de renovar a sessão sozinho.
- **Não tentamos contornar o Turnstile** — nem com stealth/fingerprint
  spoofing, nem com nenhuma outra técnica de evasão. Foi uma decisão
  explícita, não uma limitação técnica que se tentou resolver e
  falhou.
- **A duração exata da sessão ainda não foi medida.** Só inferência
  (padrão Django, ~2 semanas) — o próprio monitoramento é o mecanismo
  que vai revelar isso na prática, com o tempo.
- **`sessionid` e `csrftoken` são credenciais sensíveis** — nunca
  devem aparecer em log, Git, planilha ou Knowledge da Meta. Tratadas
  com o mesmo cuidado de uma senha em toda esta investigação
  (nunca impressas no terminal, nunca coladas em chat, sempre via
  arquivo local ignorado pelo git ou Vault).
- **O mecanismo de renovação já comprovado não deve ser alterado sem
  nova autorização explícita** — o trabalho desta seção (monitoramento)
  foi deliberadamente uma camada separada, sem tocar no código/fluxo
  da renovação em si.

### O que isto habilita — infraestrutura real, não mais teórica

A partir de agora existe uma peça de infraestrutura real e testada
que o gatilho de renovação automática pode reaproveitar diretamente:
**uma sessão do Rocket sempre disponível (enquanto válida) no Vault,
com um caminho HTTP puro comprovado até a renovação real no Sigma, e
um alerta automático quando ela cair.** O próximo passo (gatilho de
propor_renovacao/cobrança, já em andamento como a frente de Renovação
Automática deste repositório) é uma camada nova em cima disso, não
uma reconstrução do zero.

### Scripts reais desta infraestrutura (migrados para `scripts/` deste repositório, 2026-08-23)

- `atualizar-sessao-remota.mjs` / `capturar-sessao-rocket.mjs` —
  captura/atualização manual da sessão do Rocket.
- `executar-renovacao-controlada.mjs` / `preparar-renovacao-controlada.mjs` —
  execução real da renovação via HTTP puro, reutilizando a sessão do
  Vault.
- `reconhecer-ui-rocket.mjs` — ferramenta de investigação reaproveitável
  (pendência registrada: repetir o reconhecimento para Blaze/ChannelTV).
- `testar-leitura-sessao-rocket.mjs` — leitura/validação da sessão
  armazenada.
- `teste-login-rocket-turnstile.mjs` — teste de automação do login
  (resultado: bloqueado pelo Turnstile, decisão de não contornar).

As duas Edge Functions reais que sustentam o monitoramento
(`atualizar-sessao-rocket`, `monitorar-sessao-rocket`) já vivem em
`supabase/functions/` deste mesmo repositório — não fizeram parte
desta migração porque nunca estiveram em `inovatv_meta_business_agent`.
