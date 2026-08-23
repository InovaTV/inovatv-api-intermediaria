# Matriz de Homologação — Número de Teste (17996286135)

> **Isto é planejamento de testes, não implementação.** Nenhum código
> novo, deploy, webhook ou configuração de Meta/WhatsApp foi criado a
> partir deste documento. Ele organiza, num lugar só, tudo que
> precisa ser provado no número de teste antes de considerar migrar o
> número oficial (Lacuna 10, `2026-08-22_fluxo_renovacao_automatica_pagbank_rocket_cloudapi.md`).
> **Nenhuma das Lacunas 1-10 é reaberta aqui** — esta matriz só
> organiza a ordem de construção/teste do que já foi decidido.

## Como ler esta matriz

Cada item tem:
- **Status:** ✅ Comprovado (evidência real já existe) · 🚧 Parcial
  (uma peça testada isoladamente, não o fluxo completo) · 🔲 Não
  testado (nada feito ainda).
- **Evidência/fonte:** onde a comprovação (ou a decisão que falta
  implementar) está registrada — nunca reafirmado sem citar de onde
  vem.
- **Critério de "pronto":** o que precisa ser observado, com evidência
  real (não só ausência de erro), para considerar o item fechado.

Organizada nos mesmos grupos do plano de fases já combinado (Fase 0
= esta matriz inteira; os grupos abaixo mapeiam pras Fases 1-5 do
plano de implementação).

---

## Grupo A — Canal e mídia básica

| Item | Status | Evidência/fonte | Critério de "pronto" |
|---|---|---|---|
| Texto recebido/enviado (Webhook → Orquestrador → Cloud API) | ✅ Comprovado | Marco Componente 3 (`inovatv_central/CLAUDE.md`), bateria de testes reais pelo Webhook | — (já fechado, não precisa retestar) |
| Áudio — Gemini processa mídia inline | 🚧 Parcial | `gemini_client.ts` (`MidiaAnexada`), testado isoladamente com sucesso | Já comprovado que o Gemini entende áudio; falta testar com um áudio real chegando pelo Webhook de verdade |
| Áudio recebido pelo Webhook real (contrato `{telefone, conteudo}` não tem campo de mídia ainda) | 🔲 Não testado | Pendência já registrada (CLAUDE.md, "Achado separado — suporte multimídia") | Cliente manda áudio real, IA responde corretamente, sem inventar conteúdo |
| Áudio enviado pelo atendente (Painel) | 🔲 Não testado | Não implementado | Atendente grava/envia áudio pelo Painel, cliente recebe |
| Imagem recebida pelo Webhook real | 🔲 Não testado | Mesma pendência do áudio (contrato sem campo de mídia) | Cliente manda imagem real (ex.: print de erro), IA descreve certo |
| Imagem enviada pelo atendente | 🔲 Não testado | Não implementado | Atendente envia imagem pelo Painel, cliente recebe |
| Vídeo | **Fora de escopo, deliberadamente** | Decisão já registrada (`CLAUDE.md`) — "vídeo está fora do escopo atual" | Não entra nesta matriz |
| Documento recebido/enviado | 🚧 Parcial (recepção testada isoladamente com o Gemini, Rodadas 3/4) | Mesma pendência de contrato do áudio/imagem | Cliente manda PDF real pelo Webhook, IA usa o conteúdo certo |
| Localização/contatos/interativos (botões) | 🔲 Nunca avaliado | Nenhuma decisão prévia — capacidade da Cloud API, nunca usada no projeto | Definir se e onde faz sentido usar (ex.: seleção de múltiplos acessos, já cogitado em `2026-08-22_desenho_poc_motor_lembretes.md` §4-B) antes de testar |
| Templates | ✅ Comprovado | `pagamento_confirmado` e `nova_transferencia_humana` aprovados e testados; `vencimento_hoje` aprovado mas Marketing | — |

## Grupo B — IA e atendimento

| Item | Status | Evidência/fonte | Critério de "pronto" |
|---|---|---|---|
| Respostas da IA (texto) | ✅ Comprovado | Rodadas 3/4 (40 execuções) + bateria real pelo Webhook | — |
| Reconhecimento de intenção de renovação (`propor_renovacao`) | 🔲 Não implementado | Decisão de contrato fechada (Lacuna 2), prompt ainda não alterado | Exige nova rodada de validação comportamental antes de produção (mesmo padrão Rodadas 3/4) — não é só "implementar e testar uma vez" |
| Transferência para humano | ✅ Comprovado | RPC `acionar_transferencia_humana`, aviso ao José via template | — |
| Atendimento pelo Painel (assumir/responder/encerrar) | 🚧 Parcial | `assumir`/`encerrar` testados contra produção; `responder` testado só até o guard de estado — envio real via WhatsApp nunca validado de ponta a ponta pelo Painel | Atendente responde de verdade pelo Painel, cliente recebe |

## Grupo C — Calling API (capacidade adicional, não pré-requisito)

| Item | Status | Evidência/fonte | Critério de "pronto" |
|---|---|---|---|
| Chamada de voz | 🔲 Não testado | API existe e está em produção (Lacuna 10, fonte oficial Meta) — elegibilidade da conta InovaTV não verificada | Confirmar destinatários únicos ≥ 2.000, habilitar Calling features, inscrever webhook `calls`, testar 1 chamada real |
| Chamada de vídeo/screen sharing | 🔲 Não testado | Documentado pela Meta como "em desenvolvimento" — menos maduro que voz | Mesmo caminho da voz, sem prioridade até voz estar validada |
| Webhook `calls` | 🔲 Não implementado | — | — |

## Grupo D — Fluxo de renovação PagBank → Rocket → Cloud API (o núcleo)

| Item | Status | Evidência/fonte | Critério de "pronto" |
|---|---|---|---|
| Consulta ao PagBank por `charge_id` | ✅ Comprovado | `2026-08-22_poc_consulta_pagbank_charge_id.md` | — |
| **Criação** de uma cobrança PagBank nova | 🔲 Não testado | Só consulta a cobranças já existentes foi testada; criar uma cobrança nova nunca foi feito nesta investigação | Criar 1 cobrança real de teste, confirmar `reference_id`/`charge.id` corretos |
| Busca do valor real do cliente no Rocket (`/cliente/{public_id}` → `valor`) | 🔲 Não implementado | Decisão fechada (Lacuna 7), nunca chamado fora da leitura manual desta sessão | Buscar valor real de um cliente com valor negociado divergente (ex.: R$30), confirmar que é esse o valor usado |
| Tabela `cobrancas_pix` | 🔲 Não criada | Desenhada (`desenho_pagbank_fluxo_renovacao.md` §6, §8), nunca implementada | — |
| Tabela `tokens_renovacao` | 🔲 Não criada | Desenhada (Lacuna 4), inclusive a pendência de distinguir "tentativa" de "concluído" (Lacuna 9, decisão 1) | — |
| Mensagem intermediária fixa ("vou preparar seu Pix") | 🔲 Não implementada | Texto provisório aprovado (Lacuna 8) | — |
| Mensagem com dados reais da cobrança (QR/valor) | 🔲 Não implementada | Desenho fechado (Lacuna 8) | — |
| Edge Function pública (GET/POST do token) | 🔲 Não criada | Arquitetura decidida (Lacuna 5) | GET nunca executa nada (testar até com prévia de WhatsApp/crawler); POST só executa com clique real |
| Reconsulta ao PagBank no clique | 🔲 Não implementada | Decisão fechada (Lacuna 4) | — |
| **Renovação real do Sigma via HTTP direto (sem navegador)** | ✅ **Comprovado** | POC real desta sessão (Lacuna 6) — `renovar_painel=true`, `enviar_mensagem` ausente, Sigma renovado, RocketZap não disparou | Já fechado — próximo passo é generalizar em código de produção, não retestar o comportamento |
| Reconsulta ao Sigma após a renovação | ✅ Comprovado (mesmo teste acima) | — | — |
| Envio da confirmação final ao cliente (`pagamento_confirmado`) | ✅ Comprovado (fora deste fluxo específico, já testado no marco do Componente 3) | — | Testar dentro do fluxo completo, não isolado |
| Fluxo completo de ponta a ponta (intenção → cobrança → pagamento → clique → renovação → confirmação) | 🔲 Nunca executado como um todo | Todas as peças têm decisão, nenhuma foi conectada ainda | 1 execução real completa, com um cliente de teste pagando de verdade |

## Grupo E — Motor de lembretes

| Item | Status | Evidência/fonte | Critério de "pronto" |
|---|---|---|---|
| `condicaoVenceHoje` (função pura de decisão) | ✅ Comprovado isoladamente | `2026-08-22_desenho_poc_motor_lembretes.md` | — |
| Disparo real do template `vencimento_hoje` | 🚧 Parcial | Template aprovado, mas classificado Marketing (não Utilidade) — implicação de custo/tratamento ainda não avaliada | Confirmar custo real de enviar como Marketing antes de escalar |
| Motor de agendamento real (cron, múltiplos clientes) | 🔲 Não implementado | Só existe a POC manual descartável, nunca um agendador de produção | Rodar 1 dia inteiro contra a base real de clientes de teste, sem falso positivo/negativo |
| `vencimento_em_3_dias`/`vencido_a_3_dias` e demais família de lembretes | 🔲 Nem desenhados como template | Deliberadamente adiados até `vencimento_hoje` se resolver | — |

## Grupo F — Tratamento de erros/casos de borda (Lacuna 9)

| Item | Status | Evidência/fonte | Critério de "pronto" |
|---|---|---|---|
| PagBank indisponível na reconsulta | 🔲 Não testado | Regra decidida (Lacuna 9) | Simular timeout, confirmar que token não é consumido |
| PagBank `PENDING` no clique | 🔲 Não testado | Regra decidida (Lacuna 9, decisão 1) — token permanece utilizável | Testar clique antes do pagamento confirmar, depois confirmar que o mesmo link funciona depois |
| Cobrança concorrente pro mesmo acesso | 🔲 Não testado | Regra decidida (Lacuna 9, decisão 2) | Pedir renovação 2x seguidas pro mesmo acesso, confirmar que só 1 cobrança existe |
| Falha na chamada ao Rocket, resultado desconhecido | 🔲 Não testado | Regra decidida (Lacuna 9, decisão 3) — nunca retry automático | Difícil de simular de propósito; ao menos confirmar que o código nunca chama o Rocket 2x pro mesmo token |
| Sessão Vault inválida no momento do clique | ✅ Comprovado (mecanismo geral) | Monitoramento já testado (`inovatv_meta_business_agent` CLAUDE.md §14.8) | — |

---

## Ordem de dependência para homologação

> **Isto é planejamento de sequência, não autorização de
> implementação.** A ordem abaixo reflete o que precisa **existir**
> antes de cada teste seguinte poder ser executado de forma real —
> não o volume de trabalho de cada grupo. Nenhum grupo, critério,
> status ou decisão das tabelas acima foi alterado por esta seção.
> Seguir esta ordem não autoriza construir todos os grupos em
> sequência sem checkpoint — cada peça continua exigindo sua própria
> aprovação antes de ser implementada, mesma disciplina já usada em
> toda a frente até aqui.

1. **Base do canal e identidade (parte já pronta de Grupo A/B)** — texto
   recebido/enviado, IA respondendo, identificação do cliente. **Já
   comprovado**, não é trabalho novo — só a fundação sobre a qual tudo
   abaixo é construído. Nada do resto pode ser testado sem isso já
   funcionando, e já funciona.

2. **`propor_renovacao` (parte de Grupo B)** — é a **porta de entrada**
   do núcleo: sem a IA reconhecer a intenção, não existe gatilho pra
   criar a cobrança PagBank. Depende da extensão do contrato do Gemini
   (Lacuna 2) e da rodada de validação comportamental que essa
   extensão exige — precisa vir **antes** de qualquer teste do Grupo D,
   não em paralelo com ele.

3. **Infraestrutura de dados do núcleo** (tabelas `cobrancas_pix`/
   `tokens_renovacao`, dentro do Grupo D) — nenhuma cobrança ou token
   pode ser testado sem essas tabelas existirem primeiro.

4. **Criação da cobrança + valor real do cliente** (Grupo D) — depende
   dos itens 2 e 3 já existirem.

5. **Mensagens fixas** (intermediária + dados reais da cobrança,
   Lacuna 8) — depende do item 4 (só faz sentido testar a mensagem
   depois que uma cobrança real existe pra descrever).

6. **Edge Function pública do token (GET/POST) + reconsulta PagBank no
   clique** (Lacunas 4/5) — depende do item 3 (o token referencia
   `operacao_id`, que precisa existir) e do item 4 (precisa haver uma
   cobrança real pra reconsultar).

7. **Renovação Sigma via HTTP + confirmação final ao cliente** — **já
   comprovado como comportamento** (Lacuna 6), não precisa ser
   reprovado — só precisa ser conectado ao restante do fluxo, o que
   depende do item 6 (é o clique que aciona essa etapa).

8. **Fluxo completo de ponta a ponta** — só é testável depois que 1-7
   existirem conectados entre si; é o item que fecha o Grupo D.

9. **Grupo F (erros/casos de borda)** — testado **junto de cada peça
   acima**, à medida que ela for implementada, não como uma fase
   separada no fim. Ex.: o caso "PagBank `PENDING` no clique" só é
   testável depois que o item 6 existir.

10. **Restante do Grupo A (áudio/imagem/documento — enviar/receber
    pelo Painel/Webhook)** — depende só da base do canal (item 1), não
    do núcleo (Grupo D). Pode ser feito em paralelo a qualquer momento
    depois do item 1, sem bloquear nem ser bloqueado pelos itens 2-9.

11. **Grupo E (motor de lembretes)** — **independente do núcleo** —
    mecanismo diferente (proativo, não reativo), sem relação de
    dependência com o Grupo D. É pré-requisito só da **migração do
    número oficial** (Lacuna 10), não da validação do fluxo de
    renovação. Pode ser feito em paralelo ao Grupo D, não precisa
    esperar ele terminar.

12. **Grupo C (Calling)** — **totalmente independente** de tudo acima,
    capacidade adicional sem relação de dependência com nenhum outro
    grupo. Pode ser homologado a qualquer momento, sem pressa.

**Nada implementado a partir deste documento.** Serve só pra orientar
a sequência real de construção/teste quando a implementação começar —
cada item continua exigindo aprovação própria antes de ser construído.
