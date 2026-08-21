-- Monitoramento de sessao do Rocket (frente "Plano B", ver CLAUDE.md
-- do inovatv_meta_business_agent). Duas partes deliberadamente
-- separadas:
--
-- 1. rocket_session_estado -- so metadado operacional, NUNCA
--    sessionid/csrftoken em texto puro (regra explicita do usuario).
-- 2. RPCs rocket_sessao_definir/rocket_sessao_ler -- unico caminho
--    de leitura/escrita da sessao real, que vive no Supabase Vault
--    (extensao ja confirmada instalada, v0.3.1). SECURITY DEFINER +
--    REVOKE de anon/authenticated + GRANT so a service_role: nenhuma
--    outra parte do sistema (Painel de Atendimento, frontend, anon
--    key) consegue ler/escrever a sessao, mesmo sabendo o nome das
--    funcoes.
--
-- Primeira vez que este projeto usa Cron Job real do Supabase
-- (pg_cron + pg_net, nenhum dos dois estava habilitado antes --
-- confirmado por consulta direta ao pg_extension nesta sessao).

create table if not exists rocket_session_estado (
  id integer primary key default 1,
  status text not null default 'invalida' check (status in ('valida', 'invalida')),
  ultima_verificacao_bem_sucedida_em timestamptz,
  sessao_capturada_em timestamptz,
  sessao_invalidada_em timestamptz,
  alerta_issue_numero integer,
  alerta_issue_criado_em timestamptz,
  atualizado_em timestamptz not null default now(),
  constraint rocket_session_estado_singleton check (id = 1)
);

insert into rocket_session_estado (id, status)
values (1, 'invalida')
on conflict (id) do nothing;

alter table rocket_session_estado enable row level security;
-- Nenhuma policy para anon/authenticated -- mesmo isolamento ja
-- documentado em supabase_client.ts (so quem tem service_role acessa,
-- nao uma policy de linha).

create or replace function rocket_sessao_definir(p_sessionid text, p_csrftoken text)
returns void
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare
  v_id_sessionid uuid;
  v_id_csrftoken uuid;
begin
  select id into v_id_sessionid from vault.secrets where name = 'rocket_sessionid';
  if v_id_sessionid is null then
    perform vault.create_secret(p_sessionid, 'rocket_sessionid', 'Cookie sessionid da sessao autenticada do Rocket (login humano, capturado manualmente)');
  else
    perform vault.update_secret(v_id_sessionid, p_sessionid);
  end if;

  select id into v_id_csrftoken from vault.secrets where name = 'rocket_csrftoken';
  if v_id_csrftoken is null then
    perform vault.create_secret(p_csrftoken, 'rocket_csrftoken', 'Cookie csrftoken da sessao autenticada do Rocket');
  else
    perform vault.update_secret(v_id_csrftoken, p_csrftoken);
  end if;

  update rocket_session_estado
  set sessao_capturada_em = now(), atualizado_em = now()
  where id = 1;
end;
$$;

revoke all on function rocket_sessao_definir(text, text) from public, anon, authenticated;
grant execute on function rocket_sessao_definir(text, text) to service_role;

create or replace function rocket_sessao_ler()
returns table(sessionid text, csrftoken text)
language sql
security definer
set search_path = public, vault, pg_temp
as $$
  select
    (select decrypted_secret from vault.decrypted_secrets where name = 'rocket_sessionid'),
    (select decrypted_secret from vault.decrypted_secrets where name = 'rocket_csrftoken');
$$;

revoke all on function rocket_sessao_ler() from public, anon, authenticated;
grant execute on function rocket_sessao_ler() to service_role;

-- Agendamento: a cada 4 horas, aciona monitorar-sessao-rocket via
-- pg_net. O token de autenticacao (X-Internal-Token) e' lido do
-- Vault EM TEMPO DE EXECUCAO -- o texto deste comando (visivel em
-- cron.job, para quem tiver acesso de leitura ao catalogo) nunca
-- contem o valor do token, so a referencia por nome. O valor real ja
-- foi inserido no Vault fora desta migration (nunca commitado em
-- arquivo).
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'monitorar-sessao-rocket',
  '0 */4 * * *',
  $$
  select net.http_post(
    url := 'https://nduxsuxkopuvhwugdkqi.supabase.co/functions/v1/monitorar-sessao-rocket',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Internal-Token', (select decrypted_secret from vault.decrypted_secrets where name = 'sessao_rocket_monitor_token')
    ),
    body := '{}'::jsonb
  );
  $$
);
