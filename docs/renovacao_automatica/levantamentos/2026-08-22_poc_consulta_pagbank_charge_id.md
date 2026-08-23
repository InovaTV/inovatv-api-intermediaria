# POC — Consulta real ao PagBank Sandbox por `charge_id`/`SELF`

> **POC isolada de leitura, executada e concluída.** Function
> descartável `poc-pagbank-consulta` (`inovatv-api-intermediaria`),
> deployada, invocada, resultados capturados abaixo, **e já apagada**
> (Supabase + arquivos locais) — mesmo padrão já usado em
> `debug-fields`/`whatsapp-diag`. Nenhum fluxo definitivo
> implementado, nenhuma cobrança nova criada, nenhum dado de produção
> tocado, Rocket/RocketZap não envolvidos.

## O que foi testado

Cobrança de teste real já existente (POC UniTV, 2026-08-12):
`order.id = ORDE_942E3B5C-A88B-40E0-8091-4226576F88F9`,
`charge.id = CHAR_2A7A3702-9236-4E24-946E-B3D43463EFBD`,
`reference_id = TESTE-INOVATV-POC-PAGBANK-013`.

## Resultado 1 — `GET /orders?charge_id=...` (endpoint documentado, público)

**Funcionou, `HTTP 200`, na primeira tentativa.** Retornou, dentro de
`orders[0].charges[0]`:
- `status`: `"PAID"`
- `amount`: `{ value: 500, currency: "BRL", summary: { total: 500, paid: 500, refunded: 0, incremented: 0 } }`
- `reference_id`: `"TESTE-INOVATV-POC-PAGBANK-013"` (igual em `order` e
  em `charge`)
- `id` (charge): `"CHAR_2A7A3702-9236-4E24-946E-B3D43463EFBD"`
- `payment_method.pix.end_to_end_id`:
  `"23cb1de9bec546bf96a1c8a63ccb1fa6"` (ver seção 4)

**Confirmado, com dado real, não mais suposição:** este único
endpoint já entrega tudo que o fluxo de confirmação precisa —
status, valor, `reference_id`, `charge.id`.

## Resultado 2 — link `SELF` do **pedido** (`order`) — funciona

```
GET https://sandbox.api.pagseguro.com/orders/ORDE_942E3B5C-A88B-40E0-8091-4226576F88F9
```
`HTTP 200`, corpo idêntico ao da consulta por `charge_id` (mesmo
`status`/`amount`/`reference_id`/`charge.id`). **Este é um caminho
alternativo válido de reconsulta**, equivalente ao Resultado 1.

## Resultado 3 — link `SELF` da **cobrança** (`charge`) — NÃO acessível, achado real

```
GET https://internal.sandbox.api.pagseguro.com/charges/CHAR_2A7A3702-9236-4E24-946E-B3D43463EFBD
```
**`HTTP 403 — {"message": "unauthorized"}`.**

**Achado importante, corrige o desenho anterior:** existem **dois**
links `SELF` diferentes no payload — um em `order.links[]`
(`sandbox.api.pagseguro.com`, funciona) e outro em `charge.links[]`
(`internal.sandbox.api.pagseguro.com`, **não funciona**, `403`). O
prefixo `internal.` já sugeria isso — é um host de uso interno do
próprio PagBank, não pra chamada de terceiros. Os documentos
anteriores (`PAGBANK_IDEMPOTENCIA_E_RETRY.md` e os desenhos desta
sessão) tratavam "o link SELF" como um mecanismo único — na prática
**só o SELF do pedido (`order`) é utilizável por nós; o SELF da
cobrança (`charge`) é bloqueado.** Isso não muda a viabilidade do
fluxo (o SELF do `order` já entrega tudo que a cobrança do `charge`
mostra), só corrige qual link específico usar.

## Resultado 4 — `end_to_end_id` real, comparação com o levantamento anterior

Valor real devolvido pela API: `23cb1de9bec546bf96a1c8a63ccb1fa6` — 32
caracteres, hexadecimal minúsculo, **sem** o formato `E`+ISPB+data+
sequencial do Bacen (bate com o exemplo da doc "Objeto Order", não com
o da doc "Webhooks", ver levantamento anterior).

**Isso não invalida a hipótese sobre o ID do seu comprovante real** —
esta cobrança de teste foi paga por um **pagador simulado do Sandbox**
(`payment_method.pix.holder.name: "API-PIX Payer Mock"`), não por uma
transferência Pix real passando pelo sistema do Banco Central. É
esperado que o Sandbox gere um identificador sintético em vez de um
EndToEndId real do Bacen, já que não existe transação real na Rede do
Pix por trás dele. **A pergunta "o ID do seu comprovante é um
EndToEndId real" continua em aberto** (só seria respondível com uma
cobrança paga de verdade, fora do Sandbox, ou reconferindo a imagem
original) — este teste só confirma que o Sandbox, especificamente,
não é uma boa referência pra validar esse formato.

## O que ficou fora desta POC, deliberadamente

- **Cenário "ainda não paga"** (pedido do usuário, condicional a "se
  tivermos uma cobrança adequada") — **não executado**: não havia
  nenhuma cobrança de teste pendente já existente à mão, e criar uma
  nova cobrança só pra esse teste vai além do escopo pedido ("cobrança
  PIX real de teste **já existente**"). Fica como decisão em aberto,
  não uma lacuna esquecida.
- Nenhuma alteração em `poc-pagbank-unitv-renew` ou qualquer outra
  function existente.
- Nenhum dado de cliente real, nenhuma cobrança nova, nenhum ambiente
  de Produção tocado.

## Resposta à pergunta que bloqueava o fluxo

> *"Conseguimos consultar uma cobrança PagBank de forma confiável e
> determinar o status/valor/identificadores?"*

**Sim, confirmado com chamada real, não mais hipótese.** Dois caminhos
funcionam (consulta por `charge_id` via `/orders`, e o `SELF` do
`order`) — qualquer um dos dois entrega `status`, `amount`,
`reference_id` e `charge.id` de forma consistente. O único ajuste ao
desenho anterior: usar o `SELF` do **pedido**, nunca o da **cobrança**
(que está bloqueado, `403`).

## Estado após esta etapa

- Function descartável **deployada, testada e já removida** (Supabase
  + arquivos locais) — nada residual em produção.
- Secret `PAGBANK_SANDBOX_TOKEN` continua configurado (você que
  configurou, nada mudou aqui).
- **Nenhum código do fluxo definitivo foi escrito.** Isso desbloqueia
  a Decisão pendente sobre *onde* reconsultar (agora resolvida: `GET
  /orders?charge_id=...` ou `SELF` do `order`), mas **a outra lacuna
  crítica continua aberta e intocada**: se o `PATCH` via
  `ROCKET_API_KEY` realmente prorroga o Sigma de verdade, ou só o
  campo do Rocket (seção 4 do documento
  `2026-08-22_comparacao_decisoes_fluxo_confirmacao.md`) — essa é uma
  decisão separada, não resolvida por esta POC.

**Como combinado: parando aqui, trazendo os resultados.**
