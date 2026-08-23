# Desenho — Teste Grátis Iniciado (levantamento + proposta, sem submissão)

> **Isto é levantamento e desenho, não implementação.** Nenhum
> template criado/submetido, nenhum código escrito, nenhuma automação
> do Rocket alterada. Continua o inventário
> (`2026-08-22_inventario_substituicao_rocketzap.md`) — e **corrige**
> uma classificação errada que aquele inventário tinha feito por
> confiar só no resumo da matriz de migração, sem ter lido o texto
> literal completo.

## 0. Correção sobre o inventário anterior — achado real, antes de qualquer proposta

**O inventário classificou este item como "confirmação de algo que já
aconteceu, mesma natureza de baixo risco do `pagamento_confirmado`".
Isso estava errado.** Ao abrir o texto literal completo (Rocket →
Mensagens → Teste Grátis Iniciado → Info), o conteúdo real é muito
mais parecido com o próprio "Teste Grátis Vencendo"/"Vence Hoje" do
que com "Pagamento Confirmado" — tem catálogo de preços, dados de PIX
completos, programa de indicação e uma chamada explícita à ação
("a contratação é simples e rápido! Só escolher o plano..."). **A
confirmação em si (nome/usuário/validade) é só o início da mensagem —
o resto é comercial.** Corrigido aqui antes de propor qualquer coisa.

## 1. Texto literal completo (Rocket, confirmado ao vivo nesta sessão)

```
👍 OBS: ESTA É UMA MENSAGEM AUTOMÁTICA!

✅ *Nome: {NOME}*
✅ *Usuário: {USUARIO}*
🕐 *Validade: {VENCIMENTO} até às {HORA}*

Seu teste gratuito de IPTV da InovaTV foi ativado com sucesso!

Agora você pode aproveitar e explorar todo o conteúdo na palma da sua mão!

Use esse período para conhecer nossos recursos e qualidade. Temos certeza de que você vai curtir!

E se você gostar, a contratação é simples e rápido! Só escolher o plano desejado e enviar o comprovante PIX aqui no Whatsapp! *Seu plano será ativado imediatamente!*

E tem mais: ao fazer indicações do nosso aplicativo você ganha *1 mês grátis* para cada pessoa que assinar um de nossos planos!

*Confira nossos planos:*
🗓️ 30 dias: R$ 35,00
🗓️ 90 dias: R$ 90,00
🗓️ 180 dias: R$ 180,00
🗓️ 365 dias: R$ 300,00

📌 Forma de pagamento:
✅ Pix Celular: *17996242415*
🏦 Banco: NuBank
🧑 Nome: José Antônio

OBS: Após fazer o pagamento favor enviar o comprovante por gentileza. Seu plano será ativado/renovado logo em seguida! 🧡

Qualquer dúvida, estamos por aqui para te ajudar.

📺 InovaTV - Sempre pensando em você
```

**Variáveis usadas:** `{NOME}` `{USUARIO}` `{VENCIMENTO}` `{HORA}` —
só 4, mais simples que o de vencimento (não usa `{PLANO}`/`{SERVIDOR}`
aqui, porque o teste é sempre o mesmo "produto").

## 2. Gatilho real — confirmado ao vivo, corrige uma ambiguidade do inventário anterior

Existem **dois pontos de configuração**, e só um é o gatilho real:

- **`/gerenciador/enviosAutomaticosTestes/` → "Teste Grátis Iniciado"**
  — aparece como **Manual, desativado** (toggle cinza), tipo período
  Minutos = 2. **Este NÃO é o caminho que dispara de verdade hoje.**
- **`/gerenciador/configuracoes/` → seção Testes → "Mensagem de Teste
  Criado"** — confirmado ao vivo (inspeção do próprio `<select>`) que
  o valor selecionado é **"Teste Grátis Iniciado"**. Esta é a
  configuração real: um **evento pontual automático**, disparado
  quando um teste é criado de forma automática (mesmo padrão do
  "Pagamento Confirmado" → evento "ADD Pagamento").

**Conclusão:** o gatilho real é um evento, não uma régua de tempo —
dispara no instante em que o teste é criado (hoje, dentro do próprio
Rocket). Não depende de motor de agendamento nenhum, mesma categoria
do `pagamento_confirmado` (evento pontual, não Cobrança recorrente).

## 3. Dados disponíveis hoje na nossa infraestrutura

| Variável | Disponível? | Fonte |
|---|---|---|
| `{NOME}` | ✅ Sim | `/status` → `cliente.nome` |
| `{VENCIMENTO}` | ✅ Sim | `/status` → `cliente.vencimento` (aqui seria a validade do teste, não de um plano pago) |
| `{HORA}` | ⚠️ Provável | Embutida no timestamp de `vencimento` |
| `{USUARIO}` | ⚠️ Parcial | Só em `/match` → `candidates[].usuario`, não em `/status` — mesma lacuna já registrada para a família de vencimento |

**Achado à parte, mais estrutural que o de variáveis:** não está
confirmado que `/match`/`/status` da `inovatv-api-intermediaria`
sequer cobrem **testes** hoje — a matriz de migração original (seção
3.3) já registrava isso como não confirmado ("nenhuma integração de
leitura de testes existe hoje... precisaria ser construída do zero").
Isso é mais sério que a lacuna do `{USUARIO}` — pode ser que nem o
dado básico do teste esteja acessível ainda pela nossa API.

## 4. Categoria provável na Meta — a lição do `vencimento_hoje` se aplica aqui, e mais forte

Pelo mesmo raciocínio já comprovado com `vencimento_hoje` (aviso
puramente factual já foi recusado 2x como Utilidade), **um template
com catálogo de preços, dados de PIX e programa de indicação seria
recusado com folga maior ainda, se tentado como está.** Não faz
sentido nem tentar Utilidade com o texto literal completo.

**Mas o núcleo da mensagem — "seu teste foi ativado, validade até
X" — é estruturalmente igual ao `pagamento_confirmado` (confirmação
de um evento que já aconteceu, sem venda embutida).** A recomendação
é **separar as duas coisas**, não tratá-las como uma coisa só:

## 5. Proposta — separar confirmação (template) de oferta (conversa livre)

**Núcleo pra template (Utilidade, candidato razoável):**
```
✅ Teste ativado!

Olá,{{1}}! Seu teste gratuito de IPTV da InovaTV foi ativado com sucesso.

👤 Usuário:{{2}}
📅 Válido até:{{3}}

Aproveite para explorar o conteúdo. Qualquer dúvida, estamos por aqui.
InovaTV — Sempre pensando em você! 📺
```
3 variáveis (nome, usuário, validade) — sem `{HORA}` separado, embutido
no mesmo campo de validade (mesmo padrão já usado no `vencimento_hoje`
final). **Sem catálogo de preços, sem PIX, sem indicação, sem CTA.**

**Catálogo de planos, PIX e indicação — não vão pro template.** Pela
mesma regra já estabelecida no achado central da revisão anterior
(janela de 24h): assim que o cliente responder a esse aviso (ou a
qualquer mensagem durante o período de teste), a conversa está aberta
e o Orquestrador já pode responder com essa informação em texto livre
— **se e quando** esse conteúdo (planos, PIX, indicação) existir na
Camada de Conhecimento Institucional (Componente 2). **Não confirmado
nesta etapa se esse conteúdo já está cadastrado lá.**

**Pensando no atendimento futuro, isso é uma melhoria real, não só
uma correção de compliance:** hoje o Rocket manda a "internet inteira"
de uma vez (preços + PIX + indicação) numa mensagem só, texto longo,
sem interação. Com o modelo de template enxuto + conversa livre
depois, o cliente recebe uma confirmação curta e só vê o catálogo/PIX
**se perguntar** — mais parecido com um atendimento de verdade do que
um despejo de informação.

## 6. O que fica pendente, não decidido aqui

1. **Confirmar se `/match`/`/status` cobrem clientes em teste** —
   bloqueador técnico mais sério que a lacuna de `{USUARIO}`.
2. **Confirmar se o conteúdo de planos/PIX/indicação já está no
   Conhecimento Institucional** — mesma pendência já registrada para
   `vencimento_hoje`.
3. **Nome definitivo do template** — sugestão: `teste_gratis_iniciado`
   (não confirmado).
4. Esta proposta não foi submetida — segue a mesma disciplina do
   `vencimento_hoje` (aguardar aprovação antes de qualquer envio à
   Meta).

---

## Investigação separada — "Teste Não Convertido Após 3 Dias" com status "Vencido"

> **Investigação à parte, não misturada com a proposta acima**,
> conforme pedido.

**Resolvido — não é uma anomalia, é uma configuração de filtro lida
errado por mim na tabela do inventário anterior.** Confirmado ao vivo
(`Editar → Configuração`): o campo **"Situação do teste" = `Vencido`**
é um **filtro de audiência** desta automação específica (junto de
"Convertido: Não", "Período: 3 dias") — não um status operacional da
automação em si. Faz sentido semântico perfeito: uma automação
chamada "Não Convertido Após 3 Dias" **deveria mesmo** filtrar por
testes cuja situação já é "Vencido" (expirado) e que não converteram
— é exatamente o público-alvo certo. O card na lista de automações
mostra esse valor de filtro no mesmo lugar visual onde as outras duas
automações da família (`Teste Grátis Iniciado`, `Teste Grátis
Vencendo`) mostram "Ativo" (porque o filtro delas é "Situação do
teste = Ativo", coerente com testes ainda em andamento).

**Confirmado também, aba Automática:** `Envio automático? = Sim`,
todos os 7 dias da semana marcados — **sem campo de horário
específico** (diferente das Cobranças de Vencimento, que têm horário
exato; a automação de Testes só usa dias da semana + período em
dias/minutos, sem hora fixa).

**Conclusão:** este item não revela nenhuma automação mal classificada
ou quebrada — é `Automática`, `Ativa`, funcionando como desenhado.
Nenhuma prioridade nova a partir deste achado; volta a ser tratado
como qualquer outro item da família de lembretes de expiração (mesmo
risco de classificação Meta do `vencimento_hoje`).
