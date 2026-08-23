# Casos Reais de Atendimento — material para a IA (log crescente)

> **Isto é um log de casos reais de suporte, não uma especificação
> técnica nem uma decisão de arquitetura.** Cada entrada registra um
> atendimento real, o problema observado e a lição que ele ensina.
> **Nenhuma automação, código ou modelo de dado é alterado a partir
> destas entradas.** A consolidação desses casos no Conhecimento
> Institucional da IA (Componente 2, `inovatv-api-intermediaria`)
> acontece depois, em lote, quando fizer sentido — não a cada caso
> novo. Objetivo: a IA aprender como a InovaTV realmente atende,
> inclusive exceções que dificilmente apareceriam num documento
> puramente técnico.

---

## Caso 1 — Conta UniTV "Não usado" sem atribuição ao cliente (22/08/2026)

- **Contexto:** atendimento/suporte real.
- **Servidor:** exclusivamente UniTV — não generalizar para outros
  servidores (NewOne, Blaze, ChannelTV etc.) sem levantamento próprio.
- **Caso:** conta de teste grátis criada para a cliente (3 dias,
  concedidos automaticamente ao instalar o UniTV), credenciais de
  continuidade já enviadas a ela. A cliente nunca fez o primeiro
  login. Dias depois voltou perguntando por que não conseguia entrar.
  O atendente não encontrou a conta buscando pelo nome dela, pelo nome
  de quem realmente ia usar (o pai dela) nem pelo usuário já enviado —
  nem no UniTV, nem no Rocket.
- **Problema observado:** a conta permaneceu com status "Não usado" e
  não estava identificada com o nome da cliente, tornando impossível
  localizá-la depois. Risco real de a mesma conta ter sido/vir a ser
  reaproveitada para outra pessoa.
- **Contraste com um caso que funcionou:** outro cliente (Jair) está
  na mesma situação técnica — conta também "Não usado" — mas o
  atendente já tinha colocado o nome dele na conta no momento da
  criação, então não há risco de confusão.
- **Lição para a IA:** no contexto UniTV, "Não usado" não significa
  necessariamente "disponível" — é preciso considerar se a conta já
  está atribuída a um cliente, mesmo que ele nunca tenha feito o
  primeiro acesso.
- **Uso futuro:** alimentar o Conhecimento Institucional da IA para
  que, diante de um relato parecido ("meu teste não está entrando",
  cliente não localizado por nome/usuário), ela reconheça a
  possibilidade descrita aqui em vez de concluir que não há registro
  algum.

---

## Caso 2 — Dado de PIX é informação corrente, não fato fixo (22/08/2026)

- **Contexto:** atendimento/suporte real.
- **Servidor:** não aplicável — caso sobre dado de pagamento, não
  específico de servidor.
- **Caso:** cliente pediu o número do PIX para pagamento. Atendente
  respondeu com os dados vigentes hoje (PIX celular
  `17996242415`, banco NuBank, nome José Antônio) e pediu envio do
  comprovante depois do pagamento.
- **Observação do usuário, importante para não confundir a IA no
  futuro:** esse número/esses dados de PIX **podem mudar** assim que
  a migração para o PagBank (frente em andamento, ver
  `documentos/levantamentos/2026-08-22_desenho_pagbank_fluxo_renovacao.md`
  e demais levantamentos PagBank) estiver concluída — hoje é o PIX
  pessoal manual do José, mas o fluxo de recebimento real está sendo
  redesenhado.
- **Lição para a IA:** dados de pagamento (chave PIX, banco, favorecido)
  são **informação corrente/operacional, não fato permanente** — não
  devem ser fixados no Conhecimento Institucional como se nunca fossem
  mudar. Precisam vir de uma fonte sempre atualizável (configuração
  corrente, não texto memorizado de um exemplo antigo), especialmente
  considerando que o mecanismo de recebimento está mudando (PagBank).
- **Uso futuro:** ao consolidar este caso no Conhecimento
  Institucional, registrar a *estrutura* da resposta (o que informar
  quando perguntarem sobre PIX/pagamento) separada do *valor* atual
  dos dados — o valor deve ser atualizado quando o PagBank entrar em
  produção, não herdado deste exemplo indefinidamente.

---

## Caso 3 — Pagamento direto na chave Pix, fora do PagBank (22/08/2026)

- **Contexto:** atendimento/suporte real.
- **Servidor:** não aplicável — caso sobre o mecanismo de pagamento,
  não específico de servidor.
- **Caso:** cliente recebeu o lembrete de vencimento padrão (plano,
  valor, vencimento, instruções de pagamento com a chave Pix da
  InovaTV). Em vez de pagar por uma cobrança gerada pela nossa futura
  infraestrutura (PagBank), o cliente fez um Pix **diretamente** pelo
  app do banco dele (Caixa Econômica Federal) para a chave Pix da
  InovaTV (conta Nubank), e enviou o comprovante. Comprovante real
  conferido: situação **"Efetivado"**, valor **R$ 35,00** (batendo com
  o plano Mensal), com **ID de transação** próprio do comprovante
  (formato EndToEndId do Pix).
- **Achado importante:** o comprovante tem, sim, um ID de transação —
  mas **isso não significa que essa transação é consultável no
  PagBank**. O dinheiro nunca passou pelo PagBank; foi Pix direto,
  banco a banco. Não faz sentido tentar encaixar esse comprovante no
  fluxo de consulta por `charge_id`/`reference_id` do PagBank (ver
  `documentos/levantamentos/2026-08-22_poc_consulta_pagbank_charge_id.md`)
  — é estruturalmente um caminho diferente.
- **Lição para a IA:** nem todo pagamento recebido pela InovaTV passa
  pelo PagBank. O PagBank deve ser o caminho **principal**/fonte de
  verdade para pagamentos originados de uma cobrança que a nossa
  própria infraestrutura criar — mas o pagamento direto na chave Pix
  continua existindo como **caminho excepcional**, sempre vai existir
  (nada impede um cliente de pagar direto), e precisa de um tratamento
  próprio (hoje, na prática: análise humana do comprovante, como
  sempre foi feito).
- **Uso futuro:** ao desenhar o fluxo de confirmação de pagamento no
  Conhecimento Institucional/Orquestrador, prever explicitamente os
  dois caminhos — nunca assumir que "todo comprovante deveria ter uma
  cobrança PagBank correspondente". Ausência de correspondência no
  PagBank não é evidência de pagamento inválido, pode ser só esse
  caminho excepcional.
- **Dado omitido deliberadamente deste registro:** nome completo/CPF
  do pagador e do recebedor, chave Pix, chave de segurança e o valor
  literal do ID de transação do comprovante real — nenhum necessário
  para a lição, mantendo a mesma disciplina de minimização já usada em
  todo o projeto.

---

## Caso 4 — Retomada de conversa sem "paguei" + reconhecimento pós-encerramento (22/08/2026, cliente Marco/NewOne)

- **Contexto:** atendimento/suporte real, sequência completa de um
  atendimento (não um evento isolado).
- **Servidor:** NewOne — mas a lição aqui não é específica de
  servidor, é sobre comportamento de conversa.
- **Caso, em sequência:**
  1. **20/08, 07:00** — Rocket envia o lembrete automático de
     vencimento pro cliente Marco (plano Mensal R$35, usuário
     `4279115995`, servidor NewOne, vencimento 20/08 às 20:59),
     pedindo pagamento + comprovante.
  2. **22/08, 16:15** — dois dias depois, o cliente volta à conversa
     só com **"Boa tarde"** — sem dizer "paguei", sem repetir plano ou
     usuário, sem anexar nada nesta mensagem específica.
  3. **22/08, 16:29** — o atendimento chega à confirmação de
     pagamento ("Pagamento confirmado com sucesso", novo vencimento
     22/09/2026 às 20:59).
  4. **Mais tarde, mesmo atendimento já encerrado** — o cliente manda
     só um emoji: **👍🏻**.
- **O que o trecho disponível NÃO comprova:** como o pagamento foi
  validado entre os passos 2 e 3 (não há comprovante visível nesse
  recorte da conversa). **Não registrar/assumir que foi o PagBank** —
  seria inventar a origem da confirmação sem evidência.
- **Lição 1 para a IA — retomada de contexto sem palavra-chave:** o
  cliente não precisa dizer "paguei" ou "quero renovar" para o
  atendimento prosseguir corretamente. Ele pode simplesmente voltar à
  conversa ("Boa tarde") e o atendimento precisa continuar a partir do
  contexto/dados reais do cliente — nunca depender de detectar uma
  frase-gatilho específica.
- **Lição 2 para a IA — mensagem mínima pós-encerramento não é nova
  intenção:** depois de um atendimento já concluído (confirmação
  enviada), o cliente pode mandar uma reação mínima — emoji (`👍🏻`),
  "ok", "obrigado", "valeu" etc. Isso **não** deve: abrir um novo
  atendimento sem necessidade; fazer a IA perguntar de novo o que o
  cliente quer; repetir a confirmação de pagamento já enviada;
  interpretar como novo pedido de renovação; ou acionar transferência
  para humano. O comportamento esperado é reconhecer isso como
  encerramento/agradecimento do próprio cliente — a política exata
  (responder algo curto vs. não responder nada) ainda não foi
  definida, mas o comportamento a **evitar** já está claro.
- **Uso futuro:** casos como este (retomada sem palavra-chave,
  reconhecimento pós-encerramento) tendem a ser recorrentes — quando
  houver massa suficiente de exemplos parecidos, viram candidatos a
  regra explícita de comportamento no prompt/Conhecimento
  Institucional. Por enquanto, ficam registrados como padrão
  observado, não como regra já fechada.
