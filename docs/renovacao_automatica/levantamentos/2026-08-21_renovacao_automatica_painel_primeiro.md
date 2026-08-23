# Renovação automática — painel primeiro, Rocket depois (levantamento técnico)

> **Isto é um levantamento, não uma implementação.** Nenhuma Edge
> Function de produção foi criada, nenhum PATCH foi feito no Rocket
> nesta sessão, nenhuma renovação foi executada em nenhum painel
> (Sigma ou UniTV), nenhum dado real foi alterado. Tudo que segue é
> leitura de documentação já existente, leitura de código já
> investigado anteriormente, e observação passiva (navegação
> read-only + captura de requisições de rede já disparadas pela
> própria interface) nos painéis Rocket e Sigma (NewOne).

## 0. Contexto e objetivo

Decisão de arquitetura proposta pelo usuário nesta sessão, invertendo
a direção considerada anteriormente:

```
ANTES (descartado):  Meta → gatilho → Rocket → painel
AGORA (a investigar): Meta → confirmação → painel IPTV → renovação real
                       → leitura do novo estado → Rocket sincronizado
                       para ficar idêntico ao painel → Rocket comunica
                       o cliente
```

O painel IPTV passa a ser a **origem** da renovação — a fonte da
verdade sobre o que realmente aconteceu. O Rocket deixa de calcular ou
decidir a renovação; ele só **reflete** o resultado real já ocorrido
no painel. Isso evita divergência entre os dois sistemas e evita que
a IA (Meta) precise "adivinhar" a regra comercial de renovação — quem
decide isso é o próprio painel, como já decide hoje quando um humano
renova manualmente.

**Ponto de partida:** a experiência real já vivida com a UniTV
(`panel-web.revenda.site`), documentada em
`inovatv-api-intermediaria/docs/unitv/` — não é uma ideia abstrata,
foi uma PoC real, executada, com resultado comprovado.

**Integração de pagamento (Mercado Pago/Asaas/paggpay) foi
explicitamente descartada pelo usuário** — não faz parte deste
levantamento, mesmo tendo aparecido como pista promissora numa etapa
anterior desta mesma sessão. Não retomada aqui.

---

## 1. UniTV — reconstituição completa (COMPROVADO)

Fonte: `inovatv-api-intermediaria/docs/unitv/UNITV_RENOVACAO_INVESTIGACAO.md`
e `UNITV_RENOVACAO_TESTE_REAL.md` — lidos por completo nesta sessão.

- **Painel:** `panel-web.revenda.site`, produto white-label
  "ResellerSystem", SPA Vue 3.
- **Endpoint de renovação:** `POST /api/account/renew`.
- **Autenticação:** headers `Authorization: <token>` e `token:
  <token>` em toda requisição, **mais** `dealer_token`/`dealer_name`
  dentro do próprio corpo da requisição (chamadas de conta).
- **Payload real capturado** (conta de teste `gcnv6v`):
  ```json
  {
    "package_id": 1,
    "points_type": 1,
    "auth_cycle": 1,
    "points": 1,
    "pre_auth_id": 123,
    "sn": "gcnv6v",
    "id": 3433363,
    "sign": "85c37de7e1e653df55e12330aebb1be4",
    "dealer_token": "[credencial real, nunca registrada]",
    "dealer_name": "inovatvstream2"
  }
  ```
- **Criptografia de transporte:** corpo real é AES-CBC (chave/IV fixos
  de 16 bytes, embutidos no bundle JS, iguais para qualquer sessão) —
  o envelope (`returnCode`/`errorMessage`/`jumpCode`/`data`) chega em
  texto puro, só o campo `data` vem cifrado.
- **`sign`:** `MD5("dealer" + id + points_type + points)` — confirmado
  batendo byte a byte com o valor real capturado.
- **`pre_auth_id`:** inteiro simples de catálogo (não é token de
  segurança), obtido uma vez por sessão via
  `POST /api/dealer-core/package/package-name`.
- **Dados necessários para identificar o acesso:** `sn` (identificador
  da conta, ex. `gcnv6v`) + `id` (id interno numérico da conta) — os
  dois já vêm da consulta/listagem da conta antes da renovação.
- **O que mudou no painel depois da chamada:**
  - Crédito do revendedor debitado (15 → 14).
  - Vencimento avançado de `02/09/2026 02:31:01` para
    `03/10/2026 02:31:01` — **+31 dias**, não +30 (achado relevante:
    "1 crédito mensal" não é necessariamente 30 dias fixos).
  - Mudança **reconfirmada com uma nova consulta ao servidor** (não é
    só valor otimista de tela) — persistência real do lado do painel
    comprovada.
- **Método de captura usado (metodologia a repetir no Sigma, se
  autorizado no futuro):** interceptor passivo de `fetch`/`XHR`
  injetado na própria página (só leitura, nunca altera o que é
  enviado) + execução de **uma** renovação real manual pela UI,
  autorizada explicitamente pelo usuário, em **uma única conta de
  teste**.

---

## 2. Rocket — o que já existe nativamente para Sigma (COMPROVADO via documentação oficial + interface real)

### 2.1 A API pública do Rocket (`rocket_gestor_openapi.json`) não documenta renovação via integração

Endpoints existentes (confirmado por leitura completa do `paths` do
OpenAPI): `cliente/add`, `cliente/{public_id}` (GET/PATCH),
`clientes/`, `aplicativos/`, `dispositivos/`, `planos/`, `captacoes/`,
`servidores/`, `teste/add`, `teste/automatico`, `teste/{teste_id}`
(GET/PATCH/DELETE), `testes/`.

**Não existe nenhum endpoint de renovação/pagamento na especificação
pública.** O único uso documentado de "integração" (Sigma, NATV, Fast,
The Best, TVS, Warez, Uniplay) é `POST /gerenciador/api/v1/teste/automatico`
— **criação de teste grátis**, nunca renovação. A descrição oficial do
endpoint é explícita: "O sistema detecta automaticamente o tipo de
integração do servidor e aplica os parâmetros corretos" — mas só para
teste.

### 2.2 Confirmado na própria interface do Rocket: a integração Sigma existe só para sincronizar servidores/pacotes de teste

Navegado ao vivo `Gerenciador → Integrações` (`app.rocketgestor.com`):
texto oficial da tela, "Como configurar integrações → Sigma → Como
obter as credenciais": **"O Sigma sincroniza automaticamente
servidores e pacotes após a configuração."** Nenhuma menção a cliente,
renovação ou vencimento.

### 2.3 Três integrações Sigma reais já configuradas (COMPROVADO, tela `Gerenciador → Integrações`)

| Nome | URL do Painel | Usuário | Status | Criado em |
|---|---|---|---|---|
| Blaze | `https://blaze.officeb.site...` | `inovatvstream1` | Ativo | 03/06/2026 |
| Channel TV | `https://channeltv.top...` | `inovatv` | Ativo | 17/07/2026 |
| NewOne | `https://painel.onetv.plus...` | `inovatv` | Ativo | 05/05/2026 (atualizado 21/08/2026) |

Todas as três classificadas pelo próprio Rocket como `SigmaIntegracao`
— ou seja, o Rocket já trata os três painéis como a mesma família de
software (mesmo white-label "Sigma"), não como três integrações
distintas.

### 2.4 Servidores do Rocket e seu tipo de integração (COMPROVADO, tela `Gerenciador → Servidores`)

| Servidor | Clientes (ativos/inativos) | Integração |
|---|---|---|
| ChannelTV | 2 (2/0) | Channel TV – Sigma |
| NewOne | 15 (11/4) | NewOne – Sigma |
| BLAZE | 10 (5/5) | Blaze – Sigma |
| UNITV | 78 (58/20) | **Não definida** |
| P2Cine | 2 (0/2) | Não definida |
| CLUB | 17 (4/13) | Não definida |

**Achado relevante:** a UniTV — de onde vem toda a nossa experiência
real de renovação via API — **nunca teve integração Sigma/nativa
configurada no Rocket**. Toda a investigação da UniTV (seção 1) foi
feita de forma totalmente paralela ao mecanismo de "Integrações" do
Rocket, por engenharia reversa direta do painel dela. Isso reforça
que, para os painéis Sigma, provavelmente também vamos precisar de
engenharia reversa direta (seção 4), e não algo que o Rocket já
resolve por baixo dos panos.

### 2.5 O que já era conhecido de sessões anteriores desta mesma investigação, ainda válido (não re-verificado agora)

- O modal **"ADD Pagamento"** de cada cliente no Rocket tem 3 toggles
  independentes: "Atualizar dados do cliente?" (equivalente ao nosso
  PATCH), "Enviar Mensagem?" (aciona RocketZap), "Renovar no Painel?"
  (aciona sincronização com o Sigma, exige selecionar um "Pacote
  Sigma").
- **Bug real, não nosso, encontrado no frontend do Rocket:** ao tentar
  carregar as opções de "Pacote Sigma" nesse modal, a requisição
  malformada gera `"The route customers/https://painel.onetv.plus
  could not be found."` — a própria integração "Renovar no Painel" do
  Rocket está quebrada hoje. Usuário planeja reportar ao suporte do
  Rocket.
- Dois testes reais de `PATCH /gerenciador/api/v1/cliente/{public_id}`
  já foram feitos (cliente de teste Js Informática Rp / NewOne) — o
  PATCH funciona e persiste de verdade, mas **não dispara nenhuma
  notificação real via RocketZap** (confirmado duas vezes) — porque
  PATCH não passa pelo fluxo "ADD Pagamento", que é quem aciona o
  "Enviar Mensagem?".
- **RocketZap 2.0** é a própria integração de WhatsApp do Rocket
  (sessão `inovatv`, número oficial `5517996242415`, Conectado) — é
  o mecanismo real que já envia confirmações automáticas de renovação
  aos clientes hoje, quando a renovação é feita via "ADD Pagamento"
  manual com o toggle "Enviar Mensagem?" ativado.

---

## 3. Sigma (painel `painel.onetv.plus`, servidor NewOne) — reconhecimento ao vivo real (COMPROVADO por observação de rede)

Sessão administrativa já autenticada (`inovatv`, 14 créditos) foi
navegada de forma **só leitura** (dashboard, Integrações, ChatBot) e
as requisições de rede reais já disparadas pela própria interface
foram capturadas passivamente (`read_network_requests` — não é
interceptação injetada, é leitura do que o navegador já registrou).

### 3.1 Stack confirmada

- SPA Vue 3 (mesmo padrão arquitetural da UniTV, mas **fornecedor
  diferente**).
- Telemetria de erro via Sentry, projeto `logs.smart-ti.com` —
  **revela o nome real do fornecedor white-label por trás da marca
  "Sigma": "Smart TI"**. Como as 3 integrações Sigma do Rocket
  (Blaze/Channel TV/NewOne) são todas classificadas como
  `SigmaIntegracao`, é razoável esperar que rodem o mesmo software
  Smart TI — ver ressalva na seção 5.
- **Todas as chamadas de negócio são mesma origem**, sob
  `https://painel.onetv.plus/api/*` — diferente da UniTV, aqui não há
  sinal de payload cifrado nas URLs observadas (as calls têm nomes de
  recurso legíveis, ex. `/api/customers/expiring`).

### 3.2 Endpoints reais observados (tráfego real, não suposição)

```
GET /api/auth/me                                  — sessão atual
GET /api/servers                                   — servidores do revendedor
GET /api/dashboard/preferences
GET /api/notices/list
GET /api/resellers/customers-count
GET /api/customers/expiring                        — confirma recurso "customers" existe
GET /api/dashboard/charts/new-customers?period=...
GET /api/dashboard/charts/revenue-forecast
GET /api/dashboard/charts/lost-revenue
GET /api/dashboard/charts/customer-retention
GET /api/dashboard/metrics/recovery
GET /api/dashboard/ai-analysis
GET /api/settings/public
GET /api/settings/logo/{id}
GET /api/integrations
```

**Autenticação:** aparenta ser por sessão (cookie), não por token
visível na URL — `GET /api/auth/me` chamado repetidamente a cada
navegação/refresh, padrão típico de checagem de sessão via cookie
HttpOnly. **Não confirmado em detalhe** (não inspecionei headers de
requisição individualmente) — ver pendência na seção 9.

### 3.3 O que isso já prova

- Existe, com certeza, um recurso `customers` na API real do painel
  (`/api/customers/expiring` prova isso). Por convenção REST (mesmo
  padrão observado na UniTV: listar → detalhe → ação), é esperado que
  existam algo como `GET /api/customers/{id}` (detalhe/estado) e uma
  ação de renovação num sub-caminho relacionado — **isso é inferência
  por convenção, não foi observado diretamente.**
- O painel tem uma seção de **Integrações** própria (`/api/integrations`,
  vista na aba "Integrações" da UI) — **diferente e mais ampla** que a
  integração que o Rocket configura. Dentro dela:
  - **BotBot** — confirmado **não ser um endpoint interno do painel**.
    É um SaaS externo (`botbot.chat`), com conta, dispositivo WhatsApp
    e chaves de API próprias, plugado por fora. A descrição oficial
    da integração diz que ele "envia mensagens automatizadas... com
    base no vencimento/pagamento" e "renovações, lembretes e
    mensagens de recuperação" — mas isso é **mensageria em cima de um
    evento**, não prova que o BotBot *executa* a renovação em si (mais
    provável: ele *avisa* sobre vencimentos, e a renovação continua
    manual ou via outro mecanismo).
  - A antiga tela **"ChatBot"** (com os links
    `/api/chatbot/{id}/{token}`) está **marcada como legada** pelo
    próprio painel ("As configurações do BotBot foram movidas
    para..."). Os dois links reais observados são explicitamente só
    de **teste grátis** ("TESTE - P2P & IPTV COM/SEM ADULTOS"). **Não
    há evidência de link equivalente para renovação** — a hipótese
    inicial (mesmo padrão de URL, mas para renovar) **não foi
    confirmada nem refutada**, porque não fomos além dessa tela (ver
    pendência, seção 9).
  - **Gateways de pagamento** (Mercado Pago, Asaas, paggpay) — vistos,
    com Mercado Pago (Primário) já configurado como forma principal.
    **Descartado pelo usuário como caminho a seguir.** Registrado aqui
    só para não perder o achado, não para retomar.

### 3.4 O que NÃO foi feito (importante, respeita a restrição desta sessão)

- **Nenhuma renovação real foi executada no Sigma.** Não naveguei até
  a tela "Clientes" do painel, não abri nenhum cliente real, não
  cliquei em nenhum botão "Renovar".
- Por consequência, **a requisição HTTP real que uma renovação manual
  dispara no Sigma ainda não foi observada** — esse é exatamente o
  próximo passo tecnicamente necessário (mesma metodologia da UniTV,
  seção 1), mas **requer autorização explícita para 1 renovação real
  em conta de teste**, que não foi dada hoje.

---

## 4. Aplicação aos outros painéis Sigma (Blaze, Channel TV) — INFERÊNCIA, AINDA PRECISA SER TESTADO

Não houve tempo/autorização nesta sessão para abrir sessão própria em
`blaze.officeb.site` ou `channeltv.top`. O que pode ser dito:

- **INFERÊNCIA razoável, não comprovada:** como o Rocket classifica os
  três (Blaze, Channel TV, NewOne) como o mesmo tipo `SigmaIntegracao`,
  é esperado que rodem o mesmo software (Smart TI) e portanto tenham a
  mesma estrutura de API (`/api/customers/*`, mesma autenticação por
  sessão, mesma tela de Integrações com BotBot/ChatBot legado/gateways).
- **Não comprovado:** domínios, contas de revendedor e credenciais são
  diferentes entre os três (`inovatvstream1` para Blaze vs. `inovatv`
  para os outros dois) — não é garantido que a versão do software, os
  planos disponíveis, ou até a presença de recursos como BotBot sejam
  idênticos. Cada um precisaria da mesma checagem feita na seção 3
  antes de assumir que o mecanismo é igual.

---

## 5. Estado pós-renovação — o que dá para consultar por painel

### UniTV (COMPROVADO)

Reconsulta da conta (mesma tela/endpoint de listagem/detalhe) devolve
pelo menos: **vencimento** (confirmado, é o campo usado no teste real).
Plano/pacote (`package_id`) e o próprio `sn` também aparecem no
payload de renovação, então presumivelmente also consultáveis depois
— não foi o foco do teste real, que validou especificamente vencimento
e crédito do revendedor.

### Sigma / NewOne (INFERÊNCIA, AINDA PRECISA SER TESTADO)

Não observei ainda uma resposta real de detalhe de cliente
(`GET /api/customers/{id}` ou equivalente) — só a existência do
recurso `customers` foi confirmada (seção 3.3). Campos esperados por
convenção de qualquer painel de revenda IPTV (vencimento, plano,
valor, servidor, usuário, telas) **ainda precisam ser confirmados na
prática**, abrindo um cliente real (leitura, sem ação) e observando a
resposta.

---

## 6. Sincronização com Rocket — mapeamento de campos já confirmado (COMPROVADO via especificação OpenAPI)

O Rocket já expõe, via `PATCH /gerenciador/api/v1/cliente/{public_id}`
(testado real duas vezes nesta investigação, funcionando), os campos
relevantes para espelhar o resultado de uma renovação — todos
opcionais, só os enviados são alterados (`ClienteEditarSchema`):

| Campo Rocket (PATCH) | Tipo | Relevante para espelhar renovação? |
|---|---|---|
| `vencimento` | date-time ou date | **Sim — o campo central.** |
| `hora_vencimento` | time | Sim, se o painel granular por hora |
| `plano` | string (nome) | Sim, se a renovação mudar de plano |
| `valor` | number ou string | Sim, se o valor mudar |
| `telas` | integer | Sim, se aplicável |
| `servidor` | string (nome) | Só se a renovação também trocar servidor (incomum) |
| `forma_de_pagamento` | string | Opcional, se quisermos registrar |

**Já comprovado nos dois testes reais desta investigação:** o PATCH
aceita `vencimento` em qualquer formato ISO válido e o Rocket converte
corretamente para o fuso `America/Sao_Paulo` documentado — não é mais
uma incerteza.

**O que ainda não está resolvido:** a *leitura* do lado do painel
(seção 5) — sem saber exatamente que campos/formato o Sigma devolve
depois de uma renovação real, não dá para fechar o mapeamento
campo-a-campo com certeza, só a direção geral (painel → Rocket via
PATCH, usando os nomes acima).

---

## 7. Mensagem final ao cliente — o Rocket já resolve isso, se o caminho certo for usado

Conforme já registrado (seção 2.5): o Rocket **já tem** um canal
próprio de confirmação automática — **RocketZap 2.0**, a integração de
WhatsApp nativa do Rocket, ligada ao número oficial
`5517996242415`. Isso já foi observado funcionando (é a origem real
das mensagens de confirmação de renovação já vistas no histórico de
conversa real).

**Implicação direta para a arquitetura proposta pelo usuário:** se a
sincronização painel→Rocket for feita através do **mesmo caminho que
já dispara o RocketZap** (ou seja, reproduzindo o que o modal "ADD
Pagamento" faz, com o toggle "Enviar Mensagem?" ativado — não só um
PATCH cru), **não precisamos de uma segunda confirmação pela Meta**.
O ciclo fecha exatamente como o usuário descreveu:

```
painel renovado → Rocket sincronizado → Rocket comunica o cliente (RocketZap)
```

**Ressalva real, já comprovada:** os dois testes de PATCH cru feitos
nesta investigação **não** dispararam RocketZap — só o fluxo "ADD
Pagamento" (hoje com o bug do "Pacote Sigma" quebrado, seção 2.5) faz
isso. Ou seja, replicar esse comportamento provavelmente vai exigir
entender **qual endpoint interno** o "ADD Pagamento" chama (não é
necessariamente o mesmo `PATCH` público que já usamos) — mais uma
frente de engenharia reversa (mesma metodologia da UniTV), ainda não
feita.

---

## 8. Tabela comparativa

| Painel | Renovação automática encontrada? | Método | Endpoint | Autenticação | Dados necessários | Estado pós-renovação | Como sincronizar Rocket | Obstáculos |
|---|---|---|---|---|---|---|---|---|
| **UniTV** (`panel-web.revenda.site`) | ✅ **Sim — COMPROVADO com PoC real** | `POST` | `/api/account/renew` | Header `token`/`Authorization` + `dealer_token`/`dealer_name` no corpo | `sn`, `id`, `package_id`, `pre_auth_id`, `points_type`, `points`, `sign` (MD5) | Vencimento (confirmado por reconsulta) | PATCH `vencimento` no Rocket (mapeamento direto) | Payload cifrado (AES fixo, já decifrado); Rocket não tem integração nativa com esse painel |
| **Sigma / NewOne** (`painel.onetv.plus`) | ⚠️ **Não confirmado — recurso `customers` existe, ação de renovação não observada** | Provavelmente `PATCH`/`POST` sob `/api/customers/*` (inferência por convenção) | Desconhecido | Sessão por cookie (`/api/auth/me`) — não inspecionado em detalhe | Desconhecido | Desconhecido (recurso existe, resposta de detalhe não observada) | PATCH no Rocket com os mesmos campos da seção 6 — mapeamento pronto assim que soubermos ler o painel | Requer 1 renovação real autorizada + captura de rede para mapear o endpoint (mesma metodologia da UniTV); "Renovar no Painel" do próprio Rocket está quebrado (bug real) |
| **Sigma / Blaze** (`blaze.officeb.site`) | ❓ **Não investigado nesta sessão** | — | — | — | — | — | — | Mesma investigação da NewOne precisa ser repetida lá (conta/sessão próprias) |
| **Sigma / Channel TV** (`channeltv.top`) | ❓ **Não investigado nesta sessão** | — | — | — | — | — | — | Idem Blaze |

---

## 9. Pendências reais para uma próxima sessão (nada autorizado aqui)

1. **Testar em 1 conta de teste do NewOne** (mesmo padrão da UniTV:
   interceptor passivo de `fetch`/XHR + 1 renovação manual real
   autorizada) para descobrir o endpoint/payload real de renovação do
   Sigma. Sem isso, a linha "Sigma / NewOne" da tabela continua em
   aberto.
2. **Ler o detalhe de um cliente real (`GET`, sem ação)** no painel
   NewOne para confirmar quais campos o Sigma devolve depois — permite
   fechar a seção 5 sem precisar de uma renovação de teste (é só
   leitura).
3. **Descobrir o que "ADD Pagamento → Renovar no Painel" realmente
   chama no backend do Rocket** — se usa o mesmo `PATCH` público ou um
   endpoint interno diferente. É a chave para a seção 7 (RocketZap
   automático).
4. **Repetir a seção 3 para Blaze e Channel TV** — sessão própria em
   cada painel, mesma checagem de rede.
5. **Aprofundar a tela ChatBot/BotBot** — nunca cheguei a clicar em
   "Criar Resposta" de verdade (só vi a tela legada de teste). Ficou
   em aberto se existe algum tipo de resposta configurável para
   "renovação" ali, ou se BotBot é só mensageria (SaaS externo) sem
   ação real no painel.

**Nenhuma dessas pendências foi executada. Todas exigem autorização
explícita e específica antes de qualquer ação real (renovação de
teste, clique em botão de ação) — mesma disciplina já usada em toda
esta investigação.**

---

## 10. Atualização — pesquisa externa (Telegram oficial) + achado real ao vivo (mesmo dia, sessão seguinte)

**Gatilho:** o usuário encontrou publicações do próprio canal oficial
do Rocket Gestor no Telegram confirmando "RENOVAÇÃO AUTOMÁTICA com
Painel SIGMA" e um mecanismo de busca automática do ID do cliente no
Sigma — evidência externa real de que o recurso existe no produto,
pedindo para descartar de vez BotBot/gateway e focar em **onde está o
gatilho técnico que o próprio Rocket usa**.

### 10.1 Pesquisa externa (COMPROVADO — texto literal de publicações oficiais)

Fonte: canal público `t.me/s/rocketgestoroficial` (Telegram oficial do
Rocket Gestor), lido diretamente (várias páginas, via `before=N`).

- **Post #196 (04:37), texto literal:**
  > "Agora não é mais necessário pegar o ID do Sigma manualmente ao
  > realizar uma renovação automática pelo Gestor. Como funciona
  > agora? Ao clicar em Adicionar pagamento e carregar os pacotes,
  > caso o cliente não tenha o ID do Sigma, o sistema irá: buscar o ID
  > de forma automática, salvar o ID diretamente nas informações do
  > cliente. Atenção: para que a busca automática funcione
  > corretamente, o usuário cadastrado no Gestor deve ser exatamente o
  > mesmo do painel Sigma."

  **Confirma exatamente o fluxo:** o gatilho é clicar **"Adicionar
  pagamento"** e o sistema **carregar os pacotes** — é nesse momento
  que o Rocket tenta localizar/gravar o ID do Sigma do cliente. Não é
  um botão/endpoint separado de "buscar ID".

- **Post #190 (21:58), sobre o painel Uniplay (mesma família de
  recurso, painel diferente), texto literal:**
  > "🧪 RENOVAÇÃO AUTOMÁTICA com Painel Uniplay [...] Renovação
  > automática no Gestor com o painel Uniplay ✅ Sincronização
  > completa: vencimento, hora de vencimento e senha atualizados de
  > acordo com o painel [...] Não é necessário adicionar o ID do
  > cliente do painel, o Gestor já faz isso sozinho."

  Confirma, para outro painel da mesma família (não achei post
  específico do Sigma com essa redação exata, mas o post #196 já
  confirma que o Sigma tem o mesmo mecanismo), que a sincronização
  pós-renovação cobre pelo menos **vencimento, hora de vencimento e
  senha** — bate com o que o usuário já tinha encontrado
  separadamente (que também citava telas e link M3U).

- **Post #202 (20:19)** lista os endpoints novos da API pública —
  **exatamente os mesmos já documentados no nosso
  `rocket_gestor_openapi.json` local** (cliente buscar/editar/listar,
  recursos, testes) — **sem nenhum endpoint de pagamento/renovação**.
  O mesmo post menciona **"a renovação automática de clientes já está
  em testes"**, "esta semana ou na próxima".

- **Achado importante de desambiguação (evita um caminho errado):**
  posts #205/#206/#207/#210/#213/#216 mostram que aquela "renovação
  automática de clientes em testes" citada no post #202 **evoluiu para
  o "Portal do Cliente"** — um recurso onde o **próprio cliente final**
  clica num link de pagamento (Mercado Pago, UpDePix, FastDePix, Lynx)
  e o Portal renova sozinho. **Isso é o caminho de gateway de
  pagamento que o usuário já descartou explicitamente** — não é o
  mesmo mecanismo do "Renovar no Painel"/Sigma. **Não confundir os
  dois:** "renovação automática de CLIENTES" (Portal, gateway,
  descartado) ≠ "RENOVAÇÃO AUTOMÁTICA com PAINEL Sigma/Uniplay/etc."
  (o que estamos investigando, dentro do fluxo "Adicionar pagamento").

- **Nenhum post encontrado** (nas páginas lidas) menciona uma API ou
  endpoint separado, chamável de fora, para acionar a renovação com
  painel — em todos os relatos, o gatilho descrito é sempre "clicar em
  Adicionar pagamento".

### 10.2 Achado real ao vivo — endpoint interno real encontrado + causa-raiz do bug confirmada (COMPROVADO por reprodução direta)

Reabri o modal **"ADD Pagamento"** do cliente de teste real (Js
Informática Rp / NewOne, mesmo cliente já usado nos testes de PATCH) e
capturei as requisições de rede reais que a própria interface disparou
ao abrir o modal — **sem clicar em Salvar, sem confirmar nenhuma
renovação**.

**Endpoint interno real, nunca documentado antes nesta investigação:**
```
GET https://app.rocketgestor.com/gerenciador/cliente/sigma/info/?cliente_id={id_interno_rocket}
```
- Autenticação: sessão (cookie do próprio painel web, não API Key) —
  é o mesmo domínio/padrão de sessão usado por todo o resto da
  interface `app.rocketgestor.com/gerenciador/*` (dashboard, gráficos
  etc.), **diferente** da API pública documentada no OpenAPI (que usa
  `X-API-Key` e é servida por outro caminho).
- `cliente_id` aqui é o **ID interno do Rocket** (`1553554` para este
  cliente) — **não é o `public_id`** usado no PATCH da API pública.
  São identificadores diferentes.
- Disparado automaticamente pelo próprio frontend ao abrir o modal
  "ADD Pagamento" de um cliente com servidor Sigma — é literalmente o
  "carregar os pacotes" descrito no post #196.

**Resposta real capturada (refeita a mesma chamada, mesma sessão, via
`fetch` de leitura — sem nenhuma alteração):**
```json
{
  "error": true,
  "msg": "{\n    \"message\": \"The route customers/https://painel.onetv.plus could not be found.\"\n}"
}
```

**Isto é exatamente o mesmo erro que o usuário já tinha encontrado
antes** ("Erro ao carregar pacotes" na tela + essa mensagem no
console) — agora capturado com o endpoint exato que o gera.

**Causa-raiz identificada com evidência direta (COMPROVADO, não mais
hipótese):** abri a tela "Editar cliente" (aba "Dados", só leitura,
fechada sem salvar) e o campo **"Painel id"** (descrição na própria
tela: *"Será usado para renovação no painel caso tenha integração com
o gestor"*) está preenchido, para este cliente, com:
```
https://painel.onetv.plus/
```
— **a URL do painel, não um ID numérico do cliente no Sigma.** Isso
bate perfeitamente com o erro: o backend do Rocket monta uma rota
interna do tipo `customers/{painel_id}` esperando um identificador
numérico do cliente no Sigma, mas recebe a URL inteira do painel no
lugar — resultando na rota malformada `customers/https://painel.onetv.plus`
que o próprio backend do Rocket não reconhece.

**Isso explica tecnicamente por que a renovação automática com Sigma
está quebrada hoje, para este cliente pelo menos:** o campo "Painel
id" nunca foi preenchido corretamente com o ID real do cliente no
Sigma (o mecanismo de busca automática do post #196 nunca rodou com
sucesso para ele, ou rodou e gravou o valor errado).

### 10.3 O que isso muda na resposta às perguntas do usuário

| Pergunta | Resposta com a evidência de hoje |
|---|---|
| O que acontece tecnicamente ao clicar "Adicionar pagamento" e selecionar o pacote Sigma? | **Confirmado:** dispara `GET /gerenciador/cliente/sigma/info/?cliente_id={id_interno}` (sessão), que busca/valida o ID do cliente no Sigma e carrega os pacotes disponíveis. |
| Qual endpoint o Rocket chama para efetivamente renovar? | **Ainda não observado** — o endpoint encontrado hoje é o de **carregar pacotes/info**, não o de **confirmar a renovação** (esse só dispararia ao clicar "Salvar" no modal, o que não foi feito). Seria o próximo passo natural (ex. `POST /gerenciador/cliente/sigma/renovar/` ou nome parecido, mesmo padrão de URL) — **hipótese por convenção de nomenclatura, não confirmada**. |
| Existe API/endpoint interno que possamos acionar externamente? | **Sim, existe um padrão real confirmado** (`/gerenciador/cliente/sigma/info/?cliente_id=X`, autenticado por sessão/cookie) — mas **autenticação por sessão de usuário, não API Key** é uma diferença técnica importante: acioná-lo "externamente" exigiria manter uma sessão autenticada do Rocket (cookie), não só a `ROCKET_API_KEY` que já usamos hoje na API pública. Isso muda a complexidade de qualquer automação futura por esse caminho. |
| Como o Rocket identifica o cliente no Sigma? | **Confirmado o mecanismo, mas com bug real:** campo `Painel id` no cadastro do cliente, deveria conter o ID numérico do cliente no Sigma, populado automaticamente quando "usuário cadastrado no Gestor é exatamente o mesmo do painel Sigma" (post #196) — **para o cliente testado, esse campo está com o valor errado (a URL do painel)**, o que quebra tudo a partir daí. |
| Como sincroniza depois os dados para o Rocket? | **Ainda não observado diretamente** — só temos a palavra oficial do Rocket (posts #190/#196, mais o que o usuário já tinha achado) de que vencimento/hora/telas/link M3U/senha são atualizados "de acordo com o painel". O mecanismo exato (se é resposta síncrona da chamada de renovação, ou uma sincronização separada depois) não foi observado. |

### 10.4 Nada disso foi corrigido ou alterado

**O campo "Painel id" incorreto não foi editado. Nenhum "Salvar" foi
clicado em nenhuma tela. Nenhuma renovação foi confirmada.** A única
ação de escrita evitada deliberadamente: seria possível, em teoria,
tentar corrigir manualmente o "Painel id" com o ID numérico certo do
Sigma (se soubéssemos qual é) para testar se isso desbloqueia o
carregamento de pacotes — **não tentado, exigiria descobrir o ID real
do cliente no Sigma primeiro (não temos) e alterar um dado real do
cliente, fora do escopo autorizado hoje.**

### 10.5 Pendências atualizadas (substituem/complementam a seção 9)

1. **Descobrir o ID real do cliente no Sigma** (ex.: abrindo a lista de
   clientes do painel `painel.onetv.plus` — leitura, achar o cliente
   correspondente ao telefone/usuário — e comparando com o padrão
   esperado pelo campo "Painel id"). Só leitura, sem alterar nada no
   Sigma.
2. **Testar, com autorização explícita, se corrigir manualmente o
   "Painel id" desse cliente de teste com o ID real do Sigma resolve o
   carregamento de pacotes** — isso sozinho não é uma renovação, é só
   dado de cadastro, mas ainda é uma escrita real e por isso não foi
   feito sem autorização.
3. **Repetir a captura de rede com o "Painel id" corrigido**, dessa vez
   observando o que acontece ao selecionar de fato um pacote (ainda
   sem clicar Salvar) — deve revelar mais um endpoint (provavelmente
   de listagem de pacotes de verdade, não mais o erro).
4. **Só depois, com autorização explícita e específica, uma única
   renovação real de teste** (clicar Salvar) — nesse momento, e só
   nesse momento, capturar o endpoint real de renovação (mesma
   metodologia da UniTV).
5. Testar se esse endpoint interno aceita chamada autenticada só por
   cookie de sessão a partir de um contexto externo (ex. script Node
   com sessão previamente autenticada) — relevante para decidir se dá
   para automatizar via HTTP puro ou se exigiria manter uma sessão de
   navegador viva.

**Conclusão desta atualização:** a pergunta do usuário — "existe uma
forma de acionar isso por HTTP sem abrir o painel e clicar
manualmente" — tem agora uma resposta técnica parcial e concreta: o
mecanismo É HTTP (endpoints reais sob `/gerenciador/cliente/sigma/*`),
mas autenticado por sessão de usuário do Rocket, não pela API Key
pública que já usamos. E, pelo menos para o cliente de teste
disponível, o mecanismo está com um dado de cadastro incorreto
("Painel id" = URL em vez de ID numérico), o que precisa ser
investigado/corrigido antes de qualquer teste de renovação real fazer
sentido.

---

## 11. Atualização — cadeia completa do lado Rocket (leitura estática do HTML/JS, sem executar nada) + ID real do Sigma encontrado + ponto onde a investigação parou

**Autorizado pelo usuário a continuar agora**, com a fronteira
explícita: investigar qual deveria ser o `Painel id` correto e como
obtê-lo, **sem alterar o cadastro do cliente e sem executar nenhuma
renovação real** sem autorização específica adicional.

### 11.1 Cadeia completa de chamadas do lado Rocket (COMPROVADO, leitura estática do HTML/JS da própria página, nenhuma delas é AJAX oculto — é tudo lido do código-fonte real da página, sem adivinhação)

Rocket **não tem um bundle JS próprio separado** — a lógica do modal
"ADD Pagamento" está embutida como `<script>` inline no próprio HTML
servido (Django, confirmado pelo campo `csrfmiddlewaretoken`), usando
Vue como runtime (carregado via CDN). Lendo esse HTML diretamente
(sem interceptar rede, só o código-fonte já carregado no navegador):

```
1. GET  /gerenciador/cliente/sigma/info/?cliente_id={id_interno_rocket}
   → confirma/descobre o ID do cliente no Sigma (mesmo endpoint já
     documentado na seção 10.2, aqui confirmado também estaticamente
     no código, não só por captura de rede)

2. GET  /gerenciador/cliente/sigma/packages/?cliente_id={id_interno_rocket}
   → NOVO endpoint encontrado nesta atualização — lista os pacotes
     Sigma disponíveis pra esse cliente (preenche o <select> "Pacote
     Sigma"). Ainda não observado com sucesso (client de teste
     quebrado, seção 10.2), mas o endpoint real tem esse nome.

3. Usuário preenche o formulário e clica "Salvar"
   → POST /gerenciador/pagamento/add/?id_cliente={id_interno_rocket}
   → **submissão de formulário HTML tradicional** (via
     `form.setAttribute('action', ...)`), não uma chamada AJAX/JSON —
     autenticada por sessão + csrfmiddlewaretoken, igual a qualquer
     navegação normal da página.
```

**Campos reais do formulário** (nomes exatos, lidos do HTML, atributo
`name`): `csrfmiddlewaretoken`, `vencimento`, `hora_vencimento`,
`plano`, `valor`, `forma_de_pagamento`, `telas`, `custo`,
`custo_creditos`, `data_pagamento`, `observacao`,
`atualizar_cliente`, `enviar_mensagem`, **`renovar_painel`**
(o toggle "Renovar no Painel?"), **`sigma_package_id`** (o pacote
Sigma selecionado, campo oculto — variáveis JS confirmadas:
`sigma_package_id_select`, `sigmaPackageHidden`,
`sigmaPackageSelect`).

**Isso responde de forma concreta, ainda que parcial, a pergunta "qual
endpoint efetivamente renova":** é o **mesmo** `POST
/gerenciador/pagamento/add/` usado para qualquer pagamento — a
renovação no Sigma não é uma chamada separada do lado do navegador,
é um **efeito colateral do lado do servidor** dessa mesma submissão,
condicionado ao campo `renovar_painel=true` + um `sigma_package_id`
válido. **Isso é uma conclusão por leitura de código, ainda não
confirmada por execução real** (não clicamos Salvar).

### 11.2 ID real do cliente no Sigma — encontrado (COMPROVADO, leitura direta no painel Sigma, só leitura)

Fui ao painel `painel.onetv.plus` (sessão já autenticada), aba
**Clientes**, busquei pelo usuário `2715749553` (mesmo valor do campo
"Usuario" no Rocket para este cliente de teste) e abri o registro
(tela "Editar Cliente", sem alterar nem salvar nada). A URL da tela
revela o ID real:

```
https://painel.onetv.plus/#/customers/edit/K4WrbeQ3We
```

**O ID real do cliente no Sigma é `K4WrbeQ3We`** — uma string
alfanumérica curta (10 caracteres), **não um número inteiro simples**.
Isso é uma informação nova importante: o campo `painel_id` que
aparece como `integer` no schema de leitura da API pública do Rocket
(`rocket_gestor_openapi.json`) provavelmente **não é o mesmo campo**
que o "Painel id" mostrado na tela de edição do cliente no Rocket —
ou o tipo documentado na API pública não reflete o formato real usado
internamente pela integração Sigma. **Não resolvido, fica como
pendência** (seção 11.4).

**Confirma, também, a causa-raiz já registrada na seção 10.2:** o
valor correto para o campo "Painel id" deste cliente de teste seria
`K4WrbeQ3We` — bem diferente do valor errado que está lá hoje
(`https://painel.onetv.plus/`). **Não alterado** — só documentado,
conforme a fronteira desta etapa.

**Achado extra, não perseguido ainda:** o rodapé do painel Sigma diz
"Powered by Sigma", e o link de suporte "Sigma" no menu de ações do
cliente aponta para `https://smart-ti.com/avisos` (avisos do
fornecedor real por trás da marca "Sigma", confirma o achado da
seção 3.1 sobre o Sentry `logs.smart-ti.com`) — não é um endpoint de
renovação, é só um link de avisos/suporte do fornecedor.

### 11.3 Onde a investigação parou — ponto real que exige clique real (não perseguido, por respeitar a fronteira desta etapa)

No mesmo menu de ações do cliente, no painel Sigma, existe um item
**"Renovar"** de verdade — **separado** da tela "Editar Cliente" que
já vimos (essa é só cadastro, mostra "Vencimento (Opcional)" mas é
edição geral, não a ação de renovação em si). Também existe, na barra
lateral do Sigma, um item **"Assistente de Renovação" com selo
"Beta"** — recurso ainda não explorado, nome sugestivo (pode ser
exatamente um assistente pensado para automatizar isso).

**Nenhum dos dois foi clicado.** Diferente do Rocket (HTML
server-renderizado, fácil de ler estaticamente), o Sigma é uma SPA Vue
com bundle JS **minificado e sem os textos "renew"/"renovar" em texto
literal** (pesquisado no bundle inteiro, 653KB, zero ocorrências) —
os rótulos vêm de um arquivo de tradução carregado à parte, e as
chamadas de API são montadas dinamicamente (não achei o path literal
tipo `/customers/{id}/renew` no bundle). **Isso significa que, para o
lado Sigma, a única forma prática de descobrir a chamada real é
observar a rede durante o clique de verdade em "Renovar"** — exatamente
a mesma situação/metodologia já usada com sucesso na UniTV (interceptor
passivo + 1 ação real autorizada), não dá para continuar só por
leitura estática como fizemos no Rocket.

### 11.4 Pendências reais, atualizadas

1. **Decisão pendente do usuário:** autorizar (ou não) clicar
   "Renovar" (ou abrir o "Assistente de Renovação") no cliente de
   teste do Sigma, com captura de rede, para finalmente observar o
   endpoint real de renovação do lado Sigma — isso é uma ação real
   (mesmo em conta de teste), então segue exigindo autorização
   específica, não incluída automaticamente nesta etapa.
2. **Alternativa mais próxima do objetivo final, ainda não tentada:**
   ao invés de renovar direto no Sigma, testar o fluxo do **Rocket**
   ("Adicionar pagamento" → "Renovar no Painel" → Salvar) — isso
   também é uma ação real (dispara o POST documentado na seção 11.1,
   que por sua vez aciona o Sigma do lado do servidor) e também requer
   autorização específica, mas é o teste que responde diretamente ao
   objetivo do usuário (capturar `Adicionar pagamento → Rocket → Sigma
   → resposta → atualização do Rocket` de ponta a ponta). **Pré-requisito
   real para esse teste funcionar:** o `Painel id` do cliente de teste
   precisaria estar correto primeiro (seção 11.2) — hoje está errado,
   então mesmo autorizando o teste, ele provavelmente falharia do
   mesmo jeito que já falhou (mesmo erro de rota), a menos que o
   `Painel id` seja corrigido antes (o que também é uma escrita real,
   pendente de autorização).
3. **Reconciliar o campo `painel_id` (integer) da API pública** com o
   ID alfanumérico real visto no Sigma (`K4WrbeQ3We`) — não
   investigado ainda, pode ser um campo diferente ou um formato de
   armazenamento diferente do que a API pública expõe.
4. ~~Explorar o "Assistente de Renovação (Beta)" do Sigma só por
   leitura~~ — **feito nesta mesma sessão, é um caminho descartado,
   ver 11.5.**
5. ~~Corrigir o `Painel id` do cliente de teste~~ — **feito, com
   autorização explícita e específica do usuário, ver 11.6. Confirmado
   que resolveu o bug.**

### 11.6 Correção aplicada (autorizada explicitamente) — bug confirmado resolvido

**Ação real, autorizada especificamente pelo usuário** ("Corrige o
Painel id desse cliente de teste pra K4WrbeQ3We"): campo "Painel id"
do cliente de teste (Js Informática Rp / NewOne) alterado de
`https://painel.onetv.plus/` para `K4WrbeQ3We` na tela "Editar" do
Rocket. **Nenhum outro campo tocado.** Confirmação do próprio Rocket:
"Js Informática Rp ALTERADO com sucesso".

**Verificação (só leitura — reabri "ADD Pagamento", sem selecionar
pacote nem clicar Salvar):**
- `GET cliente/sigma/info/?cliente_id=1553554` → **200** (antes
  retornava o erro de rota malformada).
- `GET cliente/sigma/packages/?cliente_id=1553554` → **200**, nunca
  tinha sido alcançado antes (a chamada anterior falhava e essa nem
  chegava a ser disparada).
- O campo "Pacote Sigma" carregou a lista real de pacotes do
  servidor NewOne: 15 dias, 1/3/6/12 meses, cada um em duas variantes
  (com/sem conteúdo adulto), com custo em créditos e número de telas
  — ex.: "1 MÊS - P2P & IPTV SEM ADULTOS - 1 créditos - 1 tela(s)".

**Confirma com evidência real (não mais leitura de código):** a
causa-raiz identificada na seção 10.2 estava certa — o valor errado no
"Painel id" era, sozinho, suficiente para quebrar toda a cadeia. Com o
valor certo, a cadeia funciona até o ponto testado (carregar pacotes).
**Nenhum pacote foi selecionado, nenhum "Salvar" foi clicado — a
renovação real em si continua não executada**, exatamente na
fronteira que o usuário definiu.

**Isso desbloqueia o próximo passo real:** agora que o "Renovar no
Painel" do Rocket funciona até aqui, um teste controlado (selecionar
1 pacote + clicar Salvar, com captura de rede) capturaria a cadeia
completa de ponta a ponta — exatamente o que falta pra fechar a
pergunta original do usuário. **Ainda não autorizado.**

---

## 12. TESTE CONTROLADO REAL EXECUTADO (autorizado explicitamente, 2026-08-21) — cadeia completa confirmada de ponta a ponta

**Autorização do usuário:** "Sim, pode fazer o teste controlado."
Execução real, única, no cliente de teste (Js Informática Rp / NewOne,
`public_id` já usado em todos os testes de PATCH anteriores desta
investigação). Pacote selecionado: **"1 MÊS - P2P & IPTV SEM ADULTOS -
1 créditos - 1 tela(s)"** (mesmo tipo do plano real do cliente, "Mensal").
Toggles mantidos no padrão da tela (todos ligados): Atualizar dados do
cliente, Enviar Mensagem, Renovar no Painel.

### 12.1 Requisição real capturada (COMPROVADO)

```
POST https://app.rocketgestor.com/gerenciador/pagamento/add/?id_cliente=1553554
Status: 200
```
Única requisição visível no navegador — confirma a conclusão da seção
11.1: não existe uma segunda chamada AJAX separada para "renovar no
Sigma" do lado do cliente. Tudo (Sigma + RocketZap + atualização do
próprio Rocket) acontece como efeito colateral **do lado do
servidor**, dentro do processamento desse único POST.

### 12.2 Resultado — 4 confirmações reais, nesta ordem exata

```
✅ Cliente renovado com sucesso no SIGMA
✅ Dados do cliente atualizado
✅ Mensagem enviada com sucesso
✅ Pagamento salvo com sucesso
```

**Isso é a primeira evidência real, ponta a ponta, de que a
arquitetura "painel primeiro, Rocket depois" que motivou todo este
levantamento realmente funciona tecnicamente através do Rocket** — e
prova, ao vivo, que a mensagem de confirmação ao cliente **já
acontece automaticamente** quando o fluxo certo é usado (diferente
dos testes de PATCH cru anteriores, seção 2.5, que nunca disparavam
RocketZap).

### 12.3 Verificação independente nos dois sistemas (COMPROVADO, leitura em ambos)

**No Rocket** (lista de clientes, recarregada após o POST):
```
Vencimento antes:  08/10/2026 23:59
Vencimento depois: 08/11/2026 20:59   ← exatamente +1 mês
```

**No Sigma** (mesmo cliente, `2715749553`, aba Clientes, reconsultado
de forma independente):
```
Plano:      1 MÊS - P2P & IPTV SEM ADULTOS   ← exatamente o pacote escolhido
Vencimento: 08/11/2026, 23:59:59
Créditos do revendedor: 14 → 13              ← 1 crédito debitado, bate com "1 créditos" do pacote
```

**A renovação aconteceu de verdade no Sigma** (não é só o Rocket
"fingindo" um sucesso) — confirmado por reconsulta independente, com
o crédito realmente debitado e o plano realmente trocado.

### 12.4 Achado real novo — divergência de horário entre Sigma e Rocket (COMPROVADO, não hipótese)

```
Sigma:  08/11/2026 23:59:59
Rocket: 08/11/2026 20:59:XX
```
**Diferença de exatamente 3 horas** — coincide exatamente com o
offset do fuso `America/Sao_Paulo` (UTC-3). **Leitura mais provável:**
o vencimento que o Sigma devolve (`23:59:59`) provavelmente já está em
horário local, mas algum ponto da sincronização Sigma→Rocket trata
esse valor como UTC e aplica a conversão pra `America/Sao_Paulo` de
novo, subtraindo 3 horas indevidamente (dupla conversão de fuso).
**Isso é uma inconsistência real de dados entre os dois sistemas,
gerada pela própria "renovação automática com Sigma" do Rocket** — não
foi causada por nada que fizemos, é um comportamento nativo do
produto, útil de saber antes de decidir confiar no vencimento
sincronizado automaticamente sem checar a hora.

### 12.5 O que isso responde, definitivamente, da pergunta original do usuário

| Pergunta original | Resposta, agora com execução real |
|---|---|
| Existe renovação automática com Sigma no Rocket? | **Sim, confirmado com execução real, não só documentação.** |
| Qual o gatilho técnico? | `POST /gerenciador/pagamento/add/?id_cliente={id}` — formulário único, autenticado por sessão, campos `renovar_painel=true` + `sigma_package_id={id_do_pacote}`. |
| Existe uma API separada só pra isso? | **Não** — é o mesmo endpoint de "adicionar pagamento" de sempre; o efeito no Sigma é condicional aos campos enviados, decidido no servidor. |
| Como sincroniza de volta pro Rocket? | Confirmado automático e imediato (mesma resposta do POST) — mas com uma imprecisão real de 3h no horário (seção 12.4), então **vencimento em si está certo, hora não**. |
| Precisamos de uma segunda confirmação pela Meta? | **Não** — confirmado que o Rocket já envia a mensagem de confirmação sozinho (RocketZap) como parte do mesmo fluxo, sem precisar de nada nosso. |

### 12.6 O que ainda não foi testado/decidido

- **Autenticação por sessão, não API Key:** este teste foi feito
  manualmente, logado no navegador como `Jose Antonio`. Repetir esse
  POST a partir de um sistema nosso (fora do navegador) exigiria obter
  e manter uma sessão autenticada do Rocket (cookie de login), já que
  esse endpoint não aceita `X-API-Key` — **isso não foi testado**, fica
  como a próxima pergunta técnica real antes de considerar qualquer
  automação.
- O `csrfmiddlewaretoken` também precisaria ser obtido e enviado
  corretamente em qualquer chamada automatizada — **não testado**.
- Não testamos ainda **um cliente sem `Painel id` nenhum** (vazio, não
  errado) — só corrigimos um que já tinha valor errado. Comportamento
  nesse caso (a busca automática do post #196 dispara sozinha?) segue
  como hipótese, não confirmado.
- A divergência de 3h (seção 12.4) não foi investigada a fundo — não
  sabemos se afeta só a exibição, ou se o valor errado (`20:59`) é o
  que fica de fato gravado e usado pelo Rocket dali em diante.

**Nada além deste único teste, explicitamente autorizado, foi
executado.** Nenhuma segunda renovação, nenhum outro cliente tocado.

---

## 13. Como manter uma sessão autenticada do Rocket por script — levantamento técnico (2026-08-21, nenhuma renovação, nenhuma alteração de cliente)

**Objetivo desta seção:** descobrir se um sistema nosso consegue obter
e reutilizar uma sessão autenticada do Rocket pra chamar
`POST /gerenciador/pagamento/add/?id_cliente=...` sem depender de
alguém logado manualmente no navegador. **Nenhuma renovação real,
nenhuma alteração de cliente, nenhuma tentativa real de login por
script foi executada** — tudo abaixo é leitura da página real de
login (buscada sem cookies, `credentials: 'omit'`, só pra ver o HTML
público da tela, sem usar a sessão já autenticada) e inspeção dos
cookies já existentes no navegador.

### 13.1 Como o login funciona tecnicamente (COMPROVADO, HTML real da tela de login)

- **URL:** `https://app.rocketgestor.com/accounts/login/?next=/gerenciador/`
  — padrão exato do Django (`django.contrib.auth`, `LOGIN_URL` default)
  — confirma que a autenticação é feita com um framework conhecido e
  bem documentado, não algo customizado/obscuro.
- **Formulário real** (`id="login-form"`, `method="post"`), 3 campos
  visíveis: `username`, `password`, `csrfmiddlewaretoken` (hidden,
  valor único por carregamento de página — precisa ser lido de um GET
  antes de qualquer POST).
- **Sem "lembrar-me"** — não existe opção de sessão estendida.
- **Sem campo de 2FA/OTP** na tela de login em si.

### 13.2 Bloqueio real encontrado — Cloudflare Turnstile obrigatório (COMPROVADO, é o achado mais importante desta seção)

```html
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
<div class="cf-turnstile" required id="id_turnstile" data-sitekey="0x4AAAAAAA9DWEH-iYYhSeyZ"></div>
```

**O login exige passar por um desafio real do Cloudflare Turnstile**
(a alternativa da Cloudflare ao reCAPTCHA), marcado como `required`.
Isso significa que **um script HTTP simples (axios/`fetch` do
Node.js) não consegue fazer login sozinho** — ele precisaria enviar
um token de resposta do Turnstile que só é gerado executando o
JavaScript real da Cloudflare dentro de um navegador de verdade (ou
motor equivalente). Sem esse token, o Django provavelmente rejeita o
POST de login (não testado — não tentamos logar por script, só
confirmamos que o campo existe e é obrigatório na própria página).

**Isso é, sozinho, o fator decisivo desta investigação** — muda a
resposta de "só precisamos guardar usuário/senha" para "precisamos de
um navegador de verdade (ou headless) pelo menos na etapa de login".

### 13.3 Cookies envolvidos (COMPROVADO, inspecionado no navegador já logado)

```js
document.cookie → ["_ga", "_fbp", "csrftoken", "_ga_ZFTGBFNEXE"]
```
- **`csrftoken`** — visível/legível por JavaScript (cookie não-HttpOnly,
  padrão do Django, existe justamente pra ser reenviado em requisições).
- **O cookie de sessão em si (provavelmente `sessionid`, nome padrão do
  Django) NÃO aparece nessa lista** — está protegido como `HttpOnly`,
  ou seja, invisível a qualquer JavaScript rodando na página (proteção
  padrão contra roubo de sessão via XSS). **Isso não impede
  automação por script** — um cliente HTTP de verdade fazendo o login
  ele mesmo (não lendo de dentro da página) recebe esse cookie
  normalmente via `Set-Cookie` na resposta do POST de login, e pode
  guardá-lo/reenviá-lo como qualquer outro cookie. O `HttpOnly` só
  bloqueia leitura via JS da própria página, não bloqueia um cliente
  HTTP dedicado.

### 13.4 Duração da sessão e mecanismo de refresh (NÃO CONFIRMADO — inferência)

**Não foi possível confirmar tecnicamente** quanto tempo a sessão dura
nem se existe refresh automático, sem alterar cookies ou esperar a
sessão expirar de verdade (fora do escopo autorizado hoje). **Inferência
razoável, não comprovada:** por ser Django puro (seção 13.1), o
comportamento mais provável é o padrão do framework —
`SESSION_COOKIE_AGE` de 2 semanas (1.209.600 segundos), sem "remember
me" pra estender. Django não tem conceito de "refresh token" (isso é
padrão OAuth, não do sistema de sessão do Django) — a sessão
simplesmente permanece válida até o cookie expirar ou o servidor
invalidar (ex.: troca de senha).

### 13.5 Risco real de invalidação (INFERÊNCIA, baseada em padrão conhecido do próprio projeto)

- **Troca de senha do usuário derruba a sessão** — já aconteceu neste
  projeto antes (seção do Painel de Atendimento, `inovatv_central/CLAUDE.md`)
  com o Supabase Auth, mesma lógica se aplica aqui.
- **Cloudflare pode desconfiar de tráfego automatizado mesmo com
  cookie de sessão válido** — o Turnstile do login é só a primeira
  camada; é comum sites atrás de Cloudflare aplicarem heurísticas
  adicionais (fingerprint de TLS/headers, cadência de requisições) em
  chamadas subsequentes também, não só no login. **Não testado, é um
  risco a considerar, não um fato confirmado.**
- Sem "Sessões Ativas" (equivalente ao que o Sigma tem) visto no
  Rocket até agora — não dá pra saber, pela própria interface, se
  múltiplas sessões simultâneas (José logado no navegador + uma
  sessão de script) coexistem sem conflito. Django, por padrão, não
  restringe sessões concorrentes — mas isso é o padrão do framework,
  não uma confirmação específica da configuração do Rocket.

### 13.6 Alternativa oficial/documentada — já mapeada, não cobre este endpoint

O Rocket já tem um mecanismo oficial e documentado de autenticação
programática: `X-API-Key`, usado por toda a API pública
(`/gerenciador/api/v1/*`, `rocket_gestor_openapi.json`) — é o mesmo
mecanismo que a `inovatv-api-intermediaria` já usa hoje (`ROCKET_API_KEY`).
**Confirmado, seção 2.1 deste documento: esse endpoint específico
(`/gerenciador/pagamento/add/`) não faz parte dessa API pública** — é
uma rota interna do próprio site (`/gerenciador/*`, autenticada por
sessão de usuário, CSRF do Django), não da API `/api/v1/*`. Não existe
uma forma oficial documentada de acionar especificamente essa rota
sem ser via sessão de usuário autenticado.

### 13.7 Viável para automação de verdade?

**Resposta: B — viável, mas exige intervenção periódica (não é A).**

- **Não é A** ("viável para automação persistente", tipo guardar a
  API Key uma vez e nunca mais pensar nisso): o Turnstile obrigatório
  no login (13.2) impede um script HTTP simples de logar sozinho, do
  zero, sempre que precisar — não dá pra tratar isso como uma chave
  fixa reaproveitável indefinidamente sem nenhuma peça a mais.
- **Não é C** ("não viável"): existe um caminho real — um navegador de
  verdade (headless, ex. Playwright/Puppeteer) consegue carregar a
  página de login de verdade, deixar o JavaScript real da Cloudflare
  rodar (Turnstile em modo não-interativo costuma passar sozinho pra
  tráfego que parece um navegador legítimo, sem exigir clique humano),
  fazer login, e capturar os cookies resultantes (`sessionid` +
  `csrftoken`). **Depois disso, o cookie pode ser reutilizado em
  quantas chamadas HTTP simples forem necessárias** — POSTs comuns
  pra `/gerenciador/pagamento/add/`, sem precisar de navegador de novo,
  até a sessão expirar ou ser invalidada.
- **É B** por isso: a parte fácil (reusar a sessão pra muitas
  renovações) é viável; a parte difícil (obter/renovar a sessão em si)
  exige uma peça de infraestrutura mais pesada (um navegador de
  verdade rodando de vez em quando), não é "configura uma vez e
  esquece" como uma API Key tradicional.

### 13.8 Arquitetura mais segura, SE isso vier a ser implementado (registrado como referência, nada implementado)

```
Peça 1 (rara, pesada) — Login headless
  Executa só quando necessário (agendado, ex. 1x/dia, ou sob demanda
  quando uma chamada falhar por sessão expirada)
  Roda um navegador real headless (Playwright), login real, resolve o
  Turnstile como qualquer navegador legítimo resolveria
  Credenciais do Rocket como secret, nunca em código
  Resultado: sessionid + csrftoken frescos, guardados com segurança
  (mesmo padrão já usado pra ROCKET_API_KEY hoje)
      ↓
Peça 2 (frequente, leve) — Chamada real de renovação
  Edge Function/Orquestrador já existente, sem navegador nenhum
  Lê sessionid + csrftoken guardados
  POST direto em /gerenciador/pagamento/add/?id_cliente=X
  Se vier 401/redirecionamento pra login → sessão expirou →
  aciona a Peça 1 de novo (sob demanda) e tenta de novo
```

**Onde rodar a Peça 1 sem contrariar a regra permanente do projeto
("nunca VPS, nunca custo recorrente novo"):** GitHub Actions (dentro
do repositório já existente) é a opção mais natural — minutos de CI
gratuitos, sem contratar nada novo, já é infraestrutura que o
ecossistema InovaTV já usa (git/CI). **Isso é uma sugestão de
arquitetura pra registro, não uma decisão tomada nem algo
implementado.**

**Ressalva importante, honesta:** esse caminho inteiro é **não
oficial** — depende do HTML/comportamento atual do site do Rocket, que
pode mudar sem aviso (diferente da API pública documentada, que tem um
contrato). Isso é um risco real de manutenção a considerar, não um
detalhe técnico menor.

### 13.9 O que ainda não foi testado (pendências reais)

1. Se um login headless real (Playwright) de fato passa pelo Turnstile
   sem interação — **inferência baseada em como Turnstile costuma se
   comportar, não testado neste projeto**.
2. Duração real da sessão (13.4) — só inferência de padrão Django, não
   medida.
3. Se chamadas subsequentes (depois do login) sofrem alguma checagem
   extra da Cloudflare além do cookie de sessão — não testado.
4. Nenhuma tentativa de login por script foi feita — nem com sucesso
   nem com falha. **Isto é 100% levantamento, sem execução.**

### 11.5 "Assistente de Renovação (Beta)" — explorado só por leitura, é um caminho descartado (COMPROVADO, sem nenhuma ação disparada)

Aberto (`#/customers/renewal-assistant`), lido por completo, **nada
clicado/enviado**. Conclusão: **não é o mecanismo que procuramos** —
é uma ferramenta de **campanha de recuperação via WhatsApp** para
clientes já vencidos, não uma renovação executada pelo revendedor:

- Depende do **BotBot conectado** (mesmo SaaS externo já descartado
  nesta investigação, seção 3.3).
- A mensagem gerada inclui uma tag `{pay_url}` — um **link de
  pagamento para o próprio cliente clicar e pagar** (ex.:
  `https://panel.exemplo.com/renovar/preview?promocode=AUTO-GENERATED`)
  — ou seja, é a mesma família do "Portal do Cliente"/gateway de
  pagamento que o usuário já descartou explicitamente, só que do lado
  Sigma em vez do lado Rocket.
- Envia via WhatsApp em lote, com intervalo configurável entre envios
  e aviso explícito de risco de banimento por spam — reforça que é
  ferramenta de marketing/recuperação, não de execução técnica de
  renovação.
- "Agendamento automático" está marcado **"EM BREVE"** (não
  implementado ainda no próprio Sigma).

**Não descarta nada da investigação principal** — o alvo continua
sendo o item **"Renovar"** simples do menu de ações do cliente (seção
11.3), que é uma ação direta do revendedor sobre a conta, sem
depender de BotBot nem de o cliente pagar um link.

---

## 14. Sessão capturada manualmente + reutilização por HTTP puro + monitoramento automático — COMPROVADO (2026-08-21, sessão seguinte, máquina diferente da que rodou as seções 1-13)

> Esta seção documenta a continuação direta da pendência real deixada
> em aberto na seção 12.6: *"repetir esse POST a partir de um sistema
> nosso exigiria obter e manter uma sessão autenticada do Rocket...
> não foi testado"*. Ela foi resolvida aqui, com evidência real.

### 14.1 Tentativa de automatizar o login — headless, BLOQUEADA (COMPROVADO)

Script Playwright (`scripts/teste-login-rocket-turnstile.mjs`, novo
repositório `inovatv_meta_business_agent`, dependência `playwright`
adicionada só para este fim) tentou logar sozinho em
`https://app.rocketgestor.com/accounts/login/`, preenchendo
usuário/senha reais e aguardando o Turnstile resolver (até 20s).
**Resultado: bloqueado.** O Turnstile nunca gerou token
(`cf-turnstile-response` continuou vazio) e o Rocket recusou o login
com a mensagem literal:
```
Please prove you are a human.
```

### 14.2 Tentativa com navegador VISÍVEL (headed) — TAMBÉM BLOQUEADA (COMPROVADO)

Hipótese testada: talvez o bloqueio fosse específico do modo
headless. Reexecutado com `headless: false` (janela real, visível),
sem preencher nada por script — o usuário digitou usuário/senha reais
e resolveu o Turnstile manualmente, como sempre faz. **Resultado:
bloqueado de novo**, mesma tela de erro do Cloudflare ("Essa
verificação pode falhar por vários motivos..."). **Conclusão:** o
bloqueio não é do comportamento de digitação — é do próprio navegador
ser controlado por automação (Playwright/CDP), independente de
headless ou headed. Descartada também a hipótese de que uma sessão
paralela no Chrome normal do usuário interferisse (contextos do
Playwright são isolados, sem cookies compartilhados) — confirmada
irrelevante ao repetir o teste com logout prévio da outra sessão,
mesmo resultado.

**Decisão explícita, mantida em toda a investigação a partir daqui:
não tentar contornar o Turnstile por nenhuma técnica de evasão**
(stealth plugins, fingerprint spoofing, etc.) — o login continua
sendo sempre feito por um humano de verdade.

### 14.3 Captura manual via DevTools — o caminho que funcionou (COMPROVADO)

Com a automação do navegador descartada, a captura passou a ser 100%
manual: usuário loga no seu Chrome normal (não automatizado),
resolve o Turnstile normalmente, abre DevTools (F12) → Application →
Cookies → `app.rocketgestor.com`, copia os valores de `sessionid` e
`csrftoken` (o segundo cookie precisou ser refeito uma vez após o
usuário trocar a senha do Rocket no meio da investigação — troca de
senha invalida a sessão anterior, comportamento padrão do Django).
Valores colados manualmente num arquivo local
(`scripts/.credentials/rocket-session.json`, `.gitignore` já cobria
`.env*`/`scripts/.credentials/`), nunca colados na conversa.

### 14.4 Reutilização por HTTP puro, sem navegador — leitura (COMPROVADO)

Script `testar-leitura-sessao-rocket.mjs`: `GET
/gerenciador/cliente/sigma/info/?cliente_id=1553554` (cliente de
teste Js Informática Rp/NewOne), enviando só os dois cookies capturados
como header `Cookie`, sem nenhum navegador. **Resultado: `200`,
resposta real** (`id: "K4WrbeQ3We"`, `server: "NEW ONE P2P & IPTV"`,
`package`, `expires_at`, `status: "ACTIVE"`) — confirma que a sessão
capturada manualmente é reutilizável fora do navegador, sem passar
pelo Turnstile de novo. **Achado colateral:** essa resposta também
inclui `m3u_url`/`m3u_url_short`, que contêm a **senha real do
cliente em texto puro** (necessária pro link M3U funcionar) — mais
exposto que os endpoints da API pública, que nunca devolvem senha.
Registrado como cuidado a considerar se esse endpoint específico for
usado em produção — nada feito a respeito ainda.

### 14.5 Reconhecimento da UI real com sessão injetada (COMPROVADO, somente leitura)

Script `reconhecer-ui-rocket.mjs`: sessão injetada (`context.addCookies`)
num navegador headless **sem login nenhum** (logo, sem Turnstile
envolvido — só páginas depois do login precisam da sessão, nunca do
desafio). Confirmado: dashboard carrega normal
(`https://app.rocketgestor.com/gerenciador/`, título "Dashboard",
usuário "Jose Antonio"); lista de clientes
(`/gerenciador/clientes/`) acessível, campo de busca real
`#pesquisar-cliente`; cliente de teste localizado em
`/gerenciador/cliente/info/019ff025-ae5a-7e96-a037-8cfec84178d1/`
(mesmo `public_id` já usado nos testes de PATCH da API pública —
confirma que é o mesmo identificador em ambos os sistemas). Modal
real "Adicionar pagamento" localizado (botão
`data-bs-target="#modal-add-pagamento"`, botão Salvar
`#btn_adicionar_pagamento`) e seus campos lidos diretamente do DOM
(bate exatamente com os nomes já documentados na seção 11.1).

### 14.6 Teste controlado de renovação REAL — repetido via script, sem clique humano no momento (COMPROVADO)

Diferença importante em relação ao teste da seção 12: **daquela vez
foi um clique manual na UI; desta vez foi inteiramente por script**,
reaproveitando só a sessão já capturada — nenhuma interação humana no
momento da chamada de renovação em si.

Metodologia (`preparar-renovacao-controlada.mjs` seguido de
`executar-renovacao-controlada.mjs`): sessão injetada → abre o modal
real → marca "Renovar no Painel" → aguarda o `<select>` de pacotes
Sigma carregar de verdade (mesma chamada `GET
.../sigma/packages/` já documentada) → seleciona a opção "1 MÊS -
P2P & IPTV SEM ADULTOS - 1 créditos - 1 tela(s)" (mesmo pacote do
teste anterior) → **dump completo do estado do formulário antes de
qualquer clique** (screenshot enviado ao usuário para revisão) →
só depois de confirmação explícita, clique real em "Salvar".

**Estado do formulário confirmado antes do envio** (tudo auto-calculado
pelo próprio JS do Rocket, nada adivinhado por nós):
```
action: /gerenciador/pagamento/add/?id_cliente=1553554
vencimento novo: 2026-12-09 20:59 (calculado a partir do vencimento
  atual + período do plano)
plano: 53886 (Mensal) · valor: 35.0 · forma_de_pagamento: 9635
telas: 1 · custo: 5.5 créditos · custo_creditos: 1
sigma_package_id: rlKWO3Wzo7
toggles: atualizar_cliente ✓ · enviar_mensagem ✓ · renovar_painel ✓
```

**Resultado real do clique em Salvar:**
```
POST /gerenciador/pagamento/add/?id_cliente=1553554 → 302

✅ Cliente renovado com sucesso no SIGMA
✅ Dados do cliente atualizado
✅ Mensagem enviada com sucesso
✅ Pagamento salvo com sucesso
```

**Verificação independente nos dois sistemas** (reconsulta separada,
depois do fato):
| | Antes | Depois |
|---|---|---|
| Sigma (reconsultado à parte) | vencimento anterior (09/11/2026) | `1 MÊS - P2P & IPTV SEM ADULTOS`, vencimento `2026-12-09T02:59:59Z`, status `ACTIVE` |
| Rocket (página do cliente recarregada do zero) | — | `Vencimento: 08/12/2026 - 20:59` |

A mesma divergência de ~3h entre Sigma e Rocket já documentada na
seção 12.4 **se repetiu de forma idêntica** — reforça que é
comportamento nativo consistente do produto, não um artefato do
nosso teste.

**Isto fecha, com evidência real, a pendência da seção 12.6:** sim, é
possível repetir a cadeia inteira (`sessão capturada → HTTP puro →
Rocket → Sigma → renovação real`) a partir de um sistema nosso, sem
navegador, sem login novo, sem Turnstile — desde que a sessão já
tenha sido capturada manualmente antes.

### 14.7 Armazenamento seguro (Supabase Vault) — decidido e confirmado disponível antes de depender dele (COMPROVADO)

Decisão explícita do usuário: `sessionid`/`csrftoken` nunca numa
tabela comum em texto puro. Confirmado, por consulta direta ao banco
real (`inovatv-api-intermediaria`, `nduxsuxkopuvhwugdkqi`, não
suposição): extensão `supabase_vault` v0.3.1 já instalada e
funcional, com `vault.create_secret`/`vault.update_secret`
disponíveis.

**Desenho final:** duas RPCs `SECURITY DEFINER`
(`rocket_sessao_definir`/`rocket_sessao_ler`), `REVOKE` de
`anon`/`authenticated`, `GRANT EXECUTE` só a `service_role` — nenhuma
outra parte do sistema (Painel de Atendimento, frontend, anon key)
consegue ler ou escrever a sessão, mesmo sabendo o nome das funções.
Estado operacional (status, timestamps) numa tabela separada,
comum, **sem nenhum valor sensível dentro** —
`rocket_session_estado` (linha única).

### 14.8 Monitoramento automático + alerta via GitHub Issues — implementado, deployado, testado de ponta a ponta (COMPROVADO)

Repositório `inovatv-api-intermediaria` (código de produção, migration
`20260821150000_rocket_session_monitoramento.sql`):

- **`atualizar-sessao-rocket`** (Edge Function): único ponto de
  escrita, protegido por token interno dedicado
  (`SESSAO_ROCKET_UPDATE_TOKEN`, checado antes de tudo, nunca
  refletido em log/resposta). Grava a sessão via
  `rocket_sessao_definir`, faz uma verificação real imediata (`GET
  /gerenciador/`) para confirmação rápida.
- **`monitorar-sessao-rocket`** (Edge Function): primeira vez que este
  projeto usa Cron Job real do Supabase — `pg_cron` (v1.6.4) e
  `pg_net` (v0.20.4) habilitados pela primeira vez, agendado a cada 4h
  (`0 */4 * * *`). O token de autenticação da chamada
  (`X-Internal-Token`) é lido do **Vault em tempo de execução** —
  o texto do cron job em si (visível em `cron.job`) nunca contém o
  valor, só a referência por nome.
- **Detecção de sessão inválida:** só conta como inequívoco um
  redirect real para `/accounts/login/` ou HTML reconhecível da tela
  de login. Erro de rede/timeout **nunca** marca a sessão como
  inválida — só é ignorado e tentado de novo no próximo ciclo.
- **Alerta via GitHub Issues** (`InovaTV/inovatv-api-intermediaria`,
  label `sessao-rocket`), token dedicado (`GITHUB_ALERT_TOKEN`,
  fine-grained, escopo só `Issues: read/write` nesse único
  repositório — nunca o token amplo da `gh` CLI interativa). Alerta
  só na transição `valida → invalida`; enquanto continuar inválida,
  nenhuma issue nova; quando uma sessão nova válida é confirmada, o
  estado volta sozinho pra `valida` e limpa os campos de alerta.

**Sequência real de teste, executada nesta sessão (nenhuma renovação
de cliente feita durante este teste):**
1. Sessão real (a mesma da seção 14.6) enviada via
   `atualizar-sessao-remota.mjs` → gravada no Vault → verificação
   imediata confirmou válida.
2. Disparo do monitoramento pelo mesmo caminho exato do cron real
   (`net.http_post` lendo o token do Vault) → `{"outcome":"valida",...}`,
   `ultima_verificacao_bem_sucedida_em` avançada — confirma o ciclo
   real funcionando de ponta a ponta.
3. Sessão corrompida deliberadamente (valores inválidos de propósito,
   via `atualizar-sessao-rocket`) → `sessaoValidada: false`, mas
   status **não** mudou ainda (regra: uma única checagem logo após
   gravar não decide sozinha).
4. Monitoramento disparado de novo → detectou a sessão inválida,
   **transição real registrada**, **Issue #1 criada** no GitHub
   (`⚠️ Sessão do Rocket expirada`, corpo com data de detecção e
   última verificação válida conhecida).
5. Monitoramento disparado uma terceira vez, ainda inválida →
   `{"outcome":"invalida_ja_alertada"}` — **confirmado: nenhuma issue
   duplicada** (só 1 issue existia no repositório neste momento).
6. Sessão real restaurada via `atualizar-sessao-remota.mjs` → estado
   voltou sozinho para `valida`, `sessao_invalidada_em`/
   `alerta_issue_numero`/`alerta_issue_criado_em` limpos.
7. Issue #1 fechada manualmente com comentário explicando que era
   teste deliberado — não ficou um alerta real "pendurado" sem
   corresponder à realidade.

### 14.9 O que fica em aberto, registrado sem resolver por conta própria

- **Duração real da sessão** — ainda não medida, só será conhecida com
  o tempo, observando o próprio monitoramento em produção.
- **`m3u_url` expondo senha do cliente** (seção 14.4) — achado
  registrado, nenhuma decisão tomada sobre isso ainda.
- **Gatilho da Meta ligado a esta infraestrutura** — deliberadamente
  fora de escopo desta etapa, por instrução explícita do usuário
  ("não comece ainda a implementação do gatilho da Meta"). Ver
  `CLAUDE.md`, seção 16, para o resumo de estado e o que isso
  habilita.
