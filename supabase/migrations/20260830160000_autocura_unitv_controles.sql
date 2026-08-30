-- F1 da autocura automatica do UNITV_DEALER_TOKEN (2026-08-30).
-- Documento oficial de arquitetura:
--   docs/renovacao_automatica/AUTOCURA_UNITV_DEALER_TOKEN.md
--   (invariantes I1-I7; roadmap F0 doc -> F1 controles -> F2 monitor ->
--    F3 observacao/OCR -> F4 login supervisionado -> F5 ativacao).
--
-- ESCOPO DESTA MIGRATION: SO' o plano de controle da autocura --
-- 2 tabelas, 3 indices, 3 funcoes, 1 insert singleton. NADA MAIS.
--
--   * SO' CREATE + 1 INSERT. Nenhum ALTER de objeto existente, nenhum
--     trigger, nenhuma mudanca de grant em objeto pre-existente.
--   * NAO cria Edge Function, workflow, OCR nem secret.
--   * NAO toca o Vault, o Edge secret UNITV_DEALER_TOKEN, as funcoes
--     unitv_dealer_token_* / unitv_conta / unitv_token_diag, nem o
--     fluxo de renovacao (tokens_renovacao / renovacoes_lote /
--     cobrancas_pix / openpix-webhook / renovacao-sigma-*).
--   * autocura_unitv_pode_disparar() faz um SELECT read-only em
--     public.tokens_renovacao (guard financeiro I3) -- leitura, nunca
--     escrita, e so' quando alguem chamar a funcao (nada chama em F1).
--
-- ESTADO INERTE APOS APLICAR: healer_ativo=false, modo_observacao=true,
-- return_codes_que_disparam=NULL. Nenhuma funcao de producao consome
-- estas estruturas ainda -- a EF autocura-unitv-monitor que chamara as
-- RPCs e' F2, fora desta migration.
--
-- APLICACAO: MANUAL via SQL Editor do Supabase (mesmo processo de toda
-- migration deste repositorio) -- este arquivo e' o artefato revisado,
-- nao roda sozinho. NAO registrada em schema_migrations (fluxo manual).

-- =====================================================================
-- 1. autocura_unitv_config  (singleton id=1)
-- =====================================================================
create table public.autocura_unitv_config (
  id  integer primary key default 1,
  constraint autocura_unitv_config_singleton check (id = 1),

  -- ---- flags mestras (roadmap F1..F5) ----
  healer_ativo    boolean not null default false,  -- F5 liga (junto com modo_observacao=false)
  modo_observacao boolean not null default true,   -- F3: monitor/detector/OCR sim, POST de login NUNCA

  -- ---- allowlist obrigatoria (Invariante I1) ----
  -- NULL / vazio => healer automatico NAO pode ser ativado (CHECK abaixo).
  return_codes_que_disparam integer[] null,

  -- ---- corte / pausa ----
  kill_switch  boolean     not null default false,
  pausado_ate  timestamptz null,                   -- 'infinity' = hard-stop por N falhas

  -- ---- limites (ajustaveis via SQL Editor, sem deploy) ----
  cooldown_min                   integer  not null default 120 check (cooldown_min >= 0),
  cap_ciclos_diario              smallint not null default 4   check (cap_ciclos_diario >= 0),
  cap_calibracao_diario          smallint not null default 2   check (cap_calibracao_diario >= 0),
  cap_post_diario                smallint not null default 6   check (cap_post_diario >= 0),
  cap_post_por_ciclo             smallint not null default 2   check (cap_post_por_ciclo between 1 and 5),
  cap_refresh_captcha            smallint not null default 12  check (cap_refresh_captcha between 1 and 50),
  max_ciclos_falhos_consecutivos smallint not null default 3  check (max_ciclos_falhos_consecutivos >= 1),
  confirmacao_gap_min            integer  not null default 10  check (confirmacao_gap_min >= 1),
  orfao_timeout_min             integer  not null default 20  check (orfao_timeout_min >= 1),
  calibracao_intervalo_h        integer  not null default 24  check (calibracao_intervalo_h >= 1),
  ocr_score_min                 numeric(4,3) not null default 0.920 check (ocr_score_min  between 0 and 1),
  ocr_margem_min                numeric(4,3) not null default 0.150 check (ocr_margem_min between 0 and 1),

  atualizado_em  timestamptz not null default now(),
  atualizado_por text        null,

  -- ---- INVARIANTES ESTRUTURAIS ----
  -- I1: o healer so' pode ser ligado com a allowlist ja preenchida.
  --     array_length('{}',1) e' NULL -> coalesce(...,0) trata vazio como 0.
  constraint autocura_unitv_config_allowlist_obrigatoria check (
    healer_ativo = false
    or (return_codes_que_disparam is not null
        and coalesce(array_length(return_codes_que_disparam, 1), 0) >= 1)
  ),
  -- Roadmap: healer_ativo=true exige modo_observacao=false. O unico
  -- caminho para um healer vivo e' o flip conjunto de F5.
  constraint autocura_unitv_config_healer_fora_observacao check (
    healer_ativo = false or modo_observacao = false
  )
);

-- Linha singleton -- nasce inerte:
--   healer_ativo=false, modo_observacao=true, return_codes_que_disparam=NULL,
--   kill_switch=false, pausado_ate=NULL, + todos os defaults acima.
insert into public.autocura_unitv_config (id) values (1);

-- RLS on, SEM policy -- so' service_role (bypassa RLS) e postgres (SQL
-- Editor). anon/authenticated: sem grant, sem policy -> zero acesso.
-- Mesmo padrao de unitv_dealer_token_estado / unitv_token_diagnostico /
-- tokens_renovacao / cobrancas_pix.
alter table public.autocura_unitv_config enable row level security;

-- =====================================================================
-- 2. autocura_unitv_ciclos  (append-only; 1 linha por ciclo)
-- =====================================================================
create table public.autocura_unitv_ciclos (
  id           uuid primary key default gen_random_uuid(),
  iniciado_em  timestamptz not null default now(),

  estado  text not null default 'em_andamento'
            check (estado in ('em_andamento', 'concluido')),

  -- 'disparo'    = ciclo de autocura real (so' fora do modo observacao)
  -- 'calibracao' = coleta de CAPTCHAs + OCR, sem token morto, sem POST
  tipo    text not null check (tipo in ('disparo', 'calibracao')),

  trigger text not null check (trigger in ('monitor_proativo', 'reativo', 'agendado')),

  diag_return_code integer null,      -- probe_return_code que disparou (NULL em calibracao)
  modo_observacao  boolean not null,  -- SNAPSHOT da config no inicio do ciclo

  captcha_refreshes        smallint not null default 0 check (captcha_refreshes >= 0),
  captcha_confianca_bucket text null
                             check (captcha_confianca_bucket in ('alta','media','baixa','n_a')),
  login_posts              smallint not null default 0 check (login_posts between 0 and 5),

  outcome  text null
             check (outcome is null
                    or outcome in ('sucesso','falhou','indeterminado','observacao','calibracao')),
  failure_class text null
             check (failure_class is null or failure_class in (
               'captcha_sem_confianca','login_recusado','login_transporte',
               'token_shape_invalido','token_novo_invalido','revalidacao_falhou',
               'excecao','codigo_desconhecido','orfao'
             )),

  vault_gravado boolean not null default false,
  alertado_jose boolean not null default false,
  ended_at      timestamptz null,

  -- ---- CONSISTENCIA ----
  -- em_andamento => sem outcome/ended_at ; concluido => com os dois
  constraint autocura_unitv_ciclos_terminal_coerente check (
    (estado = 'em_andamento' and outcome is null and ended_at is null)
    or
    (estado = 'concluido'    and outcome is not null and ended_at is not null)
  ),
  -- calibracao nunca faz POST de login
  constraint autocura_unitv_ciclos_calibracao_sem_login check (
    tipo <> 'calibracao' or login_posts = 0
  ),
  -- I2 no nivel de dados: ciclo iniciado em modo observacao NUNCA
  -- registra POST de login.
  constraint autocura_unitv_ciclos_observacao_sem_login check (
    modo_observacao = false or login_posts = 0
  )
);

-- Historico cronologico + suporte a limpeza de retencao (180 dias, manual).
create index autocura_unitv_ciclos_iniciado_em_idx
  on public.autocura_unitv_ciclos (iniciado_em desc);

-- Cooldown / streak de falhas consultam os concluidos por ended_at.
create index autocura_unitv_ciclos_concluido_idx
  on public.autocura_unitv_ciclos (ended_at desc)
  where estado = 'concluido';

-- INDICE UNICO PARCIAL -- garante NO MAXIMO 1 ciclo 'em_andamento'.
-- Todas as linhas indexadas tem o mesmo valor ('em_andamento') -> a
-- unicidade permite so' uma. Um 2o INSERT concorrente pega 23505
-- (unique_violation), reconvertido para P0001 por
-- autocura_unitv_registrar_inicio. Mesma disciplina CAS de
-- tokens_renovacao_ativo_unico_por_acesso_idx / assumir_atendimento.
create unique index autocura_unitv_ciclos_um_em_andamento_idx
  on public.autocura_unitv_ciclos (estado)
  where estado = 'em_andamento';

alter table public.autocura_unitv_ciclos enable row level security;

-- Retencao: 180 dias, limpeza MANUAL (volume baixissimo). Comando:
--   delete from public.autocura_unitv_ciclos
--    where iniciado_em < now() - interval '180 days';

-- =====================================================================
-- 3. RPCs de controle -- SECURITY DEFINER, so' service_role.
--    Nenhuma le o Vault -> search_path sem 'vault'.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 3.1 autocura_unitv_pode_disparar(p_tipo) -> { pode, motivo }
--
-- FORA DESTA FUNCAO (e' F2 -- EF monitor): a confirmacao dupla de
-- token_morto (2 batidas, mesmo returnCode, >= confirmacao_gap_min) e a
-- checagem returnCode IN allowlist. Aqui so' os guards de estado do
-- plano de controle.
-- ---------------------------------------------------------------------
create or replace function public.autocura_unitv_pode_disparar(p_tipo text default 'disparo')
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  c            public.autocura_unitv_config;
  v_ultimo_fim timestamptz;
  v_streak     integer;
  v_n          integer;
begin
  if p_tipo not in ('disparo','calibracao') then
    return jsonb_build_object('pode', false, 'motivo', 'tipo_invalido');
  end if;

  select * into c from public.autocura_unitv_config where id = 1;
  if not found then
    return jsonb_build_object('pode', false, 'motivo', 'config_ausente');
  end if;

  -- ===== guards globais (disparo E calibracao) =====
  if c.kill_switch then
    return jsonb_build_object('pode', false, 'motivo', 'kill_switch');
  end if;

  if c.pausado_ate is not null and c.pausado_ate > now() then
    return jsonb_build_object('pode', false, 'motivo', 'pausado');
  end if;

  if exists (select 1 from public.autocura_unitv_ciclos where estado = 'em_andamento') then
    return jsonb_build_object('pode', false, 'motivo', 'ciclo_em_andamento');
  end if;

  -- Guard financeiro (I3). Cobre renovacao UniTV avulsa E filho de lote:
  -- cada filho tem SUA linha em tokens_renovacao com tipo='unitv' e seu
  -- proprio estado (as RPCs do lote movem lote+filhos na mesma transacao).
  -- SELECT read-only -- nunca escreve em tokens_renovacao.
  if exists (
    select 1 from public.tokens_renovacao
     where tipo = 'unitv'
       and estado in ('aguardando_confirmacao','autorizada','renovacao_em_andamento')
  ) then
    return jsonb_build_object('pode', false, 'motivo', 'renovacao_unitv_em_voo');
  end if;

  -- Cooldown (vale para sucesso E falha).
  select max(ended_at) into v_ultimo_fim
    from public.autocura_unitv_ciclos where estado = 'concluido';
  if v_ultimo_fim is not null
     and v_ultimo_fim + make_interval(mins => c.cooldown_min) > now() then
    return jsonb_build_object('pode', false, 'motivo', 'cooldown');
  end if;

  -- ===== ramo calibracao =====
  if p_tipo = 'calibracao' then
    select count(*) into v_n
      from public.autocura_unitv_ciclos
     where tipo = 'calibracao' and iniciado_em > now() - interval '24 hours';
    if v_n >= c.cap_calibracao_diario then
      return jsonb_build_object('pode', false, 'motivo', 'cap_calibracao_diario');
    end if;
    return jsonb_build_object('pode', true, 'motivo', 'ok');
  end if;

  -- ===== ramo disparo =====
  if not c.healer_ativo then
    return jsonb_build_object('pode', false, 'motivo', 'healer_inativo');
  end if;

  if c.return_codes_que_disparam is null
     or coalesce(array_length(c.return_codes_que_disparam, 1), 0) < 1 then
    return jsonb_build_object('pode', false, 'motivo', 'allowlist_vazia');
  end if;

  if c.modo_observacao then
    return jsonb_build_object('pode', false, 'motivo', 'modo_observacao');
  end if;

  -- hard-stop por N falhas de disparo consecutivas (redundante com
  -- pausado_ate='infinity' que registrar_fim seta -- defesa em profundidade).
  select count(*) into v_streak
  from (
    select bool_and(outcome = 'falhou') over (
             order by ended_at desc rows between unbounded preceding and current row
           ) as s
    from public.autocura_unitv_ciclos
    where estado = 'concluido' and tipo = 'disparo'
  ) t
  where s;
  if v_streak >= c.max_ciclos_falhos_consecutivos then
    return jsonb_build_object('pode', false, 'motivo', 'hard_stop_falhas');
  end if;

  -- cap de ciclos de disparo / 24h
  select count(*) into v_n
    from public.autocura_unitv_ciclos
   where tipo = 'disparo' and iniciado_em > now() - interval '24 hours';
  if v_n >= c.cap_ciclos_diario then
    return jsonb_build_object('pode', false, 'motivo', 'cap_ciclos_diario');
  end if;

  -- cap de POSTs de login / 24h (soma dos ciclos + a folga deste ciclo)
  select coalesce(sum(login_posts), 0) into v_n
    from public.autocura_unitv_ciclos
   where iniciado_em > now() - interval '24 hours';
  if v_n + c.cap_post_por_ciclo > c.cap_post_diario then
    return jsonb_build_object('pode', false, 'motivo', 'cap_post_diario');
  end if;

  return jsonb_build_object('pode', true, 'motivo', 'ok');
end;
$$;

-- ---------------------------------------------------------------------
-- 3.2 autocura_unitv_registrar_inicio(p_tipo, p_trigger, p_return_code)
--     -> uuid
--
-- Numa transacao: (1) auto-cura de ciclo orfao, (2) re-checa
-- pode_disparar no mesmo instante do claim (fecha TOCTOU), (3) claim
-- atomico via o indice unico parcial.
-- ---------------------------------------------------------------------
create or replace function public.autocura_unitv_registrar_inicio(
  p_tipo        text,
  p_trigger     text,
  p_return_code integer default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id            uuid;
  v_pode          jsonb;
  v_orfao_timeout integer;
begin
  if p_tipo not in ('disparo','calibracao') then
    raise exception 'registrar_inicio: tipo invalido (%)', p_tipo using errcode = 'P0001';
  end if;
  if p_trigger not in ('monitor_proativo','reativo','agendado') then
    raise exception 'registrar_inicio: trigger invalido (%)', p_trigger using errcode = 'P0001';
  end if;

  -- (1) auto-cura de ciclo orfao: fecha qualquer em_andamento vencido.
  select orfao_timeout_min into v_orfao_timeout from public.autocura_unitv_config where id = 1;
  update public.autocura_unitv_ciclos
     set estado = 'concluido', outcome = 'indeterminado',
         failure_class = 'orfao', ended_at = now()
   where estado = 'em_andamento'
     and iniciado_em < now() - make_interval(mins => v_orfao_timeout);

  -- (2) re-checa guards no mesmo instante do claim (TOCTOU).
  v_pode := public.autocura_unitv_pode_disparar(p_tipo);
  if not (v_pode->>'pode')::boolean then
    raise exception 'registrar_inicio: bloqueado (%)', (v_pode->>'motivo') using errcode = 'P0001';
  end if;

  -- (3) claim atomico -- o indice unico parcial garante 1 em_andamento.
  begin
    insert into public.autocura_unitv_ciclos (tipo, trigger, diag_return_code, modo_observacao)
    select p_tipo, p_trigger, p_return_code, cfg.modo_observacao
      from public.autocura_unitv_config cfg where cfg.id = 1
    returning id into v_id;
  exception when unique_violation then
    raise exception 'registrar_inicio: ciclo ja em andamento' using errcode = 'P0001';
  end;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 3.3 autocura_unitv_registrar_fim(p_ciclo_id, p_outcome,
--       p_failure_class, p_metrics) -> void
--
-- CAS em estado='em_andamento' + engate do hard-stop (so' tipo='disparo').
-- ---------------------------------------------------------------------
create or replace function public.autocura_unitv_registrar_fim(
  p_ciclo_id      uuid,
  p_outcome       text,
  p_failure_class text  default null,
  p_metrics       jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tipo       text;
  v_rows       integer;
  v_streak     integer;
  v_max_falhas smallint;
begin
  if p_outcome not in ('sucesso','falhou','indeterminado','observacao','calibracao') then
    raise exception 'registrar_fim: outcome invalido (%)', p_outcome using errcode = 'P0001';
  end if;

  update public.autocura_unitv_ciclos
     set estado                   = 'concluido',
         outcome                  = p_outcome,
         failure_class            = p_failure_class,
         ended_at                 = now(),
         captcha_refreshes        = coalesce((p_metrics->>'captcha_refreshes')::smallint, captcha_refreshes),
         captcha_confianca_bucket = coalesce(p_metrics->>'captcha_confianca_bucket', captcha_confianca_bucket),
         login_posts              = coalesce((p_metrics->>'login_posts')::smallint, login_posts),
         vault_gravado            = coalesce((p_metrics->>'vault_gravado')::boolean, vault_gravado),
         alertado_jose            = coalesce((p_metrics->>'alertado_jose')::boolean, alertado_jose)
   where id = p_ciclo_id and estado = 'em_andamento'
  returning tipo into v_tipo;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'registrar_fim: ciclo % nao esta em_andamento', p_ciclo_id using errcode = 'P0001';
  end if;

  -- hard-stop: N falhas de DISPARO consecutivas -> pausa a autocura.
  -- Falha de calibracao NAO conta.
  if v_tipo = 'disparo' and p_outcome = 'falhou' then
    select max_ciclos_falhos_consecutivos into v_max_falhas
      from public.autocura_unitv_config where id = 1;

    select count(*) into v_streak
    from (
      select bool_and(outcome = 'falhou') over (
               order by ended_at desc rows between unbounded preceding and current row
             ) as s
      from public.autocura_unitv_ciclos
      where estado = 'concluido' and tipo = 'disparo'
    ) t
    where s;

    if v_streak >= v_max_falhas then
      update public.autocura_unitv_config
         set pausado_ate = 'infinity', atualizado_em = now(),
             atualizado_por = 'autocura:hard_stop'
       where id = 1
         and (pausado_ate is null or pausado_ate <> 'infinity');
    end if;
  end if;
end;
$$;

-- =====================================================================
-- 4. Permissoes das RPCs -- so' service_role (padrao unitv_dealer_token_*)
-- =====================================================================
revoke all on function public.autocura_unitv_pode_disparar(text)                    from public, anon, authenticated;
revoke all on function public.autocura_unitv_registrar_inicio(text, text, integer)  from public, anon, authenticated;
revoke all on function public.autocura_unitv_registrar_fim(uuid, text, text, jsonb) from public, anon, authenticated;

grant execute on function public.autocura_unitv_pode_disparar(text)                    to service_role;
grant execute on function public.autocura_unitv_registrar_inicio(text, text, integer)  to service_role;
grant execute on function public.autocura_unitv_registrar_fim(uuid, text, text, jsonb) to service_role;
