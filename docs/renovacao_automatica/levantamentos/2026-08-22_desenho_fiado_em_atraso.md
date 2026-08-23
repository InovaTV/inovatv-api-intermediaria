# Desenho — Fiado em Atraso (proposta de template, sem submissão)

> **Isto é desenho, não implementação.** Nenhum template criado/
> submetido, nenhum código escrito, nenhuma automação do Rocket
> alterada. Continua o inventário fechado
> (`2026-08-22_inventario_substituicao_rocketzap.md`, item 8) —
> escolhido como próxima POC de template por ser o texto mais "limpo"
> de toda a investigação depois do `pagamento_confirmado`.

## 1. Texto literal (já lido nesta sessão, reaproveitado sem mudança)

```
🕊 OBS: ESTA É UMA MENSAGEM AUTOMÁTICA!

👋 Olá {NOME}, tudo bem?

📌 Você agendou o pagamento de seu {PLANO}, no valor de R$ {VALOR} para hoje!

🕊 OBS: Caso já tenha realizado o pagamento, desconsidere esta mensagem!

⚠️ IMPORTANTE: Se por acaso você ainda não realizou o pagamento, seu acesso ao sistema poderá ser bloqueado a qualquer momento e sem aviso prévio.

📺 InovaTV sempre pensando em você!
```

**Variáveis usadas: `{NOME}` `{PLANO}` `{VALOR}` — só 3, confirmado
que bate exatamente com o resumo original da matriz (um dos únicos
dois itens de toda a investigação onde isso aconteceu).**

## 2. Nenhuma frase promocional — confirmado por leitura completa

Diferente de `Teste Grátis Iniciado`, `Ganhou Um Mês Grátis` e
`Pagamento Fiado Vence Hoje`, **este texto não tem nenhum bloco de
indicação, nenhum catálogo de preços, nenhum CTA de compra.** É aviso
puro sobre um pagamento já combinado. Isso é o motivo de ter sido
escolhido como próxima POC — não precisa de nenhum trabalho de
"separar confirmação de oferta", diferente dos itens 9, 13 e 7.

## 3. CORREÇÃO (2026-08-22, mesma sessão) — "fiado" não é uma característica do cliente a descobrir

> **A seção original abaixo (preservada em `git log`, reescrita aqui)
> partia de uma premissa errada: que precisaríamos de um jeito de
> "detectar automaticamente" quais clientes têm fiado, via algum
> campo `forma_pagamento` em `/status`.** O usuário corrigiu: **fiado
> não é um atributo do cliente que o Rocket "sabe" sozinho — é uma
> condição que o José define manualmente, cliente a cliente, no
> momento em que negocia o pagamento.** Achado real que confirma isso:
> a tela **`/gerenciador/mensagens_agendadas/`** (nunca explorada
> antes desta correção) é exatamente esse mecanismo — um formulário
> "Adicionar Mensagem Agendada" com 3 campos centrais: **Cliente**
> (escolha manual, um de cada vez), **Mensagem salva** (qual das 15
> mensagens usar) e **Data agendamento** (data/hora específica,
> escolhida por José). **Não existe filtro de audiência nem regra
> recorrente aqui** — é literalmente "mandar esta mensagem pra esta
> pessoa nesta hora", decidido manualmente. Confirmado com o único
> registro histórico existente na tela: cliente "Cleber Martins",
> mensagem "Pagamento Fiado Vence Hoje", 25/05/2026 08:00, já enviado.

**A pergunta técnica correta, portanto, não é "como a nossa
infraestrutura descobre quem é fiado"** — isso nunca foi papel da IA
nem do Rocket. **É: como reproduzir a mesma capacidade de
agendamento manual, por cliente, que o José já usa hoje?** A resposta
não é um "motor de detecção automática" — é uma peça de UI/ferramenta
onde o José escolhe cliente + mensagem + data, parecido com o que o
Rocket já oferece.

## 3-B. Dados disponíveis hoje, com a pergunta corrigida

| Variável | Disponível? | Fonte |
|---|---|---|
| `{NOME}` | ✅ Sim | `/status` → `cliente.nome` (assumindo que José já escolheu o cliente manualmente, igual ao Rocket) |
| `{PLANO}` | ✅ Sim | `/status` → `cliente.planoNome` |
| `{VALOR}` | ❌ Não disponível | Mesma lacuna já registrada em toda a investigação — mas aqui é menos crítica: como é o próprio José quem está agendando manualmente, ele já sabe o valor combinado; poderia ser um campo de texto livre no momento do agendamento (mesmo padrão do campo "Observação" já existente na tela do Rocket), não precisa necessariamente vir de uma API |

**Implicação maior, que vale para toda a investigação, não só este
item:** as 15 mensagens do Rocket **são configurações que o José
escreveu/aprovou** (textos, variáveis, e — pra parte delas — também
regras de Cobrança ou agendamento manual). **O Rocket só executa o
que foi configurado** — não toma nenhuma decisão sozinho sobre quem
recebe o quê. Isso significa que reproduzir a "família manual" (itens
6, 7, 8, 13, e possivelmente outros já classificados como "sem
gatilho") não é um problema de **descoberta de dado** — é um problema
de **construir a mesma capacidade de agendamento/disparo manual**
que hoje vive só dentro do Rocket.

## 4. Proposta de texto do template — versão final para revisão (2026-08-22, com `{VALOR}` de volta)

**Correção sobre a versão anterior desta seção:** com o Grupo 2
esclarecido (seção 3), `{VALOR}` deixa de ser um dado "ausente" —
quem agenda a mensagem (José) já sabe o valor combinado no momento do
agendamento, o mesmo jeito que ele já sabe qual cliente e qual data.
Não precisa vir de `/match`/`/status`. Volta a fazer sentido manter
as **3 variáveis originais**, batendo exatamente com o texto real do
Rocket:

```
📌 Lembrete de pagamento combinado

Olá,{{1}}! Você combinou o pagamento do seu plano {{2}}, no valor de R$ {{3}}, para hoje.

Caso já tenha realizado o pagamento, pode desconsiderar este aviso.

InovaTV — Sempre pensando em você! 📺
```

3 variáveis: `{{1}}` nome, `{{2}}` plano, `{{3}}` valor. Sem CTA
promocional. **Frase de ameaça de bloqueio deliberadamente fora desta
versão** — não removida por decisão técnica, e sim porque acrescentar
esse tom de ameaça é uma escolha de produto que precisa da sua
aprovação explícita antes de entrar no texto final; não incluída por
conta própria.

### Versão alternativa, com o alerta de consequência em tom mais suave (2026-08-22, a pedido do usuário)

Mantém a informação (existe uma consequência real de não pagar), mas
troca "pode ser bloqueado a qualquer momento e sem aviso prévio"
(ameaça, imprevisibilidade) por uma frase que só pede regularização,
sem o tom de "a qualquer momento":

```
📌 Lembrete de pagamento combinado

Olá,{{1}}! Você combinou o pagamento do seu plano {{2}}, no valor de R$ {{3}}, para hoje.

Caso já tenha realizado o pagamento, pode desconsiderar este aviso. Caso ainda não tenha pago, pedimos que regularize para manter seu acesso funcionando normalmente.

InovaTV — Sempre pensando em você! 📺
```

**O que mudou de tom, especificamente:**
- Tira "poderá ser bloqueado a qualquer momento e sem aviso prévio"
  (imprevisibilidade + ameaça) → troca por "pedimos que regularize
  para manter seu acesso funcionando normalmente" (pedido + benefício
  de agir, sem ameaça).
- Mantém a informação real (existe uma consequência de não pagar) sem
  dramatizar o "quando"/"como" — não promete nem omite que existe
  risco, só não usa linguagem de coação.
- Ainda são 3 variáveis, mesmo corpo geral, sem CTA promocional —
  continua estruturalmente mais parecido com "atualização de conta"
  do que com convite comercial.

## 7. RESULTADO REAL (2026-08-22) — submetido com sucesso, sem aviso de categoria

**Versão escolhida: a suavizada (seção 6).** Submetida à Meta como
Utilidade, categoria **`fiado_em_atraso`**, 3 variáveis (nome, plano,
valor). **Diferente das duas tentativas do `vencimento_hoje`,
nenhum aviso "A categoria não corresponde" apareceu** — o fluxo de
envio passou direto, sem intervenção. Status confirmado no
Gerenciador do WhatsApp: **"Em análise"**, categoria **Utilidade**
(a que submetemos, sem reclassificação automática visível até agora —
diferente do que aconteceu com `vencimento_hoje`, que foi
reclassificado pra Marketing depois da análise completa).

**Achado que fecha a comparação pretendida:** confirma a hipótese
levantada no momento da escolha deste item como próxima POC — o
problema do `vencimento_hoje` era mesmo "lembrete de vencimento
programado" especificamente, não "qualquer mensagem sobre pagamento
pendente". Um aviso de pagamento **combinado** (não uma régua
recorrente de vencimento) passou sem nenhum sinal de alerta.

**Pendência real:** "Em análise" ainda não é aprovação final — o
mesmo `vencimento_hoje` também esteve "Em análise" antes de ser
reclassificado. Só saberemos o resultado definitivo (Utilidade mantida
ou trocada) quando a análise terminar.

### Como as 3 variáveis seriam preenchidas no futuro fluxo de agendamento (Grupo 2, não implementado agora)

Pensando na futura tela equivalente a "Mensagens Agendadas" no nosso
Painel (registrada como pendência, seção 6):
- **Nome** e **Plano** — poderiam vir automaticamente assim que José
  selecionasse o cliente (mesmo dado já disponível via `/status`),
  sem precisar digitar.
- **Valor** — campo de texto livre, preenchido manualmente por José
  no momento do agendamento (mesmo padrão do campo "Observação" já
  existente na tela real do Rocket) — nunca inferido, nunca vindo de
  uma API que não tem esse dado.

Isto é só uma nota de como o preenchimento funcionaria — **não é uma
especificação da ferramenta de agendamento em si**, que segue como
funcionalidade futura não priorizada (seção 6-C do inventário).

## 5. Avaliação de risco de classificação Meta — honesta, não uma previsão garantida

**A favor de Utilidade:** sem CTA, sem oferta, sem preço, sem convite
a comprar algo novo — é estruturalmente mais parecido com
`pagamento_confirmado` (que passou) do que com `vencimento_hoje` (que
foi recusado 2x).

**Contra, ou pelo menos incerto:** o tema de fundo ainda é "pagamento
pendente" — mesma família temática do `vencimento_hoje`, que já
provou que o classificador da Meta pode reagir ao **assunto**
("pagamento perto de vencer/vencido"), não só à presença de CTA
explícito. **Não dá pra garantir que vai passar como Utilidade só
porque o texto está mais limpo** — é uma hipótese razoável, testável,
não uma certeza.

**Por isso a lógica de "testar este primeiro" faz sentido como
estratégia:** se este passar como Utilidade e o `vencimento_hoje`
continuar recusado, isso vai revelar que o problema real é
"lembrete de vencimento programado" especificamente, não "qualquer
mensagem sobre dinheiro pendente" — informação valiosa pra decidir o
resto da família (itens 2-5, 10), exatamente como você apontou.

## 6. O que fica pendente, não decidido aqui

1. **Construir o equivalente da tela "Mensagens Agendadas"** (Cliente +
   Mensagem + Data, agendamento manual) na nossa própria
   infraestrutura — é a peça real que falta, não um mecanismo de
   detecção (corrigido na seção 3). Provavelmente uma extensão futura
   do Painel de Atendimento, não decidido aqui.
2. **Se a frase de ameaça de bloqueio entra ou não no template final**
   — removida nesta proposta, não decidido definitivamente.
3. **Nome definitivo do template** — sugestão: `fiado_em_atraso` (não
   confirmado).
4. Esta proposta não foi submetida — mesma disciplina de sempre,
   aguardando aprovação.

**Nada implementado, nada submetido, Rocket/RocketZap intocados.**
