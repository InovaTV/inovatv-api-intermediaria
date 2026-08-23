# Revisão — Mensagens/Templates Pensando na Automação Futura de Renovação

> **Isto é revisão de desenho, não implementação.** Nenhum template
> foi submetido à Meta, nenhum código foi escrito, nenhum deploy foi
> feito. Parte de `2026-08-22_desenho_poc_motor_lembretes.md` (seção
> 4-B, levantamento de botões, que fica como base, sem alteração) e do
> `pagamento_confirmado`/POC #2 já existentes. Objetivo: revisar o
> `vencimento_hoje` e os templates futuros à luz de um fluxo mais
> ambicioso — aviso → orientação → comprovante → processamento →
> renovação → confirmação — **sem inventar capacidade que a
> arquitetura atual não tem**.

## -1. CORREÇÃO (2026-08-22, mesma sessão) — a seção 5 original estava errada sobre o gatilho de renovação

> **Erro meu, não do usuário.** A primeira versão deste documento
> tratava "gateway de pagamento" como uma decisão de arquitetura ainda
> em aberto, e a renovação automática como algo que ainda dependia de
> um humano clicar toda vez. **As duas coisas já estavam resolvidas e
> documentadas antes desta sessão** — eu simplesmente não tinha lido
> `inovatv_meta_business_agent/CLAUDE.md` seções 15/16 nem
> `documentos/levantamentos/2026-08-21_gatilho_meta_renovacao.md`
> antes de escrever a versão original. Corrigido agora, com a fonte
> real.

**Gateway de pagamento: já descartado, não é decisão em aberto.**
`CLAUDE.md` seção 15: *"Integração de gateway de pagamento (Mercado
Pago/Asaas/paggpay)... foi explicitamente descartada pelo usuário —
não faz parte deste caminho."* (O PagBank mencionado na versão
anterior deste documento era um PoC técnico à parte, escopado à
renovação do painel upstream da UniTV — nunca virou a arquitetura de
produção para o fluxo geral de renovação via Rocket.)

**Já existe mecanismo automático de renovação, COMPROVADO e em
produção (`CLAUDE.md` seção 16):** a sessão real do Rocket
(`sessionid`+`csrftoken`, capturada manualmente do navegador do
usuário, guardada no Supabase Vault via RPCs `rocket_sessao_definir`/
`rocket_sessao_ler`) é reutilizada via **HTTP puro, sem navegador**,
para chamar `POST /gerenciador/pagamento/add/?id_cliente=...` — **o
mesmo endpoint que o botão "Adicionar Pagamento" da UI do Rocket usa**.
Essa única chamada, testada via script sem nenhuma interação humana no
momento, já demonstrou:
- Renovar o cliente no Sigma (plano trocado, crédito debitado —
  confirmado por reconsulta independente ao painel).
- Atualizar o vencimento no Rocket (confirmado por reconsulta
  independente).
- Registrar o pagamento no Rocket.
- **Disparar a confirmação ao cliente automaticamente via RocketZap**
  — sem depender de nada nosso nesse ponto.

**A única limitação real, já registrada explicitamente (não uma
lacuna nova encontrada agora):** o login no Rocket é **sempre
manual** — o Cloudflare Turnstile bloqueia login automatizado, testado
e a evasão foi deliberadamente descartada. Quando a sessão expira
(~2 semanas, padrão Django, duração exata ainda não medida), alguém
precisa logar de novo pelo navegador e recapturar os cookies pro
Vault. **Isso já está coberto por monitoramento automático**
(`monitorar-sessao-rocket`, Cron a cada 4h, já deployado) que detecta
a queda e abre uma issue no GitHub avisando — não é um ponto cego.

**O que ainda está em aberto, e isso continua real:** o **gatilho**
— quem/o quê decide "está na hora de chamar essa renovação" — é um
desenho separado (`2026-08-21_gatilho_meta_renovacao.md`), pensado
originalmente para a Meta AI (Plano B): um link de uso único
(padrão `GET` seguro que só mostra um botão / `POST` que executa de
verdade, reivindicação atômica do token, expiração 24-48h) que a IA
apresentaria ao cliente depois de examinar um comprovante. **Esse
desenho ainda depende da própria Meta AI decidir quando apresentar o
link — e a confiabilidade da Meta AI para essa tarefa está registrada
como "BLOQUEIO"** (mesma IA pausada desde 2026-08-15 por regressão de
comportamento, seção "IA do WhatsApp" do `inovatv_central` CLAUDE.md).
**Esse mesmo padrão de token/link não está, hoje, conectado à IA
própria (Gemini/Orquestrador)** — é só reaproveitável, arquiteturalmente,
se decidirmos estender pra lá.

**O que isso muda, e o que não muda, nesta revisão de mensagens:**
- **Não muda:** os textos dos templates de lembrete (`vencimento_hoje`
  e família) continuam corretos como estão — informativos, sem CTA,
  sem prometer renovação automática no corpo da mensagem.
- **Não muda:** a regra de nunca confirmar pagamento só por causa de
  uma imagem de comprovante continua válida — o mecanismo de
  renovação comprovado (seção acima) não verifica pagamento sozinho,
  ele só *executa* uma renovação já autorizada por algum gatilho; o
  problema de "quem autoriza" continua sem solução confiável pronta
  pra IA própria.
- **Muda:** a seção 5 original (abaixo) estava errada ao listar
  "gateway de pagamento" como pendência de decisão e "humano renova
  manualmente" como único caminho hoje — corrigido nos trechos
  marcados abaixo.

## 0. Achado central desta revisão, antes de qualquer proposta de texto

**A pergunta "quantos templates precisamos" tem uma resposta mais
simples do que parece, por causa de uma regra da própria Cloud API já
usada neste projeto (Componente 1 §16-A):** um template só é
obrigatório para a **mensagem que abre a conversa** (a empresa
falando primeiro, fora de uma janela de 24h ativa). **A partir do
momento em que o cliente responde** a esse aviso — mandando um
comprovante, uma dúvida, qualquer coisa — a janela de 24h abre, e
**tudo que acontece dentro dela pode ser texto livre**, pelo mesmo
caminho que o Orquestrador já usa hoje para qualquer conversa reativa
(Componente 1, fluxo completo).

**Isso muda a resposta da seção 2:** não precisamos de um template
para cada passo do fluxo (orientação de PIX, confirmação de
recebimento do comprovante, etc.) — só para os pontos em que **nossa
infraestrutura fala primeiro, sem o cliente ter respondido ainda**.

**Segundo achado, mais importante, sobre o elo fraco do fluxo
proposto:** "comprovante → processamento automático → renovação" —
como está descrito — pressupõe que a imagem/print enviada pelo
cliente é, por si só, prova suficiente pra renovar automaticamente.
**Isso contraria uma regra já fechada e congelada neste projeto**
(prompt de sistema, seção "PAGAMENTOS E COMPROVANTES", Componente 1):
*"Receber ou analisar um comprovante enviado pelo cliente não é a
mesma coisa que confirmar um pagamento — [...] Se não bater ou não
houver esse dado conectado, diga que não consegue confirmar e
transfira."* Um comprovante pode ser adulterado, duplicado ou de
outra transação — não é evidência determinística. **Isto não é uma
decisão nova sendo tomada aqui** — é a aplicação de uma regra que já
existe, ao contexto novo desta automação. Ver seção 5 para o caminho
que preserva essa regra.

## 1. Proposta de texto — `vencimento_hoje` (revisado)

Mantém a versão já ajustada na sessão anterior (informativa, sem CTA,
sem menção a comprovante) — **sem mudança**, já está correta à luz
desta revisão também, porque o próximo achado (seção 0) já resolve o
"e depois?" sem precisar de mais nada no corpo do próprio aviso:

```
⚠️ Seu plano vence hoje!

Olá,{{1}}! Este é um lembrete de que seu plano vence hoje.

📋 Plano:{{2}}
🖥️ Servidor:{{3}}
📅 Vencimento:{{4}}

InovaTV — Sempre pensando em você! 📺
```

**Por que não adicionar orientação de PIX aqui:** colocar instrução
de pagamento (chave PIX, valor) de volta no template reintroduziria
exatamente o sinal que a Meta já rejeitou (uma instrução de ação =
leitura de Marketing) — e, pelo achado da seção 0, **não precisa**:
assim que o cliente responder a este aviso (mesmo só com "oi" ou
enviando o comprovante direto), a conversa abre e a orientação de
pagamento pode vir como texto livre, gerada pela mesma pipeline
Gemini + Conhecimento Institucional já existente (Componente 2) — se
e quando essa informação (chave PIX) estiver cadastrada lá. **Não
verificado nesta revisão se já existe uma entrada de conhecimento
institucional com a chave PIX** — fica como pendência a confirmar
(seção 5).

## 2. Outros templates futuros — bem menos do que o fluxo sugere

Só é preciso template pra cada ponto em que a **empresa fala
primeiro, fora de uma janela aberta**:

| Template | Quando dispara | Status |
|---|---|---|
| `vencimento_hoje` | Vencimento = hoje, cliente não iniciou conversa | Desenhado, corrigido, não submetido |
| `vencimento_em_3_dias` | 3 dias antes do vencimento | Mesma estrutura do `vencimento_hoje`, texto adaptado — não desenhado em detalhe ainda, mesma revisão se aplica |
| `vencido_a_3_dias` | 3 dias após o vencimento | Idem |
| `pagamento_confirmado` | Confirmação de renovação, **quando o cliente não está numa conversa aberta no momento** (ex.: José registrou a renovação horas depois, fora de qualquer janela) | **Já existe, já aprovado** — reutilizado, nenhum template novo aqui |

**O que explicitamente NÃO precisa de template novo, pela regra da
seção 0:**
- Orientação de pagamento/PIX após o cliente responder ao lembrete —
  texto livre, dentro da janela.
- Confirmação de recebimento do comprovante ("recebemos, vamos
  analisar") — texto livre.
- **Confirmação final de renovação, se ela acontecer dentro da mesma
  janela que o comprovante abriu** (ex.: cliente manda comprovante,
  segundos depois a renovação é processada e confirmada, ainda na
  mesma conversa) — texto livre também serviria; `pagamento_confirmado`
  continua sendo o caminho certo só para o caso **fora** de janela
  (ex.: confirmação horas/dias depois).

**Conclusão:** a família de templates realmente necessária é a mesma
já mapeada no levantamento de lembretes (`vencimento_hoje` +
`vencimento_em_3_dias` + `vencido_a_3_dias`) mais o `pagamento_confirmado`
já existente — não um template por etapa da jornada.

## 3. Botões — onde agregam valor neste fluxo específico

Reaproveita o levantamento já feito (`2026-08-22_desenho_poc_motor_lembretes.md`,
seção 4-B), sem alterá-lo, acrescentando o que esta revisão do fluxo
de renovação revela de novo:

- **Nos templates de lembrete (`vencimento_hoje` e família):
  continua não recomendado** — mesmo risco de reclassificação já
  registrado, reforçado pelo achado da seção 0 (não precisamos de
  botão ali, porque qualquer resposta do cliente já abre a janela
  pra conversa livre).
- **Achado novo desta revisão:** dentro da janela de 24h (depois que
  o cliente respondeu), a Cloud API permite **Interactive Reply
  Buttons** em mensagens de texto livre (`type: "interactive"`), não
  só em template — ou seja, um menu tipo "Já paguei, vou mandar
  comprovante" / "Preciso de ajuda" logo após o cliente responder ao
  lembrete **não exige template nem aprovação da Meta**, porque é uma
  mensagem de sessão, não proativa. **Isto não está implementado
  hoje** — `_shared/whatsapp_client.ts` só tem `enviarMensagemWhatsApp`
  (texto) e `enviarTemplateWhatsApp` (template); não existe
  `enviarBotoesWhatsApp`/mensagem interativa ainda. Fica registrado
  como capacidade nova a construir, não como algo já disponível.
- **Múltiplos acessos continua o candidato mais forte e mais simples**
  (já levantado) — também usaria esse mesmo mecanismo de mensagem
  interativa de sessão, quando construído.

## 4. Qual fluxo/estado cada mensagem deveria iniciar

Mapeamento conceitual, reaproveitando o modelo de estado já existente
(`conversas_estado`, Componente 5 §7) — **nenhuma mudança de schema
proposta aqui**, só a leitura de qual mensagem corresponde a qual
transição:

```
vencimento_hoje (template, empresa fala primeiro)
        ↓
   cliente responde (qualquer coisa)
        ↓
janela de 24h aberta — conversa normal, Passo 0 do Orquestrador já
processa isso hoje (chama Gemini, conhecimento institucional, etc.)
        ↓
   cliente manda comprovante (imagem)
        ↓
Gemini LÊ a imagem (capacidade já comprovada, 2026-08-21) mas NÃO
confirma pagamento sozinho (regra já fixada) → resposta padrão:
"recebido, vou verificar" + TRANSFERE para humano (comportamento já
correto e testado nas Rodadas 3/4 — critério "não confirma pagamento
sem evidência")
        ↓
   [daqui em diante é território de implementação futura, seção 5]
```

Ou seja: **hoje, o fluxo completo do usuário já funciona até
"comprovante recebido → transferência humana"** — o pulo automático de
"processamento → renovação → confirmação automática" é que ainda não
existe, e não deveria existir via leitura de imagem (seção 0).

## 5. O que já é possível hoje vs. o que depende de implementação futura

**Já funciona hoje, sem nenhuma mudança:**
- Enviar `vencimento_hoje` (depois de aprovado) pro cliente, fora de
  janela.
- Cliente responder, abrir janela, Orquestrador processar
  normalmente (Gemini + Conhecimento Institucional + Validador).
- Cliente mandar imagem de comprovante, Gemini ler o conteúdo da
  imagem corretamente (câmera/OCR-like, já testado).
- Sistema recusar confirmar pagamento sem evidência conectada, e
  transferir pra humano (regra já no prompt congelado, já testada).
- Humano (José, via Painel de Atendimento) processar a renovação
  manualmente e — se quiser — usar o mesmo mecanismo do
  `poc-confirmacao-renovacao` (adaptado de POC pra produção) pra
  registrar o `PATCH` no Rocket e disparar `pagamento_confirmado`.

**Depende de implementação futura, nenhuma delas decidida aqui:**
1. **Ligar a IA própria (Gemini/Orquestrador) ao mecanismo de
   renovação já comprovado (seção -1)** — hoje o Orquestrador não
   chama nada disso; é infraestrutura real e testada, mas ainda não
   conectada a esse fluxo específico.
2. **Decidir o gatilho para a IA própria** — reaproveitar o padrão de
   token/link de uso único já desenhado para a Meta AI (seção -1),
   adaptado pra decisão vir do Gemini/Validador em vez da Meta AI? Ou
   outro mecanismo? Não decidido — e o problema de fundo ("quem
   autoriza gerar o token com confiança") continua sem resposta
   pronta nem para a Meta AI nem para a IA própria.
2-B. **Mensagens interativas de sessão (Quick Reply fora de
   template)** — capacidade nova em `_shared/whatsapp_client.ts`, não
   existe hoje.
3. **Templates `vencimento_em_3_dias`/`vencido_a_3_dias`** — mesmo
   desenho do `vencimento_hoje`, ainda não escritos/submetidos.
4. **Se existe conteúdo de PIX/pagamento já cadastrado em
   `conhecimento_institucional`** — não verificado nesta revisão.
5. **Conectar o `poc-confirmacao-renovacao` ao mecanismo de sessão do
   Rocket já comprovado** (hoje ele usa `PATCH` via `ROCKET_API_KEY`,
   simulando a renovação; o mecanismo real de produção usa a sessão
   do Vault + `POST /gerenciador/pagamento/add/`, que também cascata
   pro Sigma e dispara o RocketZap sozinho) — trabalho de
   implementação futura, fora de escopo desta revisão de mensagens.
6. **Motor de agendamento** (quem dispara `vencimento_hoje` todo dia,
   automaticamente) — já registrado como pendência no levantamento
   anterior, não resolvido aqui.

## 6. Resumo para decisão

- **`vencimento_hoje`: texto mantido como já corrigido (seção 1),
  pronto para submissão quando autorizado.**
- **Templates futuros necessários: só mais 2** (`vencimento_em_3_dias`,
  `vencido_a_3_dias`) — não um por etapa da jornada, graças à regra
  da janela de 24h.
- **Botões: nenhum nos templates de lembrete; múltiplos acessos
  continua o candidato mais forte; menu pós-lembrete ("já paguei"/
  "preciso de ajuda") é uma ideia nova desta revisão, mas depende de
  capacidade ainda não construída (mensagem interativa de sessão).**
- **O mecanismo de execução da renovação já existe e já foi comprovado
  em produção** (sessão do Rocket no Vault → `POST pagamento/add` →
  Sigma + Rocket + RocketZap, sem gateway de pagamento — descartado
  explicitamente). **O que falta é o gatilho para a IA própria**
  (quem decide "pode renovar agora") — continua não podendo ser "só
  porque leu uma imagem de comprovante", mesma regra de segurança já
  adotada no resto do projeto; o padrão de token/link de uso único já
  desenhado para a Meta AI é um candidato a reaproveitar, não decidido
  aqui.

**Nada implementado, nada submetido. Aguardando decisão sobre:**
(a) aprovar o texto do `vencimento_hoje` como está e liberar a
submissão; (b) se/quando desenhar `vencimento_em_3_dias`/
`vencido_a_3_dias` da mesma forma; (c) se vale investigar agora o
conteúdo de PIX no Conhecimento Institucional, antes de prosseguir.
