# Matriz de Migração — RocketZap → Infraestrutura Própria da InovaTV

> **Levantamento somente leitura, nada implementado.** Nenhum código,
> banco, configuração do Rocket ou deploy foi alterado nesta etapa.
> Toda evidência de conteúdo/gatilho foi coletada por navegação real e
> autenticada no painel `app.rocketgestor.com` (sessão do usuário),
> sem clicar em nenhuma ação destrutiva (desconectar, apagar, enviar,
> salvar configuração alterada). Continua a investigação registrada em
> `2026-08-21_renovacao_automatica_painel_primeiro.md` e
> `2026-08-21_gatilho_meta_renovacao.md` — não duplica o conteúdo já
> lá, só acrescenta o que foi visto de novo nesta sessão.

## 0. Contexto e objetivo

O número oficial da InovaTV (`5517996242415`) está hoje conectado ao
Rocket Gestor via **RocketZap** (sessão `inovatv`) — confirmado nesta
sessão como conexão por **QR Code/WhatsApp Web** (tooltips do próprio
produto: "Clique aqui pra ler o seu QR CODE", "Conectar via WhatsApp
Web (requer extensão)"), não API oficial da Meta. O usuário confirmou
que essa sessão **já cai periodicamente e precisa ser reconectada** —
padrão típico de automação não-oficial, consistente com o aviso do
próprio Rocket sobre "risco de bloqueio" e o "intervalo aleatório
entre envios" (técnica de evasão de detecção).

**Objetivo desta matriz:** mapear tudo que o Rocket dispara hoje pelo
número oficial, para saber exatamente o que a infraestrutura própria
da InovaTV (`inovatv-api-intermediaria`) precisaria reproduzir antes
de desligar essa sessão — sem perder nenhum lembrete, confirmação ou
mecânica de indicação que os clientes já recebem.

## 1. As três famílias de automação do Rocket

### 1.1 — Cobranças (`/gerenciador/cobrancas/`)

Motor de agendamento com **dia da semana + horário exato** configuráveis, e filtros de audiência (servidor, captação, dispositivo, aplicativo, plano, forma de pagamento, time, arquivado).

| Nome | Gatilho | Auto/Manual | Horário | Dias | Mensagem usada |
|---|---|---|---|---|---|
| Vence Hoje | Vencimento = hoje | **Automática (ativa)** | 07:00 | todos os 7 dias | Vence Hoje |
| Vence em 3 Dias | Vencimento em 3 dias | **Automática (ativa)** | (não conferido individualmente — mesmo padrão de aba Automática) | — | Vence em 3 Dias |
| Vencido a 3 Dias | Vencido há 3 dias | **Automática (ativa)** | (não conferido individualmente) | — | Vencido a 3 Dias |
| Vence em 1 dia | Vencimento em 1 dia | Manual (desativada) | — | — | Vence em 1 dia |
| Avisos Servidor NewOne | Manual, ad hoc | Manual (desativada) | — | — | Aviso Servidor NewOne (filtro: servidor NewOne) |
| Promoção Indique e Ganhe | Manual, ad hoc | Manual (desativada) | — | — | Promoção Indique e Ganhe |

**Sessão do WhatsApp usada:** por padrão, "a sessão padrão do servidor de cada cliente" (pode ser sobrescrita por Cobrança específica — não estava sobrescrita em "Vence Hoje"). A sessão padrão GERAL do sistema é `inovatv` (confirmado em `Configurações do Gerenciador`).

### 1.2 — Testes (`/gerenciador/enviosAutomaticosTestes/`)

Mesmo motor, aplicado ao ciclo de vida do teste grátis. Filtros idênticos aos de Cobranças (servidor, captação, dispositivo, aplicativo, time), mais filtros específicos de teste: **Motivos não convertido** (Achou Caro, Não Responde as Mensagens, Não Gostou do Aplicativo, Trava Muito), **Convertido** (Sim/Não), **Situação do teste** (Ativo/Vencido).

| Nome | Gatilho | Auto/Manual | Período | Mensagem usada |
|---|---|---|---|---|
| Teste Grátis Vencendo | Teste vencendo (30 min antes, no exemplo aberto) | **Automática (ativa)** | Tipo Minutos, 30 | Teste Grátis Vencendo |
| Teste Não Convertido Após 3 Dias | Teste vencido há 3 dias, não convertido | **Automática (ativa)** | Tipo Dias, 3 | Teste Não Convertido Após 3 Dias |
| Teste Grátis Iniciado | Criação do teste | Manual (desativada nesta automação específica — mas ver 1.3, existe TAMBÉM um gatilho automático separado para isso) | Tipo Minutos, 2 | Teste Grátis Iniciado |

**Nota importante:** não confirmei um campo de horário explícito na aba "Automática" de Testes (só dias/toggle) — pode existir e eu não ter rolado o suficiente, fica como pendência de confirmação, não como fato negativo.

### 1.3 — Eventos pontuais (`/gerenciador/configuracoes/`)

Mapeamento direto evento→mensagem, sem motor de agenda/filtro — dispara no momento do evento, sempre pela sessão padrão (`inovatv`).

| Evento | Mensagem | Confirmado gatilho exato |
|---|---|---|
| Pagamento adicionado para um cliente | Pagamento Confirmado | Legenda do próprio Rocket: *"Mensagem enviada após adicionar um pagamento para um cliente."* — ligado à ação "ADD Pagamento" (fluxo manual da UI, conforme já confirmado em investigação anterior — `PATCH` via API não dispara) |
| Teste criado automaticamente | Teste Grátis Iniciado | Legenda: *"Mensagem enviada automaticamente quando um teste for criado de forma automática."* |
| Compra de créditos (revenda) | — | Campo em branco, não configurado |

## 2. As 15 mensagens — conteúdo e variáveis (8 confirmadas por leitura completa, 7 por padrão consistente)

**Padrão estrutural confirmado, idêntico em todas as 8 mensagens abertas por completo:** aviso "ESTA É UMA MENSAGEM AUTOMÁTICA" (quando aplicável) → saudação `{NOME}` → corpo específico → assinatura "InovaTV — Sempre pensando em você!".

| # | Mensagem | Confirmado? | Variáveis usadas | Resumo do conteúdo |
|---|---|---|---|---|
| 1 | Pagamento Confirmado | ✅ Completo | `{NOME}` `{PLANO}` `{VALOR}` `{USUARIO}` `{SERVIDOR}` `{VENCIMENTO}` `{HORA}` `{TELEFONE}` | Confirma pagamento + dados do plano + CTA de indicação (sem limite, indicado informa nome/telefone no atendimento) |
| 2 | Aviso Servidor NewOne | ✅ Completo | (sem variável de cliente) | Comunicado técnico sobre DNS/configuração — inclui uma lista real de códigos de provedor por app (LAZER PLAY, PLAYSIM, ASSIST+, etc.) |
| 3 | Pagamento Fiado Vence Hoje | ✅ Completo | `{NOME}` `{DATA_HOJE}` `{VALOR}` `{TELEFONE}` (+ CTA indicação) | Lembrete de pagamento "fiado" combinado para hoje. **Achado à parte:** o final do template tem uma lista de tags aparentemente não-usadas/residuais: `{DIA}{PAGAMENTO}{DIF_DIAS_VENCIMENTO_HOJE}{MES_ATUAL}{LTV}{INFO_SERVIDOR}{DIA_HOJE}{TIME}` — revela variáveis extras que o motor do Rocket suporta, mesmo sem estarem sendo usadas de forma legível aqui |
| 4 | Fiado em Atraso | ✅ Completo | `{NOME}` `{PLANO}` `{VALOR}` | Aviso automático de risco de bloqueio por atraso de pagamento combinado |
| 5 | Teste Grátis Iniciado | ✅ Completo | `{NOME}` `{USUARIO}` `{VENCIMENTO}` `{HORA}` | Confirma ativação do teste + catálogo de planos (30/90/180/365 → R$35/90/180/300) + dados de PIX para conversão |
| 6 | Promoção Indique e Ganhe | ✅ Completo | `{NOME}` `{TELEFONE}` | Convite à indicação — 1 mês grátis por indicação, sem limite, cliente responde com nome+telefone do indicado |
| 7 | Ganhou Um Mês Grátis Pela Indicação | ✅ Completo | `{NOME}` `{NOME_ULTIMO_INDICADO}` `{TELEFONE}` | Confirma crédito de 1 mês grátis por indicação bem-sucedida |
| 8 | Vencido a 3 Dias | ✅ Completo | `{NOME}` `{SERVIDOR}` `{USUARIO}` `{VENCIMENTO}` `{HORA}` | Aviso de vencido há 3 dias + catálogo de planos + PIX |
| 9 | Vence Hoje | ⚠️ Padrão inferido (não aberto por Info, mas nome idêntico à Cobrança + mesmo padrão de 1/8) | provavelmente `{NOME}` `{SERVIDOR}` `{USUARIO}` `{VENCIMENTO}` `{HORA}` | Não confirmado literalmente |
| 10 | Vence em 3 Dias | ⚠️ Padrão inferido | idem | Não confirmado literalmente |
| 11 | Vence em 1 dia | ⚠️ Padrão inferido | idem | Não confirmado literalmente |
| 12 | Venceu Ontem | ⚠️ Padrão inferido | idem | Não confirmado literalmente |
| 13 | 5 Dias Após Cadastro | ⚠️ Não aberto | desconhecido | Provavelmente onboarding/nutrição pós-cadastro — não confirmado |
| 14 | Teste Não Convertido Após 3 Dias | ⚠️ Config vista, mensagem não aberta por Info | desconhecido | Configuração (filtros/automática) já mapeada na seção 1.2 |
| 15 | Teste Grátis Vencendo | ⚠️ Config vista, mensagem não aberta por Info | desconhecido | Configuração já mapeada na seção 1.2 |

**Marcação explícita:** os itens 9-15 **não foram confirmados por leitura literal do conteúdo** — ficam como pendência, não como fato. O padrão das 8 confirmadas é forte o bastante para uma estimativa de trabalho, mas não deve ser tratado como igual a ter visto o texto real.

## 3. Cruzamento com `inovatv-api-intermediaria` — o que já temos vs. o que falta

### 3.1 — Dados de cliente (via `/match` + `/status`, já reais e testados)

| Variável usada pelo Rocket | Disponível hoje na nossa API? | Onde |
|---|---|---|
| `{NOME}` | ✅ Sim | `/status` → `cliente.nome` |
| `{VENCIMENTO}` | ✅ Sim | `/status` → `cliente.vencimento` |
| `{PLANO}` | ✅ Sim | `/status` → `cliente.planoNome` |
| `{SERVIDOR}` | ✅ Sim | `/status` → `cliente.servidorNome` |
| `{USUARIO}` | ⚠️ Parcial | Só em `/match` → `candidates[].usuario` — **não está em `/status`** |
| `{TELEFONE}` | ✅ Sim | É o próprio identificador da conversa no Orquestrador, não precisa vir do Rocket |
| `{VALOR}` | ❌ **Não disponível** | Não existe em `/match` nem em `/status` — existe hoje só na allowlist separada do `export-clientes` (10 colunas, uso em lote, não integrado ao Orquestrador) |
| `{HORA}` | ⚠️ Provável | `vencimento` já vem como timestamp ISO completo (`Componente 1 §7`) — a hora já está embutida, só precisaria ser formatada/extraída, não é um dado novo |
| `{NOME_ULTIMO_INDICADO}`, `{DIF_DIAS_VENCIMENTO_HOJE}`, `{MES_ATUAL}`, `{LTV}`, `{DIA}` | ❌ **Não disponível** | Sem equivalente hoje — exigiriam lógica de cálculo própria ou nova consulta ao Rocket |

**Achado crítico: `{VALOR}` e `{USUARIO}` (no formato de `/status`) são a lacuna mais concreta.** Grande parte das mensagens de vencimento/pagamento os utiliza. Expandir a allowlist do `/status` é tecnicamente simples (o dado já é lido do Rocket pela camada de `export-clientes`, só não está no contrato do Orquestrador) — mas é uma **decisão de arquitetura/segurança**, não uma correção trivial, já que a allowlist atual foi definida deliberadamente (Componente 1 §7).

### 3.2 — Dados de pagamento (evento "Pagamento Confirmado") — CORRIGIDO (2026-08-22)

> **Correção registrada:** a versão anterior desta seção presumia que
> precisaríamos "detectar" um pagamento acontecendo dentro do Rocket —
> premissa errada, apontada pelo usuário. **O Rocket não detecta
> nada.** Toda renovação/pagamento é **registrada** por uma ação
> externa — hoje, o próprio usuário fazendo "ADD Pagamento" manualmente
> na UI; amanhã, possivelmente nossa própria automação fazendo a
> operação equivalente. Em nenhum dos dois casos existe "detecção" —
> existe **registro**, e quem registra já sabe que aconteceu no
> instante em que registra.

**Achado real, código já existe e já foi testado:** a function
`teste-patch-renovacao-newone` (`inovatv-api-intermediaria`, já
descartável/temporária, mas o mecanismo é real) já demonstra o
caminho completo:

```
1. GET /gerenciador/api/v1/planos/  → lê o período real do plano (não presume)
2. GET /gerenciador/api/v1/cliente/{public_id}  → confirma nome/servidor/plano antes de mexer
3. PATCH /gerenciador/api/v1/cliente/{public_id}  { vencimento: novoVencimento }
4. GET de novo → confirma vencimentoMudouParaOEsperado: true
```

Usa a **mesma `ROCKET_API_KEY`** (`X-API-Key`) já usada por `/match`/
`/status` — nenhuma credencial nova, nenhuma sessão de navegador
frágil. **O ponto onde "sabemos que a renovação aconteceu" é
exatamente o retorno HTTP bem-sucedido desse `PATCH`** — não precisa
de nenhum mecanismo de detecção, porque fomos nós que fizemos a
chamada.

**Achado que fecha o raciocínio:** já está confirmado (investigação
anterior, `2026-08-21_renovacao_automatica_painel_primeiro.md`) que
esse mesmo `PATCH` via API **não dispara o RocketZap** — só o fluxo
manual "ADD Pagamento" da UI dispara. Ou seja: **hoje, se esse `PATCH`
fosse usado para renovar de verdade, o cliente não receberia
NENHUMA mensagem de confirmação** (nem do RocketZap, que não é
acionado por API, nem de mais ninguém). Isso não é uma lacuna nova
criada pela migração — é uma lacuna que **já existe agora**, e a
correção é a mesma nos dois casos: **nossa própria infraestrutura
envia a mensagem de confirmação logo após o `PATCH` bem-sucedido**,
usando os dados que o próprio `PATCH`/`GET` já devolveram
(`nome`, `servidor.nome`, `plano.nome`, `vencimento`).

**Peça complementar, servidor UniTV especificamente:** para clientes
UniTV, existe também `poc-pagbank-unitv-renew` — renova a conta
**no painel upstream do UniTV** (`panel-web.revenda.site/api/account/renew`,
protocolo AES-CBC já decifrado), disparada por webhook real do
PagBank. **Importante: essa function mexe no UniTV, não no Rocket** —
são dois sistemas diferentes (Rocket é o cadastro/cobrança da InovaTV;
UniTV é o provedor upstream de onde a InovaTV compra o serviço). Um
fluxo completo de renovação automatizada para cliente UniTV
provavelmente precisaria das duas chamadas (UniTV upstream + Rocket
`PATCH`), não só uma — não confirmado ainda se isso já está encadeado
em algum lugar, ou se são hoje dois pontos desconectados.

**O que isso resolve, e o que ainda falta:**
- ✅ **Resolvido:** "como sabemos que a renovação aconteceu" — não
  precisa de detecção, o próprio `PATCH` bem-sucedido é a confirmação.
- ✅ **Resolvido:** de onde vêm `{NOME}`, `{SERVIDOR}`, `{PLANO}`,
  `{VENCIMENTO}` para a mensagem — o próprio retorno do `PATCH`/`GET`
  já trouxe tudo isso no teste real.
- ⚠️ **Ainda em aberto:** `{VALOR}` — mas agora com um enquadramento
  diferente e mais simples: **não precisa vir do Rocket**, porque quem
  decide fazer a renovação já sabe o valor (o webhook do PagBank já
  carrega o valor pago; se for um registro manual, quem registra digita
  o valor). O gap não é "buscar o valor em algum lugar", é só "levar
  esse dado adiante" no momento de montar a mensagem — trivial uma vez
  que exista qualquer ponto de entrada (manual ou automatizado) que já
  carregue esse valor.
- ⚠️ **Ainda em aberto:** se/como encadear UniTV (upstream) + Rocket
  (`PATCH`) + envio da mensagem numa única operação, para servidores
  que dependem de upstream externo.

### 3.3 — Dados de teste (Testes Grátis)

Existe API real (`clientes`/`testes` já confirmados no ecossistema, referenciados também pela ADR-021 do `inovatv_painel`) — mais viável de poll que pagamentos, mas **nenhuma integração de leitura de testes existe hoje em `inovatv-api-intermediaria`** (só `/match`/`/status` de cliente). Precisaria ser construída do zero.

### 3.4 — O motor de agendamento em si (dia/hora/filtros)

**Não existe nada equivalente hoje.** O Orquestrador da IA própria é **inteiramente reativo** (responde a mensagem recebida via Webhook) — não tem nenhum mecanismo de disparo agendado/proativo. Replicar Cobranças/Testes exigiria construir, do zero:
- Um agendador (Supabase Cron/`pg_cron`, ou Edge Function agendada);
- Uma consulta periódica ao Rocket buscando clientes que batem com cada critério (vencimento hoje/em N dias/vencido há N dias);
- Lógica de filtro de audiência (servidor, dispositivo, etc. — hoje nem sequer lida pelo nosso lado).

### 3.5 — Mecânica de indicação

Confirmado que, do lado do Rocket, é **um processo manual** — o cliente responde no próprio WhatsApp, e alguém (humano, hoje) registra a indicação manualmente no sistema para gerar o crédito. Não é uma automação de ponta a ponta nem do lado deles. Replicar isso não é "buscar um dado que falta" — é decidir um processo novo (a IA própria poderia captar essa resposta e registrar automaticamente, mas isso é decisão de produto, não gap técnico).

## 4. Resumo — nível de prontidão por automação

| Automação | Dado de cliente | Dado de evento/gatilho | Motor de agendamento | Prontidão hoje |
|---|---|---|---|---|
| Vencimento (Vence Hoje/3 dias/Vencido) | 🟡 Falta `{VALOR}`, `{USUARIO}` completo | 🟢 `/status` já dá o vencimento | 🔴 Não existe | **Parcial — precisa do motor de agenda, o resto já existe** |
| **Pagamento Confirmado / Renovação** | 🟢 `PATCH`+`GET` já devolvem nome/servidor/plano/vencimento (testado, real) | 🟢 **Resolvido** — o próprio `PATCH` bem-sucedido é a confirmação, não precisa detectar nada (correção desta rodada) | 🔴 N/A (evento, dispara na hora) | **A mais próxima de pronta — só falta ligar "PATCH bem-sucedido → enviar mensagem" e decidir de onde vem o `{VALOR}`** |
| Testes (iniciado/vencendo/não convertido) | 🟢 Provavelmente coberto | 🟡 Se formos nós a criar o teste, mesma lógica do Pagamento (sem detecção); se o teste continuar sendo criado só dentro do Rocket, precisa de polling | 🔴 Não existe (para os de prazo/vencimento) | **Depende de quem cria o teste no futuro** |
| Indicação (Promoção/Ganhou) | 🟢 Nome/telefone já disponíveis | 🔴 Processo manual, sem gatilho técnico | 🔴 N/A | **Decisão de processo, não só técnica** |
| Fiado (combinado/atraso) | 🟡 Falta `{VALOR}` (mesmo raciocínio do Pagamento — quem registra o fiado já sabe o valor) | 🔴 Sem visibilidade de "fiado" hoje | 🔴 Não existe | **Precisa construir do zero, mas mesmo padrão do Pagamento** |
| Avisos ad hoc (ex.: Servidor NewOne) | 🟢 Não depende de dado de cliente | 🟢 Manual, sem gatilho técnico necessário | — (é manual mesmo no Rocket) | **Fácil — é só broadcast** |

**Achado que muda a leitura geral:** a "Pagamento Confirmado" deixou
de ser a automação mais difícil da matriz — com a correção desta
rodada, é a que já tem o caminho mais claro e mais testado (o `PATCH`
real já existe e já foi validado). A automação genuinamente mais dura
de resolver hoje é o **motor de agendamento** (Vencimento por dia/hora
+ filtros), que continua não tendo nenhum equivalente construído.

## 5. O que ainda falta confirmar antes de qualquer decisão de arquitetura

1. Conteúdo literal das 7 mensagens ainda não abertas (item 2, marcadas ⚠️).
2. ~~Se existe endpoint de pagamentos no Rocket não documentado~~ —
   **superado pela correção da seção 3.2**: não precisamos de um
   endpoint de leitura de pagamentos, porque não estamos detectando
   nada — estamos registrando. O `PATCH` já testado resolve isso.
3. Horário exato configurado em "Vence em 3 Dias" e "Vencido a 3 Dias" (só vi "Vence Hoje" = 07:00).
4. Se existe campo de horário na automação de Testes (só confirmei dias, não horário).
5. Se o campo `{USUARIO}` pode ser adicionado ao `/status` sem reabrir a decisão de segurança da allowlist, ou se isso precisa de uma decisão nova.
6. **Nova pendência desta rodada:** se/como o fluxo de renovação real (manual ou futuro automatizado) vai encadear UniTV upstream + Rocket `PATCH` + envio da mensagem — hoje são peças comprovadas separadamente (`poc-pagbank-unitv-renew` e `teste-patch-renovacao-newone`), não uma cadeia única.
7. **Nova pendência:** de onde exatamente virá o `{VALOR}` no momento de montar a mensagem — depende de qual vai ser o ponto de entrada real da renovação (webhook de gateway próprio? registro manual numa interface nossa? continuar sendo o próprio Rocket, e nesse caso o valor viria de onde?). Isso é decisão de arquitetura, não investigação — não decidida aqui.

**Nenhuma decisão de arquitetura foi tomada nesta etapa.** Esta matriz é insumo para a próxima etapa (Passo 3 do plano do usuário: desenhar a substituição) — não é, em si, uma proposta de substituição.
