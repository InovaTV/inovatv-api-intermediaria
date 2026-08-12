# PagBank (Pix) — Idempotência e Comportamento de Retry do Webhook

> **Status: investigação concluída no Sandbox PagBank. A arquitetura
> proposta na seção 3 NÃO foi implementada nem aprovada como decisão
> final** — é uma proposta a ser revisada antes de qualquer código,
> mesma disciplina de "aprovação → implementação" já usada no
> `inovatv_central`. Nenhum arquivo de código foi alterado para
> produzir este documento.

## 0. Contexto

Investigação da renovação de assinatura via Pix usando a API de
Pedidos v4 do PagBank (`sandbox.api.pagseguro.com`), como parte da
integração que este repositório (`inovatv-api-intermediaria`) vai
hospedar — nunca a Central fala direto com o PagBank, mesmo principio
já aplicado à integração com o Rocket Gestor (README deste repo,
Decisão 050/051 em `inovatv_central`). Este documento cobre só a
perna de pagamento (PagBank/Pix); não duplica nem altera a arquitetura
de identidade/sincronização com o Rocket.

Dois testes reais foram executados no Sandbox, usando o Webhook.site
como receptor de notificação para observação:

1. **Teste 1 (fumaça):** criação de pedido → geração de QR Code →
   pagamento simulado → status `PAID` → webhook recebido. Resposta
   padrão do Webhook.site (200), sem reentrega.
2. **Teste 2 (retry):** o mesmo fluxo, mas com o Webhook.site
   reconfigurado para responder **HTTP 500** a toda requisição, para
   observar o comportamento de reenvio do PagBank.

## 1. Fatos comprovados (só o que foi observado nesta investigação)

### 1.1 Ciclo completo de cobrança Pix (Teste 1)

Confirmado de ponta a ponta no Sandbox:

- Criação de pedido (`order`) via API retornou `qr_codes[]` com o
  código Pix (`text`, formato BR Code) e links para PNG/base64.
- Simulação de pagamento no Sandbox marcou a `charge` associada como
  `PAID`.
- O PagBank enviou o webhook completo (o próprio recurso `order`
  atualizado, não um envelope de evento separado) para a
  `notification_url` configurada.

Evidência (Teste 1, pedido `ORDE_4A0ABF96-890D-4AB3-8B7F-75B03C103FFC`,
`reference_id = "TESTE-INOVATV-WEBHOOK-001"`):

```
charge.id            CHAR_18A49481-1BE4-4054-A82A-E84AF67CE98A
charge.status         PAID
payment_method.pix.notification_id   NTF_BCE6344F-A806-43D1-9382-9FB9FD9CD886
payment_method.pix.end_to_end_id     e505e9359a3e43cd8a0f02b374819ae6
```

### 1.2 Estrutura real do payload do webhook

O corpo é o recurso `order` inteiro (API de Pedidos v4), não um
envelope de "evento". Campos relevantes para correlação/idempotência,
confirmados nos dois testes:

| Campo | Origem | Observação |
|---|---|---|
| `id` (order) | PagBank | identifica o *pedido*; pode existir mais de um evento de status ao longo da vida de um pedido |
| `reference_id` (order e charge) | **nós** (enviado na criação) | único campo totalmente sob nosso controle |
| `charges[].id` | PagBank | identifica a *cobrança/tentativa* específica |
| `charges[].payment_method.pix.notification_id` | PagBank (Pix) | notificação específica do trilho Pix dentro do PagBank |
| `charges[].payment_method.pix.end_to_end_id` | **Banco Central (SPI)** | identificador único do Pix em todo o sistema financeiro nacional, não é emitido pelo PagBank |
| `charges[].links[].rel == "SELF"` | PagBank | URL para consulta server-to-server do status real da cobrança |

### 1.3 Headers reais enviados pelo PagBank

Confirmados em todas as entregas dos dois testes:

```
user-agent: Go-http-client/2.0
content-type: application/json
x-product-origin: ORDER
x-product-id: <order.id>
x-authenticity-token: <token de 64 caracteres hex>
```

Não existe nenhum header de assinatura HMAC calculada sobre o corpo
da requisição — o único mecanismo de autenticidade observado é o
`x-authenticity-token`. **Ver seção 2** sobre o que ainda não está
confirmado a respeito desse token.

### 1.4 Reentrega por falha do endpoint (Teste 2)

Webhook.site (`https://webhook.site/9fec9b8a-c1cd-4151-b115-66056cf84b64`)
configurado para responder HTTP 500 a toda requisição. Um novo pedido
foi criado via PowerShell, usando o mesmo Bearer token Sandbox dos
testes anteriores (token nunca exposto em arquivo ou documento).

**Resultado: o PagBank reenviou a notificação 3 vezes** para cada
cobrança paga, confirmando reentrega ativada por resposta não-2xx do
receptor:

| Cobrança | Tentativa 1 | Tentativa 2 | Intervalo 1→2 | Tentativa 3 | Intervalo 2→3 |
|---|---|---|---|---|---|
| `CHAR_D2CBBBCA-...` | 08:21:03 | 08:23:36 | 2min33s | 08:27:36 | 4min00s |
| `CHAR_75D1141A-...` | 08:21:21 | 08:23:36 | 2min15s | 08:27:37 | 4min01s |

Observações confirmadas sobre essas reentregas:

- **Todos os identificadores permanecem idênticos** entre as 3
  tentativas de uma mesma cobrança: `order.id`, `charge.id`,
  `reference_id`, `notification_id`, `end_to_end_id` e até o
  `x-authenticity-token` — nenhum campo é regenerado no reenvio.
- O intervalo entre tentativas **aproximadamente dobrou** (de ~2-2,5
  min para ~4 min) nas duas cobranças observadas.
- As duas cobranças, apesar de terem sido pagas em momentos diferentes
  e terem tentativas iniciais em horários diferentes, tiveram suas
  reentregas convergindo para o mesmíssimo segundo (ou 1 segundo de
  diferença) em ambas as rodadas — indício de que o reenvio funciona
  por varredura periódica de uma fila de pendências, não por um timer
  individual por notificação.
- `x-authenticity-token` variou entre as duas cobranças diferentes
  (`3252a75a...` vs. `dccda602...`), mas foi estável dentro da mesma
  cobrança entre as 3 tentativas — não é um segredo estático global
  idêntico para todas as notificações da conta.

### 1.5 Descoberta colateral: duas cobranças independentes com o mesmo `reference_id`

Durante o Teste 2, a inbox do Webhook.site recebeu notificações de
**duas cobranças Pix inteiramente distintas e realmente pagas**,
ambas carregando `reference_id = "TESTE-INOVATV-RETRY-001"`:

| | Pedido "B" | Pedido "A" |
|---|---|---|
| `order.id` | `ORDE_1F04373E-D8FA-4F87-BDBD-C9368B3B3530` | `ORDE_787D0486-A3C2-4F2B-8757-E876A52295D9` |
| `charge.id` | `CHAR_D2CBBBCA-F4B3-4516-9343-4F092FCAFC9A` | `CHAR_75D1141A-4671-4F49-8FA1-3D2B920B8E4B` |
| `notification_id` | `NTF_42D567BD-9445-48B6-8FC1-61FB697BE58E` | `NTF_F4A5D8EE-54A1-444D-A8FA-B54E3A4F910A` |
| `end_to_end_id` | `07f551a1e124439eaff0b2e51974b8e8` | `f7f15c38f7ad4fe08c874664cfaac77e` |
| pedido criado | 08:20:43.088 | 08:21:02.622 |
| cobrança/QR criada | 08:20:59.541 | 08:21:18.941 |
| pago | 08:21:01.319 | 08:21:20.180 |

**Fato comprovado: o PagBank não rejeita nem deduplica pedidos com
`reference_id` repetido.** Ele aceitou e processou as duas cobranças
como pagamentos totalmente independentes, cada uma com seu próprio
ciclo completo de notificações (3 tentativas cada, ver seção 1.4).

## 2. Questões ainda não fechadas (hipóteses, não fatos)

- **Mecanismo exato do `x-authenticity-token` não foi confirmado na
  documentação oficial atual do PagBank.** O comportamento observado
  (estável dentro da mesma cobrança, diferente entre cobranças
  diferentes) sugere um valor calculado por pedido/cobrança, não um
  segredo estático único configurado no painel — mas isso é inferência
  a partir de 2 amostras, não confirmação documental. Precisa ser
  verificado antes de basear qualquer validação de segurança nele.
- **O padrão de backoff (2 → ~4 min) foi observado em só 3 tentativas
  de 2 cobranças, no mesmo teste.** Não deve ser tratado como um
  contrato garantido do PagBank. A arquitetura não deve depender de
  intervalos específicos nem assumir um número máximo de tentativas —
  o comportamento além da 3ª tentativa não foi testado.
- **A origem exata da segunda criação de pedido com o mesmo
  `reference_id` (seção 1.5) não foi definitivamente comprovada.**
  Os timestamps sugerem fortemente uma segunda execução do fluxo de
  criação: o pedido "A" começou apenas 1,303 segundo depois do pedido
  "B" ser marcado como pago, e as durações internas dos dois pipelines
  (pedido→cobrança: ~16,3-16,5s; cobrança→pago: ~1,2-1,8s) são quase
  idênticas entre os dois — compatível com a mesma sequência de
  chamadas rodando duas vezes (loop, retry automático de script, ou
  execução duplicada do comando) em vez de duas execuções manuais
  distintas. **Isso é uma hipótese fundamentada em evidência indireta,
  não um fato comprovado** — não foi possível confirmar a causa exata
  a partir do histórico da sessão de PowerShell.

## 3. Proposta arquitetural — duas camadas de idempotência independentes

As duas camadas abaixo protegem contra **classes de falha diferentes**
e devem ser implementadas e testadas separadamente. Nenhuma delas
substitui a outra.

### 3.1 Camada 1 — Idempotência na CRIAÇÃO da cobrança

**Protege contra:** o nosso próprio lado (API intermediária) pedir ao
PagBank para criar mais de uma cobrança para a mesma tentativa de
renovação — o risco real exposto pela seção 1.5, já que o PagBank não
oferece essa proteção sozinho.

Proposta:

1. Toda tentativa de renovação gera **um único `operacao_id` (UUID)
   antes** de chamar a API do PagBank, persistido em tabela própria
   (ex.: `cobrancas_pix`) com status inicial (`iniciada`) **na mesma
   transação** que decide "vou cobrar a assinatura X agora".
2. O `reference_id` enviado ao PagBank **é esse `operacao_id`** —
   nunca reaproveitado entre tentativas diferentes. Uma nova tentativa
   de renovação (ex.: depois que a cobrança anterior expirou) gera um
   `operacao_id` novo e uma linha nova — isso é esperado e correto.
3. Antes de chamar o endpoint de criação de pedido do PagBank,
   consultar a tabela local: já existe uma operação em aberto para
   (assinatura, ciclo de cobrança)? Se sim, reaproveitar/retornar essa
   operação em vez de criar uma segunda cobrança no PagBank.
4. Essa checagem precisa de **constraint UNIQUE no banco** sobre
   (assinatura_id, ciclo_de_cobrança) — uma leitura seguida de escrita
   em nível de aplicação não é suficiente contra corrida (duas
   chamadas quase simultâneas passando a checagem antes de qualquer
   uma commitar).
5. Essa camada é **inteiramente independente do webhook** — protege
   contra "cliente cobrado duas vezes" mesmo que a notificação nunca
   chegue.

### 3.2 Camada 2 — Idempotência no RECEBIMENTO do webhook

**Protege contra:** o PagBank reentregar a mesma notificação mais de
uma vez — comportamento real confirmado na seção 1.4 (3 tentativas
observadas, conteúdo idêntico).

Proposta:

1. Tabela própria (ex.: `pagamentos_processados`) com **constraint
   UNIQUE em `charge.id`** (armazenar também `end_to_end_id` para
   referência cruzada/suporte).
2. Ao receber qualquer webhook: tentar **inserir** a linha por
   `charge.id` **antes** de qualquer efeito de renovação.
   - Insert falhou por violação de unicidade → essa cobrança já foi
     processada → responder 200 imediatamente, nenhuma ação nova
     (no-op idempotente).
   - Insert teve sucesso → primeira vez vendo essa cobrança, seguir
     para validação e renovação.
3. **Nunca confiar só no campo `status` do corpo recebido.** Antes de
   disparar a renovação, fazer uma consulta server-to-server de volta
   ao PagBank usando o link `SELF` do charge (com a API key real,
   nunca exposta) para confirmar o status diretamente na fonte — trata
   o webhook como "aviso para ir confirmar", não como fonte de verdade
   por si só. Isso neutraliza forjamento mesmo que o token de
   autenticidade seja comprometido.
4. Validar o `x-authenticity-token` como primeiro filtro (descarta
   lixo rapidamente, reduz carga), mas a consulta confirmatória do
   item 3 é o que efetivamente autoriza a renovação.
5. **Nunca usar `order.id` isolado como chave de deduplicação** — um
   mesmo pedido pode gerar mais de um evento de status ao longo da
   vida (seção 1.2). A chave é sempre `charge.id` (cruzado com
   `end_to_end_id`).
6. Responder 200 o mais rápido possível depois que a checagem de
   idempotência e a persistência mínima estiverem feitas — o efeito
   de renovação em si pode ser assíncrono, mas a resposta ao PagBank
   não deve demorar a ponto de parecer falha (o que aciona reentregas
   desnecessárias, mesmo sendo tolerável pela Camada 2).

### 3.3 Como as duas camadas se relacionam

São redes de segurança independentes para falhas diferentes:

- **Camada 1** impede que a gente peça duas cobranças reais ao PagBank
  pela mesma renovação.
- **Camada 2** impede que uma única cobrança real renove a assinatura
  mais de uma vez, mesmo que o PagBank avise sobre ela mais de uma
  vez.

Uma não substitui a outra: mesmo com a Camada 1 perfeita, a Camada 2
ainda é necessária (retry de webhook é comportamento normal e
documentado do PagBank, seção 1.4). E mesmo com a Camada 2 perfeita, a
Camada 1 ainda é necessária (ela evita gerar uma segunda cobrança real
ao cliente, o que a Camada 2 não tem como desfazer depois).

## 4. Próximos passos (nenhum iniciado)

- RFC formal desta arquitetura antes de qualquer código, mesma
  disciplina de aprovação já usada no `inovatv_central`.
- Confirmar na documentação oficial atual do PagBank o mecanismo exato
  do `x-authenticity-token` (seção 2).
- Se necessário, testar o comportamento de retry além da 3ª tentativa
  (limite máximo, se o backoff continua dobrando, se o PagBank desiste
  em algum ponto).
- Investigação do UniTV: **explicitamente adiada**, será feita
  separadamente, fora do escopo deste documento.
