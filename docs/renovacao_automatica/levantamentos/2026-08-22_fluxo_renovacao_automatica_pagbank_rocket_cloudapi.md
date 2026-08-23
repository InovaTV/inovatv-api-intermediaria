# Fluxo de Renovação Automática — PagBank → Rocket → Cloud API

> **Isto é consolidação por escrito, não implementação.** Nenhum
> código, migration, deploy, prompt ou configuração foi alterado a
> partir deste documento. Ele reúne, num único lugar, o fluxo já
> decidido e comprovado ao longo de vários levantamentos/POCs
> paralelos desta mesma frente (substituição do RocketZap) — cada
> afirmação cita a fonte, nada é reaberto ou re-investigado aqui.
> Ao final, uma seção separada lista só o que genuinamente ainda
> falta decidir/construir — sem escolher nada por conta própria.

## 1. Por que este documento existe

Várias peças foram investigadas e comprovadas separadamente ao longo
do dia (22/08/2026): renovação do Sigma pelo Rocket, consulta ao
PagBank, casos reais de atendimento, correção do desenho de
confirmação. Ficou fácil perder o fio entre tantos documentos
paralelos. Este documento existe só para **congelar, num lugar só, o
fluxo-alvo tal como está entendido hoje**, antes de abrir qualquer
nova investigação — para não voltar a discutir o que já está
resolvido.

## 2. O fluxo completo, consolidado

```
0-A. Cliente está numa conversa ativa com a IA (por qualquer motivo —
     não precisa ser especificamente sobre renovação)
        ↓
0-B. IA identifica intenção de renovação (Gemini retorna
     tipo="propor_renovacao") — reconhecimento de intenção
     equivalente, NUNCA por frase-gatilho exata nem simplesmente por
     detectar que o cliente está vencido/perto de vencer. Validador
     confere só condições objetivas (identidade, acesso definido),
     nunca a intenção em si. DECIDIDO (22/08/2026), ver lacunas 1 e 2,
     seção 8
        ↓
1. Nossa infraestrutura cria a cobrança PagBank (reference_id =
   nosso operacao_id, valor do plano real) — caminho REATIVO,
   nunca criado só por vencimento próximo/passado — OU cliente paga
   direto na chave Pix da InovaTV, sem cobrança nossa — dois
   caminhos possíveis, ver seção 6
        ↓
2. Cliente envia o comprovante pelo WhatsApp — continua sendo o
   gatilho da conversa
        ↓
3. IA reconhece que é um comprovante/mensagem sobre pagamento e
   responde algo como "Recebi seu comprovante, estou conferindo..."
   — mensagem intermediária, evita deixar o cliente sem resposta
   enquanto a conferência acontece
   [fonte: 2026-08-22_desenho_fluxo_corrigido_duas_confirmacoes.md, seção 5]
        ↓
4. Nossa infraestrutura CONSULTA o PagBank sobre a cobrança
   correspondente ao cliente — reconsulta ATIVA, na hora (o
   comprovante é o gatilho da consulta, não um webhook passivo)
   [fonte: mesmo doc, seção 2]
        ↓
5. PagBank é a FONTE DE VERDADE para confirmar que o pagamento
   realmente aconteceu — PRIMEIRA confirmação, sobre o DINHEIRO
        │
        ├── NÃO confirma / não encontra cobrança pendente →
        │     não confirma, não renova, cai no comportamento já
        │     existente (transferência humana, regra congelada)
        │
        └── SIM (`status: "PAID"`) →
6. IA responde "Pagamento confirmado" e disponibiliza o botão
   "CONFIRMAR RENOVAÇÃO" — só agora, nunca antes da confirmação do
   PagBank
        ↓
7. Cliente clica — SEGUNDA confirmação, sobre a AUTORIZAÇÃO de agir.
   Pagamento confirmado pelo PagBank é NECESSÁRIO mas não executa a
   renovação sozinho — precisa das duas confirmações juntas
        ↓
8. O clique aciona o mecanismo já comprovado no Rocket:
   POST /gerenciador/pagamento/add/ com renovar_painel=true (+
   enviar_mensagem=false) — COMPORTAMENTO comprovado, ainda não existe
   como componente backend automático (ver lacuna 6, seção 8)
   [fonte: 2026-08-22_achado_separacao_renovar_painel_enviar_mensagem.md, seção 8]
        ↓
9. Esse mecanismo renova o Sigma de verdade (não só o campo do
   Rocket) — comprovado com reconsulta independente
        ↓
10. Consultamos os dados atualizados (novo vencimento real, devolvido
    pelo Rocket depois da renovação — nunca confiamos no que valia
    antes do clique)
        ↓
11. Nossa infraestrutura envia a confirmação final ao cliente pela
    Cloud API (template `pagamento_confirmado`, já aprovado pela
    Meta) — nunca pelo RocketZap, que não dispara nada porque
    enviar_mensagem=false
```

## 3. Princípio central — duas confirmações, nunca uma sozinha

**PagBank confirma o dinheiro. O clique do cliente autoriza a
renovação.** Nenhuma das duas substitui a outra; nenhuma decisão de
renovar é tomada com só uma delas.

- O comprovante (imagem) **nunca** é tratado como prova de pagamento
  — só como sinal de que o cliente está reportando um pagamento. A
  leitura do Gemini sobre a imagem é usada apenas para exibição
  (dados identificados), nunca para decidir a renovação.
- A IA, sozinha, **nunca** confirma pagamento nem apresenta o botão
  sem a confirmação real do PagBank.
- O clique do cliente, sozinho (sem confirmação prévia do PagBank),
  **nunca** dispara a renovação.

[fonte: `2026-08-22_desenho_fluxo_corrigido_duas_confirmacoes.md`,
seção 0 e 7 — substitui a versão anterior do desenho, que tratava a
confirmação do PagBank como suficiente sozinha]

## 4. Mecanismo de renovação Rocket → Sigma — COMPORTAMENTO RESOLVIDO (não confundir com componente pronto)

> **Distinção que precisa ficar clara em todo este documento:**
> "resolvido" aqui significa que a **pergunta de comportamento** — o
> Rocket renova o Sigma de verdade sem disparar o RocketZap, quando
> chamado desta forma específica? — tem resposta comprovada, sim. Isso
> **não** significa que existe hoje um **mecanismo backend produtivo e
> reutilizável** que qualquer cliente real possa acionar sozinho. A
> POC foi uma execução manual, única, num cliente de teste. Transformar
> esse comportamento comprovado num componente automático de produção
> continua sendo trabalho de implementação/arquitetura em aberto — ver
> lacuna 6, seção 8.

**Comprovado com evidência real em 22/08/2026:**
`POST /gerenciador/pagamento/add/` com `renovar_painel=true` +
`sigma_package_id` válido renova o Sigma de verdade — vencimento
avançou exatamente o esperado (+1 mês pro pacote testado), pagamento
real registrado no Rocket, confirmado por reconsulta independente ao
Sigma. Com `enviar_mensagem=false` na mesma submissão, o RocketZap não
dispara nenhuma mensagem — confirmado no WhatsApp real do cliente de
teste.

**Isso resolve a "Decisão 2" que estava em aberto** em
`2026-08-22_comparacao_decisoes_fluxo_confirmacao.md` (tensão entre
`PATCH` isolado — não confirmava renovar o Sigma de verdade — e sessão
do Vault — confirmava a renovação, mas duplicava mensagem com o
RocketZap). A combinação `renovar_painel=true` + `enviar_mensagem=false`
entrega os dois lados ao mesmo tempo: renovação real **e** nenhuma
duplicidade de mensagem.

**Consequência direta:** quem manda a confirmação final ao cliente
(passo 11) é sempre a nossa infraestrutura, via Cloud API, nunca o
RocketZap.

**Nota de prioridade, não confunda com "problema resolvido para
sempre":** este mecanismo (`enviar_mensagem=false`) é a ferramenta
certa **durante a transição**, enquanto o número oficial ainda
atende manualmente pelo WhatsApp App/Web. Quando o número oficial
migrar de vez para a Cloud API (decisão/execução separada, ver seção
8), a conta WhatsApp App/Web dele deixa de existir nesse mesmo
processo — sem ela, o RocketZap fica sem sessão pra se conectar,
com ou sem o toggle. [fonte: mesmo doc, seção 9]

## 5. Confirmação de pagamento via PagBank — RESOLVIDO como mecanismo de consulta

**Comprovado com chamada real (Sandbox):** `GET
/orders?charge_id=...` (ou o link `SELF` do **pedido**, nunca o da
**cobrança** — esse é bloqueado, `403`) devolve, de forma confiável,
`status`, `amount`, `reference_id` e `charge.id`. `status: "PAID"` é o
sinal que autoriza seguir para o passo 6.

[fonte: `2026-08-22_poc_consulta_pagbank_charge_id.md`]

## 6. Caminho excepcional — pagamento direto na chave Pix

**Casos reais já comprovam que este caminho existe e sempre vai
existir** — nem todo pagamento recebido pela InovaTV passa por uma
cobrança PagBank. Um cliente pode pagar diretamente na chave Pix da
InovaTV (banco a banco, sem gerar cobrança nossa) e mandar o
comprovante. Esse comprovante pode até ter um ID de transação próprio
— mas isso não significa que a transação é consultável no PagBank,
porque o dinheiro nunca passou por lá.

**Regra:** ausência de cobrança PagBank correspondente **não** é
evidência de pagamento inválido — só significa que esse caminho
excepcional precisa de um tratamento próprio (hoje, na prática:
análise humana do comprovante), separado do caminho principal descrito
na seção 2. Os dois caminhos não devem ser misturados nem forçados a
caber no mesmo fluxo.

[fonte: `documentos/CASOS_REAIS_ATENDIMENTO.md`, Caso 3]

## 7. O que este fluxo resolve, e o que ele reafirma (sem mudar)

**Resolve, com evidência real, não só desenho:**
- A IA não confirma pagamento só por receber uma imagem — o clique
  explícito do cliente, depois da confirmação real do PagBank, é que
  autoriza a renovação.
- O **comportamento** de renovação real (Rocket → Sigma) sem
  duplicidade de mensagem com o RocketZap — comprovado como
  comportamento do Rocket, não como componente backend de produção já
  implementado (esse é o item 6 da seção 8, ainda em aberto).
- O mecanismo de consulta confiável ao PagBank.
- O caminho excepcional (Pix direto) está identificado e não deve ser
  forçado a caber no fluxo principal.

**Reafirma, sem mudar, decisões já tomadas antes:**
- Associação pagamento↔cliente via `reference_id` = identificador
  nosso, decidido na criação da cobrança.
- Múltiplos acessos: nunca escolhido sozinho pela IA/Validador — o
  fluxo de confirmação só segue depois de esclarecido a qual acesso o
  comprovante se refere.
- Ambiguidade em qualquer ponto → nunca adivinha, sempre reprova/
  transfere.

## 8. Lacunas técnicas restantes — só o que falta, nenhuma escolha feita aqui

Cada item abaixo é uma decisão de arquitetura/produto ainda aberta, ou
um trabalho de implementação ainda não iniciado. **Nenhum foi
resolvido por este documento.**

1. ~~Quem/quando decide criar a cobrança PagBank~~ — **DECIDIDO
   (22/08/2026).** Caminho **Reativo**: a cobrança nasce quando existe
   uma conversa ativa com **intenção de renovação identificada** pela
   IA — reconhecimento de intenção equivalente ("quero renovar",
   "quanto fica pra renovar?", "meu plano venceu, quero continuar"
   etc.), **nunca** dependente de uma frase-gatilho exata. **Regra
   explícita, para não confundir com o caminho Proativo:** a IA
   **nunca** cria cobrança só por detectar, via `/status`, que o
   cliente está vencido ou perto de vencer — precisa da intenção
   manifestada na conversa.
   - **Caminho Proativo** (motor de lembretes cria a cobrança junto
     com o aviso automático de vencimento) fica registrado como
     **evolução futura**, não descartado — depende de duas peças que
     ainda não existem e não são desta lacuna: reconstruir o motor de
     lembretes na nossa própria infraestrutura (hoje ainda é o
     RocketZap quem envia) e resolver a classificação **Marketing**
     (não Utilidade) que a Meta já deu ao template `vencimento_hoje`
     — ver lacuna 10.
   - **Ainda em aberto, não resolvido por esta decisão:** o mecanismo
     exato de como o Gemini/Validador reconhecem "intenção de
     renovação equivalente" na prática (quais formulações contam, como
     evitar falso positivo/negativo) — isso é trabalho de
     implementação, ligado à lacuna 2 (extensão do contrato do
     Gemini), não decidido aqui.
   [decisão registrada nesta sessão; pergunta original aberta desde
   `2026-08-22_desenho_fluxo_corrigido_duas_confirmacoes.md`, seção 3,
   e `2026-08-22_desenho_pagbank_fluxo_renovacao.md`, seção 6]

2. ~~Extensão do contrato estruturado do Gemini (reconhecimento de
   intenção de renovação)~~ — **DECIDIDO (22/08/2026).**

   **Contrato — Opção A escolhida:** novo terceiro valor de `tipo`,
   `propor_renovacao`, ao lado dos já existentes `responder`/
   `transferir`:
   ```json
   { "tipo": "responder" | "transferir" | "propor_renovacao", "texto": "string" }
   ```
   Descartado deliberadamente um campo booleano oculto dentro de
   `responder` — uma resposta aparentemente normal não deve carregar
   silenciosamente o sinal de uma ação.

   **Criação da cobrança PagBank: assíncrona**, separada da resposta
   principal do Gemini — evita colocar a latência de uma chamada
   externa (PagBank) dentro do ciclo síncrono do Orquestrador.
   **Regra explícita, para não criar promessa falsa:** a resposta ao
   cliente nunca pode afirmar que a cobrança já foi criada antes de
   termos confirmação real de que a criação aconteceu. Enquanto a
   cobrança está sendo preparada, usar uma resposta intermediária
   neutra (ex.: "Vou preparar seu pagamento via Pix, só um momento.")
   — só depois de a cobrança existir de fato é que os dados reais
   (QR/código Pix) são enviados numa mensagem seguinte.

   **Papel do Validador — limite explícito, não uma checagem nova
   fingindo ser determinística:** o Validador **não pode** confirmar
   que a intenção semântica identificada pelo Gemini está "correta" —
   não existe, no contexto, um fato pra comparar (diferente de data/
   valor/contagem, que sempre têm uma resposta certa verificável). O
   papel dele fica restrito a **condições objetivas**: cliente
   identificado (`/match` resolveu um `publicId`); acesso determinado
   (sem ambiguidade, se houver múltiplos); checagens de segurança já
   existentes (credencial, telefone de outro cliente). A segurança
   real desta capacidade vem da combinação de três camadas, nenhuma
   sozinha: reconhecimento semântico do Gemini + condições objetivas
   do Validador + uma futura rodada de validação comportamental
   (mesmo padrão das Rodadas 3/4) testando se o Gemini reconhece
   intenção corretamente na prática.

   **Ainda em aberto, não resolvido por esta decisão:**
   - ~~O texto exato da resposta intermediária/neutra~~ — **resolvido
     na Lacuna 8** (seção 8), incluindo a decisão de que essa mensagem
     é fixa, não gerada pelo Gemini.
   - Onde/como a criação assíncrona da cobrança é efetivamente
     disparada (decisão de implementação, não de arquitetura).
   - **Continua exigindo alterar o prompt de sistema congelado** e a
     rodada de validação comportamental antes de produção — não
     decidido quando isso acontece, só registrado como pré-requisito.
     Prompt não tocado por esta decisão.

   **Nota de escopo, para não confundir com uma pendência parecida:**
   esta decisão cobre só o reconhecimento de **intenção de renovar**
   (o que dispara a criação da cobrança, passo 0-B do fluxo, seção 2).
   A referência original desta lacuna a `apresentar_confirmacao_renovacao`
   (tipo pensado para o passo 6 — apresentar o botão depois que o
   PagBank já confirmou o pagamento) é uma extensão **diferente e
   ainda separada**, não decidida aqui. Vale reavaliar no futuro se
   ela continua necessária como decisão do Gemini: a correção de
   "duas confirmações" (seção 3 deste documento) já move a
   confirmação real para uma reconsulta determinística ao PagBank —
   é possível que apresentar o botão vire lógica só do Orquestrador
   (determinística, sem depender do Gemini classificar nada). **Não
   resolvido — fica registrado como ponto a esclarecer, não uma nova
   lacuna formal por enquanto.**

   [decisão registrada nesta sessão; contrato/código real conferidos em
   `inovatv-api-intermediaria/supabase/functions/_shared/types.ts`,
   `gemini_client.ts`, `validador.ts`, `orchestrator/index.ts`;
   pergunta original em
   `2026-08-22_desenho_fluxo_comprovante_confirmacao_renovacao.md`, seção 2]

3. ~~Regras novas do Validador Determinístico para `propor_renovacao`~~
   — **DECIDIDO (22/08/2026).**

   **Condições objetivas exigidas** (todas precisam valer para
   aprovar):
   - **Cliente identificado** — pelo menos 1 acesso presente no
     contexto (`contexto.acessos.length >= 1`, mesmo sinal que
     `parseContexto` já produz hoje). Sem isso, reprova.
   - **Acesso determinado** — se houver só 1 acesso no contexto, essa
     condição já está satisfeita. Se houver **múltiplos** acessos, o
     texto do Gemini precisa conter um rótulo de plano/servidor
     (reaproveita `REGEX_PLANO_ROTULADO`/`REGEX_SERVIDOR_ROTULADO` já
     existentes) que aponte pra **exatamente um** dos acessos — sem
     rótulo, ou rótulo ambíguo entre mais de um, reprova.
   - **Segurança já existente continua valendo sem mudança**
     (credencial, telefone de outro cliente, valor monetário — já
     rodam pra qualquer `texto`, independente de `tipo`).
   - **Checagens factuais já existentes continuam rodando como estão**
     (datas, contagem de acessos, plano/servidor — só disparam se o
     texto contiver algo checável); não conflitam com a regra de
     rótulo acima.

   **Decisão de produto que fechou a única pendência real desta
   lacuna:** **não há restrição de elegibilidade por proximidade de
   vencimento.** O cliente pode demonstrar intenção de renovar a
   qualquer momento — vencendo hoje, já vencido, ou com dias
   restantes (renovação antecipada, troca de plano, ou só garantir
   continuidade). A condição para `propor_renovacao` nunca é a data
   do vencimento — é a combinação **intenção reconhecida (Gemini) +
   cliente identificado + acesso determinado + segurança**, nada além
   disso.

   **O que explicitamente não pertence ao Validador:**
   - **`public_id`** — nunca aparece no texto de contexto (achado real,
     conferido em `_shared/contexto.ts`: o contexto só tem Nome/Plano/
     Servidor/Vencimento/Telas por acesso, nunca o identificador). O
     Validador não conhece, e não precisa conhecer, o `public_id`.
   - **Intenção semântica em si** — já decidido na Lacuna 2, reafirmado
     aqui.
   - **Elegibilidade por vencimento** — decisão de produto acima:
     nunca existe essa checagem.
   - **Duplicidade/idempotência de cobrança** — já tem dono (camada de
     criação da cobrança, `2026-08-22_desenho_pagbank_fluxo_renovacao.md`,
     seção 8); o Validador não duplica essa proteção.

   **Peça de implementação que decorre disto, registrada mas não
   resolvida aqui (não é regra do Validador):** depois de aprovado,
   quem resolve o `public_id` real é o **Orquestrador**, a partir dos
   dados **estruturados** que ele já possui (`StatusResult`/candidatos
   de `/match`+`/status`), correlacionando o acesso identificado pelo
   Gemini/Validador contra essa estrutura — **nunca** fazendo parsing
   livre do texto atrás de um UUID. Fluxo:
   ```
   Gemini → propor_renovacao
        ↓
   Validador aprova (condições objetivas acima)
        ↓
   Orquestrador: resolve texto → acesso estruturado → public_id
        ↓
   cria cobrança PagBank
   ```
   Essa resolução (texto → `public_id`) ainda não está desenhada em
   detalhe — fica como trabalho de implementação futuro, não decidido
   nesta lacuna.

   **Resumo do papel do Validador nesta capacidade:** ele não decide
   se o cliente "merece" renovar — garante que, se o Gemini propôs uma
   renovação, existe um cliente/acesso suficientemente determinado e
   seguro para o Orquestrador resolver a operação.

   [decisão registrada nesta sessão; código real conferido em
   `inovatv-api-intermediaria/supabase/functions/_shared/validador.ts`
   e `_shared/contexto.ts`]

4. ~~Tabela `tokens_renovacao`~~ — **DECIDIDO (22/08/2026).**

   **Achado antes da decisão:** o desenho original
   (`2026-08-21_gatilho_meta_renovacao.md`) nasceu **antes de o
   PagBank existir** neste fluxo — pensado pra Meta AI lendo
   comprovante por OCR, token gerado por sincronização periódica de
   planilha. Duas peças inteiras desse desenho ficam **obsoletas**,
   substituídas pelas decisões já fechadas nas Lacunas 1/2/3:
   - Geração "idempotente por sync" (reaproveitar token entre ciclos
     de 30-60min de uma planilha) — não existe mais esse cenário; o
     fluxo agora é reativo, dentro de uma conversa (Lacuna 1).
   - A "Regra da IA" de analisar o comprovante por OCR pra decidir
     oferecer o link — substituída pela confirmação determinística via
     PagBank (seção 5 deste documento), não mais uma leitura de
     imagem decidindo.

   **Responsabilidade de cada peça, para não confundir a tabela com
   uma fonte de verdade que ela não é:**

   | Peça | Responsabilidade |
   |---|---|
   | PagBank | Provar o pagamento |
   | `cobrancas_pix` | Representar a operação/cobrança |
   | `tokens_renovacao` | Registrar a autorização temporária e de uso único do clique — nunca prova pagamento |
   | Rocket | Executar a renovação |
   | Cloud API | Comunicar o resultado |

   **Vínculo do token — decisão central desta lacuna:**
   `tokens_renovacao.operacao_id` referencia a **cobrança PagBank
   específica** (`cobrancas_pix`), **nunca** o `public_id` direto:
   ```
   token → operacao_id → cobrança PagBank específica → public_id + acesso + valor
   ```
   O clique não autoriza "renovar este cliente" de forma genérica —
   autoriza **exatamente a operação já confirmada como paga**. `public_id`/
   `conversation_id` continuam acessíveis via `cobrancas_pix` (que já os
   amarra, `2026-08-22_desenho_pagbank_fluxo_renovacao.md`, seção 6),
   sem duplicar essa informação em duas tabelas.

   **Estrutura proposta:**
   ```sql
   tokens_renovacao
   ├── id            (uuid)
   ├── token_hash     (hash — valor bruto nunca em texto puro)
   ├── operacao_id     (FK para cobrancas_pix)
   ├── criado_em
   ├── expira_em       (janela curta — valor exato de 24h/48h fica como
   │                    decisão menor, não bloqueia o desenho)
   ├── usado_em        (nullable — reivindicação atômica)
   └── resultado        (nullable — sucesso/falha, preenchido após o clique)
   ```
   Removido, deliberadamente, o campo `dados_identificados` (jsonb de
   OCR) do desenho antigo — não faz sentido carregar dado extraído de
   imagem quando a cadeia PagBank → cobrança → valor → operação já
   entrega tudo que é necessário.

   **Reconsulta ao PagBank no momento do clique — decisão nova, não
   coberta pelo desenho antigo:** antes de executar a renovação
   (Rocket), o backend reconsulta o estado atual da cobrança
   diretamente no PagBank — não confia só na confirmação que gerou o
   token minutos/horas antes.
   ```
   PagBank confirma PAID → gera token → cliente recebe botão → clique
        ↓
   reconsulta PagBank
        ↓
   continua PAID? ── NÃO → não renova
        │
       SIM
        ↓
   Rocket → renovação
   ```
   **Importante, para não overinterpretar:** esta decisão não presume
   que um pagamento `PAID` possa reverter — é uma defesa de segurança
   (reconsultar a fonte de verdade antes de uma ação irreversível),
   independente da resposta a essa pergunta. Se um dia for confirmado
   que `PAID` é definitivamente final nesse contexto, a segunda
   consulta continua sendo uma defesa válida, sem custo relevante.

   **Mantido do desenho antigo, sem mudança:** uso único (`usado_em`
   nullable) + reivindicação atômica (`UPDATE ... WHERE usado_em IS
   NULL RETURNING ...`, mesmo mecanismo já comprovado em produção no
   `assumir_atendimento`, testado sob concorrência real).

   **Ainda em aberto, não resolvido por esta decisão:**
   - Valor exato da janela de expiração (24h vs. 48h ou outro) —
     decisão menor, de implementação/configuração.
   - Se a reconsulta ao PagBank no clique pode reverter/estornar um
     `PAID` já confirmado — não confirmado, não bloqueia a decisão
     acima (seção "Importante" logo acima).
   - `cobrancas_pix` em si continua sem tabela real criada — mesma
     situação já registrada, não resolvida por esta lacuna.

   [decisão registrada nesta sessão; desenho original em
   `2026-08-21_gatilho_meta_renovacao.md`, seções 3–8; nenhuma
   tabela/migration existe hoje, confirmado por busca real no
   repositório `inovatv-api-intermediaria`]

5. ~~Onde hospedar a tela de confirmação/clique do cliente~~ —
   **DECIDIDO (22/08/2026): Edge Function pura, servindo HTML
   diretamente — não Next.js do Painel.**

   **Achados que fundamentaram a decisão (infraestrutura real, não
   suposição):**
   - `AuthGuard` do Painel é **client-side apenas** (V1, sem middleware/
     SSR) — rotas fora dele já são públicas por padrão; `/reset-password`
     é precedente real de rota pública no mesmo projeto Next.js.
   - **Nenhuma Edge Function hoje serve HTML** (busca real no código:
     zero ocorrências de `text/html`/`Content-Type` fora de
     `jsonResponse`/`errorResponse`) — confirmado que é um **padrão
     novo**, não extensão de algo já testado.
   - O princípio já registrado pro Painel ("100% estático, toda lógica
     de negócio mora nas Edge Functions") significa que, mesmo se a
     tela vivesse no Next.js, a lógica real (token, PagBank, Rocket,
     segredos) **continuaria obrigatoriamente numa Edge Function** — o
     Next.js seria só uma casca de UI chamando essa mesma function via
     `fetch()` cross-origin (exigindo CORS de novo, sem a proteção de
     autenticação que os `painel-atendimento-*` têm hoje, já que esta
     tela nunca tem sessão).

   **Motivo da escolha:** não mistura uma página pública de cliente
   final com o projeto do Painel (ferramenta interna da equipe);
   elimina a camada extra Next.js→Edge Function+CORS que não muda onde
   a lógica sensível vive; o trade-off (escrever HTML/CSS à mão numa
   function, sem reaproveitar o visual do Painel) é pequeno — é uma
   tela simples (dados + botão), não uma interface rica. **Registrado
   explicitamente: HTML/CSS numa Edge Function é implementação nova
   neste projeto, mas não uma lacuna arquitetural — só um padrão ainda
   não exercitado aqui.**

   **Fluxo decidido:**
   ```
   Token
     ↓
   Edge Function
     ├── GET  → valida token → consulta estado → renderiza página
     │           NÃO executa renovação (garantia estrutural, já
     │           decidida no desenho do token — Lacuna 4)
     │
     └── POST → reivindica token atomicamente
                 ↓
              reconsulta PagBank (Lacuna 4)
                 ↓
              reconsulta estado atual
                 ↓
              executa Rocket
                 ↓
              retorna resultado
   ```

   **Separação de responsabilidade, explícita:** HTML da página =
   apresentação; Edge Function = toda a lógica e os segredos. Nenhum
   segredo (`service_role`, sessão do Vault, chaves) chega ao HTML/
   cliente em nenhum momento — só roda no backend da própria function.

   **Requisitos de segurança confirmados como já resolvidos pelo
   desenho existente, sem necessidade de mecanismo novo:**
   - **CSRF:** não se aplica no sentido tradicional (sessão/cookie) — o
     próprio token de uso único, entregue por link privado no
     WhatsApp, já é a credencial (mesmo padrão de link mágico usado em
     reset de senha/unsubscribe).
   - **Cookies/sessão do Painel:** nenhum — esta tela nunca autentica
     por sessão Supabase Auth, diferente das rotas internas do Painel.
   - **Exposição do token na URL:** inerente ao desenho já decidido
     (Lacuna 4), não muda com a hospedagem — mitigado pela garantia de
     que GET nunca executa nada.

   [decisão registrada nesta sessão; comparação original em
   `2026-08-22_comparacao_decisoes_fluxo_confirmacao.md`, Decisão 1;
   infraestrutura real conferida em `inovatv-api-intermediaria/painel/`
   e busca por `text/html` em `supabase/functions/`]

6. ~~Generalizar o mecanismo de renovação comprovado em código de
   produção reutilizável~~ — **PERGUNTA-CHAVE RESOLVIDA (22/08/2026):
   não precisa de Playwright/Chromium.**

   **Achado prévio importante, antes da POC:** a documentação existente
   (`2026-08-21_renovacao_automatica_painel_primeiro.md`, seção 14)
   tinha uma frase de conclusão dizendo que a cadeia foi comprovada
   "sem navegador" — **isso não era exato**. Só a leitura (`GET
   /sigma/info/`) tinha sido comprovada por HTTP puro; a renovação em
   si (`POST /pagamento/add/`) **sempre** usou Playwright em todos os
   testes até então (21/08 e a POC desta mesma sessão, seção 8, antes
   desta lacuna) — por conveniência (o JS do Rocket calcula os valores
   na tela), nunca porque foi comprovado que HTTP puro falha. Registrado
   aqui para não repetir essa imprecisão em documentos futuros.

   **POC controlada real, executada e concluída nesta sessão:** uma
   Edge Function temporária e descartável (`poc-http-direto-renovacao`,
   deployada, testada, **já apagada** — Supabase + arquivo local, mesmo
   padrão já usado em `debug-fields`/`whatsapp-diag`/
   `poc-pagbank-consulta`) leu a sessão do Vault (`rocket_sessao_ler`,
   nunca exposta fora do backend), consultou `/sigma/packages/` (achado
   real de formato, não documentado antes: a lista vem em
   `data.packages`, não em `data` diretamente), montou o corpo do POST
   reaproveitando valores já confirmados ao vivo mais cedo na mesma
   sessão (plano/valor/forma de pagamento/telas/custo), calculando
   `vencimento` com a mesma função `somarPeriodo` já existente no
   código real (`poc-confirmacao-renovacao/index.ts`), e **omitiu o
   campo `enviar_mensagem` do corpo** (mesmo comportamento de um
   checkbox HTML desmarcado — nunca enviado como `"false"`).

   **Resultado, critério de sucesso completo, os três juntos:**
   ```
   POST /gerenciador/pagamento/add/ (fetch puro, Deno, sem navegador)
        ↓ 302 (mesmo padrão de sucesso já visto via browser)
   Sigma reconsultado de forma independente: 2027-01-09 → 2027-02-09
   (+1 mês exato, renovação real confirmada)
        ↓
   Rocket: vencimento atualizado, novo pagamento real criado (7155044)
        ↓
   Confirmado pelo usuário: nenhuma mensagem chegou no WhatsApp do
   cliente de teste vinda do RocketZap
   ```

   **Conclusão: o mecanismo de produção não precisa de Playwright,
   Chromium, nem de um serviço de execução separado.** Uma Edge
   Function (Deno) usando `fetch()` com a sessão já guardada no Vault é
   suficiente para reproduzir exatamente o comportamento já comprovado
   (`renovar_painel=true`, `enviar_mensagem` ausente, renovação real do
   Sigma, sem disparo do RocketZap). Isso simplifica bastante a
   arquitetura desta lacuna em relação ao que parecia antes da POC.

   **O que ainda falta, não resolvido por esta POC (trabalho de
   implementação, não mais uma dúvida de arquitetura):**
   - Generalizar a function descartável usada no teste (hoje com
     cliente/pacote fixos) para receber `operacao_id`/`public_id`/
     pacote como entrada real, chamada a partir do endpoint de clique
     (Lacuna 5), não como script isolado.
   - Tratamento de erro/sessão inválida no momento da chamada — já
     desenhado na Lacuna 4 (não marca token como consumido, "tente
     novamente"), mas ainda não implementado neste mecanismo
     especificamente.
   - Decidir se `sigma_package_id` sozinho já é suficiente pro cálculo
     de `vencimento`/`custo` no corpo do POST ser aproximado (como
     feito na POC) sem risco, ou se vale confirmar com mais casos reais
     — a POC funcionou de primeira, mas foi uma única execução.

   [fontes: `2026-08-22_achado_separacao_renovar_painel_enviar_mensagem.md`;
   `2026-08-22_levantamento_gatilho_pagamento_confirmado.md`, seções 3-4;
   POC real executada e documentada nesta sessão, código já removido do
   repositório]

7. ~~`{VALOR}` sem fonte de conferência independente~~ — **DECIDIDO
   (22/08/2026): regra de negócio, não decisão de produto em aberto.**

   **Achado real que fundamentou a regra:** o campo `valor` ("Valor
   Combinado" na UI) existe **por cliente** no Rocket (`ClienteSchema`,
   `rocket_gestor_openapi.json`), e **diverge de fato do catálogo
   padrão** — confirmado com dado real de produção visto nesta mesma
   sessão (clientes reais pagando "Mensal R$ 30,00" em vez do R$ 35,00
   padrão, ex.: condição especial/múltiplos pontos). Usar o preço do
   catálogo (`/planos/`) como autoridade teria cobrado errado desses
   clientes.

   **Regra de negócio fechada, para o fluxo de renovação do plano
   atual (não plano novo, ver abaixo):**
   ```
   Cliente identificado (public_id)
         ↓
   consultar cliente no Rocket (GET /gerenciador/api/v1/cliente/{public_id},
   mesma API pública ROCKET_API_KEY já usada em poc-confirmacao-renovacao —
   NUNCA a /status que alimenta a IA, allowlist dela permanece intocada)
         ↓
   ler valor ("Valor Combinado" do cliente) = valor esperado da cobrança
         ↓
   criar cobrança PagBank com esse valor
         ↓
   PagBank confirma o valor realmente pago
         ↓
   valor esperado == valor pago? ── NÃO → nunca renova automaticamente
         │
        SIM → continua
   ```
   **Fonte de verdade: o valor efetivamente cadastrado/negociado para
   aquele cliente no Rocket — nunca o catálogo (`/planos/`), nunca
   OCR/comprovante, nunca uma regra de preço embutida no Gemini ou no
   Validador.** O catálogo continua servindo só para identificar
   plano/período (já usado assim em `poc-confirmacao-renovacao`), não
   como autoridade de preço individual.

   **Sem fallback pro preço padrão do catálogo.** Se `valor` estiver
   ausente/nulo no cadastro do cliente (schema real confirma que é
   permitido ser nulo) ou não puder ser determinado com segurança,
   **não cria cobrança automaticamente — encaminha para atendimento
   humano.** Inventar o preço é exatamente o que esta regra existe
   para evitar.

   **Comparação PagBank × valor esperado:** mecanismo já desenhado
   anteriormente, não é novo — grava o valor esperado em
   `cobrancas_pix` no momento da criação, compara contra `charge.amount`
   na reconsulta, divergência → nunca renova automaticamente, marca
   `valor_divergente`, aciona transferência humana.
   [`2026-08-22_desenho_pagbank_fluxo_renovacao.md`, seção 8]

   **Fora do escopo desta lacuna, deliberadamente:** mudança/upgrade
   para um plano **novo** (diferente do atual) — fica fora deste fluxo,
   tratado como fluxo separado do atendimento, já existente por outro
   caminho. Esta lacuna cobre só renovação do plano que o cliente já
   tem.

   [decisão registrada nesta sessão; achado de divergência de valor
   confirmado com dado real de produção; schema conferido em
   `inovatv_central/docs/rocket_gestor/rocket_gestor_openapi.json`
   (`ClienteSchema`, `PlanoSchema`); `/status` (`_shared/rocket_intermediaria.ts`,
   `StatusCliente`) confirmado sem `valor`, allowlist intocada]

8. ~~Texto da mensagem intermediária~~ — **DECIDIDO (22/08/2026), com
   uma correção de escopo em relação ao texto original desta lacuna.**

   **Correção de escopo, para não confundir duas mensagens
   diferentes:** o texto original desta lacuna citava "recebi, estou
   conferindo" — essa é a mensagem do **passo 3** do fluxo (seção 2),
   quando o cliente manda o **comprovante**, depois que a cobrança já
   existe. **O que foi decidido agora é outra mensagem, de outro ponto
   do fluxo:** a resposta logo após o Gemini reconhecer
   `tipo="propor_renovacao"` (passo 0-B/1), **antes** de a cobrança
   existir — exatamente o item que tinha ficado em aberto na Lacuna 2
   ("texto exato da resposta intermediária/neutra"). A mensagem
   "recebi, estou conferindo" (comprovante, passo 3) **continua sem
   texto fechado** — não resolvida aqui, fica como pendência separada,
   menor (mesmo padrão de mensagem informativa já usado em outros
   pontos do prompt congelado, não deve exigir uma decisão própria tão
   extensa quanto esta).

   **Decisões fechadas, para a mensagem de "propor_renovacao" (antes
   da cobrança existir):**

   1. **Mensagem fixa/determinística, não gerada pelo Gemini** — mesmo
      raciocínio já usado na mensagem de transferência (Componente 1
      §16): representa uma ação real do sistema ainda em andamento,
      melhor ter garantia determinística do que depender da
      interpretação do modelo. **Texto provisório aprovado** (copy
      final fica para depois, mesma disciplina já usada em outros
      textos fixos do projeto):
      ```
      Certo! Vou preparar seu pagamento via Pix. Só um momento...
      ```
   2. **Se o cliente manda outra mensagem enquanto a cobrança está
      sendo criada:** não repetir automaticamente essa mensagem fixa.
      Se a nova mensagem perguntar especificamente sobre o andamento
      do pagamento/preparação, responder informando o estado atual.
      Se for outro assunto qualquer, **segue o atendimento normalmente
      — "cobrança em andamento" é estado da operação de pagamento, não
      um novo estado de atendimento que bloqueia a conversa** (ex.:
      "meu vencimento é quando?" continua sendo respondido normalmente
      enquanto a cobrança é preparada em segundo plano).
   3. **Segunda mensagem (cobrança criada com sucesso) também é
      fixa/estruturada**, preenchida exclusivamente com dados reais da
      cobrança (nunca gerada pelo Gemini) — mesmo padrão já usado no
      template `pagamento_confirmado`:
      ```
      Pronto! Aqui está o Pix para renovar seu plano: R$ [valor]
      [código/QR]
      ```
      Inclui a informação de que a renovação só será confirmada depois
      que o PagBank reconhecer o pagamento (reforça o princípio das
      duas confirmações, seção 3 deste documento).
   4. **Falha na criação da cobrança** → aciona transferência humana,
      reaproveitando o mecanismo genérico já existente no projeto
      (nunca falha silenciosamente) — **nunca afirma que a cobrança
      foi criada** quando não foi.

   [decisão registrada nesta sessão]

9. ~~Casos de borda~~ — **MATRIZ COMPLETA LEVANTADA, TRÊS DECISÕES
   FECHADAS (22/08/2026).**

   **Já cobertos por decisões existentes, sem trabalho novo de
   decisão** (matriz completa de investigação, resumida aqui):
   cliente não identificado, múltiplos acessos sem determinar qual,
   cliente sem `valor` cadastrado (Lacuna 3/7); token expirado, token
   já utilizado, dois cliques simultâneos (reivindicação atômica, já
   testada sob concorrência real em produção no `assumir_atendimento`)
   (Lacuna 4); valor pago ≠ esperado (Lacuna 7); webhook duplicado
   (fora de escopo — este fluxo usa reconsulta ativa, não webhook,
   `2026-08-22_desenho_fluxo_corrigido_duas_confirmacoes.md` seção 2);
   Rocket retorna sucesso HTTP mas Sigma não confirma (mesma disciplina
   já usada em toda POC — `poc-confirmacao-renovacao`, nunca confia só
   no HTTP, sempre reconsulta); sessão Vault expirada/inválida
   (monitoramento já implementado e testado); reutilizar botão antigo,
   outra mensagem durante/depois da cobrança, cliente pede outra coisa
   durante a operação (Lacuna 8 — "cobrança em andamento não bloqueia
   a conversa geral", estendido também ao estado "aguardando
   pagamento").

   **Regras pequenas, novas mas de baixo risco (decorrentes de
   princípios já usados em outros pontos do projeto, não escolhas
   novas em aberto):**
   - Cada `operacao_id` (cobrança) gera exatamente um único token,
     nunca reaproveitado entre cobranças diferentes (o desenho antigo
     de reaproveitar token por sync já está marcado obsoleto, Lacuna 4
     — esta é a regra positiva equivalente pro fluxo novo).
   - PagBank indisponível durante a reconsulta (timeout/rede) → mesma
     resposta já usada pra sessão Rocket inválida: não marca o token
     como consumido, mostra "tente novamente".
   - Cliente manda o comprovante da própria cobrança em vez de clicar
     no link → a IA pode lembrar que falta clicar no link, em vez de
     tratar como um comprovante avulso do Caminho Excepcional (texto
     exato não decidido).

   **Registrado, sem mecanismo novo necessário — só confirmação
   pendente:** quais valores de `status` o PagBank pode retornar além
   de `PAID` (`CANCELED`/`DECLINED`/etc.) nunca foram todos observados
   — a regra geral ("≠ `PAID` → não renova") já cobre isso na prática,
   mas vale confirmar com mais casos reais quando surgirem.

   ### As três decisões fechadas

   **1. PagBank `PENDING` no clique — token permanece utilizável, não
   é consumido definitivamente.**
   ```
   clique → reivindica/entra em processamento → consulta PagBank
        ↓
      PENDING
        ↓
   não renova, mas o token continua disponível (enquanto não expirado
   e a operação continuar a mesma) → cliente pode tentar de novo
   depois de pagar de verdade
   ```
   **Nota de implementação registrada, não resolvida aqui:** isso
   exige distinguir "tentativa de processamento" de "token consumido/
   concluído" — a estrutura simples de `usado_em` (nullable) desenhada
   na Lacuna 4 não basta sozinha pra essa distinção. **A estrutura da
   tabela `tokens_renovacao` não foi alterada nesta etapa** — fica como
   trabalho de implementação futuro, sem nova decisão de arquitetura
   necessária agora (só desenho de schema mais detalhado quando chegar
   a hora de implementar).

   **2. Uma cobrança de renovação pendente por vez, por acesso — nunca
   por telefone/cliente.**
   > Para um acesso específico, só pode existir uma cobrança de
   > renovação pendente por vez. Se o cliente pedir renovação de novo
   > enquanto já existe uma cobrança pendente **para aquele mesmo
   > acesso**, não cria outra automaticamente.

   Vinculado ao **acesso** (não ao telefone/cliente) porque um mesmo
   cliente pode ter múltiplos acessos (Lacuna 3) — cada acesso tem seu
   próprio ciclo de cobrança independente. Depois que uma cobrança é
   concluída (paga e renovada, ou expirada/cancelada), uma nova
   solicitação já é uma operação legítima nova, sem restrição.

   **3. Resultado desconhecido na chamada ao Rocket — nunca retry
   automático.**
   ```
   token autorizado → Rocket chamado → resultado desconhecido
        ↓
   NUNCA chama o Rocket de novo automaticamente
        ↓
   GET /sigma/info/ (mesma reconsulta já comprovada em toda a
   investigação)
        ↓
   determina com segurança que renovou? ── SIM → registra sucesso
        │
        NÃO (sem certeza) → transferência humana, com instrução
        explícita de reconsultar o Sigma antes de qualquer ação
        corretiva — nunca "tenta de novo às cegas"
   ```
   **Por que isso é seguro e não exige mecanismo novo:** a reivindicação
   atômica do token já acontece **antes** da chamada ao Rocket (ordem
   já fixada no desenho do clique, Lacuna 4/5) — isso já impede que o
   mesmo link seja reexecutado, mesmo em caso de falha de confirmação.
   O que faltava era só formalizar que, diante de incerteza, a
   reconsulta ao Sigma (já testada e comprovada, não uma capacidade
   nova) é o próximo passo — nunca um retry automático da ação real.

   [decisões registradas nesta sessão; matriz completa de investigação
   cobriu identificação/operação, PagBank, Rocket/Sigma e conversação,
   cruzando com as Lacunas 1-8 e os documentos originais
   (`2026-08-22_desenho_pagbank_fluxo_renovacao.md` seção 8;
   `2026-08-21_gatilho_meta_renovacao.md` seções 8-10;
   `2026-08-22_comparacao_decisoes_fluxo_confirmacao.md`, seção
   "Detalhamento pedido")]

10. ~~Migração do número oficial para a Cloud API~~ —
    **DIAGNÓSTICO FECHADO (22/08/2026), execução explicitamente NÃO
    autorizada agora.**

    **O que a migração resolve × o que não resolve, separado com
    clareza:** as Lacunas 1-9 já fecharam o mecanismo de renovação
    (PagBank → confirmação → botão → Rocket/Sigma → Cloud API) de
    forma **praticamente independente** da migração — a migração é o
    que permite esse mecanismo alcançar **clientes reais**, não uma
    peça técnica da renovação em si. Renovação do Sigma, confirmação
    do PagBank, lógica do token, regras do Gemini/Validador — nenhuma
    dessas depende de qual número está na Cloud API.

    **Achado central: sem coexistência, migrar é um corte definitivo
    para TODAS as ~15 mensagens automáticas do RocketZap hoje** (3
    famílias: Cobranças/lembretes, Testes, Eventos pontuais), não só
    para o `pagamento_confirmado` que este documento resolve. Das 15,
    hoje só `pagamento_confirmado` está pronta/testada;
    `vencimento_hoje` está aprovada mas reclassificada Marketing, **sem
    motor de agendamento real construído** (só POC manual descartável);
    as demais nunca foram submetidas.

    **Regra operacional fechada, para não migrar por impulso:**
    > **A migração do número oficial não será executada enquanto as
    > comunicações essenciais atualmente dependentes do RocketZap não
    > tiverem substituto funcional na nossa infraestrutura, ou enquanto
    > não houver decisão explícita de aceitar sua ausência temporária.**

    **Motor mínimo de lembretes de vencimento — tratado como
    pré-requisito da MIGRAÇÃO, não como requisito da arquitetura de
    renovação** (que já está fechada, Lacunas 1-9). Não significa
    reconstruir as 15 mensagens do RocketZap — só o mínimo considerado
    operacionalmente indispensável (lembretes de vencimento e
    comunicações ligadas a pagamento/renovação, no mínimo).

    **Investigação específica sobre histórico de conversas — concluída,
    com fonte oficial (Meta for Developers, `developers.facebook.com/
    docs/whatsapp/cloud-api/get-started/migrate-existing-whatsapp-number-to-a-business-account/`):**
    - **Confirmado, não mais incerto:** se a conta do WhatsApp Business
      App do número oficial for apagada e o número registrado direto na
      Cloud API (mesmo caminho já usado no número de teste), **o
      histórico de mensagens é perdido permanentemente**, e o número
      **não pode voltar a ser usado no WhatsApp Business App**, a menos
      que seja desregistrado da Cloud API antes.
    - **A própria Meta recomenda backup do histórico antes de migrar**
      (guias oficiais de backup Android/iOS) — a perda é esperada e
      documentada por eles, não uma falha nossa de processo.
    - **Reversibilidade:** existe um caminho técnico (`/deregister`,
      já usado nesta investigação pra outro fim), mas nada garante que
      o app volte a mostrar o histórico antigo depois — só o backup
      feito antes disso é recuperável.
    - **Única forma de preservar histórico automaticamente:** onboard
      via parceiro que suporta "business app number onboarding" —
      variante de Coexistence, já decidida como fora de escopo (custo/
      complexidade do Tech Provider + Embedded Signup).
    - **O que continua desconhecido:** se um backup feito antes é
      restaurável de volta no mesmo número depois de reinstalar o
      WhatsApp Business App (a documentação recomenda backup, mas não
      detalha o processo de restauração pós-migração) — não investigado
      além do que a fonte oficial já cobre.

    **Capacidades de comunicação do novo canal — levantamento
    adicional (22/08/2026), corrigindo uma avaliação inicial excessivamente
    cautelosa sobre chamadas.** A Cloud API não fica limitada a texto —
    confirmado, documentação oficial já usada em código real deste
    projeto (`gemini_client.ts` já processa mídia inline) e/ou
    documentação pública da própria Cloud API:

    | Capacidade | Situação |
    |---|---|
    | Texto | ✅ já em produção neste fluxo |
    | Áudio (receber/enviar mensagem) | ✅ suportado pela Cloud API — recepção já usada pelo Gemini (`MidiaAnexada`); envio pelo Painel ainda não implementado |
    | Imagem | ✅ suportado — mesma situação do áudio |
    | Vídeo (como mensagem/arquivo) | ✅ suportado pela Cloud API para envio de mensagem — **nunca decidido no escopo do projeto** (CLAUDE.md registra vídeo como deliberadamente fora do escopo da IA própria) |
    | Documento | ✅ suportado — mesma situação de áudio/imagem |
    | Localização/contatos/mensagens interativas (botões) | ✅ suportado pela Cloud API — nunca avaliado/testado neste projeto |
    | Templates | ✅ já em uso (`pagamento_confirmado` etc.) |

    **Chamada de voz/vídeo — distinção rigorosa entre o que está
    comprovado pela documentação oficial e o que ainda precisa ser
    validado na conta da InovaTV especificamente** (fonte:
    `developers.facebook.com/documentation/business-messaging/whatsapp/calling`,
    consultada nesta sessão):

    **Comprovado pela documentação oficial atual:**
    - A **WhatsApp Business Calling API** existe de verdade e está em
      produção — não é mais hipótese nem "a validar se existe".
    - Suporta **voz**; chamada iniciada pelo cliente é suportada "em
      todo lugar onde a Cloud API está disponível" (inclui Brasil).
    - Chamada iniciada pela empresa também é suportada, com regras
      próprias de disponibilidade por país (Brasil não está na lista
      de países bloqueados para esse tipo).
    - **Vídeo e compartilhamento de tela estão documentados pela
      própria Meta, mas marcados com asterisco como "em
      desenvolvimento"** — existem no roteiro oficial, não devem ser
      tratados como indisponíveis, mas também não como maduros/prontos
      quanto voz.

    **Ainda precisa ser validado especificamente na conta/número da
    InovaTV, não presumido nem em um sentido nem no outro:**
    - Elegibilidade do número para habilitar Calling.
    - **Limite mínimo de 2.000 destinatários únicos de mensagem** —
      requisito real documentado pela Meta. **Não registrar que a
      InovaTV atende ou não atende esse número** — ninguém mediu isso
      ainda. Fica como pré-requisito a confirmar, não como fato
      resolvido em qualquer direção.
    - Inscrição no webhook `calls` — não implementado.
    - Habilitação de "Calling features" nas configurações do número —
      não feita.
    - Funcionamento real, ponta a ponta, no número de teste — nunca
      testado.

    **Posicionamento desta capacidade em relação à migração, fechado
    nesta sessão:** Calling é uma **capacidade adicional a homologar no
    número de teste**, não um pré-requisito da migração do número
    oficial. O número de teste vira, na prática, o ambiente de
    homologação completo — não só do fluxo PagBank→Rocket→Cloud API
    (Lacunas 1-9), mas também da experiência de atendimento multimídia
    e, se a conta for elegível, de chamadas — antes de qualquer coisa
    chegar ao número oficial.

    **Decisões operacionais mantidas explicitamente em aberto, não
    resolvidas por mim:**
    1. Quais mensagens, exatamente, precisam estar substituídas antes
       da migração (lista final).
    2. Confirmação de que José aceita operar exclusivamente pelo
       Painel de Atendimento, sem o WhatsApp App como fallback.
    3. Se/como fazer o backup do histórico do número oficial antes de
       qualquer migração — decisão e execução do próprio José, não
       técnica deste documento.
    4. Matriz de capacidades de comunicação (áudio/imagem/vídeo/
       documento/interativos/Calling) a homologar no número de teste
       antes da migração — lista de itens levantada acima, sequência e
       critério de "pronto" ainda não definidos.

    **Nada migrado, nenhuma configuração de Meta/WhatsApp/Rocket
    alterada, nenhum deploy, nenhuma POC.**

    [fontes: `inovatv_central/CLAUDE.md` (histórico completo da saga de
    registro do número de teste, matriz de migração RocketZap);
    documentação oficial Meta for Developers sobre migração de número
    existente pra Cloud API, consultada nesta sessão]

## 9. O que este documento explicitamente não faz

Não implementa nada, não altera prompt de sistema, não cria tabela,
migration, Edge Function ou tela, não decide nenhuma das lacunas da
seção 8, não reabre nenhuma investigação já concluída (renovação
Sigma, consulta PagBank, casos reais). É só o registro consolidado do
fluxo-alvo e do que falta para chegar lá.
