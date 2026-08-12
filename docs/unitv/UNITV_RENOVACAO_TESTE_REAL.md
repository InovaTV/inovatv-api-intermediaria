# UniTV (painel ResellerSystem) — Teste Real de Renovação

> **Este é um registro de teste real, autorizado explicitamente pelo
> usuário, executado em 1 conta de teste.** Documento separado da
> investigação estática (`UNITV_RENOVACAO_INVESTIGACAO.md`) — aquele
> documento registra o que foi mapeado por leitura de código; este
> registra o que foi efetivamente executado e observado no painel de
> produção. **Nenhuma automação foi implementada a partir deste
> teste** — foi uma validação manual, via UI real do painel, com
> captura passiva da requisição/resposta reais.

## 1. Escopo autorizado e executado

- **Conta testada:** `gcnv6v` (comprador: José Antonio dos Santos —
  confirmado via tela de Detalhes antes de qualquer ação, batendo
  exatamente com o solicitado).
- **Operação:** 1 renovação, ciclo "Créditos Mensal", duração "1 Mês".
- **Nenhuma outra conta foi tocada. Nenhuma outra operação foi
  executada** (só a renovação em si; a busca/consulta da conta antes e
  depois é leitura, não altera dados).

## 2. Resultado

- **`returnCode: 0`** — renovação aceita pelo servidor.
- **Crédito mensal do revendedor:** debitado de **15 para 14** (1
  crédito consumido, consistente com "1 Crédito = 1 mês").
- **Vencimento antes:** `02/09/2026 02:31:01` (21 dias restantes).
- **Vencimento depois:** `03/10/2026 02:31:01` (52 dias restantes).
- **Vencimento reconfirmado com uma nova consulta ao servidor**
  (`Consultar` refeito depois da operação, não apenas o estado
  otimista deixado na tela pela própria ação) — a mudança está
  persistida no lado do servidor, não é só um valor de tela.

> ⚠️ **Ver observação separada sobre duração** — 52 − 21 = **31
> dias**, não 30. Detalhe e recomendação em
> `UNITV_RENOVACAO_INVESTIGACAO.md`, seção 7. Não repetido aqui para
> não duplicar conteúdo — este documento só registra o fato observado
> (a diferença real foi de 31 dias neste teste).

## 3. `pre_auth_id` utilizado

**`123`** — correspondente a "Plano Básico + Créditos Mensal + 1 mês".
Confirma que `pre_auth_id` é um inteiro simples de catálogo emitido
pelo servidor, não um token opaco de segurança gerado por requisição.

## 4. `sign` — algoritmo confirmado empiricamente

```
sign = MD5("dealer" + id + points_type + points)
```

Com os valores reais desta renovação (`id = 3433363`, `points_type =
1`, `points = 1`):

```
MD5("dealer343336311") = 85c37de7e1e653df55e12330aebb1be4
```

Esse valor, calculado de forma independente (fora do painel), **bateu
byte a byte** com o `sign` real presente na requisição capturada.
Confirmado MD5 — descartado SHA1 (o hash real tem 32 caracteres hex,
compatível só com MD5; SHA1 teria 40).

## 5. Payload real decriptado (requisição enviada ao servidor)

Capturado via interceptação passiva de `fetch`/`XHR` no navegador
(instrumentação que só lê, nunca modifica, a requisição) e decriptado
offline com a chave/IV AES documentados em
`UNITV_RENOVACAO_INVESTIGACAO.md`, seção 2:

```json
{
  "package_id": 1,
  "points_type": 1,
  "auth_cycle": 1,
  "points": 1,
  "pre_auth_id": 123,
  "sn": "gcnv6v",
  "id": 3433363,
  "sign": "85c37de7e1e653df55e12330aebb1be4",
  "dealer_token": "[OMITIDO — credencial real do revendedor, não registrada]",
  "dealer_name": "inovatvstream2"
}
```

**O `dealer_token` real não é registrado neste documento** — foi visto
e usado apenas em memória durante o teste, e removido da memória da
página do navegador (`window.__captured__`) ao final da sessão.

## 6. Formato da resposta de sucesso

Envelope recebido em texto puro (só o campo `data` vem criptografado):

```json
{
  "returnCode": 0,
  "errorMessage": "Dicas: Se a operação foi concluída, o serviço de renovação entrará em vigor em 5 minutos.",
  "jumpCode": 1,
  "data": "c72a2a13c9b7e415148f78dfd060c601ab340eebcc7226b5e70e1f8b07bc86a0aa366c0773650d869d8998e7cf375339"
}
```

`data`, decriptado com a mesma chave/IV AES:

```json
{ "uuid": "0c1d56a6-9fcc-4c76-812b-a745e7b0206e" }
```

## 7. Método de captura (transparência do processo)

1. Injeção de um interceptor passivo de `fetch`/`XMLHttpRequest` no
   contexto da própria página (só leitura — grava url/método/corpo em
   `window.__captured__`, nunca altera o que é enviado).
2. Abertura do modal "Renovar" pela UI real do painel, preenchimento
   já vinha correto por padrão (Créditos Mensal, 1 Mês, 1.00 ponto) —
   nenhum valor foi alterado manualmente.
3. Confirmação explícita pelo usuário para executar (dois diálogos de
   confirmação do próprio painel, ambos aceitos).
4. Corpo/resposta reais capturados pelo interceptor, decriptados
   offline com a chave/IV AES já identificados na investigação
   estática.
5. `sign` recalculado de forma independente e comparado — bateu.
6. Conta reconsultada no painel para confirmar persistência real do
   novo vencimento.
7. Memória da página limpa (`window.__captured__ = []`) ao final, por
   conter o `dealer_token` real.

## 8. Status

Teste real concluído com sucesso, escopo respeitado (só a conta
`gcnv6v`, só 1 renovação). **Nenhuma automação foi implementada** —
este documento é só o registro do teste manual e da evidência
coletada. Próxima decisão (não tomada aqui) é se/quando formalizar uma
automação real a partir dessas informações.
