# Levantamento — Ligar o Gatilho Automático Real do "Pagamento Confirmado"

> **Isto é levantamento/design, não implementação.** Nenhum código
> escrito, nenhum deploy, nenhuma automação do Rocket alterada,
> número oficial e RocketZap intocados. Consolida o que já está
> espalhado entre `inovatv_central` CLAUDE.md (Componente 1),
> `inovatv-api-intermediaria` (código real do
> `poc-confirmacao-renovacao`) e `inovatv_meta_business_agent`
> CLAUDE.md §16 (mecanismo de sessão do Rocket) — não repete o
> conteúdo, só organiza pra decidir o próximo passo.

## 0. O que já está pronto, sem ambiguidade

- **A mensagem está aprovada:** template `pagamento_confirmado`
  (Utilidade), 4 variáveis (nome, plano, servidor, vencimento).
- **O mecanismo de renovação + confirmação já foi executado com
  sucesso real, duas vezes** (POC #1 texto livre, POC #2 template):
  `PATCH /gerenciador/api/v1/cliente/{public_id}` (via
  `ROCKET_API_KEY`, não a sessão do Vault) → `GET` de confirmação →
  `enviarTemplateWhatsApp`. Function `poc-confirmacao-renovacao`
  (`inovatv-api-intermediaria`).
- **O que falta, literalmente, é só o gatilho** — hoje essa function
  só roda quando alguém (eu, via `curl`) a invoca manualmente. Não
  existe nada que a chame sozinha quando um pagamento acontece de
  verdade.

## 1. A pergunta que este levantamento NÃO responde sozinho — já estava registrada como decisão em aberto

`2026-08-22_desenho_substituicao_rocketzap.md`, seção 7, já
registrava explicitamente, sem decidir:

> *"Quem inicia a renovação no futuro: José continua 'clicando em
> algo' (uma tela nossa, substituindo o 'ADD Pagamento' do Rocket), ou
> vira 100% automatizado via gateway de pagamento próprio? [...] é
> uma escolha do usuário, não uma imposição técnica."*

**Gateway já foi descartado nesta mesma sessão** (correção da seção
-1 de `2026-08-22_revisao_mensagens_fluxo_renovacao.md`). Isso deixa,
na prática, só duas famílias de resposta possíveis pra "o que dispara
o `poc-confirmacao-renovacao` (generalizado) sozinho":

**Opção A — José clica em algo NOSSO, não no Rocket.** Ele para de
usar "Adicionar Pagamento" na tela do Rocket pro fluxo desse cliente,
e passa a usar uma tela nossa (ex.: extensão do Painel de Atendimento)
— aí sim a nossa infraestrutura, não mais RocketZap, dispara a
confirmação. **Mesma família de padrão já usada no Painel de
Atendimento** (José assume/responde/encerra pela nossa interface, não
mais pelo app do WhatsApp).

**Opção B — continuar usando o "Adicionar Pagamento" do Rocket, e
capturar esse evento de algum jeito.** Duas variantes possíveis, nenhuma
confirmada como viável:
- B1: Polling periódico no Rocket (ex.: comparar `vencimento` de cada
  cliente a cada N minutos, detectar quando mudou) — funcionaria, mas
  é "descobrir por inferência", quase uma forma de "reinventar
  Cobrança" fora do Rocket; also duplica o próprio RocketZap, que já
  manda a confirmação sozinho nesse caminho (ver seção 2).
- B2: Algum webhook/evento nativo do Rocket que dispara quando
  "Adicionar Pagamento" é usado — **não confirmado que existe**; a
  matriz de migração original (`2026-08-21_renovacao_automatica_painel_primeiro.md`)
  já registrou que o Rocket usa `POST /gerenciador/pagamento/add/`,
  formulário HTML tradicional (Django + CSRF), sem indicação de que
  exista um webhook de saída pra terceiros.

**Opção C — o CLIENTE clica em "confirmar", não o José.** Reaproveita
um mecanismo **já desenhado em detalhe**, só que noutra frente
(`2026-08-21_gatilho_meta_renovacao.md`, pensado originalmente pra
Meta AI): link de uso único, padrão de dois passos —
```
GET /renovar/<token>   → sempre seguro, nunca executa nada
                          (protege contra preview automático do
                          WhatsApp, crawler de antivírus, etc.)
        ↓ (clique real no botão)
POST /renovar/<token>/confirmar  → único ponto onde a autorização
                                     vira real; reivindica o token
                                     atomicamente, consulta o estado
                                     atual (nunca confia no que valia
                                     quando o link foi gerado), chama
                                     o mecanismo de renovação já
                                     comprovado
```
**Importante: isso não resolve sozinho "quem decide que o pagamento é
legítimo"** — só resolve "qual é o gatilho técnico depois que alguém
(hoje, José) já decidiu". Ou seja, a Opção C é **compatível com** a
Opção A, não uma alternativa a ela — a diferença é *quem* aciona o
`POST` final: José clicando numa tela nossa (Opção A pura) ou o
**cliente** clicando num link que José gerou depois de revisar o
comprovante (Opção C). A vantagem da C: fica um registro auditável de
que o próprio cliente confirmou, não só o José agindo por ele — e
reaproveita um desenho que já passou por uma rodada inteira de revisão
de segurança (token de uso único, reivindicação atômica, proteção
contra pré-carregamento) em vez de desenhar essa parte do zero.

**Este levantamento não escolhe entre A, B e C — é uma decisão de
produto/arquitetura, não uma pesquisa técnica que só falta terminar.**
Fica para o usuário decidir, mesma disciplina já usada no resto do
projeto.

## 2. Achado real que reforça a Opção A — RocketZap já resolve o caminho B sozinho, e nossa infraestrutura correria por cima dele

Confirmado em investigação anterior (`2026-08-21`, seção 3.2 da matriz
de migração): **quando José usa "Adicionar Pagamento" no Rocket de
verdade, o próprio RocketZap já dispara a mensagem de confirmação**
(pelo número oficial, sem depender de nada nosso). Se a nossa
infraestrutura tentasse "descobrir" esse mesmo evento (Opção B) e
mandar sua própria confirmação, **o cliente receberia duas mensagens
de confirmação** — uma do RocketZap, outra nossa. Isso não é um
problema técnico a resolver, é um sinal de que **a Opção B duplicaria
um caminho que já funciona**, enquanto a Opção A **substitui** o
caminho antigo por um novo, sem duplicar nada.

## 3. O que a Opção A exigiria, se escolhida (desenho, não implementação)

1. **Generalizar `poc-confirmacao-renovacao`** — hoje hardcoded pro
   cliente de teste (`PUBLIC_ID` fixo). Precisaria receber o cliente
   como parâmetro real (ex.: escolhido numa tela, não mais uma
   constante no código).
2. **Uma tela nossa onde José "confirma a renovação"** — mesma família
   de padrão do Painel de Atendimento (autenticação já existente,
   Supabase Auth, e-mail único autorizado). Provavelmente: buscar
   cliente (reaproveita `/match`), confirmar identidade, disparar o
   mesmo fluxo já comprovado (`PATCH` → `GET` → template).
3. **Decisão sobre valor (`{VALOR}` não existe em `/status`)** — na
   tela nossa, José digitaria o valor recebido, mesmo padrão já
   proposto pro fluxo de agendamento manual do Grupo 2
   (`2026-08-22_desenho_fiado_em_atraso.md`, seção 3-B).
4. **Escopo continua restrito ao número de teste** — mesmo depois de
   automatizado, o corte para o número oficial é uma decisão e
   execução separadas (seção 6 do desenho de substituição), não
   implícita por causa disso.

## 4. Relação com o mecanismo de sessão do Rocket (§16, `inovatv_meta_business_agent`)

**Nota de escopo, pra não confundir dois mecanismos parecidos:** o
`poc-confirmacao-renovacao` usa `ROCKET_API_KEY` (`PATCH` direto na
API pública do Rocket) — **não** usa a sessão capturada no Vault
(`sessionid`/`csrftoken`, mecanismo do §16, que simula o botão
"Adicionar Pagamento" via `POST /gerenciador/pagamento/add/`). São
dois caminhos tecnicamente diferentes, ambos já comprovados
separadamente:
- **`ROCKET_API_KEY` + `PATCH`** — já testado 2x pela nossa
  automação (POCs #1/#2), mas **não** aciona o RocketZap (confirmado)
  — é por isso que a nossa própria infraestrutura precisa mandar a
  confirmação.
- **Sessão do Vault + `POST pagamento/add`** — já testado (§16),
  **aciona o RocketZap sozinho** (porque é o mesmo caminho que José
  usaria manualmente) — nesse caminho, a confirmação já sairia pelo
  RocketZap, sem precisar da nossa.

**Isso é uma segunda decisão dentro da Opção A, também em aberto:**
se a tela nossa deve chamar o `PATCH` via `ROCKET_API_KEY` (e nós
mandamos a confirmação, como já testado) ou a sessão do Vault via
`POST pagamento/add` (e o RocketZap manda a confirmação sozinho,
como no fluxo manual de hoje). **Não decidido aqui.**

## 5. Resumo — o que precisa de decisão do usuário antes de qualquer código

1. **Opção A/C (José ou cliente aciona algo nosso) vs. Opção B
   (capturar evento do Rocket)** — recomendação implícita pela seção 2
   (A/C evitam duplicidade com o RocketZap; B duplicaria), mas não
   decidido sozinho. Dentro de A/C, falta decidir se quem clica é o
   José (A) ou o cliente, via link de uso único (C) — as duas reaproveitam
   o mesmo mecanismo de renovação de fundo, só muda quem aciona o
   passo final.
2. **Dentro da Opção A: `PATCH`/`ROCKET_API_KEY` (nós confirmamos) vs.
   sessão do Vault/`pagamento/add` (RocketZap confirma sozinho)** —
   segunda decisão, também em aberto.
3. **Onde essa tela viveria** — extensão do Painel de Atendimento já
   existente, ou algo novo? Não decidido.
4. **Continua restrito ao número de teste** até decisão explícita de
   corte — isso não é uma pergunta em aberto, já está fechado desde a
   seção 6 do desenho de substituição.

**Nada implementado nesta etapa. Aguardando decisão do usuário sobre
os itens 1-3 antes de qualquer especificação técnica ou código.**
