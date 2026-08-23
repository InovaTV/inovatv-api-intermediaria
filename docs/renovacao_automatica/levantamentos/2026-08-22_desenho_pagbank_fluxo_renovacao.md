# Desenho — PagBank como Caminho Principal de Renovação (revisão do fluxo comprovante→confirmação)

> **Isto é desenho arquitetural, não implementação.** Nenhum código,
> migration, deploy, cobrança ou renovação real executada. Decisão de
> produto (adotar PagBank Pix, aceitando a taxa) **já aprovada e não
> reaberta aqui** — este documento só desenha a arquitetura em cima
> dela. Reaproveita fatos técnicos **já confirmados** em
> `docs/pagamentos/POC_PAGBANK_UNITV_TESTE_013_PONTA_A_PONTA.md` e
> `docs/pagamentos/PAGBANK_IDEMPOTENCIA_E_RETRY.md`
> (`inovatv-api-intermediaria`) — nada inventado sobre a API do
> PagBank; onde algo não está confirmado, está marcado explicitamente.

## 0. Fatos técnicos já confirmados sobre o PagBank (não inventados, reaproveitados dos documentos reais)

- **`reference_id`** — campo enviado por **nós** na criação do pedido;
  único campo do payload totalmente sob nosso controle. **Confirmado
  que o PagBank NÃO deduplica nem rejeita `reference_id` repetido** —
  aceitou duas cobranças reais e independentes com o mesmo valor.
  Isso significa: `reference_id` sozinho **não é** mecanismo de
  idempotência do lado do PagBank — a proteção precisa ser nossa
  (seção 8).
- **`charge.id`** — identificador real da cobrança/tentativa
  específica, gerado pelo PagBank. **É a chave certa de deduplicação**
  no recebimento do webhook — nunca `order.id` (um pedido pode ter
  mais de um evento de status ao longo da vida).
- **`end_to_end_id`** — identificador do Banco Central (SPI), não
  emitido pelo PagBank; útil como referência cruzada/suporte.
- **Payload do webhook = o próprio recurso `order` inteiro**, não um
  envelope de evento enxuto.
- **Autenticidade:** só existe `x-authenticity-token` (sem HMAC
  confirmado); mecanismo exato **não confirmado na documentação
  oficial** — ver seção 11. A defesa real proposta (e não implementada)
  é sempre **reconsultar o status direto na fonte** (link `SELF` do
  charge, com API key real) antes de agir — nunca confiar só no corpo
  do webhook.
- **Retry real observado:** até 3 tentativas, backoff crescente
  (~2min → ~4min), todos os identificadores estáveis entre tentativas
  — comportamento real, não deve ser tratado como contrato garantido
  além do que foi observado.
- **Duas camadas de idempotência já desenhadas** (não implementadas) —
  reaproveitadas neste documento, seção 8.

## 1. Caminho Principal — PagBank

```
nossa infraestrutura decide cobrar (seção 6: quem/quando decide isso
  ainda em aberto)
        ↓
cria pedido/cobrança no PagBank, com reference_id = operacao_id
  nosso (UUID, Camada 1 de idempotência, seção 8), valor = preço do
  plano real (seção 7)
        ↓
envia o QR/código Pix ao cliente (texto livre se dentro de janela de
  24h, ou template próprio se fora — mesma lógica já usada no resto
  do projeto)
        ↓
cliente paga
        ↓
PagBank envia webhook (charge.status = PAID)
        ↓
Camada 2 de idempotência (seção 8): charge.id já visto? → no-op
        ↓
reconsulta o status na fonte (link SELF, nunca confia só no webhook)
        ↓
confirma reference_id → nosso operacao_id → cliente/renovação
  associados (seção 6)
        ↓
executa a extensão REAL do serviço (seção 10 — gap ainda aberto pra
  servidores Sigma; já resolvido pra UniTV)
        ↓
atualiza o Rocket (registro/gestão, PATCH via ROCKET_API_KEY — nunca
  aciona RocketZap, seção 9)
        ↓
envia `pagamento_confirmado` (nós, nunca o RocketZap)
```

**Nenhuma leitura de imagem, nenhum OCR, nenhum clique de
confirmação do cliente neste caminho** — a fonte de verdade é o
próprio PagBank, reconsultado na origem.

## 2. O que se simplifica/elimina do desenho anterior, graças ao webhook

Comparado ao desenho de `2026-08-22_desenho_fluxo_comprovante_confirmacao_renovacao.md`:

- **Elimina** a necessidade do Gemini identificar/ler o comprovante
  pra este caminho — o PagBank já entrega tudo estruturado.
- **Elimina** a ambiguidade do `{VALOR}` — deixa de ser "lido de uma
  imagem, sem conferência independente" e passa a ser **o valor que
  nós mesmos definimos** ao criar a cobrança, confirmado pelo PagBank.
- **Elimina** a necessidade do link de uso único + tela de
  confirmação clicável **para este caminho especificamente** — o
  gatilho é o webhook, server-to-server, sem depender de o cliente
  clicar em nada. (O mecanismo de link/token continua existindo, mas
  migra de papel — vira parte do **Caminho Secundário**, seção 4, não
  mais do principal.)
- **Elimina** a ambiguidade de "qual cliente/acesso" — resolvida no
  momento da **criação** da cobrança (`reference_id` = nosso
  `operacao_id`, já amarrado a um cliente/acesso específico desde o
  início), não precisa ser inferida depois.
- **Não elimina** o problema de extensão real do serviço em
  servidores Sigma (seção 10) — isso é independente de qual mecanismo
  de pagamento dispara o processo.

## 3. Múltiplos acessos — como fica no caminho PagBank

Como a cobrança já nasce amarrada a um `operacao_id` que aponta pra
um cliente/acesso específico (decidido no momento da criação, não
inferido depois), **a ambiguidade de "múltiplos acessos" precisa ser
resolvida antes de criar a cobrança**, não depois — mesma regra já
existente (Componente 1 §8: nunca escolher um acesso sozinho),
aplicada num ponto mais cedo do fluxo.

## 4. Caminho Secundário — comprovante espontâneo (revisado, não descartado)

**Continua existindo**, mas como caminho de exceção/transição, não
mais o principal. Cenários reais em que ele continua necessário:
- Cliente que paga direto na chave Pix pessoal já divulgada (Nubank
  do José, mesma que aparece hoje no `Teste Grátis Iniciado`) em vez
  de usar a cobrança gerada pelo PagBank — comportamento que
  provavelmente continua acontecendo por um bom tempo, por hábito.
- Qualquer pagamento que chegue **sem passar pela nossa cobrança**
  (seção 8, "pagamento sem identificação").

**Desenho já aprovado anteriormente permanece válido pra este
caminho, sem mudança:** comprovante → Gemini identifica → Validador
confere → link de uso único → clique do cliente → renovação. O
mecanismo de token/link (`2026-08-21_gatilho_meta_renovacao.md`) que
antes seria o caminho principal **passa a servir só este caminho
secundário** — não descartado, só reposicionado.

## 5. Comparação — qual deve ser o fluxo principal de produção

| Critério | PagBank (Principal) | Comprovante espontâneo (Secundário) |
|---|---|---|
| Confiabilidade do valor | ✅ Exato, definido por nós | ⚠️ Lido de imagem, sem conferência independente |
| Confiabilidade da identidade | ✅ Resolvida na criação da cobrança | ⚠️ Inferida pelo Gemini, dependente de Validador |
| Ação do cliente necessária | Só pagar (nenhum clique extra) | Pagar + clicar em confirmar |
| Automação real (sem intervenção) | ✅ Sim, server-to-server | ⚠️ Depende do cliente clicar |
| Já testado com evidência real | ✅ Sim (UniTV, 2026-08-12) | ⚠️ Desenhado, nunca implementado |
| Cobre pagamento fora da cobrança nossa | ❌ Não | ✅ Sim — é exatamente o caso que resolve |

**Resposta direta: PagBank deve ser o fluxo principal de produção.**
O comprovante espontâneo continua como caminho de exceção — cobre o
cenário real de cliente pagando fora do fluxo que nós geramos, que
não desaparece só porque o principal mudou.

## 6. Associação pagamento → cliente — mecanismo, e o que ainda depende de decisão

`reference_id` = nosso `operacao_id` (UUID), gerado **no momento em
que decidimos cobrar aquele cliente por aquela renovação** — antes de
qualquer chamada ao PagBank (Camada 1, seção 8). Esse `operacao_id`
fica numa tabela nossa (`cobrancas_pix`, já proposta no documento de
idempotência) amarrado ao `public_id`/`conversation_id` do cliente.

**O que ainda não está decidido:** **quem/o que decide "vou cobrar
este cliente agora" e dispara a criação da cobrança.** Duas
possibilidades, nenhuma escolhida:
- Proativo — o próprio motor de lembretes (família Grupo 1 do
  inventário: Vence Hoje/Vence em 3 Dias/etc.) passaria a, em vez de
  só avisar, **já gerar a cobrança Pix junto** com o aviso.
- Reativo — só quando o cliente pede/responde que quer renovar, numa
  conversa aberta.
Provavelmente os dois, em momentos diferentes — **não decidido aqui**.

## 7. Planos e valores atuais — reaproveitados, não inventados

Já confirmados no texto real do "Teste Grátis Iniciado" (Rocket, lido
nesta mesma investigação):

| Período | Valor |
|---|---|
| 30 dias | R$ 35,00 |
| 90 dias | R$ 90,00 |
| 180 dias | R$ 180,00 |
| 365 dias | R$ 300,00 |

**Ponto a verificar, não assumido:** o mapeamento exato entre esses
períodos e os nomes de plano do Rocket (`Mensal`/`Trimestral`/
`Semestral`/`Anual`, vistos nos filtros de Cobrança) — plausível
(30↔Mensal, 90↔Trimestral, 180↔Semestral, 365↔Anual), mas não
confirmado 1:1. A fonte real e já testada pra isso é
`GET /gerenciador/api/v1/planos/` (já usada com sucesso nas POCs #1/#2)
— deveria ser consultada de novo no momento de gerar a cobrança, nunca
assumida por uma tabela fixa no código.

## 8. Casos de borda — idempotência e exceções

Reaproveita as duas camadas já desenhadas
(`PAGBANK_IDEMPOTENCIA_E_RETRY.md`, seção 3), com os casos extras
pedidos:

- **Pagamento duplicado (nós criamos 2 cobranças pra mesma renovação):**
  Camada 1 — `UNIQUE` em (assinatura/cliente, ciclo de cobrança) antes
  de chamar o PagBank, evita a causa. Se acontecer mesmo assim (ex.:
  cliente pagou pela cobrança E também mandou um Pix avulso pro
  caminho secundário), a defesa é **reconsultar o estado real do
  cliente antes de agir** (mesma disciplina já usada em
  `2026-08-21_gatilho_meta_renovacao.md`, "já renovado por outro
  caminho" — se o vencimento já avançou mais do que o esperado,
  aborta e não renova de novo às cegas).
- **Webhook repetido:** Camada 2 — `UNIQUE` em `charge.id`,
  insert-antes-de-agir (mesmo padrão já usado em
  `webhook_mensagens_processadas` do Componente 3). Segunda entrega
  → no-op, responde 200, nenhuma ação nova.
- **Pagamento de valor diferente do esperado:** **caso novo, não
  coberto nos documentos existentes.** Proposta: ao criar a cobrança
  (Camada 1), gravar o valor esperado em `cobrancas_pix`. No
  recebimento do webhook, depois da reconsulta na fonte, comparar
  `charge.amount` contra esse valor esperado — **se não bater, nunca
  renova automaticamente**, marca a cobrança como
  "valor_divergente" e aciona transferência humana (mesma disciplina
  de "nunca adivinha, sempre reprova" já usada em todo o Validador).
- **Pagamento sem identificação** (Pix recebido sem passar por uma
  cobrança nossa — ex.: cliente pagou direto na chave Pix pessoal, não
  via cobrança gerada): **não teria `reference_id` nosso associável.**
  Cai fora do Caminho Principal por definição — vira,
  necessariamente, o Caminho Secundário (comprovante/conversa), nunca
  um "encaixe automático" por tentativa e erro. **Ponto a verificar
  (seção 11):** se um Pix recebido fora de uma cobrança gera algum
  tipo de notificação do PagBank pra nós de qualquer forma, ou se
  passa despercebido pelo lado do PagBank inteiramente — não
  confirmado.
- **Pagamento já processado:** coberto pela Camada 2 (mesma
  `charge.id`, já teria `UNIQUE` constraint), no-op.
- **Idempotência preservada:** as duas camadas continuam
  independentes uma da outra — nenhuma substitui a outra (mesmo
  raciocínio já registrado no documento original).

## 9. Papel do Rocket e do RocketZap — revisado

- **Rocket:** continua sendo o cadastro/registro oficial — recebe um
  `PATCH` (via `ROCKET_API_KEY`, já comprovado 2x) **só pra manter os
  dados em sincronia** (o que José vê ao abrir o Rocket bate com a
  realidade). **Deixa de ser, nesta arquitetura, o mecanismo que
  decide se o cliente foi renovado** — quem decide isso agora é a
  reconsulta ao PagBank.
- **RocketZap:** **nunca mais é quem confirma a renovação ao
  cliente**, em nenhum dos dois caminhos. A confirmação sempre sai
  pela nossa própria infraestrutura (Cloud API, template
  `pagamento_confirmado`). Isso resolve de vez a tensão que existia
  antes entre "usar a sessão do Vault" (RocketZap confirma, mas
  prorroga o Sigma de verdade) e "usar PATCH direto" (nós
  confirmamos, mas sem prova de que prorroga o Sigma) — **PagBank
  como gatilho + PATCH só pra registro** já garante que somos nós que
  confirmamos; falta só resolver a extensão real do serviço (seção
  10), que é um problema técnico separado, não mais uma escolha entre
  dois caminhos de confirmação.
- **Objetivo final confirmado:** número oficial, nossa Cloud API,
  zero dependência do RocketZap — este desenho já aponta pra isso
  desde já, mesmo que a execução continue restrita ao número de teste
  por enquanto (decisão de corte já registrada como separada, seção 6
  do desenho de substituição original).

## 10. O que o PagBank NÃO resolve — gap crítico permanece, só muda de escopo

**Isto continua sendo a pendência técnica mais importante de toda a
investigação, já identificada antes do PagBank entrar no desenho.**
PagBank resolve com segurança total "um pagamento aconteceu, deste
valor, para este cliente" — mas **não resolve, sozinho, como estender
o serviço real do cliente**:

- **UniTV:** ✅ **Já resolvido e comprovado** — `poc-pagbank-unitv-renew`
  já combina os dois (webhook PagBank → renovação real no painel
  UniTV, confirmado por reconsulta independente). Estado atual da
  PoC: **possivelmente não funcional agora** — o `UNITV_DEALER_TOKEN`
  pode estar inválido desde a troca de senha do painel em 2026-08-16
  (consequência aceita conscientemente na época, não recapturado
  ainda).
- **Servidores baseados em Sigma (NewOne, Blaze, ChannelTV — a
  maioria dos clientes atuais de teste):** ❌ **Ainda não resolvido.**
  O único caminho já comprovado pra estender o Sigma de verdade é a
  sessão do Vault (`POST pagamento/add`), que **aciona o RocketZap
  junto** — contradiz o objetivo desta arquitetura. Um `PATCH` isolado
  no Rocket nunca teve confirmação de que prorroga o Sigma (mesmo
  achado já registrado antes do PagBank entrar no desenho). **Não
  existe, ainda, um caminho comprovado de estender o Sigma sem passar
  pelo RocketZap.**

## 11. Pontos a verificar — marcados explicitamente, nada inventado

1. **Mecanismo exato do `x-authenticity-token`** — não confirmado na
   documentação oficial do PagBank (já registrado como pendência no
   documento original).
2. **Mapeamento exato período↔nome de plano no Rocket** (seção 7) —
   plausível, não confirmado 1:1; a fonte real (`GET /planos/`) já
   existe e é testável.
3. **Se existe algum aviso do PagBank pra pagamento recebido fora de
   uma cobrança criada por nós** (seção 8, "sem identificação") — não
   confirmado.
4. **Se existe uma API direta do Sigma pra renovação, independente do
   Rocket** — investigação anterior (§15) só fez leitura do painel
   Sigma real (`painel.onetv.plus`), confirmou endpoints `/api/*` e um
   recurso `customers`, mas **nunca testou uma chamada de renovação
   direta** — só o caminho via Rocket (`pagamento/add`) foi
   comprovado.
5. **Status real do `UNITV_DEALER_TOKEN`** — pode estar inválido,
   não reconfirmado desde 2026-08-16.
6. **Comportamento do PagBank além da 3ª tentativa de retry** — não
   testado (já registrado no documento original).

## 12. Resumo do que este desenho fecha e do que ainda falta

**Fecha:** PagBank como caminho principal (comparação seção 5);
mecanismo de associação pagamento↔cliente (`reference_id` = nosso
`operacao_id`, seção 6); tratamento completo de idempotência e casos
de borda (seção 8); papel do Rocket restrito a registro, RocketZap
nunca mais confirma (seção 9); caminho secundário preservado como
exceção, não descartado (seção 4).

**Não fecha, decisão/investigação pendente:** quem/o que decide
disparar a criação da cobrança (seção 6); extensão real do serviço em
servidores Sigma (seção 10 — o gap mais importante, herdado, não
resolvido por este desenho); os 6 pontos a verificar (seção 11);
onde hospedar a lógica de criação de cobrança (Edge Function nova,
provavelmente, mas não especificada aqui).

**Nada implementado, nada submetido, nenhuma cobrança ou renovação
real criada nesta etapa. Taxa do PagBank aceita como decisão de
produto, não reaberta.**
