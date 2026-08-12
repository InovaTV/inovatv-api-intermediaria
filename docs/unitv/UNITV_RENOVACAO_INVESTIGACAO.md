# UniTV (painel ResellerSystem) — Investigação da API de Renovação

> **Nota sobre este documento:** esta investigação foi conduzida em
> sessão de Claude Code, inteiramente por leitura passiva (análise do
> código-fonte JavaScript já baixado pelo navegador + observação do
> log de rede), sem executar nenhuma operação que alterasse dados —
> **até o momento em que o teste real autorizado (ver
> `UNITV_RENOVACAO_TESTE_REAL.md`) confirmou empiricamente os pontos
> que aqui estavam registrados como inferência.** Este documento foi
> escrito/atualizado **depois** desse teste — por isso já marca como
> comprovados pontos que, no momento da investigação em si, eram só
> hipótese fundamentada. Nenhum arquivo de código foi alterado para
> produzir esta investigação.

## 0. Contexto

Investigação do painel de revenda usado para gerenciar as contas de
clientes UniTV (`https://panel-web.revenda.site`, produto white-label
"ResellerSystem"), para avaliar se existe uma operação oficial de
renovação/ativação/extensão de conta que poderia, no futuro, ser
automatizada pela API intermediária — sem que isso already implique
qualquer implementação real (ver seção 5).

## 1. Domínio, stack e autenticação

- **Domínio/API:** `panel-web.revenda.site`, SPA Vue 3, todas as
  chamadas de negócio em `POST` sob `/api/*` (mesmo as de consulta).
- **Autenticação:** dupla via código-fonte confirmado —
  - Headers em toda requisição: `Authorization: <esquema> <token>`
    (ou só o token, se sem esquema) e `token: <token>`.
  - Além disso, as chamadas de negócio específicas de conta (módulo
    `account.js`) incluem explicitamente `dealer_token`/`dealer_name`
    dentro do próprio corpo da requisição.

## 2. Criptografia de transporte (`isEncrypt: true`) — COMPROVADO

Confirmado por leitura de código **e** por decriptação real de uma
requisição/resposta capturada (ver teste real):

```
chave AES = UTF8("93403d3aa2ec48b4")   // 16 bytes, usada como key
IV        = UTF8("7cf0127d190cb909")   // 16 bytes

encrypt(json) = AES-CBC(UTF8(json), key, iv, padding=PKCS7).ciphertext → HEX → uppercase
decrypt(hex)  = AES-CBC-decrypt(hex→bytes, key, iv, padding=PKCS7) → UTF8 → JSON.parse
```

**Chave e IV são fixos, embutidos em texto literal no bundle
JavaScript do painel — os mesmos para qualquer sessão, qualquer
revendedor.** A resposta do servidor chega como um envelope em texto
puro (`{ returnCode, errorMessage, jumpCode, data }`) onde **só o
campo `data` (quando presente) é a string hexadecimal criptografada**
— o envelope em si nunca é criptografado.

## 3. Endpoints mapeados (por leitura do módulo `account.js` do painel)

| Ação | Endpoint | Método | Parâmetros (confirmados no código) |
|---|---|---|---|
| Listar contas | `/api/account` | POST | filtros de busca + paginação |
| **Renovar** | **`/api/account/renew`** | POST | `package_id`, `points_type`, `auth_cycle`, `points`, `pre_auth_id`, `sn`, `id`, `sign`, `dealer_token`, `dealer_name` |
| Habilitar/Desabilitar | `/api/account/upStatus` | POST | `sn`, `id`, `dealer_token`, `dealer_name` |
| Resetar senha | `/api/account/password` | POST | `sn`, `id`, `dealer_token`, `dealer_name` |
| Mudar senha | `/api/account/SavePW` | POST | `sn`, `id`, `password`, `check_password`, `sign`, `dealer_token`, `dealer_name` |
| Editar | `/api/account/upEdit` | POST | `sn`, `id`, `sn_name`, `sn_email`, `sn_telphone`, `remark` (não toca em vencimento) |
| Excluir (lixeira) | `/api/dealer-core/account/delete` | POST | `sn_list`, `dealer_token`, `dealer_name` |
| Criar conta | `/api/account/create` | POST | `add_total`, `points_type`, `points`, `pre_auth_id`, `sign` |
| Listar pacotes/preços | `/api/dealer-core/package/package-name` | POST | `dealer_token`, `dealer_name`, `customer`, `type` |
| Códigos de ativação | `/api/dealer-core/exchange-code/{get,create,edit,export}` | POST/GET | sistema de vouchers, separado de renovação direta |

## 4. Origem do `pre_auth_id` — COMPROVADO

Vem de `POST /api/dealer-core/package/package-name`, chamada **uma
única vez por sessão** (cacheada depois — reabrir o modal de renovação
ou navegar entre telas não a repete). Cada pacote retornado já vem com
um array `pre_auth_objs[]`, e **cada opção de duração dentro dele já
tem seu próprio `pre_auth_id`** (inteiro simples, não um token opaco de
segurança — confirmado real: `pre_auth_id = 123` para "Plano Básico +
Créditos Mensal + 1 mês", ver teste real), junto com `name`,
`auth_cycle` e `auth_unit`.

## 5. Fórmula do `sign` — COMPROVADO EMPIRICAMENTE

```
sign = MD5("dealer" + id + points_type + points)
```

Confirmado no teste real (`UNITV_RENOVACAO_TESTE_REAL.md`): o `sign`
calculado de forma independente com essa fórmula bateu **byte a byte**
com o `sign` real capturado numa renovação de verdade. **Não é SHA1**
(também descartado pelo comprimento do hash — 32 caracteres hex só é
compatível com MD5, SHA1 teria 40).

## 6. Formato da resposta de sucesso — COMPROVADO

```json
{ "returnCode": 0, "errorMessage": "...entrará em vigor em 5 minutos.", "jumpCode": 1, "data": "<hex AES>" }
```
`data`, decriptado, é `{ "uuid": "<uuid-v4>" }`.

## 7. Observação separada — duração de "1 mês" não é necessariamente 30 dias

> ⚠️ **Não assumir que "1 Crédito Mensal" = exatamente 30 dias.** No
> teste real executado (ver `UNITV_RENOVACAO_TESTE_REAL.md`), 1
> crédito mensal resultou em **+31 dias** de vencimento, não +30. Isso
> é relevante para qualquer cálculo futuro de data de expiração feito
> fora do próprio painel — a regra exata (dias fixos vs. "+1 mês de
> calendário" vs. outra lógica) não foi determinada, só observada uma
> vez.

## 8. O que ainda não está comprovado

- A regra exata de conversão "1 crédito mensal → N dias" (seção 7) —
  só uma amostra observada.
- Se `pre_auth_id` tem validade temporal (expira?) ou pode ser
  reaproveitado em chamadas futuras sem revalidação.
- Comportamento do endpoint com parâmetros inválidos/`sign` incorreto
  (não testado deliberadamente).

## 9. Status

Investigação encerrada nesta fase. **Nenhuma automação foi
implementada** — este documento e o do teste real são só
levantamento/prova de conceito. Ver `UNITV_RENOVACAO_TESTE_REAL.md`
para o registro do teste real autorizado que comprovou os pontos
acima.
