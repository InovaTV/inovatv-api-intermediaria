-- Janela de pagamento de 5min ponta a ponta para a renovacao
-- (2026-09-07, inovatv_central/CLAUDE.md). Ver tambem, na mesma data:
--   * _shared/openpix_client.ts        -> cobranca Woovi com expiresIn=300
--   * _shared/tokens_renovacao.ts       -> JANELA_EXPIRACAO_MS = 5min (era 2h)
--   * _shared/renovacoes_lote.ts        -> idem
--   * _shared/reconciliacao_renovacao.ts -> outcome 'cobranca_inexistente' (404)
--   * renovacao-sigma-watchdog/index.ts -> dupla confirmacao de 404 + backstop 24h
--
-- Esta migration adiciona SO' uma coluna nova (nullable, sem default,
-- sem backfill) em duas tabelas -- nenhuma linha existente muda de
-- valor, nenhuma constraint/indice/RPC/FK e' alterada. `cobranca_ausente_em`
-- guarda a 1a deteccao de "cobranca inexistente na Woovi" (HTTP 404 /
-- resposta sem `charge`) para uma autorizacao/lote em 'autorizada'. O
-- watchdog so' libera o acesso apos confirmar o 404 em DOIS ciclos
-- diferentes (cron */5); este timestamp e' o marcador do 1o ciclo, e e'
-- limpo (volta a NULL) se um ciclo posterior nao confirmar o 404.
--
-- Idempotente (IF NOT EXISTS) -- seguro reaplicar.
--
-- Aplicacao: MANUAL via SQL Editor do Supabase / `supabase db query
-- --linked` (mesmo processo de toda migration deste repositorio) --
-- este arquivo e' o artefato revisado, NAO roda sozinho e NAO deve ser
-- aplicado sem autorizacao explicita.

alter table public.tokens_renovacao
  add column if not exists cobranca_ausente_em timestamptz null;

alter table public.renovacoes_lote
  add column if not exists cobranca_ausente_em timestamptz null;

comment on column public.tokens_renovacao.cobranca_ausente_em is
  '1a deteccao de cobranca inexistente na Woovi (404). Watchdog exige 2 confirmacoes em ciclos diferentes antes de liberar. NULL = nunca detectado / limpo. Janela 5min ponta a ponta, 2026-09-07.';
comment on column public.renovacoes_lote.cobranca_ausente_em is
  'Espelho lote de tokens_renovacao.cobranca_ausente_em. Janela 5min ponta a ponta, 2026-09-07.';
