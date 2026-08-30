-- F3-A da autocura automatica do UNITV_DEALER_TOKEN (2026-08-30) --
-- MODO OBSERVACAO / OCR, somente.
-- Documento oficial: docs/renovacao_automatica/AUTOCURA_UNITV_DEALER_TOKEN.md
-- (invariantes I1-I7; roadmap F0 doc -> F1 controles -> F2 monitor ->
--  F3-A observacao/OCR -> F3-B prep login (design) -> F4 login
--  supervisionado -> F5 ativacao).
--
-- ESCOPO DESTA MIGRATION: 1 tabela + 1 RPC + 1 cron. SO' CREATE.
--
--   * NENHUM ALTER de objeto existente. NENHUM trigger. NENHUMA mudanca
--     em autocura_unitv_config / autocura_unitv_ciclos / as RPCs de F1 /
--     autocura_unitv_monitor_* (F2) / o cron do monitor.
--   * `calibracao_amostras` fica como CONSTANTE no runner
--     (scripts/autocura-unitv-ocr.mjs), NAO como coluna de config --
--     evita ALTER numa tabela de F1. Pode virar coluna depois.
--   * NAO cria: secret de login, workflow de healer, componente que
--     faca POST de login.
--   * NAO toca: Vault, Edge secret UNITV_DEALER_TOKEN, fluxo de
--     renovacao (tokens_renovacao / renovacoes_lote / cobrancas_pix /
--     openpix-webhook / renovacao-sigma-*), /api/account/renew.
--
-- O QUE F3-A LIGA: uma calibracao de OCR 1x/dia. Um cron novo
-- (autocura-unitv-ocr-agendador, 03:00 UTC) chama uma EF nova que, se
-- os guards de F1 (pode_disparar('calibracao')) permitirem, registra um
-- ciclo tipo='calibracao' e dispara o workflow autocura-unitv-ocr.yml.
-- O runner desse workflow NAO TEM credenciais (UNITV_DEALER_LOGIN/SENHA
-- ausentes do env) -> zero possibilidade estrutural de POST de login.
-- Alem disso, o CHECK autocura_unitv_ciclos_observacao_sem_login (F1)
-- torna IMPOSSIVEL um ciclo criado com modo_observacao=true registrar
-- login_posts > 0.
--
-- APLICACAO: MANUAL via SQL Editor do Supabase. NAO registrada em
-- schema_migrations.

-- =====================================================================
-- 1. autocura_unitv_ocr_metricas -- 1 linha por execucao de calibracao.
--    SO' AGREGADOS. NUNCA bytes do CAPTCHA, hash/base64 da imagem, nem
--    a string de digitos resolvida.
-- =====================================================================
create table public.autocura_unitv_ocr_metricas (
  id            uuid primary key default gen_random_uuid(),
  ciclo_id      uuid not null references public.autocura_unitv_ciclos(id),
  executado_em  timestamptz not null default now(),

  -- volume
  amostras_total               smallint not null check (amostras_total >= 0),
  amostras_4_segmentos         smallint not null default 0,
  amostras_gate_ok             smallint not null default 0,   -- passaram o gate 'alta'
  amostras_formato_invalido    smallint not null default 0,   -- string != ^[0-9]{4}$
  amostras_obviamente_invalida smallint not null default 0,   -- segmentos != 4 / score-margem degenerados / all-same / borda

  -- confianca (percentis sobre TODOS os digitos de TODAS as amostras)
  score_top1_p50  numeric(4,3) null check (score_top1_p50 is null or score_top1_p50 between 0 and 1),
  score_top1_p90  numeric(4,3) null check (score_top1_p90 is null or score_top1_p90 between 0 and 1),
  score_top1_min  numeric(4,3) null check (score_top1_min is null or score_top1_min between 0 and 1),
  margem_p50      numeric(4,3) null check (margem_p50 is null or margem_p50 between 0 and 1),
  margem_p10      numeric(4,3) null check (margem_p10 is null or margem_p10 between 0 and 1),

  -- buckets por amostra
  bucket_alta    smallint not null default 0,
  bucket_media   smallint not null default 0,
  bucket_baixa   smallint not null default 0,

  refreshes_total smallint not null default 0,
  runner_sha      text null,        -- git sha curto do pipeline -- rastreia mudanca de template/algoritmo
  estilo_alterado boolean not null default false,  -- fundo fora da banda / strikeLikeRows>0 / dimensao inesperada

  constraint autocura_unitv_ocr_metricas_soma_buckets
    check (bucket_alta + bucket_media + bucket_baixa <= amostras_total),

  constraint autocura_unitv_ocr_metricas_sub_totais
    check (amostras_4_segmentos <= amostras_total
       and amostras_gate_ok <= amostras_total
       and amostras_formato_invalido <= amostras_total
       and amostras_obviamente_invalida <= amostras_total)
);

create index autocura_unitv_ocr_metricas_executado_em_idx
  on public.autocura_unitv_ocr_metricas (executado_em desc);
create index autocura_unitv_ocr_metricas_ciclo_id_idx
  on public.autocura_unitv_ocr_metricas (ciclo_id);

-- RLS on, SEM policy -- so' service_role (bypassa RLS) e postgres (SQL
-- Editor). Mesmo padrao das demais tabelas operacionais do projeto.
alter table public.autocura_unitv_ocr_metricas enable row level security;

-- =====================================================================
-- 2. autocura_unitv_expirar_orfaos() -- adiada da F2, necessaria agora
--    que F3-A cria ciclos (calibracao) que podem orfanar se o workflow
--    morrer. Fecha 'em_andamento' vencido como indeterminado/orfao.
--    Chamada pelo agendador (F3-A) e, no futuro, pelo healer (F4).
-- =====================================================================
create or replace function public.autocura_unitv_expirar_orfaos()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_timeout integer;
  v_n       integer;
begin
  select orfao_timeout_min into v_timeout from public.autocura_unitv_config where id = 1;
  update public.autocura_unitv_ciclos
     set estado = 'concluido',
         outcome = 'indeterminado',
         failure_class = 'orfao',
         ended_at = now()
   where estado = 'em_andamento'
     and iniciado_em < now() - make_interval(mins => coalesce(v_timeout, 20));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.autocura_unitv_expirar_orfaos() from public, anon, authenticated;
grant execute on function public.autocura_unitv_expirar_orfaos() to service_role;

-- =====================================================================
-- 3. cron: dispara a EF autocura-unitv-ocr-agendador 1x/dia (03:00 UTC).
-- Mesmo mecanismo (pg_cron + pg_net) e mesmo padrao de header
-- (X-Internal-Token lido do Vault em tempo de execucao) de
-- renovacao-sigma-watchdog / autocura-unitv-monitor.
-- =====================================================================
select cron.schedule(
  'autocura-unitv-ocr-agendador',
  '0 3 * * *',
  $$
  select net.http_post(
    url := 'https://nduxsuxkopuvhwugdkqi.supabase.co/functions/v1/autocura-unitv-ocr-agendador',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Internal-Token', (select decrypted_secret from vault.decrypted_secrets where name = 'autocura_unitv_ocr_agendador_token')
    ),
    body := '{}'::jsonb
  );
  $$
);
