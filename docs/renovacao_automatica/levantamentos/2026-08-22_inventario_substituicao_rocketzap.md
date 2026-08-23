# Inventário Consolidado — Automações do RocketZap Ainda Pendentes de Substituição

> **Isto é inventário/classificação, não implementação.** Nenhum
> template criado ou submetido, nenhum código alterado, nenhuma
> automação do Rocket tocada, número oficial e RocketZap intocados.
> Consolida o que já estava espalhado em
> `2026-08-22_matriz_migracao_rocketzap.md`,
> `2026-08-22_levantamento_lembretes_vencimento.md`,
> `2026-08-22_desenho_substituicao_rocketzap.md` e
> `2026-08-22_desenho_poc_motor_lembretes.md`, mais uma checagem ao
> vivo desta sessão (`/gerenciador/enviosAutomaticosTestes/` e
> `/gerenciador/configuracoes/`) para fechar duas lacunas que
> restavam (status real da automação de Testes, e onde "5 Dias Após
> Cadastro" se encaixa).

> **Atualização de consolidação (2026-08-22, fim de sessão):**
> `vencimento_hoje` teve resultado **definitivo** da Meta —
> reclassificado para Marketing, não mais "em análise" (itens 2 e
> Grupo 1 abaixo atualizados). `fiado_em_atraso` foi **submetido**
> como Utilidade, aguardando aprovação (item 8 e Grupo 2 abaixo
> atualizados). Ver `2026-08-22_desenho_substituicao_rocketzap.md`,
> seção 14, para o checkpoint consolidado completo desta frente
> (pagamento, renovação, WhatsApp, fluxo futuro, lembretes, Meta).

## 0. As 15 mensagens do Rocket — inventário completo

| # | Mensagem | Automático/Manual | Ativa/Inativa | Finalidade | Quando dispara | Substituição comprovada? | Precisa template Meta? | Categoria provável | Depende de implementação futura | Prioridade |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **Pagamento Confirmado** | Evento pontual (automático, ligado a "ADD Pagamento") | Ativa | Confirmar renovação registrada | No momento do registro do pagamento | ✅ **Sim** — POC #1 (texto livre) e POC #2 (template `pagamento_confirmado`, aprovado) | Sim, já aprovado | Utilidade ✅ (aprovado) | Falta só ligar o **gatilho automático real** (mecanismo de sessão do Rocket já comprovado, `inovatv_meta_business_agent` CLAUDE.md §16) — a mensagem em si já está pronta | **Alta** — mais perto de fechar de tudo |
| 2 | **Vence Hoje** | Automática (Cobrança) | ✅ Ativa (07:00, todos os dias) | Lembrete de vencimento hoje | Diariamente, vencimento = hoje | ❌ **Resultado definitivo (2026-08-22): Meta aprovou o template, mas reclassificou para Marketing** — não é mais "em análise", é resultado fechado. Ver `2026-08-22_desenho_poc_motor_lembretes.md` | Sim, submetido | **❌ Marketing (definitivo)** — mesmo com texto totalmente neutro, sem CTA, a Meta trata todo o tópico "lembrete de vencimento" como Marketing | Motor de agendamento (não existe); gatilho automático; **decisão de produto sobre pagar Marketing ou não** | **Baixa agora** — deixou de ser candidato a Utilidade, prioridade cai até decisão de produto sobre aceitar Marketing |
| 3 | **Vence em 3 Dias** | Automática (Cobrança) | ✅ Ativa (11:00, todos os dias) | Lembrete 3 dias antes | Diariamente | ❌ Não | Sim, provavelmente | Mesma incerteza do item 2 (mesma família) | Mesmo do item 2 + aguardar resultado do item 2 | Média — aguardando veredito do `vencimento_hoje` |
| 4 | **Vencido a 3 Dias** | Automática (Cobrança) | ✅ Ativa (09:00, todos os dias) | Lembrete 3 dias após vencer | Diariamente | ❌ Não | Sim, provavelmente | Mesma incerteza do item 2 | Mesmo do item 2 | Média — idem |
| 5 | **Vence em 1 dia** | Automática, mas **desligada** (`Cobrança automática?` = off; horário 09:40 já configurado, pronto se ligar) | ❌ Inativa hoje no Rocket | Lembrete véspera | Se ativada, diariamente | ❌ Não | Sim, provavelmente | Mesma incerteza do item 2 | Mesmo do item 2 | **Baixa** — decisão de produto: vale reproduzir algo que nem está ativo hoje? |
| 6 | **Venceu Ontem** | **Nenhuma Cobrança liga a esta mensagem hoje** (nem ativa nem inativa) | — não dispara | Lembrete 1 dia após vencer | Nunca, hoje | ❌ Não | — | — | — | **Baixa/nenhuma** — o próprio Rocket não usa; não é lacuna real a fechar |
| 7 | **Pagamento Fiado Vence Hoje** | ✅ **Confirmado nesta sessão: SEM Cobrança/gatilho automático** — não existe entre as 6 Cobranças reais, não há filtro "Forma pagamento = Fiado" em nenhuma delas; disparo é manual (José registra o fiado e envia) | — não dispara sozinho | Lembrete de "fiado" combinado, vence hoje | Manual, quando José decide enviar | ❌ Não | Provavelmente | Mistura aviso + **mesmo bloco de indicação promocional do item 13** — não é puramente transacional | Mesmo do item 2 + **desenhar separação aviso/promoção, mesmo padrão já usado nos itens 9 e 13** | Baixa — sem gatilho automático hoje, menor urgência |
| 8 | **Fiado em Atraso** | ✅ Confirmado nesta sessão: mesma ausência de Cobrança/gatilho — manual | — não dispara sozinho | Aviso de risco de bloqueio por atraso combinado | Manual | 🟡 **Submetido (2026-08-22)** — template `fiado_em_atraso`, sem aviso de reclassificação da Meta (diferente do `vencimento_hoje`), aguardando aprovação final. Ver `2026-08-22_desenho_fiado_em_atraso.md` | Sim, já submetido | **Utilidade (pretendida, ainda em análise)** — puramente transacional/aviso, sem indicação, sem CTA de compra (variáveis: `{NOME}` `{PLANO}` `{VALOR}`) | Motor de gatilho manual→automático (tela de agendamento própria, Grupo 2) | **Alta** — melhor resultado de aprovação da Meta até agora depois do `pagamento_confirmado`, falta só o veredito final |
| 9 | **Teste Grátis Iniciado** | Manual na aba própria, mas **também evento pontual automático** ("quando teste for criado de forma automática") — dispara de fato, por esse segundo caminho | Ativa (evento pontual) | Confirmar ativação do teste | Na criação automática do teste | ❌ Não | Sim, provavelmente | **Confirmação de algo que já aconteceu — mesma natureza do `pagamento_confirmado`, que passou.** Candidato de baixo risco | Depende de quem cria o teste no futuro (nós ou só o Rocket) | Média — bom candidato pra testar Utilidade com risco menor |
| 10 | **Teste Grátis Vencendo** | Automática | ✅ Ativa (30 min antes) | Lembrete de teste acabando | Perto do fim do teste | ❌ Não | Sim, provavelmente | Mesma incerteza do item 2 (lembrete de expiração) | Mesmo do item 2 | Baixa/Média — mesmo risco de classificação |
| 11 | **Teste Não Convertido Após 3 Dias** | Automática | ⚠️ **Status mostrado como "Vencido" no painel** (diferente de "Ativo" nos demais) — checado ao vivo nesta sessão, não investigado a fundo o que esse status significa | Reengajar teste não convertido | 3 dias após teste vencer, sem conversão | ❌ Não | Sim, provavelmente | Mesma incerteza do item 2 | Mesmo do item 2 + **entender o que "Vencido" significa aqui antes de priorizar** | Baixa — achado novo, precisa investigar antes |
| 12 | **Promoção Indique e Ganhe** | Manual (Cobrança ad hoc, desativada) | Manual/inativa como automação | Convite à indicação | Disparo manual, quando o usuário decide | ❌ Não | Sim, se reproduzida | **Confirmado nesta sessão: 100% oferta, sem núcleo transacional.** Texto lido por completo — variáveis batem exatamente com a matriz original (`{NOME}` `{TELEFONE}`, sem surpresa desta vez). Diferente de todos os outros itens revisados (9, 12-antigo/13, 7), **não há nada aqui pra separar** — a mensagem inteira é convite comercial, do início ao fim | Decisão de produto: vale pagar Marketing por isto, ou manter só manual/RocketZap? | Baixa — decisão de produto antes de qualquer trabalho técnico |
| 13 | **Ganhou Um Mês Grátis Pela Indicação** | Processo manual (alguém registra a indicação) — confirmado, não é automação de ponta a ponta nem do lado do Rocket | Manual | Confirmar crédito de indicação | Quando humano registra a indicação bem-sucedida | ❌ Não | Sim, provavelmente | **Confirmação de algo que já aconteceu — mesma família do `pagamento_confirmado`**, candidato de baixo risco | Depende de decidir o processo (quem registra, como) — decisão de produto, não técnica | Baixa/Média — mensagem de baixo risco, mas processo de origem ainda manual |
| 14 | **Aviso Servidor NewOne** | Manual (Cobrança ad hoc, desativada) | Manual | Comunicado técnico (DNS/config, específico do servidor NewOne) | Disparo manual, broadcast | ❌ Não | — | — | — | **Descartado — decisão explícita do usuário (2026-08-22): não vamos reproduzir este item.** Investigação interrompida antes de ler o texto completo; não há trabalho pendente aqui |
| 15 | **5 Dias Após Cadastro** | **Confirmado sem automação** — checado em Cobranças, Testes e Eventos Pontuais, não aparece em nenhum | Não identificada | **Texto lido nesta sessão: pesquisa de satisfação/check-in ("o que você está achando até agora?"), não onboarding de produto** — sem preço, sem CTA de compra, só convite a responder + WhatsApp de suporte | Desconhecido, provavelmente pensado pra 5 dias após cadastro | ❌ Não | Único da lista que é puramente conversacional | **Candidato surpreendentemente bom a Utilidade** — mais neutro que qualquer outra mensagem da família de vencimento, só 1 variável (`{NOME}`) | Nenhuma — mensagem simples, só falta decidir se vale a pena reativar algo que nem o Rocket está usando | **Baixa, mas reavaliar** — órfã hoje, mas é a mensagem tecnicamente mais "segura" pra Meta de toda a lista |

## 1. Fora de escopo — mensagens internas, não para clientes

Vistas em `/gerenciador/configuracoes/`, mas endereçadas ao **revendedor** (José), não a clientes InovaTV — não fazem parte da substituição de atendimento a cliente:
- **Aviso créditos baixos** (alerta de saldo do servidor).
- **Mensagem compra créditos** (confirmação pra revenda, não configurada hoje).

## 2. O que muda com o achado do `vencimento_hoje` (revisado após investigação completa)

A recusa da Meta em classificar "aviso de vencimento" como Utilidade, mesmo sem CTA, **provavelmente afeta toda a família de lembretes de expiração** (itens 2-5, 7-8, 10-11 — oito das quinze mensagens, contando os dois Fiado). **Não afeta**, pela mesma lógica, o `Pagamento Confirmado` (item 1, já aprovado) — o único item da lista que é confirmação pura, sem nenhum conteúdo comercial embutido.

**Correção importante, descoberta só depois de ler os textos literais completos dos itens 9 e 13:** eles **não são confirmações puras** como se pensava inicialmente — ambos misturam confirmação com oferta comercial completa (catálogo de preços/PIX no item 9; convite renovado à indicação no item 13). A recomendação para os dois deixou de ser "testar como está" e passou a ser "separar núcleo transacional de oferta, testar só o núcleo". `Fiado em Atraso` (item 8) e `5 Dias Após Cadastro` (item 15), pelo contrário, **se revelaram mais limpos do que o esperado** — nenhum dos dois tem conteúdo comercial, ambos são candidatos razoáveis a Utilidade como estão. `Promoção Indique e Ganhe` (item 12) é o único confirmado como 100% oferta, sem nenhum núcleo a separar — Marketing por definição, sem meio-termo possível.

## 3. O que dá pra trabalhar agora, sem depender do veredito da Meta sobre `vencimento_hoje`

**Nada que envolva submeter template novo** (instrução explícita desta etapa: não criar/submeter). O que pode avançar em **desenho** (não implementação):

- **Item 1 (Pagamento Confirmado):** desenhar como ligar o gatilho automático real ao mecanismo de sessão do Rocket já comprovado (`CLAUDE.md` §16) — é o item mais avançado de toda a lista, e não depende de nada da Meta.
- **Itens 9 e 13** (confirmações de baixo risco): podem ser desenhadas em paralelo, já que sua categoria provável (Utilidade) não compartilha o problema encontrado no `vencimento_hoje`.
- **Item 11:** investigar o que o status "Vencido" significa nesta automação específica, antes de decidir prioridade.
- **Itens 7-8 (Fiado):** investigar se existe Cobrança real ligando a essas mensagens hoje — hoje é uma lacuna de conhecimento, não de arquitetura.
- **Item 15:** confirmar definitivamente se "5 Dias Após Cadastro" é mesmo órfã (checar mais alguma tela do Rocket não coberta ainda) antes de descartar.

**O que fica parado, esperando o veredito:** itens 2-5, 10 — mesma família, mesmo risco de classificação do `vencimento_hoje`, não faz sentido desenhar/submeter antes de saber se Utilidade é viável para esse tipo de conteúdo.

## 4. Ordem recomendada de trabalho (revisada, inventário fechado)

1. **Pagamento Confirmado (item 1)** — ligar o gatilho automático real ao mecanismo já comprovado. Maior retorno, zero dependência da Meta, mensagem já pronta.
2. **Fiado em Atraso (item 8)** — o texto mais limpo de toda a investigação depois do `pagamento_confirmado`: puro aviso, sem oferta, sem CTA. Candidato natural a testar Utilidade independente do veredito do `vencimento_hoje`, mas falta decidir o processo de "fiado" antes (quem registra, gatilho manual→automático).
3. **Teste Grátis Iniciado / Ganhou Um Mês Grátis / Pagamento Fiado Vence Hoje (itens 9, 13, 7)** — mesmo padrão: separar núcleo transacional (candidato a Utilidade) de oferta comercial embutida (fica pra conversa livre). Trabalho de desenho já feito para 9 e 13; falta o mesmo tratamento formal pro 7.
4. **Aguardar o veredito da Meta sobre `vencimento_hoje`** — decide o destino de 5 mensagens da família "lembrete puro" (itens 2-5, 10).
5. **5 Dias Após Cadastro (item 15)** — reavaliar prioridade: é a mensagem tecnicamente mais segura de toda a lista (puro check-in, 1 variável), mas está órfã hoje — decisão de produto sobre reativá-la.
6. **Promoção Indique e Ganhe (item 12)** — decisão de produto antes de qualquer trabalho técnico: vale pagar Marketing por isso, ou deixar como está (manual/RocketZap)? Confirmado 100% oferta, sem meio-termo possível.
7. **Vence em 1 dia / Venceu Ontem (itens 5-6)** — mais baixa prioridade: nem o próprio Rocket as usa de forma ativa hoje.
8. ~~Aviso Servidor NewOne (item 14)~~ — **descartado, decisão do usuário.**

## 5. Números finais — inventário das 15 mensagens fechado

- **15 mensagens** no total no Rocket, **todas com gatilho e categoria provável já determinados** — nenhuma pendência de descoberta restante.
- **1 já comprovada e testada** de ponta a ponta (Pagamento Confirmado) — falta só ligar o gatilho automático.
- **1 com resultado definitivo, reclassificada pra Marketing** (Vence Hoje — Meta aprovou o template, mas como Marketing, não Utilidade; ver `2026-08-22_desenho_poc_motor_lembretes.md`).
- **1 submetida, aguardando aprovação como Utilidade** (Fiado em Atraso — `fiado_em_atraso`, sem sinal de reclassificação até agora, diferente do `vencimento_hoje`).
- **5 na mesma família "lembrete puro"** do Vence Hoje, tratadas como herdando o mesmo resultado (Marketing) por analogia — não testadas individualmente (Vence em 3 Dias, Vencido a 3 Dias, Vence em 1 dia, Teste Grátis Vencendo, Teste Não Convertido Após 3 Dias).
- **4 mistas (confirmação + oferta embutida)**, mesma receita de separação já desenhada para 2 delas (Teste Grátis Iniciado, Ganhou Um Mês Grátis) e ainda pendente pras outras 2 (Pagamento Fiado Vence Hoje e, em menor grau, nenhuma outra — Fiado em Atraso na verdade caiu no grupo limpo abaixo).
- **2 limpas, candidatas diretas a Utilidade sem precisar separar nada** (Fiado em Atraso, 5 Dias Após Cadastro) — achado só confirmado nesta sessão, lendo o texto completo.
- **1 100% Marketing, sem núcleo a aproveitar** (Promoção Indique e Ganhe) — decisão de produto, não técnica.
- **2 sem automação ativa identificada hoje** (Venceu Ontem, 5 Dias Após Cadastro — este último também conta na linha acima) — podem nem precisar ser reproduzidas.
- **1 descartada por decisão do usuário** (Aviso Servidor NewOne) — fora do escopo de substituição.

**Achado transversal de toda a investigação:** em praticamente todo item cujo resumo original (matriz de migração) tinha sido escrito só a partir de uma leitura rápida, **o texto literal completo revelou mais variáveis e mais conteúdo comercial do que o resumo sugeria** (itens 9 e 13 confirmam o padrão). Os únicos dois itens onde o resumo original bateu exatamente com o texto completo foram `Fiado em Atraso` e `Promoção Indique e Ganhe`.

## 6-A. Princípio permanente (2026-08-22, confirmado explicitamente pelo usuário) — o Rocket nunca decide nada sozinho

> **"Tudo no Rocket é configurável. Ele não cria nada — é tudo criado
> por mim. Ele apenas entrega aquilo que eu configurei."** — vale para
> as três formas de disparo já mapeadas nesta investigação:
> - **Cobrança recorrente** (Vence Hoje, Vence em 3 Dias, etc.) — dias/
>   horário/filtro de audiência, tudo configurado por José.
> - **Evento pontual** (Pagamento Confirmado, Teste Grátis Iniciado) —
>   o mapeamento evento→mensagem é escolhido em Configurações, não
>   inventado pelo Rocket.
> - **Agendamento manual** (Mensagens Agendadas — seção 6-B, abaixo) —
>   José escolhe cliente + mensagem + data, um de cada vez.
>
> **Regra prática daqui pra frente:** nunca formular uma pergunta de
> investigação como "como o Rocket/a IA descobre X" — a pergunta certa
> é sempre "qual configuração já existe (ou precisaria existir) pra
> produzir esse resultado". Erro já cometido uma vez nesta mesma
> investigação (seção 6-B, `forma_pagamento` do Fiado) — registrado
> aqui pra não repetir em nenhum item futuro.

## 6-C. Reclassificação final (2026-08-22) — dois grupos, não uma lista só

**Decisão do usuário, a partir do achado da seção 6-B:** separar as
15 mensagens em dois grupos estruturalmente diferentes, pra nunca
mais tentar reproduzir como "automação" algo que nunca foi automático
no Rocket. Dentro do Grupo 2, mantém-se uma distinção técnica (não
muda a decisão de prioridade, só documenta a diferença real de
mecanismo):

### Grupo 1 — Automações/réguas do Rocket (o próximo grande objetivo real)

Disparam sozinhas — recorrentes (Cobrança com dias/horário) ou por
evento do sistema (Evento pontual). É aqui que está o trabalho de
substituição que realmente precisa de um "motor" do nosso lado.

| Item | Mecanismo | Status |
|---|---|---|
| Pagamento Confirmado | Evento pontual | ✅ Pronto, falta gatilho automático |
| Vence Hoje | Cobrança automática | ❌ **Reclassificado Marketing (resultado definitivo, 2026-08-22)** — não é mais "aguardando", decisão de produto necessária antes de seguir |
| Vence em 3 Dias | Cobrança automática | ⏳ Mesma família do `vencimento_hoje` — herda o mesmo resultado (Marketing), tratado como fechado por analogia, não testado individualmente |
| Vencido a 3 Dias | Cobrança automática | ⏳ Idem |
| Vence em 1 dia | Cobrança automática (hoje desligada, mas é a mesma estrutura de régua — não é agendamento manual) | ⏳ Idem, baixa prioridade |
| Teste Grátis Vencendo | Cobrança automática | ⏳ Idem |
| Teste Não Convertido Após 3 Dias | Cobrança automática | ⏳ Idem |
| Teste Grátis Iniciado | Evento pontual | ⚠️ Desenhado, separar núcleo de oferta — categoria diferente da família de vencimento, não afetada pelo resultado do `vencimento_hoje` |

### Grupo 2 — Mensagens de disparo manual/agendado (não são automações, nunca foram)

**Duas variantes técnicas dentro deste grupo**, ambas manuais, ambas
sem "detecção automática" de público — só documentado pra precisão,
sem mudar a prioridade combinada:
- **Broadcast ad hoc** (Cobrança configurada, mas o toggle automático
  fica desligado — José clica "Enviar" quando quer, usando o filtro
  de audiência já configurado): Promoção Indique e Ganhe.
- **Agendamento por cliente** (tela Mensagens Agendadas — Cliente +
  Mensagem + Data/hora, um de cada vez, sem filtro): Fiado Vence
  Hoje, Fiado em Atraso, Ganhou Um Mês Grátis, Venceu Ontem, 5 Dias
  Após Cadastro — e qualquer outra que José decida usar assim no
  futuro.

| Item | Mecanismo | Observação |
|---|---|---|
| Promoção Indique e Ganhe | Broadcast ad hoc | 100% oferta, decisão de produto sobre Marketing |
| Pagamento Fiado Vence Hoje | Agendamento por cliente | Mistura aviso + oferta |
| Fiado em Atraso | Agendamento por cliente | 🟡 Template `fiado_em_atraso` submetido (2026-08-22), Utilidade, aguardando aprovação — melhor resultado depois do `pagamento_confirmado` |
| Ganhou Um Mês Grátis Pela Indicação | Agendamento por cliente | Mistura confirmação + oferta |
| Venceu Ontem | Agendamento por cliente (provável) | Não usada recentemente, sem registro na tela hoje |
| 5 Dias Após Cadastro | Agendamento por cliente (provável) | Check-in de satisfação, mais segura de todas |
| ~~Aviso Servidor NewOne~~ | Broadcast ad hoc | Descartado |

**Não precisamos criar nenhum "detector" pra nada do Grupo 2.** O que
poderá ser necessário, como funcionalidade futura do nosso próprio
painel (não decidido, não priorizado agora): uma tela equivalente à
"Mensagens Agendadas" do Rocket — selecionar cliente → selecionar
mensagem → definir data/hora → agendar envio. Isso é trabalho de
produto pro Painel de Atendimento, não parte do "motor de lembretes".

**Prioridade confirmada:** o Grupo 1 (réguas automáticas) continua
sendo o objetivo real desta frente de substituição. O Grupo 2 fica
registrado, documentado, mas **não precisa virar automação nossa
agora** — no máximo, uma ferramenta de agendamento manual no Painel,
como funcionalidade futura separada.

## 6-B. Correção arquitetural (2026-08-22, depois do fechamento do inventário) — "sem gatilho" não é a leitura certa para vários itens

**Achado que muda a interpretação de vários itens marcados como "sem
automação"/"órfã" acima.** A tela `/gerenciador/mensagens_agendadas/`
(nunca explorada até este ponto) revelou um **terceiro mecanismo de
disparo**, além de Cobranças (recorrente, com filtros) e Eventos
Pontuais (automático, ligado a um evento do sistema): **agendamento
manual, um cliente por vez** — José escolhe Cliente + Mensagem salva
+ Data/hora, e o Rocket só executa nesse instante. Confirmado com o
único registro real existente (cliente "Cleber Martins", mensagem
"Pagamento Fiado Vence Hoje", já enviado).

**Isso muda a leitura de "gatilho" para os itens 6, 7, 8 e 13** — não
é que essas mensagens "não disparam" ou "estão órfãs" — é que elas
disparam **por decisão manual, caso a caso**, sem regra
recorrente nem filtro de audiência. `Venceu Ontem` (item 6) e `5 Dias
Após Cadastro` (item 15) — marcados como "nenhuma Cobrança liga a
esta mensagem" — **também podem estar sendo usadas assim**, mesmo sem
nenhum registro histórico visível na tela agora (só existe 1 registro
no total, o que sugere que este recurso é pouco usado, não que essas
mensagens nunca são enviadas).

**Implicação mais importante pra toda a migração:** a pergunta certa
para reproduzir esses itens não é *"como nossa infraestrutura
descobre automaticamente quem deveria receber isso"* — nunca foi
papel do Rocket nem seria papel da IA decidir isso sozinha. É:
**construir, na nossa própria infraestrutura, o equivalente à tela de
agendamento manual** (escolher cliente + mensagem + data/hora) — uma
ferramenta pro José usar, não um algoritmo de detecção. Detalhe
completo em `2026-08-22_desenho_fiado_em_atraso.md`, seção 3.

## 6. Atualizações desta sessão — lacunas fechadas, achados novos

- **Item 11 (Teste Não Convertido Após 3 Dias, "Vencido"): resolvido.**
  Não é anomalia — "Vencido" é o valor do filtro "Situação do teste"
  desta automação (junto de "Convertido: Não"), faz sentido semântico
  perfeito pro nome da automação. Confirmado `Automática`, `Ativa`,
  todos os 7 dias, sem campo de horário fixo (diferente das Cobranças
  de Vencimento). Detalhe completo em
  `2026-08-22_desenho_teste_gratis_iniciado.md`.
- **Itens 7-8 (Fiado): confirmado que não têm Cobrança/gatilho
  automático** — nem entre as 6 Cobranças reais, nem filtro "Forma
  pagamento = Fiado" em nenhuma delas. Disparo é manual. Textos
  literais lidos: "Pagamento Fiado Vence Hoje" mistura aviso +
  indicação promocional (mesmo padrão do item 13); "Fiado em Atraso" é
  puramente aviso/ameaça de bloqueio, sem promoção — o texto mais
  "limpo" pra Utilidade de toda a família de vencimento.
- **Item 15 (5 Dias Após Cadastro): texto lido pela primeira vez —
  reclassificado.** Não é oferta nem lembrete de expiração — é um
  **check-in de satisfação** ("o que você está achando até agora?"),
  puramente conversacional, só 1 variável. Continua sem gatilho
  identificado hoje, mas tecnicamente é a mensagem mais segura de toda
  a lista pra tentar como Utilidade, se algum dia for reativada.
- **Item 13 (Ganhou Um Mês Grátis Pela Indicação): já registrado com
  detalhe próprio** em
  `2026-08-22_desenho_ganhou_mes_gratis_indicacao.md` — 9 variáveis
  (não 3), mistura confirmação + nova chamada promocional,
  `{NOME_ULTIMO_INDICADO}` não existe na nossa infraestrutura hoje.
- **Item 9 (Teste Grátis Iniciado): já registrado com detalhe próprio**
  em `2026-08-22_desenho_teste_gratis_iniciado.md` — reclassificado de
  "baixo risco" pra "mistura confirmação + oferta comercial completa"
  depois de ler o texto literal.

**Nada implementado, nada submetido, nada alterado no Rocket/RocketZap/número oficial/banco/código nesta etapa.**
