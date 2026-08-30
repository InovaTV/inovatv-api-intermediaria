-- Fase 2A da autocura do UNITV_DEALER_TOKEN (2026-08-30, inovatv_central/
-- CLAUDE.md, "Frente -- Fluxo de Renovacao Automatica", Etapa 2 UniTV /
-- autocura). Move a FONTE VIVA do dealer token do painel de revenda
-- UniTV para o Supabase Vault, mantendo o Edge secret
-- UNITV_DEALER_TOKEN como BOOTSTRAP e FALLBACK.
--
-- Mesmo padrao ja em producao neste projeto para a sessao do Rocket
-- (migration 20260821150000: vault.secrets + RPCs
-- rocket_sessao_ler/rocket_sessao_definir, SECURITY DEFINER, REVOKE de
-- anon/authenticated, GRANT so a service_role).
--
-- ESTA FASE NAO ROTACIONA NADA. O valor do token NAO aparece nesta
-- migration -- o bootstrap ('select unitv_dealer_token_definir(...)')
-- e' uma acao humana separada, feita no SQL Editor com o valor colado
-- na hora (nunca em arquivo/commit/log), DEPOIS que esta migration for
-- aplicada. Vault e secret comecam com o MESMO valor.
--
-- A autocura (login/CAPTCHA/rotacao) e' Fase 4, fora daqui. Esta
-- migration so' cria a fonte viva que a Fase 4 podera atualizar, via a
-- mesma RPC unitv_dealer_token_definir.
--
-- Consumidores (Fase 2A):
--   * _shared/unitv_dealer_token.ts (obterDealerToken) -- Edge Functions
--     via getServiceClient().rpc("unitv_dealer_token_ler"); fallback env.
--   * scripts/renovacao-sigma-workflow.mjs -- runner do GitHub Actions
--     via POST /rest/v1/rpc/unitv_dealer_token_ler com a service_role
--     key (ja disponivel no .yml; NENHUMA credencial nova); fallback env.
-- scripts/lib/unitv-renovar.mjs permanece byte a byte intocado -- quem
-- injeta o token e' o chamador.
--
-- APLICACAO: MANUAL via SQL Editor do Supabase (mesmo processo de toda
-- migration deste repositorio) -- este arquivo e' o artefato revisado,
-- nao roda sozinho.

-- supabase_vault (v0.3.1) ja instalado (confirmado por pg_extension).

-- ---------------------------------------------------------------------
-- Metadados operacionais -- NUNCA o token. So' quem/quando/porque da
-- ultima escrita (o Vault nao guarda isso).
-- ---------------------------------------------------------------------
create table public.unitv_dealer_token_estado (
  id             integer primary key default 1,
  origem         text not null default 'bootstrap'
                   check (origem in ('bootstrap', 'recaptura_manual', 'autocura')),
  atualizado_em  timestamptz not null default now(),
  atualizado_por text,
  constraint unitv_dealer_token_estado_singleton check (id = 1)
);

insert into public.unitv_dealer_token_estado (id, origem)
values (1, 'bootstrap')
on conflict (id) do nothing;

-- RLS on, SEM policy -- mesmo isolamento de rocket_session_estado /
-- tokens_renovacao / cobrancas_pix (so' service_role acessa).
alter table public.unitv_dealer_token_estado enable row level security;

-- ---------------------------------------------------------------------
-- LEITURA: unica forma de obter o dealer token vivo. NULL/'' quando o
-- Vault ainda nao foi semeado (o chamador cai no fallback do env).
-- ---------------------------------------------------------------------
create or replace function public.unitv_dealer_token_ler()
returns text
language sql
security definer
set search_path = public, vault, pg_temp
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'unitv_dealer_token'
$$;

revoke all on function public.unitv_dealer_token_ler() from public, anon, authenticated;
grant execute on function public.unitv_dealer_token_ler() to service_role;

-- ---------------------------------------------------------------------
-- ESCRITA: create-or-update no Vault + carimbo de metadados. Usada
-- pelo bootstrap humano (uma vez) e, no futuro, pela autocura (Fase 4)
-- e por recaptura manual. NUNCA faz RAISE/log de p_token.
-- ---------------------------------------------------------------------
create or replace function public.unitv_dealer_token_definir(
  p_token  text,
  p_origem text default 'recaptura_manual',
  p_por    text default null
)
returns void
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare
  v_id uuid;
begin
  if p_token is null or length(trim(p_token)) = 0 then
    raise exception 'unitv_dealer_token_definir: token vazio' using errcode = 'P0001';
  end if;
  if p_origem not in ('bootstrap', 'recaptura_manual', 'autocura') then
    raise exception 'unitv_dealer_token_definir: origem invalida' using errcode = 'P0001';
  end if;

  select id into v_id from vault.secrets where name = 'unitv_dealer_token';
  if v_id is null then
    perform vault.create_secret(
      p_token,
      'unitv_dealer_token',
      'Dealer token vivo do painel de revenda UniTV (sessao, TTL curto). Fonte viva; o Edge secret UNITV_DEALER_TOKEN e bootstrap/fallback.'
    );
  else
    perform vault.update_secret(v_id, p_token);
  end if;

  update public.unitv_dealer_token_estado
     set origem = p_origem,
         atualizado_em = now(),
         atualizado_por = coalesce(p_por, current_user)
   where id = 1;
end;
$$;

revoke all on function public.unitv_dealer_token_definir(text, text, text) from public, anon, authenticated;
grant execute on function public.unitv_dealer_token_definir(text, text, text) to service_role;
