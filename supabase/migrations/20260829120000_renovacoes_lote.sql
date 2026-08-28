-- Renovacao em lote (Etapa 1, 2026-08-29, inovatv_central/CLAUDE.md,
-- UX aprovada). Uma unica confirmacao + uma unica cobranca Pix pelo
-- total + um unico pagamento renovam N acessos. Cada acesso continua
-- com SUA linha em tokens_renovacao, SEU estado e SEU resultado -- a
-- maquina de estados por acesso NAO muda.
--
-- renovacoes_lote e' a "capa" do grupo: 1 token/link/botao para o
-- ACEITO, 1 operacao_id (cobranca), estado derivado dos filhos.
-- tokens_renovacao.grupo_id (nullable) liga cada acesso ao lote --
-- renovacao avulsa = grupo_id NULL, tipo 'sigma' (fluxo de hoje, byte
-- a byte).
--
-- tipo ('sigma' | 'unitv') nasce generico: a execucao UniTV fica
-- BLOQUEADA ate a Etapa 2 (o Orquestrador so' emite 'sigma' hoje), mas
-- os caminhos ja sao tipo-aware para nao precisar redesenhar depois.
--
-- Aplicacao: MANUAL via SQL Editor do Supabase (mesmo processo de toda
-- migration deste repositorio) -- este arquivo e' o artefato revisado,
-- nao roda sozinho.

-- ============================================================
-- 1. Tabela do lote
-- ============================================================
create table public.renovacoes_lote (
  grupo_id                uuid primary key default gen_random_uuid(),
  conversation_id         uuid not null references public.conversas_estado(conversation_id),
  telefone                text not null,
  -- token bruto (enviado ao cliente no id do botao) NUNCA gravado --
  -- so' o hash SHA-256, mesma disciplina de tokens_renovacao.
  token_hash              text not null unique,
  estado                  text not null default 'aguardando_confirmacao'
                            check (estado in (
                              'aguardando_confirmacao', 'cancelada', 'autorizada', 'expirada',
                              'renovacao_em_andamento', 'concluida', 'parcial', 'falhou'
                            )),
  valor_total_centavos    integer not null,
  -- rotulo INTERNO da regra comercial aplicada (auditoria/log) --
  -- NUNCA enviado ao cliente. Ver _shared/precos_renovacao.ts.
  regra_aplicada          text not null,
  operacao_id             uuid null references public.cobrancas_pix(operacao_id),
  criado_em               timestamptz not null default now(),
  expira_em               timestamptz not null,
  decidido_em             timestamptz null,
  renovacao_iniciada_em   timestamptz null,
  renovacao_concluida_em  timestamptz null
);

create index renovacoes_lote_operacao_id_idx on public.renovacoes_lote (operacao_id);
create index renovacoes_lote_conversation_id_idx on public.renovacoes_lote (conversation_id);

alter table public.renovacoes_lote enable row level security;

-- ============================================================
-- 2. tokens_renovacao -- ligacao ao lote + tipo generico
-- ============================================================
alter table public.tokens_renovacao
  add column grupo_id  uuid null references public.renovacoes_lote(grupo_id),
  add column tipo      text not null default 'sigma' check (tipo in ('sigma', 'unitv')),
  add column unitv_sn  text null,
  add column unitv_id  bigint null;

-- public_id era NOT NULL (todo acesso Sigma tem um). Passa a aceitar
-- NULL so' para um futuro item 'unitv' (identificado por sn/id). O
-- CHECK garante que cada linha tem exatamente o alvo do seu tipo.
alter table public.tokens_renovacao alter column public_id drop not null;
alter table public.tokens_renovacao
  add constraint tokens_renovacao_alvo_por_tipo check (
    (tipo = 'sigma' and public_id is not null) or
    (tipo = 'unitv' and unitv_sn is not null and unitv_id is not null)
  );

create index tokens_renovacao_grupo_id_idx on public.tokens_renovacao (grupo_id);

-- O indice unico "1 solicitacao ativa por acesso" continua valendo
-- para linhas Sigma (public_id preenchido) -- cada filho de um lote
-- tem seu proprio public_id, entao continua protegido contra uma
-- renovacao avulsa concorrente do mesmo acesso.
drop index if exists public.tokens_renovacao_ativo_unico_por_acesso_idx;
create unique index tokens_renovacao_ativo_unico_por_acesso_idx
  on public.tokens_renovacao (public_id)
  where public_id is not null
    and estado in ('aguardando_confirmacao', 'autorizada', 'renovacao_em_andamento');

-- ============================================================
-- 3. cobrancas_pix -- 1 cobranca pode ser de um lote
-- ============================================================
alter table public.cobrancas_pix
  add column grupo_id uuid null;

alter table public.cobrancas_pix alter column public_id drop not null;

-- Reescreve o indice de "1 pendente por acesso" para so' valer quando
-- ha' public_id (cobranca avulsa), e adiciona o equivalente por lote.
drop index if exists public.cobrancas_pix_pendente_unica_por_acesso_idx;
create unique index cobrancas_pix_pendente_por_acesso_idx
  on public.cobrancas_pix (public_id)
  where status = 'pendente' and public_id is not null;
create unique index cobrancas_pix_pendente_por_lote_idx
  on public.cobrancas_pix (grupo_id)
  where status = 'pendente' and grupo_id is not null;

-- ============================================================
-- 4. RPCs atomicas do lote (mesma disciplina CAS de
--    assumir_atendimento / acionar_transferencia_humana)
-- ============================================================

-- ACEITO do lote: numa unica transacao, move o lote e TODOS os filhos
-- de 'aguardando_confirmacao' para 'autorizada'. Retorna a linha do
-- lote (ou nada, se ja' decidido -> chamador trata como "ja_decidido").
create or replace function public.reivindicar_aceite_lote(p_token_hash text)
returns public.renovacoes_lote
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lote public.renovacoes_lote;
begin
  update public.renovacoes_lote
     set estado = 'autorizada', decidido_em = now()
   where token_hash = p_token_hash
     and estado = 'aguardando_confirmacao'
  returning * into v_lote;

  if v_lote.grupo_id is null then
    return null;
  end if;

  update public.tokens_renovacao
     set estado = 'autorizada', decidido_em = now()
   where grupo_id = v_lote.grupo_id
     and estado = 'aguardando_confirmacao';

  return v_lote;
end;
$$;

-- CANCELAR do lote: espelho do aceite.
create or replace function public.reivindicar_cancelamento_lote(p_token_hash text)
returns public.renovacoes_lote
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lote public.renovacoes_lote;
begin
  update public.renovacoes_lote
     set estado = 'cancelada', decidido_em = now()
   where token_hash = p_token_hash
     and estado = 'aguardando_confirmacao'
  returning * into v_lote;

  if v_lote.grupo_id is null then
    return null;
  end if;

  update public.tokens_renovacao
     set estado = 'cancelada', decidido_em = now()
   where grupo_id = v_lote.grupo_id
     and estado = 'aguardando_confirmacao';

  return v_lote;
end;
$$;

-- Inicio da renovacao do lote (disparado pelo openpix-webhook so'
-- quando marcarCobrancaComoPaga afetou uma linha de verdade): move o
-- lote e todos os filhos 'autorizada' -> 'renovacao_em_andamento'.
-- Retorna a linha do lote (ou nada, se ja' iniciado -> nao redispara).
create or replace function public.reivindicar_inicio_renovacao_lote(p_operacao_id uuid)
returns public.renovacoes_lote
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lote public.renovacoes_lote;
begin
  update public.renovacoes_lote
     set estado = 'renovacao_em_andamento', renovacao_iniciada_em = now()
   where operacao_id = p_operacao_id
     and estado = 'autorizada'
  returning * into v_lote;

  if v_lote.grupo_id is null then
    return null;
  end if;

  update public.tokens_renovacao
     set estado = 'renovacao_em_andamento', renovacao_iniciada_em = now()
   where grupo_id = v_lote.grupo_id
     and estado = 'autorizada';

  return v_lote;
end;
$$;

-- Falha do lote ANTES da cobranca vincular (ACEITO ok mas OpenPix
-- falhou) -- libera lote + filhos sem esperar o watchdog. CAS: so' se
-- ainda 'autorizada'.
create or replace function public.marcar_lote_como_falha(p_grupo_id uuid, p_motivo text)
returns public.renovacoes_lote
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lote public.renovacoes_lote;
begin
  update public.renovacoes_lote
     set estado = 'falhou'
   where grupo_id = p_grupo_id
     and estado in ('autorizada', 'renovacao_em_andamento')
  returning * into v_lote;

  if v_lote.grupo_id is null then
    return null;
  end if;

  update public.tokens_renovacao
     set estado = 'renovacao_falhou', motivo_falha = p_motivo
   where grupo_id = p_grupo_id
     and estado in ('autorizada', 'renovacao_em_andamento');

  return v_lote;
end;
$$;

revoke all on function public.reivindicar_aceite_lote(text) from public, anon, authenticated;
revoke all on function public.reivindicar_cancelamento_lote(text) from public, anon, authenticated;
revoke all on function public.reivindicar_inicio_renovacao_lote(uuid) from public, anon, authenticated;
revoke all on function public.marcar_lote_como_falha(uuid, text) from public, anon, authenticated;
grant execute on function public.reivindicar_aceite_lote(text) to service_role;
grant execute on function public.reivindicar_cancelamento_lote(text) to service_role;
grant execute on function public.reivindicar_inicio_renovacao_lote(uuid) to service_role;
grant execute on function public.marcar_lote_como_falha(uuid, text) to service_role;
