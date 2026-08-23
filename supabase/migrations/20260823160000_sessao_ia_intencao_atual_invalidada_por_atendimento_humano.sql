-- Estende a mesma invalidacao por atendimento humano (migration
-- 20260823140000) para tambem cobrir intencao_atual (coluna nova,
-- migration 20260823150000) -- nenhum contexto operacional da IA deve
-- atravessar um atendimento humano, mesmo principio, mesmos 3 pontos
-- de entrada/saida ja confirmados por leitura do codigo real:
--   - acionar_transferencia_humana: normal -> aguardando_humano.
--   - assumir_atendimento, ramo (a) normal -> aguardando_humano (ramo
--     (b), aguardando_humano -> aguardando_humano, nao muda estado,
--     sem invalidacao adicional -- mesma nota da migration anterior).
--   - encerrar_atendimento_humano: aguardando_humano -> normal.
--
-- Mudanca minima: "create or replace function" nas mesmas 3 RPCs, sem
-- alterar assinatura nem nenhum outro comportamento -- so' acrescenta
-- intencao_atual = null aos mesmos UPDATEs que ja zeram
-- acesso_selecionado/sessao_atividade_em.

create or replace function public.acionar_transferencia_humana(
  p_conversation_id  uuid,
  p_motivo           text,
  p_conteudo_cliente text,
  p_texto_ia         text
)
returns public.conversas_estado
language plpgsql
as $$
declare
  v_conversa    public.conversas_estado;
  v_episodio_id uuid;
begin
  update public.conversas_estado
  set estado = 'aguardando_humano',
      atualizado_em = now(),
      acesso_selecionado = null,
      intencao_atual = null,
      sessao_atividade_em = null
  where conversation_id = p_conversation_id
    and estado = 'normal'
  returning * into v_conversa;

  if not found then
    raise exception 'conversa_ja_aguardando_humano_ou_inexistente'
      using errcode = 'P0001';
  end if;

  insert into public.conversas_episodios (conversation_id, origem, motivo, iniciado_em)
  values (p_conversation_id, 'ia', p_motivo, now())
  returning id into v_episodio_id;

  update public.conversas_estado
  set episodio_atual_id = v_episodio_id
  where conversation_id = p_conversation_id
  returning * into v_conversa;

  insert into public.mensagens_conversa (conversation_id, episodio_id, origem, texto)
  values (p_conversation_id, v_episodio_id, 'cliente', p_conteudo_cliente);

  insert into public.mensagens_conversa (conversation_id, episodio_id, origem, texto)
  values (p_conversation_id, v_episodio_id, 'ia', p_texto_ia);

  insert into public.mensagens_conversa (conversation_id, episodio_id, origem, texto)
  values (p_conversation_id, v_episodio_id, 'sistema', format('Transferencia automatica: %s', p_motivo));

  return v_conversa;
end;
$$;

revoke all on function public.acionar_transferencia_humana(uuid, text, text, text) from public;
grant execute on function public.acionar_transferencia_humana(uuid, text, text, text) to service_role;

create or replace function public.assumir_atendimento(
  p_conversation_id uuid,
  p_operador        text
)
returns public.conversas_estado
language plpgsql
as $$
declare
  v_conversa public.conversas_estado;
  v_novo_id  uuid;
begin
  select * into v_conversa
  from public.conversas_estado
  where conversation_id = p_conversation_id
  for update;

  if not found then
    raise exception 'conversa_inexistente' using errcode = 'P0001';
  end if;

  if v_conversa.estado = 'normal' then
    insert into public.conversas_episodios (conversation_id, origem, motivo, iniciado_em, assumido_por, assumido_em)
    values (p_conversation_id, 'operador', null, now(), p_operador, now())
    returning id into v_novo_id;

    update public.conversas_estado
    set estado = 'aguardando_humano',
        episodio_atual_id = v_novo_id,
        atualizado_em = now(),
        acesso_selecionado = null,
        intencao_atual = null,
        sessao_atividade_em = null
    where conversation_id = p_conversation_id
    returning * into v_conversa;

    insert into public.mensagens_conversa (conversation_id, episodio_id, origem, texto)
    values (p_conversation_id, v_novo_id, 'sistema', format('Operador %s assumiu manualmente', p_operador));

    return v_conversa;
  end if;

  if v_conversa.episodio_atual_id is null then
    raise exception 'conversa_aguardando_humano_sem_episodio' using errcode = 'P0002';
  end if;

  update public.conversas_episodios
  set assumido_por = p_operador,
      assumido_em = now()
  where id = v_conversa.episodio_atual_id
    and assumido_por is null;

  if not found then
    raise exception 'conversa_ja_assumida' using errcode = 'P0001';
  end if;

  update public.conversas_estado
  set atualizado_em = now()
  where conversation_id = p_conversation_id
  returning * into v_conversa;

  return v_conversa;
end;
$$;

revoke all on function public.assumir_atendimento(uuid, text) from public;
grant execute on function public.assumir_atendimento(uuid, text) to service_role;

create or replace function public.encerrar_atendimento_humano(
  p_conversation_id uuid,
  p_operador        text
)
returns public.conversas_estado
language plpgsql
as $$
declare
  v_conversa    public.conversas_estado;
  v_episodio_id uuid;
begin
  select * into v_conversa
  from public.conversas_estado
  where conversation_id = p_conversation_id
  for update;

  if not found then
    raise exception 'conversa_inexistente' using errcode = 'P0001';
  end if;

  if v_conversa.estado <> 'aguardando_humano' or v_conversa.episodio_atual_id is null then
    raise exception 'conversa_nao_esta_aguardando_humano' using errcode = 'P0001';
  end if;

  v_episodio_id := v_conversa.episodio_atual_id;

  update public.conversas_episodios
  set encerrado_em = now(),
      encerrado_por = p_operador
  where id = v_episodio_id;

  -- Nova sessao da IA comeca do zero ao voltar pra 'normal' -- nunca
  -- reaproveita acesso_selecionado/intencao_atual anteriores ao
  -- atendimento humano, nunca conta o tempo do atendimento humano como
  -- inatividade da IA. Ja deveriam estar null (invalidados na entrada,
  -- acima) -- resetados aqui tambem por defesa.
  update public.conversas_estado
  set estado = 'normal',
      episodio_atual_id = null,
      atualizado_em = now(),
      acesso_selecionado = null,
      intencao_atual = null,
      sessao_atividade_em = null
  where conversation_id = p_conversation_id
  returning * into v_conversa;

  insert into public.mensagens_conversa (conversation_id, episodio_id, origem, texto)
  values (p_conversation_id, v_episodio_id, 'sistema', format('Atendimento encerrado por %s', p_operador));

  return v_conversa;
end;
$$;

revoke all on function public.encerrar_atendimento_humano(uuid, text) from public;
grant execute on function public.encerrar_atendimento_humano(uuid, text) to service_role;
