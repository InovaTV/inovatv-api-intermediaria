-- Memoria de sessao da IA (Camada 3) invalidada por atendimento
-- humano (2026-08-23) -- decisao arquitetural aprovada pelo usuario
-- apos auditoria da implementacao original: nenhum contexto
-- operacional da IA (acesso_selecionado, sessao_atividade_em) deve
-- atravessar um atendimento humano.
--
-- Pontos confirmados por leitura do codigo real (nenhuma outra
-- migration depois de 20260816140000_painel_atendimento_fatia1.sql
-- redefine estas 3 RPCs -- confirmado por busca em todo
-- supabase/migrations/) que entram/saem de 'aguardando_humano':
--   - acionar_transferencia_humana: normal -> aguardando_humano
--     (transferencia automatica pela IA/Validador).
--   - assumir_atendimento: tem 2 ramos -- (a) normal ->
--     aguardando_humano (operador assume manualmente uma conversa que
--     a IA ainda nao transferiu) E (b) aguardando_humano ->
--     aguardando_humano (operador reivindica um episodio que a IA JA
--     abriu, "assumido_por" antes null) -- so' o ramo (a) e' uma
--     ENTRADA de verdade em aguardando_humano; o ramo (b) nao muda o
--     estado (ja estava aguardando_humano), entao nao precisa de
--     nenhuma invalidacao adicional (a sessao ja foi invalidada
--     quando a IA transferiu, via acionar_transferencia_humana).
--   - encerrar_atendimento_humano: aguardando_humano -> normal (o
--     unico ponto de SAIDA).
--
-- Mudanca minima e segura: "create or replace function" nas 3 RPCs,
-- SEM alterar assinatura, sem alterar nenhum outro comportamento --
-- so acrescenta acesso_selecionado=null/sessao_atividade_em=null aos
-- UPDATEs que ja existiam. Nenhum wrapper TypeScript
-- (_shared/conversas_estado.ts: acionarTransferenciaHumana/
-- assumirAtendimento/encerrarAtendimento) precisa mudar -- eles ja so'
-- repassam o retorno de "returning *" como ConversaEstado, tipo ja
-- estendido com os 2 campos novos (2026-08-23, migration
-- 20260823130000_sessao_ia.sql). Fluxo humano existente (Painel de
-- Atendimento) preservado sem nenhuma mudanca -- ele nunca le nem
-- escreve estes 2 campos.

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
  -- reaproveita acesso_selecionado anterior ao atendimento humano, nunca
  -- conta o tempo do atendimento humano como inatividade da IA (evita a
  -- mensagem "voce ficou ausente" logo apos um atendimento humano
  -- prolongado). acesso_selecionado ja deveria estar null (invalidado na
  -- entrada, acima) -- resetado aqui tambem por defesa, sem depender de
  -- nenhum caminho de entrada anterior ter tido sucesso.
  update public.conversas_estado
  set estado = 'normal',
      episodio_atual_id = null,
      atualizado_em = now(),
      acesso_selecionado = null,
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
