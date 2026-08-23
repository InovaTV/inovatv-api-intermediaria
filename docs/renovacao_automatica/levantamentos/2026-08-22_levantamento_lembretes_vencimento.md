# Levantamento — Lembretes de Vencimento do RocketZap (a preservar no Motor de Lembretes)

> **Levantamento somente leitura, nada implementado.** Nenhum código,
> banco, configuração do Rocket ou deploy foi alterado nesta etapa.
> Toda evidência foi coletada por navegação real e autenticada no
> painel `app.rocketgestor.com` nesta sessão (2026-08-22), completando
> lacunas deixadas em aberto por
> `2026-08-22_matriz_migracao_rocketzap.md` (seção 5, itens 1 e 3) —
> não duplica o que já estava confirmado lá, só fecha o que faltava.
> Número oficial e RocketZap não foram tocados — nenhuma automação,
> mensagem ou filtro foi ativado, desativado ou salvo.

## 0. Objetivo

Mapear, campo a campo, os lembretes de vencimento que o Rocket
dispara hoje pelo número oficial (`5517996242415`, sessão `inovatv`),
para que o **Motor de Lembretes** (infraestrutura própria) possa
reproduzi-los sem perder nada, antes de qualquer decisão de
implementação. **Nenhuma decisão de arquitetura foi tomada aqui.**

## 1. Inventário real — `/gerenciador/cobrancas/`, Tipo "Vencimento"

Confirmado ao vivo: **6 Cobranças existem hoje no total**, 4 do tipo
Vencimento (as que interessam a este levantamento) + 2 que não são
lembrete de vencimento (Avisos Servidor NewOne, Promoção Indique e
Ganhe — fora de escopo aqui, já cobertas pela matriz de migração).

| Nome | Ativo/Inativo | Automático/Manual | Antecedência | Horário | Dias da semana | Filtros/Audiência | Sessão WhatsApp |
|---|---|---|---|---|---|---|---|
| **Vence Hoje** | ✅ Ativo | Automática | Vencimento = hoje (Período 0, implícito no nome — campo Período não se aplica a "hoje") | **07:00** | Todos os 7 dias (Seg–Dom, todos ligados) | **Nenhum filtro selecionado** — nenhum servidor/captação/dispositivo/aplicativo/plano/forma de pagamento/time marcado; Arquivado = "Não" (só clientes não arquivados) | Em branco → usa a sessão padrão do servidor de cada cliente (sessão geral do sistema = `inovatv`) |
| **Vence em 3 Dias** | ✅ Ativo | Automática | 3 dias antes do vencimento (Tipo Período: Dias, Período: 3) | **11:00** | Todos os 7 dias (Seg–Dom, todos ligados) | **Nenhum filtro selecionado** (mesmo padrão acima) | Em branco → sessão padrão (`inovatv`) |
| **Vencido a 3 Dias** | ✅ Ativo | Automática | 3 dias depois do vencimento (Tipo Período: Dias, Período: 3) | **09:00** | Todos os 7 dias (Seg–Dom, todos ligados) | **Nenhum filtro selecionado** (mesmo padrão acima) | Em branco → sessão padrão (`inovatv`) |
| **Vence em 1 dia** | ❌ Inativo (toggle "Cobrança automática?" desligado) | Manual — mas já tem horário/dias pré-configurados, prontos para caso seja ativado | 1 dia antes do vencimento (Tipo Período: Dias, Período: 1) | **09:40** (configurado, mas não roda porque a automação está desligada) | Todos os 7 dias já marcados (idem, mas inerte) | **Nenhum filtro selecionado** (mesmo padrão acima) | Em branco → sessão padrão (`inovatv`) |

**Achado importante:** nenhum dos 4 lembretes de vencimento tem
**qualquer filtro de audiência** configurado hoje — nenhum é
restrito por servidor, plano, dispositivo, aplicativo, forma de
pagamento ou time. Todos os clientes não-arquivados recebem, na
prática, o mesmo tratamento. O Motor de Lembretes não precisa (por
enquanto) reproduzir lógica de filtro por segmento — só a régua de
antecedência/horário.

**Achado à parte:** existe uma **5ª mensagem** de vencimento,
`Venceu Ontem`, com texto pronto (seção 2, abaixo) mas **sem nenhuma
Cobrança ativa nem inativa apontando para ela** — não aparece entre
as 6 Cobranças existentes. Ou seja: hoje, um cliente que venceu ontem
não recebe automaticamente esse lembrete pelo Rocket — a mensagem
existe "solta", não conectada a nenhum gatilho. Vale decidir,
futuramente, se o Motor de Lembretes deve reintroduzir essa régua
(vencido há 1 dia) ou deixá-la de fora, já que o Rocket também não a
está usando hoje.

## 2. Texto completo e variáveis — as 5 mensagens da família Vencimento

**Padrão estrutural idêntico nas 5** (mesmo já registrado na matriz
para as demais mensagens do Rocket): saudação → aviso em destaque →
bloco de dados do plano → lembrete + CTA de comprovante → bloco fixo
de "Promoção Indique e Ganhe" → assinatura. Só a frase de "aviso em
destaque" muda por mensagem.

### 2.1 — Vence Hoje

```
👋 Olá, *{NOME}!* Tudo bem?

⚠️ *Seu plano vence hoje!*

✅ Plano atual: *{PLANO} — R$ {VALOR}*
✅ Nome de usuário: *{USUARIO}*
✅ Servidor: *{SERVIDOR}*
🕐 Válido até: *{VENCIMENTO} às {HORA}*

⚠️ Este é apenas um lembrete! Mas se quiser renovar o [...]
⚠️ Não esqueça de enviar o comprovante de pagamento por aqui para que possamos renovar seu plano mais rapidamente!

🎁 *LEMBRE-SE DA PROMOÇÃO INDIQUE E GANHE!*

💰 Se você indicar um amigo ou familiar hoje, até as *{HORA}*, e ele contratar um plano conosco, você ganha *ESSA renovação totalmente grátis!* 🤩

🚀 E tem mais: quanto mais pessoas você indicar, mais meses grátis acumula!

📲 Gostou? Responda aqui com o nome e telefone de quem gostaria de indicar e comece a ganhar meses grátis agora mesmo!

📺 *InovaTV — Sempre pensando em você!*
```

### 2.2 — Vence em 3 Dias

Idêntica à acima, só troca a linha de destaque para:
```
⚠️ *SEU PLANO EXPIRA EM 3 DIAS!*
```
Resto do corpo (dados do plano, CTA de comprovante, promoção,
assinatura) **idêntico**, mesmas variáveis.

### 2.3 — Vencido a 3 Dias

Já confirmada na matriz de migração (`2026-08-22_matriz_migracao_rocketzap.md`,
item 8) — mesma estrutura, linha de destaque de "vencido há 3 dias",
variáveis `{NOME}` `{SERVIDOR}` `{USUARIO}` `{VENCIMENTO}` `{HORA}`
(mais `{PLANO}`/`{VALOR}`, confirmado agora consistente com o padrão
das demais).

### 2.4 — Vence em 1 dia

Idêntica ao padrão, linha de destaque:
```
⚠️ *SEU PLANO EXPIRA AMANHÃ!*
```

### 2.5 — Venceu Ontem (sem Cobrança ativa hoje, ver achado acima)

Idêntica ao padrão, linha de destaque:
```
⚠️ SEU PLANO *EXPIROU!* VAMOS RENOVAR?
```

**Variáveis usadas, idênticas nas 5:** `{NOME}` `{PLANO}` `{VALOR}`
`{USUARIO}` `{SERVIDOR}` `{VENCIMENTO}` `{HORA}` — mesmo conjunto já
mapeado na matriz de migração para "Vencido a 3 Dias", agora
confirmado literalmente igual nas outras 4.

## 3. Confronto com o que a `inovatv-api-intermediaria` já tem

**Não repetido aqui em detalhe — já está inteiramente coberto pela
matriz de migração, seção 3.1, sem mudança nesta rodada:**

| Variável | Disponível hoje? | Onde |
|---|---|---|
| `{NOME}` | ✅ Sim | `/status` → `cliente.nome` |
| `{VENCIMENTO}` | ✅ Sim | `/status` → `cliente.vencimento` |
| `{PLANO}` | ✅ Sim | `/status` → `cliente.planoNome` |
| `{SERVIDOR}` | ✅ Sim | `/status` → `cliente.servidorNome` |
| `{HORA}` | ⚠️ Provável | Embutida no timestamp ISO de `vencimento`, só precisa ser formatada/extraída |
| `{USUARIO}` | ⚠️ Parcial | Só em `/match` → `candidates[].usuario`, não em `/status` |
| `{VALOR}` | ❌ Não disponível | Não existe em `/match` nem `/status` — mesmo gap já registrado na POC #2 do template `pagamento_confirmado` (seção 12 do desenho de substituição) |

**Achado que confirma um padrão entre as duas frentes (lembretes e
pagamento):** `{VALOR}` é a lacuna recorrente — nem o template
`pagamento_confirmado` (aprovado) nem `/status` o expõem hoje. Se o
Motor de Lembretes for construído com um Message Template próprio
(exigência real da Cloud API para mensagem proativa, já comprovada na
POC #2), a mesma decisão pendente de `{VALOR}` se repete aqui:
inclui a variável e aceita que ela venha de outro lugar (allowlist do
`export-clientes`?), ou aceita um template sem ela, como já foi feito
para `pagamento_confirmado`.

**Motor de agendamento (dia/hora/filtro) — não existe nada
equivalente hoje**, mesmo achado já registrado na matriz de migração
(seção 3.4) — continua sendo o bloco genuinamente novo de
infraestrutura, sem repetição aqui.

## 4. Resumo por lembrete — prontidão após este levantamento

| Lembrete | Dado de cliente | Motor de agendamento | Audiência | Prontidão |
|---|---|---|---|---|
| Vence Hoje (07:00, diário) | 🟡 Falta `{VALOR}`/`{USUARIO}` completo | 🔴 Não existe | 🟢 Sem filtro — todos os não-arquivados | Falta só o motor + decisão de `{VALOR}` |
| Vence em 3 Dias (11:00, diário) | 🟡 idem | 🔴 Não existe | 🟢 idem | idem |
| Vencido a 3 Dias (09:00, diário) | 🟡 idem | 🔴 Não existe | 🟢 idem | idem |
| Vence em 1 dia (09:40, hoje inativo no Rocket) | 🟡 idem | 🔴 Não existe | 🟢 idem | idem — decidir se entra no escopo já que nem o Rocket está usando |
| Venceu Ontem (sem gatilho ativo no Rocket hoje) | 🟡 idem | 🔴 Não existe | 🟢 idem | Decidir se vale reintroduzir, já que nem o Rocket dispara isso hoje |

## 5. O que ainda falta decidir (não decidido aqui, nenhuma implementação)

1. **De onde vem `{VALOR}`** para os lembretes — mesma pendência já
   registrada para `pagamento_confirmado` (seção 13 do desenho de
   substituição). Pode ser a mesma decisão para as duas frentes, ou
   duas decisões separadas.
2. **Se `{USUARIO}` deve ser adicionado ao contrato de `/status`** —
   decisão de arquitetura/segurança já sinalizada na matriz (seção
   3.1), não trivial, allowlist foi definida deliberadamente.
3. **Se "Vence em 1 dia" e "Venceu Ontem" entram no escopo do Motor de
   Lembretes**, já que nenhum dos dois está ativo no Rocket hoje —
   pode fazer sentido não reproduzir o que nem o sistema atual está
   disparando, ou pode ser a oportunidade de corrigir uma lacuna que
   já existe há tempo no Rocket. Decisão de produto, não técnica.
4. **Quantas mensagens por dia um cliente pode receber** se estiver,
   por exemplo, a 3 dias Y vencendo — hoje o Rocket dispara "Vence em
   3 Dias" independente de qualquer outro lembrete já enviado; o Motor
   de Lembretes precisa decidir se replica esse comportamento
   (potencialmente redundante) ou introduz alguma regra de
   deduplicação. Não decidido.
5. **Qual será o primeiro lembrete a virar POC no número de teste** —
   pergunta em aberto do usuário, a decidir depois deste levantamento.

## 6. O que NÃO foi feito nesta etapa

Nenhuma automação do Rocket foi ativada, desativada ou salva (todos
os modais foram fechados com "Fechar"/"X", nunca "Salvar"). Nenhum
código, migration, tabela ou Edge Function foi criado. Nenhum deploy.
Número oficial e sessão RocketZap não tocados. Nenhuma decisão de
arquitetura do Motor de Lembretes foi tomada — este documento é só
insumo para a próxima etapa (desenho), como já foi o padrão da matriz
de migração original.

**Parado deliberadamente aqui, aguardando aprovação do usuário antes
de desenhar o Motor de Lembretes ou decidir o primeiro POC.**
