-- F5 da autocura automatica do UNITV_DEALER_TOKEN (2026-08-30).
-- MECANISMO DE ATIVACAO -- preparado, NAO EXECUTADO.
--
-- Documento oficial: docs/renovacao_automatica/AUTOCURA_UNITV_DEALER_TOKEN.md
-- (secao F5). Roadmap: F0 doc -> F1 controles -> F2 monitor ->
--  F3-A observacao/OCR -> F4 login supervisionado -> F5 ATIVACAO.
--
-- >>> ESTE ARQUIVO E' O ARTEFATO REVISADO DA F5. NAO APLICAR AINDA. <<<
-- Aplicar esta migration NAO ativa nada: ela so' CRIA 4 funcoes. A
-- autocura so' liga quando alguem CHAMAR autocura_unitv_ativar_healer(...)
-- no SQL Editor -- 1 statement, atomico -- e so' depois dos criterios
-- formais (F3-A: >= 14 dias corridos E >= 10 execucoes; returnCode real
-- de token morto observado, revisado e autorizado; teste manual F4 OK;
-- revisao Jose + GPT).
--
-- ESCOPO: SO' CREATE de 4 funcoes SECURITY DEFINER (so' service_role).
--   * NAO altera autocura_unitv_config (nao liga healer_ativo, nao
--     desliga modo_observacao, nao preenche a allowlist).
--   * NAO cria cron do healer nem EF de orquestracao (isso e' feito na
--     hora da ativacao real -- ver doc secao F5).
--   * NAO toca Vault / Edge secret / fluxo de renovacao.
--
-- GARANTIA ESTRUTURAL DE "SEM ATIVACAO PARCIAL": os 2 CHECKs de F1
-- (autocura_unitv_config_allowlist_obrigatoria e
--  autocura_unitv_config_healer_fora_observacao) fazem o UPDATE de
-- ativacao ou terminar num estado combinado valido, ou falhar INTEIRO.

set search_path = public;

-- =====================================================================
-- 1. autocura_unitv_ativar_healer(p_return_codes integer[])
--
--    Ativacao CONJUNTA e ATOMICA num unico UPDATE:
--      return_codes_que_disparam := p_return_codes  (allowlist, obrigatoria)
--      modo_observacao           := false
--      healer_ativo              := true
--      kill_switch               := false
--      pausado_ate               := null   (limpa hard-stop anterior)
--    Se p_return_codes vier nulo/vazio -> raise, nada muda.
--    Os CHECKs de F1 rejeitam qualquer combinacao parcial -> ou tudo,
--    ou nada.
-- =====================================================================
create or replace function public.autocura_unitv_ativar_healer(p_return_codes integer[])
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c public.autocura_unitv_config;
begin
  if p_return_codes is null or coalesce(array_length(p_return_codes, 1), 0) < 1 then
    raise exception 'ativar_healer: allowlist vazia -- informe >= 1 returnCode real de token morto autorizado'
      using errcode = 'P0001';
  end if;

  update public.autocura_unitv_config
     set return_codes_que_disparam = p_return_codes,
         modo_observacao           = false,
         healer_ativo              = true,
         kill_switch               = false,
         pausado_ate               = null,
         atualizado_em             = now(),
         atualizado_por            = 'ativacao-f5'
   where id = 1
  returning * into c;

  if c.id is null then
    raise exception 'ativar_healer: config singleton ausente' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'ok', true,
    'healer_ativo', c.healer_ativo,
    'modo_observacao', c.modo_observacao,
    'return_codes_que_disparam', to_jsonb(c.return_codes_que_disparam),
    'kill_switch', c.kill_switch,
    'pausado_ate', c.pausado_ate
  );
end;
$$;

-- =====================================================================
-- 2. autocura_unitv_desativar_healer(p_motivo text) -- KILL-SWITCH
--    Sobe kill_switch. autocura_unitv_pode_disparar() passa a recusar
--    TUDO (disparo E calibracao) no proximo tick. Um workflow ja em
--    execucao termina no seu proprio timeout (8 min). Nao desliga
--    healer_ativo nem a allowlist -- e' um corte, nao um rollback.
-- =====================================================================
create or replace function public.autocura_unitv_desativar_healer(p_motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c public.autocura_unitv_config;
begin
  update public.autocura_unitv_config
     set kill_switch    = true,
         atualizado_em  = now(),
         atualizado_por = left('kill:' || coalesce(p_motivo, 'manual'), 120)
   where id = 1
  returning * into c;

  if c.id is null then
    raise exception 'desativar_healer: config singleton ausente' using errcode = 'P0001';
  end if;
  return jsonb_build_object('ok', true, 'kill_switch', c.kill_switch, 'healer_ativo', c.healer_ativo);
end;
$$;

-- =====================================================================
-- 3. autocura_unitv_reverter_para_observacao() -- ROLLBACK COMPLETO
--    Volta ao estado F3-A: healer_ativo=false, modo_observacao=true,
--    allowlist limpa, kill_switch=false, pausado_ate=null. A calibracao
--    de OCR continua rodando; nenhum POST de login e' mais possivel.
-- =====================================================================
create or replace function public.autocura_unitv_reverter_para_observacao()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c public.autocura_unitv_config;
begin
  update public.autocura_unitv_config
     set healer_ativo               = false,
         modo_observacao            = true,
         return_codes_que_disparam  = null,
         kill_switch                = false,
         pausado_ate                = null,
         atualizado_em              = now(),
         atualizado_por             = 'reverter-observacao-f5'
   where id = 1
  returning * into c;

  if c.id is null then
    raise exception 'reverter_para_observacao: config singleton ausente' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'ok', true, 'healer_ativo', c.healer_ativo, 'modo_observacao', c.modo_observacao,
    'return_codes_que_disparam', to_jsonb(c.return_codes_que_disparam)
  );
end;
$$;

-- =====================================================================
-- 4. autocura_unitv_prontidao_f5() -- CHECKLIST READ-ONLY
--    Rodar ANTES de autocura_unitv_ativar_healer(...). Nao muda nada.
--    Retorna { pronto, itens[] } -- cada item { chave, ok, detalhe }.
--    'pronto' = todos os itens ok. A decisao final continua sendo
--    humana (Jose + GPT) -- este checklist so' evita ativar num estado
--    obviamente inconsistente.
-- =====================================================================
create or replace function public.autocura_unitv_prontidao_f5()
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  c              public.autocura_unitv_config;
  v_itens        jsonb := '[]'::jsonb;
  v_ok           boolean;
  v_n            integer;
  v_min_dias     constant integer := 14;
  v_min_execs    constant integer := 10;
  v_calib_ok     integer;
  v_calib_total  integer;
  v_primeira     timestamptz;
  v_f4_ok        integer;
begin
  select * into c from public.autocura_unitv_config where id = 1;
  if not found then
    return jsonb_build_object('pronto', false, 'itens',
      jsonb_build_array(jsonb_build_object('chave','config_ausente','ok',false,'detalhe','singleton id=1 nao existe')));
  end if;

  -- (a) estado de partida limpo
  v_ok := (c.healer_ativo = false and c.modo_observacao = true
           and c.return_codes_que_disparam is null
           and c.kill_switch = false and c.pausado_ate is null);
  v_itens := v_itens || jsonb_build_object('chave','estado_partida_limpo','ok',v_ok,
    'detalhe', format('healer_ativo=%s modo_observacao=%s allowlist=%s kill=%s pausado=%s',
      c.healer_ativo, c.modo_observacao, coalesce(array_to_string(c.return_codes_que_disparam,','),'NULL'),
      c.kill_switch, coalesce(c.pausado_ate::text,'NULL')));

  -- (b) nenhum ciclo 'disparo' automatico ja concluiu 'sucesso'
  --     (so' o teste manual F4 pode ter rodado -- ver item d)
  select count(*) into v_n from public.autocura_unitv_ciclos
    where tipo = 'disparo' and outcome = 'sucesso' and trigger <> 'agendado';
  v_itens := v_itens || jsonb_build_object('chave','sem_disparo_automatico_previo','ok', v_n = 0,
    'detalhe', format('%s ciclo(s) disparo sucesso com trigger != agendado', v_n));

  -- (c) F3-A: >= v_min_dias corridos de calibracao E >= v_min_execs execucoes
  select count(*), min(iniciado_em)
    into v_calib_total, v_primeira
    from public.autocura_unitv_ciclos where tipo = 'calibracao' and estado = 'concluido';
  v_ok := (v_calib_total >= v_min_execs
           and v_primeira is not null
           and v_primeira <= now() - make_interval(days => v_min_dias));
  v_itens := v_itens || jsonb_build_object('chave','f3a_janela_minima','ok',v_ok,
    'detalhe', format('%s calibracoes concluidas (min %s); 1a em %s (min %s dias)',
      v_calib_total, v_min_execs, coalesce(v_primeira::text,'-'), v_min_dias));

  -- (d) o teste manual F4 (disparo, trigger 'agendado', modo_observacao=false)
  --     concluiu 'sucesso'
  select count(*) into v_f4_ok from public.autocura_unitv_ciclos
    where tipo = 'disparo' and trigger = 'agendado' and outcome = 'sucesso';
  v_itens := v_itens || jsonb_build_object('chave','teste_manual_f4_ok','ok', v_f4_ok >= 1,
    'detalhe', format('%s ciclo(s) disparo manual (trigger agendado) com sucesso', v_f4_ok));

  -- (e) sem streak de falha de disparo pendente
  select count(*) into v_n from public.autocura_unitv_ciclos
    where tipo = 'disparo' and outcome = 'falhou'
      and ended_at > now() - interval '24 hours';
  v_itens := v_itens || jsonb_build_object('chave','sem_falha_disparo_recente','ok', v_n = 0,
    'detalhe', format('%s falha(s) de disparo nas ultimas 24h', v_n));

  -- consolida
  select bool_and((x->>'ok')::boolean) into v_ok
    from jsonb_array_elements(v_itens) x;

  return jsonb_build_object('pronto', coalesce(v_ok, false), 'itens', v_itens);
end;
$$;

-- =====================================================================
-- 5. Permissoes -- so' service_role (padrao unitv_dealer_token_* / F1).
-- =====================================================================
revoke all on function public.autocura_unitv_ativar_healer(integer[])       from public, anon, authenticated;
revoke all on function public.autocura_unitv_desativar_healer(text)         from public, anon, authenticated;
revoke all on function public.autocura_unitv_reverter_para_observacao()     from public, anon, authenticated;
revoke all on function public.autocura_unitv_prontidao_f5()                 from public, anon, authenticated;

grant execute on function public.autocura_unitv_ativar_healer(integer[])       to service_role;
grant execute on function public.autocura_unitv_desativar_healer(text)         to service_role;
grant execute on function public.autocura_unitv_reverter_para_observacao()     to service_role;
grant execute on function public.autocura_unitv_prontidao_f5()                 to service_role;
