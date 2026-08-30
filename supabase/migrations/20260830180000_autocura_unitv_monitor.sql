-- F2 da autocura automatica do UNITV_DEALER_TOKEN (2026-08-30) --
-- MONITOR PROATIVO, somente.
-- Documento oficial: docs/renovacao_automatica/AUTOCURA_UNITV_DEALER_TOKEN.md
-- (invariantes I1-I7; roadmap F0 doc -> F1 controles -> F2 monitor ->
--  F3 observacao/OCR -> F4 login supervisionado -> F5 ativacao).
--
-- ESCOPO DESTA MIGRATION: 1 tabela singleton + 1 insert + 1 RPC (lock
-- atomico) + 1 cron.
--
--   * NENHUM ALTER de objeto existente. NENHUM trigger.
--   * A UNICA RPC nova (autocura_unitv_monitor_adquirir_lock) e' a
--     aquisicao ATOMICA do lock anti-sobreposicao -- exigida pela
--     revisao (2026-08-30): a decisao "posso rodar este tick?" NAO pode
--     depender de SELECT->UPDATE separados (corrida entre 2 ticks
--     simultaneos). E' um UNICO "UPDATE ... WHERE id=1 AND (lock IS NULL
--     OR lock < now()-10min) RETURNING *". NAO e' a RPC de sweep de
--     orfaos -- essa segue adiada para F3.
--   * NAO cria Edge Function, workflow, OCR nem secret de login.
--   * NAO toca o Vault, o Edge secret UNITV_DEALER_TOKEN, as funcoes
--     unitv_dealer_token_* / unitv_conta / unitv_token_diag, nem o
--     fluxo de renovacao (tokens_renovacao / renovacoes_lote /
--     cobrancas_pix / openpix-webhook / renovacao-sigma-*).
--   * NAO cria autocura_unitv_expirar_orfaos() -- adiada para F3: em
--     F2 nenhum codigo cria ciclos, logo nao existem orfaos reais.
--
-- A EF autocura-unitv-monitor (F2, arquivo separado, NAO nesta
-- migration) le esta tabela e chama diagnosticarTokenUnitv (Fase 1, ja
-- em producao) uma vez por tick. Ela NAO faz login, NAO resolve CAPTCHA,
-- NAO faz POST de login, NAO altera o Vault/UNITV_DEALER_TOKEN, NAO
-- chama /api/account/renew, NAO cria cobranca, NAO dispara workflow,
-- NAO chama autocura_unitv_pode_disparar nem autocura_unitv_registrar_*.
-- Em modo observacao o maximo permitido e' detectar, registrar e medir.
--
-- APLICACAO: MANUAL via SQL Editor do Supabase (mesmo processo de toda
-- migration deste repositorio). NAO registrada em schema_migrations.

-- =====================================================================
-- autocura_unitv_monitor_estado  (singleton id=1)
--   Estado leve do monitor: ultimo tick, lock anti-sobreposicao,
--   dedupe do alerta ao Jose (unico tipo em F2: token morto confirmado
--   com returnCode C), e contadores para metrica.
-- =====================================================================
create table public.autocura_unitv_monitor_estado (
  id  integer primary key default 1,
  constraint autocura_unitv_monitor_estado_singleton check (id = 1),

  -- ultimo tick concluido
  ultimo_tick_em            timestamptz null,
  ultimo_veredito           text null
                              check (ultimo_veredito is null or ultimo_veredito in
                                     ('token_vivo','token_morto','indeterminado_outage','indeterminado')),
  ultimo_probe_return_code  integer null,

  -- lock advisory contra dois ticks sobrepostos (tick > 15min enquanto
  -- o proximo cron dispara). Setado no inicio do tick, limpo no fim
  -- (inclusive em erro). Um valor mais velho que ~10min e' considerado
  -- stale e ignorado.
  tick_em_andamento_desde  timestamptz null,

  -- dedupe do UNICO alerta de F2: "token morto confirmado, returnCode C".
  -- Re-alerta so' se o codigo mudou OU passou de 12h. Zerado num tick
  -- token_vivo (a sequencia de morte reiniciou).
  ultimo_codigo_desconhecido_alertado     integer null,
  ultimo_codigo_desconhecido_alertado_em  timestamptz null,

  -- metrica
  total_ticks                     bigint not null default 0,
  total_token_morto_confirmado     bigint not null default 0,

  atualizado_em  timestamptz not null default now()
);

insert into public.autocura_unitv_monitor_estado (id) values (1);

-- RLS on, SEM policy -- so' service_role (bypassa RLS) e postgres (SQL
-- Editor). anon/authenticated: zero acesso. Mesmo padrao de
-- autocura_unitv_config / autocura_unitv_ciclos / unitv_token_diagnostico.
alter table public.autocura_unitv_monitor_estado enable row level security;

-- =====================================================================
-- autocura_unitv_monitor_adquirir_lock() -- AQUISICAO ATOMICA do lock.
--
-- Um UNICO UPDATE condicional (sem SELECT antes): se o lock esta livre
-- (NULL) ou stale (mais velho que 10min), grava now() e devolve a linha;
-- senao nao afeta nada. Dois ticks simultaneos -> exatamente 1 UPDATE
-- afeta linha -> exatamente 1 ganha o lock. O staleness de 10min vive
-- SO' aqui.
--
-- Retorno:
--   adquiriu = true  -> este tick ganhou; `estado` = to_jsonb da linha
--                       atual (contadores/dedupe, ja com o novo
--                       tick_em_andamento_desde) -- a EF NAO faz SELECT.
--   adquiriu = false -> outro tick detem o lock fresco; `estado` = NULL.
--
-- A LIBERACAO do lock e' um UPDATE condicional feito pela EF
-- (set tick_em_andamento_desde = null where id=1 and
--  tick_em_andamento_desde = <valor exato adquirido>), para nao "roubar"
-- o lock de um sucessor que ja o tenha assumido por staleness -- nao
-- precisa de RPC.
-- =====================================================================
create or replace function public.autocura_unitv_monitor_adquirir_lock()
returns table (adquiriu boolean, estado jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.autocura_unitv_monitor_estado;
begin
  update public.autocura_unitv_monitor_estado
     set tick_em_andamento_desde = now()
   where id = 1
     and (tick_em_andamento_desde is null
          or tick_em_andamento_desde < now() - interval '10 minutes')
  returning * into v_row;

  if v_row.id is null then
    return query select false, null::jsonb;
  else
    return query select true, to_jsonb(v_row);
  end if;
end;
$$;

revoke all on function public.autocura_unitv_monitor_adquirir_lock() from public, anon, authenticated;
grant execute on function public.autocura_unitv_monitor_adquirir_lock() to service_role;

-- =====================================================================
-- cron: dispara a EF autocura-unitv-monitor a cada 15 min.
-- Mesmo mecanismo (pg_cron + pg_net) e mesmo padrao de header
-- (X-Internal-Token lido do Vault em tempo de execucao, nunca em texto
-- neste comando) de renovacao-sigma-watchdog (migration 20260824130000).
-- pg_cron / pg_net ja habilitados no projeto desde 20260821150000.
-- =====================================================================
select cron.schedule(
  'autocura-unitv-monitor',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://nduxsuxkopuvhwugdkqi.supabase.co/functions/v1/autocura-unitv-monitor',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Internal-Token', (select decrypted_secret from vault.decrypted_secrets where name = 'autocura_unitv_monitor_token')
    ),
    body := '{}'::jsonb
  );
  $$
);
