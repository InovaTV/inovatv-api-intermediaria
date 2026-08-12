# PoC temporária — PagBank webhook → renovação real do UniTV

**Descartável.** Depois do teste validado, esta pasta/function deve
ser removida do projeto Supabase (mesmo padrão já usado neste repo
para a function `debug-fields`). Não é a arquitetura definitiva.

## Passos manuais (nenhum executado ainda, nenhum segredo em arquivo versionado)

### 1. Criar a tabela de idempotência (uma vez, via SQL Editor do Supabase)

```sql
create table if not exists poc_processed_charges (
  charge_id text primary key,
  processed_at timestamptz not null default now()
);
```

### 2. Configurar os secrets do UniTV (via terminal, nunca colado aqui)

```
npx supabase secrets set UNITV_DEALER_TOKEN=<seu dealer_token real> UNITV_DEALER_NAME=inovatvstream2 --project-ref <project-ref>
```

`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` já são injetados
automaticamente pela plataforma em toda Edge Function — não precisam
ser configurados manualmente.

### 3. Deploy da function (webhook público, sem JWT do Supabase)

```
npx supabase functions deploy poc-pagbank-unitv-renew --no-verify-jwt --project-ref <project-ref>
```

A URL pública resultante (algo como
`https://<project-ref>.supabase.co/functions/v1/poc-pagbank-unitv-renew`)
é o que vai como `notification_urls` do pedido Pix de teste.

### 4. Criar o pedido Pix de teste (PowerShell, como nos testes anteriores)

- `reference_id`: `TESTE-INOVATV-POC-PAGBANK-UNITV-001` (tem que bater
  exatamente com a constante `POC_REFERENCE_ID` em `index.ts`).
- `notification_urls`: a URL do passo 3.
- Simular o pagamento normalmente, como nos testes anteriores.

### 5. Verificação (feita por leitura, sem chamar o UniTV manualmente)

- Logs da function (`npx supabase functions logs poc-pagbank-unitv-renew --project-ref <project-ref>`)
  para confirmar `forwarded: true` e o `unitvRawResponse`.
- Reconsultar `gcnv6v` no painel para confirmar o novo vencimento.

### 6. Limpeza (depois do teste)

```
npx supabase functions delete poc-pagbank-unitv-renew --project-ref <project-ref>
```
E remover a tabela `poc_processed_charges` via SQL Editor:
```sql
drop table if exists poc_processed_charges;
```
