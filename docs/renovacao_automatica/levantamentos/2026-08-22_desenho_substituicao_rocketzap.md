# Desenho — Substituição do RocketZap pela Infraestrutura Própria

> **Isto é design, não implementação.** Nenhum código, migration, banco
> de dados, deploy, secret ou configuração foi alterado. O número
> oficial (`5517996242415`) e a sessão RocketZap (`inovatv`)
> permanecem exatamente como estão. Continua a linha de investigação
> de `2026-08-22_matriz_migracao_rocketzap.md` — não repete o que já
> foi levantado lá, só desenha o caminho a partir daquele resultado.

## 0. Requisito fixado pelo usuário, não negociável neste desenho

> O cliente continuará recebendo todos os avisos e mensagens
> transacionais pelo **mesmo número oficial** da InovaTV. Sem segundo
> número.

Arquitetura-alvo:

```
Rocket / nossa automação
        │
        ▼
  nossa infraestrutura
        │
        ▼
 WhatsApp Cloud API
        │
        ▼
  número oficial (mesmo de sempre)
        │
        ▼
     cliente
```

## 1. Peça central — o "disparador" único de mensagem transacional

Todo o desenho gira em torno de **um único ponto de disparo**, reaproveitado por qualquer evento (pagamento, teste, indicação, vencimento) — nunca lógica duplicada por tipo de mensagem. Mesma disciplina de "um dono por responsabilidade" já usada no Orquestrador (Componente 1) e no Componente 2.

```
                    evento confirmado
                (já sabemos que aconteceu —
                 nunca detecção, sempre registro)
                          │
                          ▼
              ┌───────────────────────┐
              │   DISPARADOR CENTRAL   │
              │  (novo módulo, único)  │
              └───────────────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
  confirma/busca     monta o texto      envia via
  dados no Rocket    (template fixo,    Cloud API
  (PATCH/GET já      nunca gerado       (mesmo cliente
  comprovado)        por IA)            já usado pelo
                                         Orquestrador)
```

**Por que nunca passa pelo Gemini:** mensagem transacional (pagamento
confirmado, vencimento, teste) é informação factual e sensível a erro
— mesma razão pela qual `MENSAGEM_TRANSFERENCIA_CLIENTE` já é fixa,
não gerada pelo Gemini (Componente 1 §16). O texto vem de um template
fixo parametrizado, auditável, revisável por vocês antes de qualquer
envio real — não de geração livre.

## 2. Os três blocos novos (design, não código)

### 2.1 — Confirmação/registro no Rocket

Generalização do que `teste-patch-renovacao-newone` já provou
funcionar de verdade:

```
confirmarOperacaoRocket(publicId, dados)
  1. GET /planos/           (se precisar calcular período)
  2. GET /cliente/{id}      (confirma identidade antes de mexer)
  3. PATCH /cliente/{id}    (a operação em si — vencimento, etc.)
  4. GET /cliente/{id}      (confirma que realmente mudou)
  → devolve: { outcome: "confirmado", cliente: {nome, servidor, plano, vencimento} }
             | { outcome: "abortado", motivo }
             | { outcome: "unavailable" }
```

Mesma `ROCKET_API_KEY` já usada por `/match`/`/status` — nenhuma
credencial nova. Nunca repassa senha/device_key (mesma sanitização já
aplicada no PoC).

**Isto não é sempre necessário antes de disparar a mensagem** — só
para os casos em que a mensagem depende de confirmar algo no Rocket
(pagamento/renovação). Para avisos de vencimento (que só *leem* o
estado, não mudam nada), o passo equivalente é uma consulta, não um
`PATCH`.

### 2.2 — Texto da mensagem (templates fixos, parametrizados)

Novo módulo, mesmo padrão de `_shared/mensagens_fixas.ts`, mas com
funções que recebem dados e devolvem texto — não frases soltas:

```
montarMensagemPagamentoConfirmado({ nome, plano, valor, servidor, vencimento, hora })
montarMensagemVencimentoHoje({ nome, servidor, vencimento, hora })
montarMensagemVencidoNDias({ nome, servidor, dias })
... uma função por mensagem do inventário já levantado
```

**Decisão de conteúdo a tomar (não técnica):** reaproveitar o texto
literal já validado no Rocket (tom, emojis, estrutura — já é o que os
clientes conhecem) ou reescrever do zero. Recomendo reaproveitar o
texto já existente como ponto de partida — é conteúdo já testado em
produção, evita reaprender o que já funciona.

### 2.3 — Envio (já existe, só reaproveitar)

`enviarMensagemWhatsApp`/`enviarTemplateWhatsApp`
(`_shared/whatsapp_client.ts`) — **já construído, já testado**, usado
hoje pelo Orquestrador e pelo aviso ao José. Nenhuma mudança de código
aqui — só uma nova chamada, com o texto vindo de 2.2.

## 3. Dependência real que precisa ser resolvida antes de qualquer mensagem proativa funcionar

**Message Templates aprovados pela Meta.** Toda mensagem que a InovaTV
inicia (não é resposta a algo que o cliente perguntou) e que pode cair
fora da janela de 24h de conversa ativa — que é o caso normal de um
lembrete de vencimento, já que o cliente não estará "em conversa" na
maioria das vezes — exige um **Message Template pré-aprovado pela
Meta**, não texto livre. Isso já é regra conhecida e já vivida neste
projeto (Componente 1 §16-A, aviso ao José: *"mensagens que iniciam
conversa fora de uma janela ativa de 24h exigem um Message Template
aprovado pela Meta"*).

**Isso significa:** antes de qualquer uma dessas mensagens funcionar
de verdade fora de uma conversa já aberta, será preciso **submeter
cada template à aprovação da Meta** (mesmo processo já usado para
`nova_transferencia_humana` e confirmado funcionando com `hello_world`
neste projeto) — trabalho real, com prazo de aprovação não controlado
por nós, não uma tarefa de código.

## 4. Como cada família do inventário se encaixa nesse desenho

| Família | Confirmação (2.1) | Template (2.2) | Pronto para desenhar em detalhe? |
|---|---|---|---|
| **Pagamento Confirmado / Renovação** | ✅ Já comprovado (`PATCH` real, testado) | Fácil — texto já conhecido, poucas variáveis | **Sim — candidato natural a ser o primeiro** |
| **Vencimento (hoje/3 dias/vencido)** | Só leitura (`/status`), sem `PATCH` — mas falta o **motor de agendamento** (quem decide "é hoje que dispara") | Fácil — texto já conhecido | Parcial — falta o agendador (item 5) |
| **Testes (iniciado/vencendo/não convertido)** | Depende de **quem passa a criar o teste** — se for nossa automação, mesmo padrão do Pagamento (sem detecção); se continuar sendo feito manualmente dentro do Rocket, precisa de outra estratégia | Fácil | Depende de uma decisão de processo primeiro |
| **Indicação (Promoção/Ganhou)** | Hoje é processo manual até no Rocket — não é gap técnico | Fácil | Precisa decidir o processo antes (quem registra a indicação, como) |
| **Fiado (combinado/atraso)** | Mesmo padrão do Pagamento (quem registra já sabe) | Fácil | Sim, mesma lógica do Pagamento |
| **Avisos ad hoc (ex.: Servidor NewOne)** | Não depende de evento de cliente — é broadcast | Fácil | Sim, é o caso mais simples de todos (nem precisa de 2.1) |

## 5. A peça que falta desenhar em detalhe — motor de agendamento

**Único bloco genuinamente novo em termos de infraestrutura** (tudo
mais reaproveita algo que já existe e já foi testado). Precisa de:

- Um agendador (Supabase `pg_cron`/Edge Function agendada — mesmo
  mecanismo já usado por `monitorar-sessao-rocket`, que já roda a
  cada 4h via `pg_net`, então já existe precedente real no projeto,
  não é tecnologia nova para este ecossistema).
- Uma consulta periódica ao Rocket buscando clientes que batem o
  critério de cada lembrete (vencimento hoje, em N dias, vencido há N
  dias) — **precisa confirmar se `/clientes` do Rocket suporta esse
  tipo de filtro por data** (não confirmado ainda, é o tipo de coisa
  que só se sabe testando contra a API real).
- Para cada cliente encontrado, chama o mesmo disparador central (seção 1).

**Este bloco fica deliberadamente fora de um desenho mais detalhado
agora** — é maior, mais incerto (depende de confirmar a API de
listagem/filtro do Rocket) e não tem o mesmo grau de prova real que a
seção 2.1 já tem. Merece sua própria rodada de investigação/desenho,
separada, quando chegar a vez.

## 6. Segurança da migração em si — como isso não arrisca o número oficial agora

- **Toda a construção e todo o teste** acontecem no **número de
  teste** (`17996286135`) — mesmo padrão já usado para todo o resto da
  IA própria (Componentes 1, 2, 3).
- **O RocketZap continua conectado ao número oficial** durante toda
  essa fase — nada muda na operação real dos clientes hoje.
- **O corte real é uma decisão e uma execução separadas**, correspondente
  ao Passo 5 do próprio plano que o usuário já definiu, e só acontece
  depois de: (a) a substituição inteira testada de ponta a ponta no
  número de teste; (b) os Message Templates necessários já aprovados
  pela Meta; (c) autorização explícita nova, específica para esse
  corte — nunca implícita por já termos testado o resto.

## 7. Decisões que ainda precisam ser tomadas por vocês (não decidido aqui)

1. **Quem inicia a renovação no futuro:** José continua "clicando em
   algo" (uma tela nossa, substituindo o "ADD Pagamento" do Rocket),
   ou vira 100% automatizado via gateway de pagamento próprio? Afeta
   diretamente o desenho da entrada do disparador central.
2. **Qual gateway de pagamento será usado de verdade** — o PagBank do
   PoC era sandbox/teste, não uma decisão de produção.
3. **Reaproveitar o texto literal das mensagens do Rocket, ou
   reescrever** — recomendação já registrada na seção 2.2, mas é
   decisão do usuário.
4. **Ordem de migração das famílias** — a matriz e este desenho
   apontam "Pagamento Confirmado" como candidato natural a ser a
   primeira, por já ter o caminho mais provado — mas é uma escolha do
   usuário, não uma imposição técnica.
5. Tudo listado na seção 5 do documento da matriz (`2026-08-22_matriz_migracao_rocketzap.md`) que ainda não foi confirmado.

## 8. Resumo do que já está pronto para virar proposta de implementação (quando autorizado)

Só a família **Pagamento Confirmado/Renovação** tem hoje todos os três
blocos (2.1/2.2/2.3) com um caminho comprovado — seria o primeiro
candidato real a sair do design e virar uma proposta técnica concreta
(nos mesmos moldes do que já foi feito para o Componente 2), **quando
o usuário autorizar avançar** — nada disso foi implementado nesta
etapa.

## 9. POC do mecanismo — EXECUTADA COM SUCESSO REAL (2026-08-22)

> Esta seção documenta uma execução real autorizada explicitamente
> pelo usuário (não é mais só design). Número de teste, nunca o
> oficial. RocketZap nunca tocado.

**Function temporária/descartável** `poc-confirmacao-renovacao`
(`inovatv-api-intermediaria`), generalizando o `PATCH` já provado em
`teste-patch-renovacao-newone`, com o passo novo (disparo da mensagem)
acrescentado no final. Sem autenticação própria (mesmo padrão já usado
por diagnósticos únicos deste tipo no repositório) — alvo sempre fixo
no código, nunca por parâmetro livre.

**Sequência real, com evidência em cada passo:**

1. Usuário abriu a janela de 24h enviando mensagem real ao número de teste.
2. `GET /planos/` + `GET /cliente/{id}` — identidade confirmada (nome/servidor/plano).
3. `PATCH /cliente/{id}` — vencimento avançado de `2027-01-08` para `2027-02-08`.
4. `GET /cliente/{id}` de novo — confirmado antes de disparar qualquer coisa.
5. Mensagem de texto livre montada com os dados confirmados, enviada via Cloud API (número de teste).
6. **Usuário confirmou o recebimento real da mensagem no WhatsApp.**

**Dois achados reais durante a execução, ambos corrigidos:**
- O `publicId` herdado do teste anterior (`teste-patch-renovacao-newone`,
  21/08) estava desatualizado — resolvido consultando `/match` de
  novo, em vez de confiar num valor antigo.
- Uma comparação de segurança (vencimento esperado × vencimento
  confirmado) reprovou por engano na primeira tentativa — comparava
  string, e o Rocket devolve a data com offset `-03:00` enquanto o
  cálculo usava `Z`/UTC (mesmo instante, formatos diferentes).
  Corrigido para comparar o instante real (`Date.getTime()`), não a
  string literal. **Achado útil para o desenho futuro:** qualquer
  código que compare datas vindas do Rocket precisa lidar com esse
  formato de offset, não presumir UTC.

**Resultado:** a arquitetura-alvo da seção 0 (`Rocket/nossa automação
→ nossa infraestrutura → Cloud API → número oficial → cliente`) está
**comprovada tecnicamente de ponta a ponta**, hoje só validada no
número de teste. Falta a segunda prova (seção 10) — mesma coisa, mas
com o template aprovado em vez de texto livre — antes de considerar
esse caminho pronto para virar proposta de implementação real.

## 10. Próximo passo

**Atualização (2026-08-22): template `pagamento_confirmado` aprovado
pela Meta.** O bloqueio que mantinha esta seção em espera não existe
mais. Próximo passo passa a ser: repetir a mesma POC, mas usando o
template em vez de texto livre, **sem depender de janela de 24h
aberta manualmente** — essa é a prova que efetivamente valida o
cenário de produção (mensagem proativa). **Decisão do usuário
(2026-08-22): manter `poc-confirmacao-renovacao` deployada até essa
segunda prova acontecer** — evita recriar a mesma function agora que
o template aprovou. **Ainda não invocada de novo** — a segunda
execução (usando `enviarTemplateWhatsApp` em vez de texto livre,
mesmo padrão já usado no aviso ao José, Componente 1 §16-A) exige
ajuste de código na function e autorização explícita própria antes de
disparar um envio real, mesma disciplina de sempre.

## 11. Resumo de fechamento (2026-08-22, fim de sessão nesta máquina)

**O que foi executado, com evidência real, nesta rodada:**

- POC realizada com o **número de teste** (nunca o oficial).
- Janela de 24h aberta **manualmente** pelo usuário (mensagem real
  enviada do próprio WhatsApp).
- Renovação executada via `PATCH` real no Rocket
  (`/gerenciador/api/v1/cliente/{public_id}`, mesma `ROCKET_API_KEY`
  já usada por `/match`/`/status`).
- `GET` posterior confirmou o novo vencimento (`2027-01-08` →
  `2027-02-08`) — comparação por instante, não por string (achado
  desta rodada, ver seção 9).
- Nossa infraestrutura montou a mensagem de confirmação a partir dos
  dados já retornados pelo próprio `PATCH`/`GET` (nome, plano,
  servidor, vencimento).
- Envio realizado pela **WhatsApp Cloud API**, número de teste.
- **Mensagem recebida de fato no WhatsApp do usuário** — confirmado
  por print de tela real, conteúdo e dados batendo exatamente com o
  que foi enviado.
- **O RocketZap não participou do envio em nenhum momento** — a
  mensagem saiu inteiramente pela nossa infraestrutura.
- **O número oficial permaneceu intocado** durante toda a POC.
- Template `pagamento_confirmado` (Utilidade, pt-BR) — submetido com
  base no conteúdo real já validado no Rocket, **aprovado pela Meta em
  2026-08-22**.
- A function `poc-confirmacao-renovacao` **permanece deployada**, por
  decisão explícita do usuário, para evitar recriação quando o
  template aprovar — **sem nova execução** até lá.
- **Próxima etapa, ainda não iniciada:** repetir a mesma prova usando
  o template aprovado (em vez de texto livre), validando o cenário
  real de produção (mensagem proativa, sem depender de janela de 24h
  aberta manualmente).

**Conclusão arquitetural desta etapa:**

> A POC comprovou que é tecnicamente possível substituir o envio do
> RocketZap pela infraestrutura própria da InovaTV, mantendo o
> cliente recebendo a mensagem pelo número que estiver conectado à
> WhatsApp Cloud API — sem depender de nenhum mecanismo de detecção
> do lado do Rocket, e sem alterar o número oficial nem a sessão
> RocketZap hoje conectada a ele.

**O que NÃO foi feito, deliberadamente, nesta etapa:** migração do
número oficial, desconexão do RocketZap, implementação dos lembretes
de vencimento, do motor de agendamento, da mecânica de testes ou de
indicação. Tudo isso segue como desenhado nas seções 4/5 deste
documento — sem execução até o resultado desta primeira família
(Pagamento Confirmado/Renovação) estar completamente fechado, incluindo
a segunda prova com template.

## 12. POC #2 — mensagem proativa com template aprovado, EXECUTADA COM SUCESSO REAL (2026-08-22)

> Segunda execução real, mesmo dia da primeira (seção 9-11). Número de
> teste, nunca o oficial. RocketZap nunca tocado. Autorizada
> explicitamente pelo usuário, passo a passo.

**Pré-condição resolvida:** template `pagamento_confirmado` aprovado
pela Meta em 2026-08-22 (confirmado ao vivo no Gerenciador do
WhatsApp — status "Ativo", categoria Utilidade, Português BR).

**Achado ao abrir o template aprovado:** o corpo final tem **4
variáveis**, não 5 — `{{1}}` nome, `{{2}}` plano, `{{3}}` servidor,
`{{4}}` vencimento. **`{VALOR}` não existe no template aprovado**
(estava no texto original do Rocket, ficou de fora quando o template
foi escrito/submetido). Decisão do usuário: seguir com o template como
está, sem reenviar/alterar — o objetivo desta POC é validar o
mecanismo (mensagem proativa via template, fora de janela de 24h
aberta manualmente), não o conteúdo completo da mensagem final.
`{VALOR}` fica explicitamente fora de escopo desta POC, nunca inventado
nem acrescentado por fora do template.

**Código alterado** (`inovatv-api-intermediaria`): `poc-confirmacao-renovacao`
passou a chamar `enviarTemplateWhatsApp` (já existente em
`_shared/whatsapp_client.ts`, nunca usado em produção até então) em
vez de `enviarMensagemWhatsApp` (texto livre, usado na POC #1).
`_shared/mensagens_fixas.ts` ganhou `NOME_TEMPLATE_PAGAMENTO_CONFIRMADO`/
`IDIOMA_TEMPLATE_PAGAMENTO_CONFIRMADO`, mesmo padrão já usado para
`nova_transferencia_humana`. Deployada com `--no-verify-jwt`, mesma
autenticação (nenhuma) já aceita pra esta function descartável — alvo
fixo, nunca por parâmetro livre.

**Execução real, evidência em cada passo:**

1. Confirmado ao vivo: template Ativo, categoria Utilidade, PT-BR.
2. `poc-confirmacao-renovacao` confirmada intacta (sem alterações
   locais) antes de qualquer edição.
3. Número oficial e RocketZap não tocados em nenhum momento.
4. Function invocada — renovação controlada no cliente de teste (Js
   Informática Rp / NewOne): vencimento `08/02/2027 23:59` →
   `11/03/2027 23:59`.
5. `PATCH` confirmado por `GET` antes de disparar qualquer mensagem
   (mesma trava de segurança da POC #1).
6. Mensagem disparada via `enviarTemplateWhatsApp`, template
   `pagamento_confirmado`, **não texto livre**.
7. **Usuário confirmou recebimento real no WhatsApp do número de
   teste** — mensagem chegou certa.
8. Variáveis conferidas: nome = "Js Informática Rp", plano = "Mensal",
   servidor = "NewOne", vencimento = "11/03/2027, 23:59:00" (formato
   com vírgula/segundos — funcionou, mas fica mais limpo como
   "11/03/2027 23:59"; ajuste de formatação avaliado como melhoria
   futura, não bloqueador, não aplicado agora por decisão do usuário —
   ver seção 13).
9. Resultado registrado aqui. **Parado deliberadamente neste ponto.**

**Resultado técnico bruto da chamada:**
```json
{
  "resultado": "poc_concluida",
  "identificacao": { "nomeConfere": true, "servidorConfere": true, "planoConfere": true },
  "vencimentoAntes": "2027-02-08T23:59:00-03:00",
  "novoVencimentoConfirmado": "2027-03-11T23:59:00-03:00",
  "templateUsado": "pagamento_confirmado",
  "parametrosTemplate": ["Js Informática Rp", "Mensal", "NewOne", "11/03/2027, 23:59:00"],
  "mensagemEnviada": true,
  "envioOutcome": "success"
}
```

**Conclusão desta rodada:** o cenário real de produção (mensagem
transacional proativa, sem depender de janela de 24h aberta
manualmente, usando um Message Template aprovado pela Meta) está
**comprovado tecnicamente de ponta a ponta**, no número de teste. Isso
fecha a validação que faltava desde a seção 10 — a família "Pagamento
Confirmado/Renovação" agora tem os três blocos (2.1/2.2/2.3) provados
com as duas formas de envio (texto livre e template).

## 13. Pendências abertas após a POC #2 (nenhuma delas bloqueadora, nenhuma decidida aqui)

1. **Formato da variável de vencimento** — `toLocaleString("pt-BR", ...)`
   produz vírgula + segundos; considerar formatar sem esses dois antes
   de qualquer uso em produção. Ajuste de código simples, não feito
   nesta etapa (decisão do usuário: primeiro confirmar recebimento,
   ajustar depois).
2. **`{VALOR}` ausente do template** — decidir se algum dia vale
   reenviar um novo template com essa variável, ou se o texto atual
   (sem valor) é suficiente pra produção. Não decidido.
3. **`poc-confirmacao-renovacao` continua deployada**, agora na versão
   com template — mesma decisão de antes (evitar recriar), sem nova
   execução até próxima autorização explícita.
4. Migração do número oficial, desconexão do RocketZap, motor de
   agendamento de lembretes — nada disso muda, seguem fora de escopo
   (seção 6/11).

## 14. Consolidação do checkpoint (2026-08-22, fim de sessão) — estado completo desta frente

> **Consolidação documental, não implementação.** Fecha esta sessão de
> trabalho na frente "Substituição do RocketZap" + "IA própria de
> pagamento" (PagBank). Nada foi codado, nenhum prompt alterado,
> número oficial e RocketZap continuam intocados. Reúne, num só lugar,
> o estado de tudo que foi investigado/desenhado/comprovado hoje —
> sem repetir o detalhe técnico de cada documento, só apontando pra
> ele.

### Pagamento

- **PagBank é a fonte de verdade do pagamento.** Nenhuma renovação é
  liberada sem confirmação real vinda do PagBank — nunca por
  interpretação do comprovante em si (Gemini não extrai valor/dados do
  comprovante nesta arquitetura, só reconhece que uma mídia foi
  enviada).
- **Consulta real por `charge_id` confirmada com chamada de verdade**
  (POC `poc-pagbank-consulta`, deployada/testada/já removida,
  2026-08-22): `GET /orders?charge_id=...` devolve `status`, `amount`,
  `reference_id`, `charge.id` corretamente. O `SELF` do **pedido**
  (`order`) também funciona, como caminho alternativo equivalente. O
  `SELF` da **cobrança** (`charge`, host `internal.sandbox.api.pagseguro.com`)
  **não é acessível** (`403 unauthorized`) — não usar esse link.
  Detalhe: `2026-08-22_poc_consulta_pagbank_charge_id.md`.
- O `end_to_end_id` do comprovante real do cliente segue como
  **hipótese plausível, não confirmada** (estrutura bate com o ISPB
  real da PagSeguro, mas 2 caracteres de diferença do padrão Bacen) —
  não é bloqueador do fluxo principal, que localiza a cobrança por
  `charge_id`/`reference_id`, não pelo `end_to_end_id`. Detalhe:
  `2026-08-22_levantamento_endtoendid_comprovante.md`.

### Renovação

> **Redação corrigida nesta consolidação — não inflar evidência
> parcial em decisão fechada** (correção feita ao vivo, ver
> conversa: a primeira tentativa de registrar "renovação pelo Rocket
> já comprovada ponta a ponta, não reabrir" foi barrada por estar mais
> forte do que os dados sustentam).

- **UniTV:** renovação real comprovada de ponta a ponta, com
  verificação independente (`poc-pagbank-unitv-renew`, webhook PagBank
  real → renovação real da conta `gcnv6v`, 2026-08-12). ✅ Fechado,
  não reabrir esta parte especificamente.
- **Sigma/Rocket via sessão do Vault** (`POST
  /gerenciador/pagamento/add/`, mesmo caminho do botão "Adicionar
  Pagamento"): renovação real do Sigma comprovada, **com reconsulta
  independente ao painel real** (`inovatv_meta_business_agent`
  CLAUDE.md §16). ✅ Comprovado como mecanismo — **mas esse caminho
  aciona o RocketZap junto**, que manda sua própria confirmação. Não
  serve, sozinho, como prova de uma arquitetura sem RocketZap.
- **`PATCH` isolado via `ROCKET_API_KEY`** (POCs #1/#2, seções 9-12
  deste documento; `poc-confirmacao-renovacao`): comprovado que
  atualiza o campo `vencimento` do **Rocket** e permite disparar nossa
  própria mensagem (texto livre e template, ambos testados com
  sucesso real). **❓ Sem confirmação independente de que isso
  prorroga o serviço real no Sigma** — nunca foi reconsultado o painel
  Sigma depois de um `PATCH` isolado. **Pendência real, não fechada —
  não presumir resolvida numa implementação futura sem esse teste.**
  Detalhe: `2026-08-22_comparacao_decisoes_fluxo_confirmacao.md`
  (seção "Achado crítico"), `2026-08-22_levantamento_tecnico_conferencia_pagbank.md`
  (item 3 da seção 13).

### WhatsApp

- **RocketZap será substituído como canal de envio** — objetivo já
  confirmado (seção 0 deste documento, arquitetura-alvo).
- **Nossa Cloud API é o canal oficial de destino** — já comprovado
  tecnicamente, duas vezes (POC #1 texto livre, POC #2 template,
  seções 9-12 deste documento).
- **Número oficial (`5517996242415`) e sessão RocketZap seguem
  intocados** — nenhuma migração real feita ou agendada.

### Fluxo futuro — comprovante → confirmação → renovação (desenhado, não implementado)

```
cliente envia comprovante
      ↓
identificamos o cliente pela conversa (telefone → /match)
      ↓
localizamos a cobrança PagBank vinculada (reference_id/charge_id,
guardados na criação da cobrança)
      ↓
consultamos o PagBank (GET /orders?charge_id=... ou SELF do order —
os dois confirmados nesta sessão)
      ↓
PAID + valor bate com o esperado?
      ↓ sim
apresentamos o botão RENOVAR ACESSO — nunca antes disso
      ↓
cliente clica — segunda confirmação, autoriza a ação (token de uso
único, reivindicação atômica)
      ↓
Rocket executa a renovação (mecanismo exato — Vault ou PATCH — ainda
em aberto, ver "Renovação" acima)
      ↓
Rocket devolve os dados atualizados (reconsulta real, nunca confia no
retorno otimista da própria ação)
      ↓
nossa infraestrutura envia a confirmação final (Cloud API, template
`pagamento_confirmado`, já aprovado)
```

Duas confirmações sempre separadas: **PagBank confirma o dinheiro; o
clique do cliente autoriza a ação.** Nenhuma substitui a outra.
Detalhe completo: `2026-08-22_desenho_fluxo_corrigido_duas_confirmacoes.md`
(ordem/princípio), `2026-08-22_levantamento_tecnico_conferencia_pagbank.md`
(os 12 pontos técnicos, incluindo casos de borda — valor divergente,
pagamento duplicado, múltiplos acessos, já processado).

### Lembretes

- **Rocket continua sendo a origem da lógica dos lembretes** — dias/
  horário/filtro de audiência configurados por José, nunca decididos
  por nós ou pela IA (princípio "o Rocket nunca decide nada sozinho",
  `2026-08-22_inventario_substituicao_rocketzap.md`, seção 6-A).
- **Nossa infraestrutura substitui só a entrega** (RocketZap → Cloud
  API) — não a decisão de quando/pra quem disparar. Isso continua
  sendo configuração do José no Rocket hoje; um motor de agendamento
  equivalente do nosso lado é trabalho futuro, não decidido (seção 5
  deste documento).

### Meta — resultado dos templates

| Template | Status (2026-08-22) | Categoria |
|---|---|---|
| `pagamento_confirmado` | ✅ Aprovado; POC #1 (texto livre) e POC #2 (template) concluídas com sucesso real | Utilidade |
| `vencimento_hoje` | ❌ Resultado definitivo — Meta aprovou, mas reclassificou | **Marketing** |
| `fiado_em_atraso` | 🟡 Submetido, aguardando aprovação | Utilidade (pretendida) |

### O que fica explicitamente como pendência real, não fechada nesta consolidação

1. Se o `PATCH` isolado via `ROCKET_API_KEY` prorroga o Sigma de
   verdade — não testado, não presumir.
2. Se o `end_to_end_id` do comprovante real é de fato o EndToEndId do
   Bacen — estrutura plausível, não confirmada.
3. Quem decide criar a cobrança PagBank em primeiro lugar (proativo vs.
   reativo) — não decidido.
4. Onde hospedar a tela de confirmação/botão — não decidido (Decisão 1,
   `2026-08-22_comparacao_decisoes_fluxo_confirmacao.md`).
5. Resultado final de `fiado_em_atraso` — aguardando a Meta.

### O que NÃO fazer a partir deste checkpoint, sem nova autorização explícita e específica

- Não reabrir a pergunta "o PATCH prorroga o Sigma" como se fosse
  informação nova — ela já está registrada como pendência real, com
  a explicação de por que não foi fechada.
- Não implementar o fluxo definitivo de comprovante→confirmação→
  renovação.
- Não alterar o prompt de sistema congelado.
- Não tocar no número oficial nem na sessão RocketZap.

**Fim do checkpoint desta sessão. Nenhum código, migration, deploy,
prompt ou configuração de produção foi alterado nesta etapa de
consolidação.**
