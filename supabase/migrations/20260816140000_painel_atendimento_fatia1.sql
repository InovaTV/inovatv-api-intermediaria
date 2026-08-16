-- Painel de Atendimento -- Fatia 1 (schema + RPCs)
-- inovatv_central, CLAUDE.md, Componente 5 SS7/SS7-B/SS8/SS9/SS11/SS12
-- Aplicar manualmente no SQL Editor do Supabase, apos aprovacao.
-- Auditoria real do banco (2026-08-16): 2 conversas aguardando_humano
-- (ambas com motivo preenchido), 11 mensagens (6 cliente/5 ia/0 humano),
-- 11/11 mensagens encontram episodio pelo backfill -- zero orfas.
-- Revisada em 3 rodadas (Claude + GPT + auditoria real do banco):
-- correcao da mensagem 'sistema' faltante em acionar_transferencia_humana,
-- guarda explicita de nao-reaplicacao, confirmacao de que episodio
-- historico sem episodio_atual_id e' comportamento intencional
-- (Componente 5 SS7), confirmacao de que RLS sem policy publica em
-- conversas_episodios bate com a arquitetura ja aprovada (Painel nunca
-- acessa tabela direto, sempre via Edge Function + service_role).
--
-- NAO idempotente por design -- roda uma unica vez. A guarda logo
-- abaixo garante que uma segunda execucao acidental falhe com
-- mensagem clara, em vez de um erro obscuro de coluna inexistente.

begin;

-- ===== GUARDA: recusa rodar de novo se ja foi aplicada =====

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'conversas_episodios'
  ) then
    raise exception 'Migration 20260816140000_painel_atendimento_fatia1 ja foi aplicada (conversas_episodios ja existe) -- abortando, nao roda de novo'
      using errcode = 'P0001';
  end if;
end $$;

-- ===== PASSO 1: estruturas novas =====

create table if not exists public.conversas_episodios (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversas_estado(conversation_id),
  origem          text not null check (origem in ('ia', 'operador')),
  motivo          text,
  iniciado_em     timestamptz not null default now(),
  assumido_por    text,
  assumido_em     timestamptz,
  encerrado_em    timestamptz,
  encerrado_por   text
);

create index if not exists idx_conversas_episodios_conversation_id
  on public.conversas_episodios(conversation_id);

alter table public.conversas_episodios enable row level security;
-- Sem policy publica: acesso so via service_role, atraves das Edge
-- Functions painel-atendimento-* (arquitetura ja aprovada, CLAUDE.md,
-- Plano de Execucao do Painel de Atendimento -- "nunca acesso direto
-- de tabela via RLS solto para o cliente").

alter table public.conversas_estado
  add column if not exists nome_snapshot text;

alter table public.conversas_estado
  add column if not exists episodio_atual_id uuid references public.conversas_episodios(id);

create index if not exists idx_conversas_estado_episodio_atual_id
  on public.conversas_estado(episodio_atual_id);

-- ===== PASSO 2 + 3: copiar dado existente e vincular os episodios =====
-- (2 conversas aguardando_humano confirmadas -- as duas ficam com
-- episodio_atual_id apontando pra elas. Uma eventual conversa 'normal'
-- com motivo antigo cria episodio historico FECHADO, sem
-- episodio_atual_id -- intencional: Componente 5 SS7, episodio_atual_id
-- "aponta pro episodio em aberto; null quando estado = 'normal'")

with migrados as (
  insert into public.conversas_episodios
    (conversation_id, origem, motivo, iniciado_em, assumido_por, assumido_em, encerrado_em, encerrado_por)
  select
    ce.conversation_id,
    'ia',
    ce.motivo,
    coalesce(ce.entrou_em_espera, ce.atualizado_em),
    ce.assumido_por,
    ce.assumido_em,
    case when ce.estado = 'aguardando_humano' then null else ce.atualizado_em end,
    case when ce.estado = 'aguardando_humano' then null else 'sistema:fechado_na_migracao_20260816' end
  from public.conversas_estado ce
  where ce.motivo is not null
  returning id, conversation_id, encerrado_em
)
update public.conversas_estado ce
set episodio_atual_id = m.id
from migrados m
where ce.conversation_id = m.conversation_id
  and m.encerrado_em is null;

-- ===== PASSO 6 (parte 1): remover so as colunas ja migradas acima =====

alter table public.conversas_estado drop column if exists motivo;
alter table public.conversas_estado drop column if exists entrou_em_espera;
alter table public.conversas_estado drop column if exists assumido_por;
alter table public.conversas_estado drop column if exists assumido_em;

-- ===== PASSO 4: rename + vincular as 11 mensagens existentes =====

alter table if exists public.mensagens_atendimento_humano
  rename to mensagens_conversa;

alter table public.mensagens_conversa
  add column if not exists episodio_id uuid references public.conversas_episodios(id);

update public.mensagens_conversa mc
set episodio_id = ep.id
from public.conversas_episodios ep
where ep.conversation_id = mc.conversation_id
  and mc.episodio_id is null;

-- ===== PASSO 5: ajustar constraints/indices =====

create index if not exists idx_mensagens_conversa_episodio_id
  on public.mensagens_conversa(episodio_id);

alter index if exists public.idx_mensagens_atendimento_conversation_id
  rename to idx_mensagens_conversa_conversation_id;

do $$
declare
  v_constraint_name text;
begin
  select con.conname into v_constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_attribute att on att.attrelid = rel.oid and att.attnum = any(con.conkey)
  where rel.relname = 'mensagens_conversa'
    and con.contype = 'c'
    and att.attname = 'origem';

  if v_constraint_name is not null then
    execute format('alter table public.mensagens_conversa drop constraint %I', v_constraint_name);
  end if;
end $$;

alter table public.mensagens_conversa
  add constraint mensagens_conversa_origem_check
  check (origem in ('cliente', 'ia', 'humano', 'sistema'));

-- ===== PASSO 7: criar as RPCs =====

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
      atualizado_em = now()
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
        atualizado_em = now()
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

  update public.conversas_estado
  set estado = 'normal',
      episodio_atual_id = null,
      atualizado_em = now()
  where conversation_id = p_conversation_id
  returning * into v_conversa;

  insert into public.mensagens_conversa (conversation_id, episodio_id, origem, texto)
  values (p_conversation_id, v_episodio_id, 'sistema', format('Atendimento encerrado por %s', p_operador));

  return v_conversa;
end;
$$;

revoke all on function public.encerrar_atendimento_humano(uuid, text) from public;
grant execute on function public.encerrar_atendimento_humano(uuid, text) to service_role;

-- ===== PASSO 8: fim da transacao =====

commit;
