-- Memoria de sessao da IA (Camada 3) -- extensao com
-- esclarecimento_pendente (2026-09-04). Fecha o achado real do
-- atendimento do Elias (04/09/2026, "Queria saber sobre as TV"):
-- pergunta ampla/ambigua + nada_encontrado hoje sempre vira
-- transferencia; a partir desta extensao, a IA pode pedir esclarecimento
-- (tipo="responder" + esclarecimento=true, RESPONSE_SCHEMA de
-- _shared/gemini_client.ts) em vez de transferir automaticamente --
-- ver inovatv_central/CLAUDE.md, investigacao do caso Elias +
-- desenho aprovado (Opcao A, campo booleano estruturado, sem novo
-- "tipo").
--
-- Mesma disciplina de acesso_selecionado/intencao_atual (migrations
-- 20260823130000/20260823150000_sessao_ia*.sql): guarda so a MENSAGEM
-- LITERAL do cliente que gerou o pedido de esclarecimento -- nunca
-- interpretacao/paráfrase da IA. Nunca fonte de fato, so' sinal de
-- continuidade conversacional (montarContextoConversa,
-- _shared/contexto.ts) -- nao decide sozinho nada, quem decide
-- continua sendo o Gemini dentro do que o SYSTEM_PROMPT permite.
--
-- TTL: reaproveita o MESMO sessao_atividade_em ja existente (nenhum
-- TTL/cron novo) -- expirarSessaoAtomicamente ja zera acesso_selecionado/
-- intencao_atual quando a sessao expira (>1h de inatividade); esta
-- migration estende a MESMA funcao pra zerar tambem
-- esclarecimento_pendente, no mesmo evento, sem mecanismo adicional.
--
-- One-shot: o campo e' sempre reescrito a cada mensagem pelo
-- Orquestrador (valor novo OU null), nunca acumulado -- garantia de
-- codigo, nao so' de prompt, contra "esclarecimento ficar preso
-- indefinidamente" ou ser pedido mais de uma vez sobre o mesmo
-- assunto.
--
-- Invalidacao por atendimento humano: mesma razao ja registrada para
-- acesso_selecionado/intencao_atual (2026-08-23) -- nenhum contexto
-- operacional da IA deve atravessar um atendimento humano. As 3 RPCs
-- que ja zeram os outros dois campos nessas transicoes (definidas em
-- 20260816140000_painel_atendimento_fatia1.sql,
-- 20260823140000_sessao_ia_invalidada_por_atendimento_humano.sql,
-- 20260823160000_sessao_ia_intencao_atual_invalidada_por_atendimento_humano.sql)
-- sao recriadas aqui SO' para acrescentar esclarecimento_pendente = null
-- aos UPDATEs que ja existiam -- nenhuma outra linha alterada, nenhuma
-- mudanca de comportamento do atendimento humano em si (o corpo das 3
-- funcoes e' idêntico ao ja existente, exceto pela linha nova).

alter table public.conversas_estado
  add column if not exists esclarecimento_pendente text;

-- acionar_transferencia_humana: identica a
-- 20260823140000_sessao_ia_invalidada_por_atendimento_humano.sql,
-- so' com "esclarecimento_pendente = null" acrescentado ao UPDATE que
-- ja zerava acesso_selecionado/sessao_atividade_em.
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
      sessao_atividade_em = null,
      esclarecimento_pendente = null
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

-- assumir_atendimento: identica a
-- 20260823140000_sessao_ia_invalidada_por_atendimento_humano.sql, so'
-- com "esclarecimento_pendente = null" acrescentado ao UPDATE do ramo
-- (a) normal -> aguardando_humano. O ramo (b) (reivindicar episodio ja
-- aberto pela IA) nao mexe em conversas_estado, entao nao precisa de
-- alteracao (mesma nota ja registrada na migration original).
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
        sessao_atividade_em = null,
        esclarecimento_pendente = null
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

-- encerrar_atendimento_humano: identica a
-- 20260823140000_sessao_ia_invalidada_por_atendimento_humano.sql, so'
-- com "esclarecimento_pendente = null" acrescentado ao UPDATE que ja
-- zerava acesso_selecionado/sessao_atividade_em ao voltar pra 'normal'.
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

  update public.conversas_estado
  set estado = 'normal',
      episodio_atual_id = null,
      atualizado_em = now(),
      acesso_selecionado = null,
      sessao_atividade_em = null,
      esclarecimento_pendente = null
  where conversation_id = p_conversation_id
  returning * into v_conversa;

  insert into public.mensagens_conversa (conversation_id, episodio_id, origem, texto)
  values (p_conversation_id, v_episodio_id, 'sistema', format('Atendimento encerrado por %s', p_operador));

  return v_conversa;
end;
$$;

revoke all on function public.encerrar_atendimento_humano(uuid, text) from public;
grant execute on function public.encerrar_atendimento_humano(uuid, text) to service_role;
