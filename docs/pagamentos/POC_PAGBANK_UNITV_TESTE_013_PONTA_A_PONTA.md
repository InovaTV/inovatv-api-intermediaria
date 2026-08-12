# PoC PagBank → UniTV — Teste Real Ponta a Ponta (Pedido 013)

> **Este é um registro de teste real de uma PoC isolada e temporária**
> (`inovatv-api-intermediaria/supabase/functions/poc-pagbank-unitv-renew`),
> não a arquitetura definitiva de pagamentos nem de renovação. Mesmo
> espírito de `docs/unitv/UNITV_RENOVACAO_TESTE_REAL.md`: este documento
> registra o que foi efetivamente executado e observado, separando
> claramente o que vem de log do que vem de evidência visual, e
> marcando como **não disponível** qualquer informação que a fonte
> consultada não permita afirmar — nada aqui foi inferido.

## 1. Escopo autorizado e executado

- **Pedido PagBank Sandbox:** `ORDE_942E3B5C-A88B-40E0-8091-4226576F88F9`
- **`reference_id`:** `TESTE-INOVATV-POC-PAGBANK-013`
- **Cobrança:** `CHAR_2A7A3702-9236-4E24-946E-B3D43463EFBD`
- **Valor:** R$ 5,00 (Sandbox, faixa de pagamento imediato)
- **Conta UniTV afetada:** `gcnv6v` (única conta que esta PoC é capaz
  de tocar — `UNITV_SN`/`UNITV_ID` são constantes fixas no código,
  não vêm do payload do webhook)
- **Execução da Function:** `execution_id 514db0e7-052d-4ad8-9fa9-3a60349b4deb`,
  `2026-08-12T19:59:09–19:59:10 UTC`

## 2. Resultado — comprovado por log (Supabase Logs Explorer)

Sequência completa de marcadores de diagnóstico da execução acima,
sem nenhuma ambiguidade de ordem (busca feita por `execution_id`
exato, não por posição visual no explorer):

| Etapa | Evidência de log | Resultado |
|---|---|---|
| Webhook recebido | `[diag-webhook]` — `id`, `reference_id`, `charge_statuses:["PAID"]` | `PAID` confirmado no corpo do webhook |
| Idempotência | `[diag-insert] {"status":201,"statusText":"Created","body":""}` | INSERT novo — **não** foi tratado como duplicata |
| Secret `UNITV_DEALER_TOKEN` | `[diag-step] after-token {"exists":true}` | presente |
| Secret `UNITV_DEALER_NAME` | `[diag-step] after-name {"exists":true}` | presente |
| `sign` (MD5) | `[diag-unitv] antes-sign` → `depois-sign`, sem `[diag-unitv-error] sign` | executado sem erro |
| Criptografia AES | `[diag-unitv] antes-encrypt` → `depois-encrypt`, sem `[diag-unitv-error] encrypt` | executado sem erro |
| Chamada ao UniTV | `[diag-unitv] antes-fetch` → `depois-fetch` | `fetch()` completou sem lançar exceção |
| Resposta final da Function | `POST \| 200 \| https://nduxsuxkopuvhwugdkqi.supabase.co/functions/v1/poc-pagbank-unitv-renew` | Function encerrou com **HTTP 200** |

**Importante — distinção que os logs permitem fazer e que não deve
ser confundida:** o `HTTP 200` acima é o status da **resposta da
Function ao webhook do PagBank** (requisição de entrada), não o
status HTTP que `panel-web.revenda.site/api/account/renew` devolveu
para a Function. Esse segundo valor **não é capturado** pelos logs do
Supabase (Edge Function logs nunca registram corpo nem status da
chamada de saída) — só é possível concluir, pela ausência de qualquer
`[diag-unitv-error]` e pelo fato de a Function ter respondido 200 (o
código só devolve 502 se o `fetch` lançar exceção), que a chamada de
saída **não lançou exceção**. O conteúdo/`returnCode`/status HTTP
exatos da resposta do UniTV: **não disponível** via log.

O corpo de `unitvRawResponse` devolvido pela Function, e o texto
literal `forwarded: true`: **não disponível** — pelo mesmo motivo
(corpo de resposta nunca aparece em log). Nenhum dos dois foi inferido
neste documento.

## 3. Resultado — comprovado por evidência visual (painel UniTV)

Captura de tela do painel de revenda (`panel-web.revenda.site`,
conta `gcnv6v`), feita pelo usuário após a execução acima:

| Campo | Valor observado |
|---|---|
| Conta | `gcnv6v` |
| Nome do pacote | Plano Básico |
| Nome do comprador | José Antônio dos Sa... |
| Dias restantes | 82 |
| Data de validade da conta | **03/11/2026 02:31:01** |
| Data de criação | 23/05/2025 22:46:07 |

Essa validade é **+1 mês** sobre a validade que já constava do teste
manual anterior (03/10/2026 02:31:01, `UNITV_RENOVACAO_TESTE_REAL.md`),
e a hora (`02:31:01`) é idêntica em ambos os registros — consistente
com uma nova renovação de "1 Crédito Mensal" aplicada sobre a mesma
conta, no mesmo ciclo. A renovação foi confirmada diretamente no
painel, não apenas pelo estado otimista de uma tela de ação.

## 4. Conclusão

**POC validada ponta a ponta, com evidência real e independente em
dois pontos da cadeia:**

```
PagBank (PAID) → Webhook → Supabase Edge Function
  → idempotência → secrets → sign (MD5) → AES
  → POST /api/account/renew (UniTV) → conta gcnv6v renovada
```

- **Log:** confirma que a Function processou o webhook, passou por
  idempotência/secrets/sign/AES sem erro, chamou o UniTV sem exceção e
  encerrou com HTTP 200.
- **Painel UniTV:** confirma, de forma independente do log, que a
  conta `gcnv6v` foi efetivamente renovada (nova data de validade
  persistida no lado do servidor UniTV).

As duas evidências, juntas, comprovam a hipótese original desta PoC:
é possível automatizar a renovação real do UniTV a partir de um
pagamento real do PagBank, sem intervenção manual no painel.

## 5. Status

**Teste concluído com sucesso.** Nenhuma alteração foi feita em
código, Function, tabela `poc_processed_charges` ou secrets a partir
deste registro — este documento só formaliza o que já tinha sido
comprovado antes de ser escrito. Decisão de transição da PoC para a
arquitetura definitiva: **não tomada ainda**, fica para um próximo
passo deliberado.

Pendência de segurança conhecida, não tratada por este documento: o
`dealer_token` real usado nesta PoC ficou exposto em texto puro numa
query salva do SQL Editor do Supabase durante a investigação de causa
raiz de uma falha anterior. Apagar a query não invalida o valor já
exposto — a correção completa exige rotacionar o token, não só
remover a query. Ação adiada deliberadamente para um próximo passo,
por decisão do usuário.
