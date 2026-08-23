# Desenho — POC do Motor de Lembretes: "Vence Hoje"

> **Isto é design, não implementação.** Nenhum código, Edge Function,
> deploy, template na Meta ou configuração do Rocket foi criado/
> alterado nesta etapa. Continua
> `2026-08-22_levantamento_lembretes_vencimento.md` (aprovado) — não
> repete o que já foi confirmado lá, só desenha a partir dele.
> Número oficial e RocketZap permanecem intocados.

## 0. Objetivo desta POC

Provar a cadeia:

```
condição de vencimento → disparador → template → Cloud API → número de teste
```

usando **"Vence Hoje"** como primeiro lembrete (escolhido — ativo,
horário conhecido, sem filtro, mecanismo de envio já comprovado nas
POCs #1/#2 da substituição do RocketZap).

**Diferença em relação às POCs anteriores:** ali, a condição
("pagamento foi registrado") era criada pela própria chamada (o
`PATCH`). Aqui, a condição ("vencimento é hoje") **precisa ser
verificada antes de decidir disparar** — é a primeira vez que a
cadeia inclui uma checagem de condição, não só uma ação seguida de
confirmação. Isso é exatamente a peça que falta pro motor de verdade
(seção 3.4 da matriz de migração) — por isso essa POC importa mais do
que parece: ela não é só "mandar outra mensagem", é provar o pedaço
de lógica que o agendador real vai reusar todo dia.

## 1. Dados disponíveis hoje para montar a mensagem — sem inventar nada

Mesmo levantamento já registrado (`/status`), sem mudança:

| Campo | Disponível? | Fonte |
|---|---|---|
| `nome` | ✅ | `/status` → `cliente.nome` |
| `plano` | ✅ | `/status` → `cliente.planoNome` |
| `servidor` | ✅ | `/status` → `cliente.servidorNome` |
| `vencimento` | ✅ | `/status` → `cliente.vencimento` (usado também pra checar a condição, seção 2) |
| `{VALOR}` | ❌ **Fora desta POC, deliberadamente.** Não existe em `/match` nem `/status` — mesma lacuna já registrada na POC #2 (`pagamento_confirmado`). Não inventado, não buscado por fonte não confirmada. Fica pendência registrada (seção 5). |
| `{USUARIO}` | ❌ **Fora desta POC**, mesmo motivo — só existe em `/match`, não em `/status`; adicioná-lo é decisão de arquitetura/segurança separada (já registrada na matriz, não resolvida aqui). |

**Conclusão:** a mensagem desta POC usa exatamente as mesmas 4
variáveis já aprovadas no template `pagamento_confirmado` — nome,
plano, servidor, vencimento. Nenhuma variável nova a resolver.

## 2. A peça nova: verificação de condição, desenhada para ser reaproveitada pelo agendador real

Diferente das POCs anteriores (onde a ação em si — o `PATCH` — já
era a prova de que o evento aconteceu), aqui precisamos de uma função
pura de decisão, **desenhada desde já no formato que o motor de
verdade vai precisar**, não uma checagem descartável só para esta
POC:

```
condicaoVenceHoje(vencimentoIso: string, agora: Date): boolean
  → compara a DATA (dia/mês/ano) do vencimento, no fuso America/Sao_Paulo,
    com a data de "agora" — ignora a hora, porque "vence hoje" é uma
    condição de dia, não de instante exato (mesmo padrão implícito na
    automação real do Rocket: "Vence Hoje" dispara pra todo cliente cujo
    dia de vencimento é hoje, não importa a hora exata configurada no
    cadastro dele)
```

**Por que isso importa mais que o resto do desenho:** o motor real
(seção 3.4 da matriz, ainda não construído) vai precisar rodar essa
mesma comparação, todo dia, contra uma lista de clientes — não contra
um cliente fixo. Escrever essa função já isolada e pura nesta POC
(em vez de embutir a comparação direto no meio do código do
disparador, como as POCs anteriores fizeram com `somarPeriodo`)
significa que o motor real, quando for construído, **reaproveita a
mesma função sem reescrevê-la** — só troca "um cliente fixo" por
"iterar sobre clientes retornados por uma consulta". Isso é a
diferença arquitetural desta POC em relação às anteriores.

## 3. Fluxo proposto da POC

```
1. PATCH controlado no cliente de teste (Rocket)
   → simula a condição real: vencimento = HOJE, mesmo horário atual
   (reaproveita exatamente o mesmo mecanismo já comprovado em
   poc-confirmacao-renovacao — GET antes → PATCH → GET depois, nunca
   confia em cálculo, sempre confirma via GET)
   ↓
2. condicaoVenceHoje(cliente.vencimento, agora) → true
   (a mesma função que o motor real vai usar, aplicada aqui a um
   único cliente fixo)
   ↓
3. Se true: monta o contexto (nome, plano, servidor, vencimento)
   ↓
4. Dispara via enviarTemplateWhatsApp — template NOVO, ainda não
   existe (seção 4)
   ↓
5. Confirma envio (outcome "success") e pede confirmação visual do
   usuário no WhatsApp de teste, mesmo processo já usado nas POCs
   #1/#2
```

**Alvo fixo, mesmo padrão de segurança já aprovado nas POCs
anteriores:** mesmo cliente de teste (`Js Informática Rp` / NewOne),
nunca por parâmetro livre, function descartável, sem autenticação
própria (mesmo raciocínio já aceito: efeito sempre no mesmo cliente
fixo, function apagada depois de usada).

**Diferença deliberada em relação à POC #2:** lá, o `PATCH` *avançava*
o vencimento (renovação real). Aqui, o `PATCH` só *reposiciona* o
vencimento pra "hoje" — não é uma renovação, é uma simulação de
condição. Isso precisa ficar bem explícito no nome/comentário da
function pra não ser confundido com uma renovação de verdade.

## 4. Dependência real que bloqueia a execução: template novo, ainda não existe

**Achado desta etapa de desenho, não resolvido aqui:** o template
`pagamento_confirmado` (já aprovado) tem o texto "Pagamento
confirmado! Sua renovação foi registrada com sucesso" — **semântica
errada** para um lembrete de vencimento. Reaproveitar esse template
pra "Vence Hoje" produziria uma mensagem enganosa (diria que o
pagamento foi confirmado quando, na verdade, é o oposto: está
vencendo). **Precisa de um template novo.**

**Proposta de conteúdo** (baseada no texto real do Rocket, seção 2 do
levantamento, com o mesmo corte de marketing/indicação já aplicado ao
`pagamento_confirmado` — decisão já validada por precedente, não uma
escolha nova):

```
⚠️ Seu plano vence hoje!

Olá,{{1}}! Este é um lembrete de que seu plano vence hoje.

📋 Plano:{{2}}
🖥️ Servidor:{{3}}
📅 Vencimento:{{4}}

InovaTV — Sempre pensando em você! 📺
```

4 variáveis, mesma ordem/semântica já usada em `pagamento_confirmado`
(nome, plano, servidor, data) — deliberadamente, pra manter
consistência entre os templates da família Vencimento e Pagamento.
Categoria proposta: **Utilidade**. **Sem botões** (ver seção 4-B).

**Duas correções feitas antes de submeter (2026-08-22, ambas pedidas
pelo usuário):**

1. A primeira proposta desta seção dizia "envie o comprovante de
   pagamento por aqui" — instrução operacional específica que **ainda
   não está fechada** (já registrado em outra frente: comprovante ≠
   confirmação de renovação, a renovação é registrada por nós, e só
   então a mensagem de confirmação sai — Componente 1 §"PAGAMENTOS E
   COMPROVANTES", `inovatv_central` CLAUDE.md).
2. **Tentativa real de submissão bloqueada pela Meta (2026-08-22):**
   ao preencher o formulário de criação do template com a versão
   ainda contendo "Para renovar seu plano, entre em contato conosco
   por aqui" (2ª versão, já sem o texto de comprovante, mas ainda com
   um CTA de contato), a própria interface da Meta interceptou o
   envio com o aviso *"A categoria não corresponde"* — classificou o
   conteúdo como mais próximo de **Marketing** do que Utilidade, e
   avisou que "este modelo de mensagem será rejeitado" se submetido
   como Utilidade. **Nada foi submetido** — o aviso apareceu antes da
   confirmação final, cancelado sem enviar. Causa provável: qualquer
   frase pedindo uma ação de engajamento/contato ("entre em contato",
   "renove agora") é lida pelo classificador automático da Meta como
   sinal promocional, mesmo sem ser, de fato, uma oferta comercial.
   **Correção:** removida toda frase de chamada à ação — o corpo final
   (acima) é puramente informativo (fato + dados), sem nenhuma
   instrução do que o cliente deve fazer.

3. **Segunda tentativa de submissão (2026-08-22), com o texto já
   totalmente neutro (sem CTA) — o MESMO aviso "A categoria não
   corresponde" apareceu de novo.** Achado real e importante: a
   recusa automática **não estava ligada ao CTA** (já removido) —
   persistiu mesmo com um corpo puramente factual (nome, plano,
   servidor, vencimento, sem nenhuma instrução de ação). Isso indica
   que o classificador da Meta trata "aviso de vencimento de plano"
   como próximo de Marketing pela **natureza do conteúdo em si**
   (lembrete de expiração/retenção), não pela redação específica —
   hipótese, não confirmada oficialmente pela Meta.

   **Decisão do usuário: não migrar para Marketing, não continuar
   ajustando cosmeticamente o texto (emoji/pontuação) tentando
   "enganar" o classificador.** Em vez disso, mantido **Utilidade** e
   a submissão foi confirmada mesmo com o aviso — a própria tela da
   Meta oferece essa opção ("Você pode solicitar uma análise na
   Página Inicial do Suporte para Empresas"), então isso funciona como
   pedido de revisão humana da classificação, não uma tentativa de
   burlar o sistema.

   **Resultado: `vencimento_hoje` submetido com sucesso (2026-08-22),
   categoria Utilidade, status "Em análise"** — confirmado na lista de
   Modelos de Mensagem do Gerenciador do WhatsApp. Texto exatamente o
   da seção acima (sem CTA). Aguardando decisão da Meta.

   **Os templates `vencimento_em_3_dias`/`vencido_a_3_dias` NÃO foram
   desenhados nem submetidos nesta rodada** — decisão explícita do
   usuário: como pertencem à mesma família (mesmo tipo de conteúdo,
   "aviso de vencimento"), esperar o posicionamento da Meta sobre
   `vencimento_hoje` antes de decidir como tratar os outros dois
   (mesma estratégia, ou algo diferente se a Meta rejeitar).

**RESULTADO FINAL (2026-08-22): aprovado pela Meta, mas reclassificado
para Marketing — não Utilidade.** Status confirmado no Gerenciador do
WhatsApp: `Ativo — Qualidade pendente`, categoria **Marketing** (não
mais "Em análise"). A Meta não rejeitou o conteúdo — **aprovou, só que
sob a categoria que ela mesma decidiu ser a correta**, ignorando a
categoria Utilidade que submetemos. Isso fecha, com resposta real (não
mais hipótese), a pergunta que motivou toda a investigação: **"lembrete
de vencimento programado" é tratado como Marketing pela Meta,
independente do texto** — confirma o padrão já suspeitado depois da
segunda tentativa recusada, agora com certeza.

**Implicação direta pra família de lembretes puros (Vence em 3 Dias,
Vencido a 3 Dias, Teste Grátis Vencendo, Teste Não Convertido Após 3
Dias):** esperar o mesmo resultado — Marketing — se algum dia forem
submetidos como estão. `Fiado em Atraso`, por outro lado, foi
submetido sem nenhum aviso de categoria (ver
`2026-08-22_desenho_fiado_em_atraso.md`) — confirma que o problema é
especificamente "lembrete de vencimento", não "qualquer assunto de
pagamento pendente".

## 4-B. Levantamento geral — onde botões (Quick Reply) fariam sentido na InovaTV

**Isto é um levantamento à parte, não uma decisão de implementação.**
Nasceu da recusa deliberada de usar botão no `vencimento_hoje` (a
mesma preocupação de reclassificação para Marketing se aplicaria a um
botão do tipo "Renovar agora" — um Call-to-Action Button que leva a
uma ação externa é o tipo mais sujeito a isso). **Distinção técnica
importante, que muda a leitura de risco:** a Cloud API separa dois
tipos de botão — **Quick Reply** (resposta rápida, só devolve um
texto fixo pro nosso Webhook, sem link/telefone/ação externa) e
**Call-to-Action** (URL ou Ligar, sempre uma ação/link externo). O
aviso da Meta nesta sessão veio do **texto do corpo** pedindo contato
("entre em contato conosco"), não de um botão — mas um CTA Button
("Fale conosco") somaria o mesmo sinal de forma ainda mais explícita.
Quick Reply, por não levar a lugar nenhum fora da conversa, é
estruturalmente mais seguro para permanecer em Utilidade.

**Candidatos reais, a partir do que já está documentado/decidido no
ecossistema** (Componentes 1-5, `inovatv_central` CLAUDE.md; matriz
de migração RocketZap):

| Onde | Tipo de botão | Por que é um bom candidato |
|---|---|---|
| **Múltiplos acessos do mesmo telefone** (Componente 1 §8 — hoje a IA lista os acessos em texto e pede ao cliente digitar qual quer, texto livre) | Quick Reply (até 3 diretos) ou List Message (até 10) | Elimina erro de digitação/ambiguidade na escolha — o cliente aperta em vez de descrever qual conta; ganho de UX real, sem nenhum sinal promocional (é seleção operacional, não oferta) |
| **Pesquisa de satisfação pós-atendimento humano** (Painel de Atendimento, Componente 5 — não implementado, mas é fluxo natural após `/encerrar`) | Quick Reply (ex.: "Resolvido" / "Não resolvido") | Feedback estruturado de 1 toque, sem abrir nova frente de desenvolvimento agora — só um candidato futuro |
| **Confirmação de identidade antes de dado sensível** (ex.: "Você é o titular desta conta?") | Quick Reply Sim/Não | Reduz ambiguidade em casos de telefone compartilhado — mas hoje o Validador/Orquestrador já lidam com isso via regra determinística, então o ganho é mais UX que segurança |
| **Menu inicial de atendimento**, se o Orquestrador algum dia oferecer categorias (Suporte/Financeiro/Outro) | Quick Reply | Só faz sentido se/quando essa ramificação de menu for decidida como funcionalidade — **não existe hoje**, fica registrado como ideia, não como próximo passo |
| **Lembretes de vencimento** (`vencimento_hoje` e família) | ❌ Nenhum, por ora | Decisão desta sessão — risco de reclassificação para Marketing, mesmo com Quick Reply, não vale o ganho de UX de um lembrete simples |
| **`pagamento_confirmado`, `nova_transferencia_humana`** (já aprovados) | ❌ Nenhum | Já aprovados sem botão, não há motivo pra reabrir/alterar um template já em produção só para adicionar botão |

**Conclusão do levantamento:** o candidato mais forte, de longe, é
**seleção de múltiplos acessos** — resolve um ponto de atrito real já
documentado (texto livre para escolher entre contas), com Quick Reply
(baixo risco de reclassificação), sem depender de nenhuma decisão de
produto nova. Os demais são ideias registradas para quando os
respectivos fluxos (Painel de Atendimento, menu de atendimento)
existirem de fato — **nenhum deles é implementado nesta etapa.**

## 5. Pendências explicitamente registradas, não resolvidas nesta etapa

1. **`{VALOR}` e `{USUARIO}` seguem de fora** — mesma lacuna da POC
   #2, não inventada nem buscada por fonte não confirmada.
2. **Nome definitivo do template** — proposto aqui como
   `vencimento_hoje` (não confirmado, só uma sugestão consistente com
   `pagamento_confirmado`); nome final é decisão do usuário no
   momento de criar o template de verdade.
3. **Texto exato do template** — a proposta da seção 4 é um rascunho
   baseado no texto real do Rocket com o mesmo corte já usado antes;
   pode ser ajustada antes de submeter.
4. **Se a função `condicaoVenceHoje` deve viver desde já em
   `_shared/`** (reaproveitável) mesmo sendo usada, por enquanto, só
   por esta POC — decisão de organização de código a confirmar no
   momento de implementar, não bloqueia o desenho.
5. Todas as pendências já registradas no levantamento anterior (seção
   5 daquele documento) continuam válidas e não foram resolvidas
   aqui — este desenho não decide nada sobre elas.

## 6. O que esta POC explicitamente NÃO faz

Não implementa o motor de agendamento real (cron/consulta periódica a
múltiplos clientes) — continua sendo uma function descartável
disparada manualmente, mesmo padrão das POCs #1/#2. Não toca no
número oficial nem no RocketZap. Não altera nenhuma automação/
configuração do Rocket. Não resolve `{VALOR}`/`{USUARIO}`. Não decide
se "Vence em 1 dia"/"Venceu Ontem" entram no escopo (levantamento,
seção 5, item 3, segue em aberto).

## 7. Próximos passos, em ordem, cada um exigindo autorização própria

1. Aprovação deste desenho (este documento).
2. Submeter o template `vencimento_hoje` (ou nome definido) à Meta —
   ação real na conta, mesmo processo já usado antes.
3. Aguardar aprovação da Meta (dias, fora do nosso controle).
4. Implementar a function da POC (`condicaoVenceHoje` + disparador),
   deploy, execução controlada — só depois do template aprovado.

**Parado deliberadamente aqui, aguardando aprovação do desenho antes
de submeter qualquer template ou escrever qualquer código.**
