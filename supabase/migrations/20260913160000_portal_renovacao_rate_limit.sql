-- Rate limiting da identificacao por telefone do Portal de Renovacao
-- Tope TV (Checkpoint 5) -- protege SOMENTE POST etapa=telefone de
-- supabase/functions/renovacao-iniciar/index.ts contra abuso/enumeracao
-- por tentativas repetidas de telefone. Nenhuma outra etapa do Portal
-- (carrinho/confirmar) e nenhuma outra Edge Function usa esta tabela.
--
-- Design: 1 linha POR TELEFONE (chave), nao 1 linha por tentativa --
-- contador com janela deslizante simples (janela_inicio + tentativas),
-- resetado quando a janela expira. Armazenamento proporcional a
-- TELEFONES DISTINTOS que ja tentaram, nunca a tentativas -- ao
-- contrario de uma tabela de log que cresce sem limite.
--
-- `chave` = SHA-256 hex do telefone NORMALIZADO (hashToken(), o MESMO
-- helper ja usado para o token de renovacao em _shared/tokens_renovacao.ts
-- -- reaproveitado, nao duplicado). O telefone em si NUNCA e' gravado
-- aqui, nem em texto puro nem em nenhuma outra forma.
--
-- Atomicidade sob concorrencia: a funcao registrar_tentativa_portal_renovacao
-- abaixo faz um UNICO "insert ... on conflict (chave) do update ...
-- returning" -- mesma familia de tecnica ja usada no projeto para
-- deduplicacao atomica (20260817120000_webhook_mensagens_processadas.sql,
-- "insert ... on conflict do nothing" + conferir linhas afetadas). O
-- Postgres serializa automaticamente updates concorrentes NA MESMA linha
-- via o lock implicito do proprio ON CONFLICT -- chaves (telefones)
-- diferentes nunca se bloqueiam entre si. Nao precisa de
-- pg_advisory_lock nem de nenhum lock explicito -- deliberadamente,
-- para nao introduzir uma tecnica de concorrencia nova neste projeto
-- quando a UPSERT atomica padrao ja resolve o problema real (corrida
-- SELECT->conta->INSERT, que esta funcao evita por nunca fazer um
-- SELECT separado antes do INSERT/UPDATE).
--
-- Retencao/limpeza: MESMA decisao ja documentada e ja tomada pelo
-- projeto em 20260817120000_webhook_mensagens_processadas.sql -- sem
-- pg_cron nem rotina automatica de limpeza nesta V1 (o crescimento ja e'
-- limitado a 1 linha por telefone distinto, nao por tentativa -- uma
-- tabela pequena mesmo sem limpeza ativa). Politica documentada, aplicavel
-- manualmente se um dia for necessario:
--   delete from public.portal_renovacao_rate_limit
--   where atualizado_em < now() - interval '30 days';
--
-- RLS sem policy publica -- mesmo padrao de toda tabela do projeto (so'
-- service_role acessa, sempre de dentro da propria Edge Function).

create table public.portal_renovacao_rate_limit (
  chave          text primary key,
  janela_inicio  timestamptz not null default now(),
  tentativas     integer not null default 1,
  atualizado_em  timestamptz not null default now()
);

alter table public.portal_renovacao_rate_limit enable row level security;

-- Retorna true = permitido, false = limite atingido nesta janela.
-- p_janela_segundos/p_limite vem do chamador (_shared/portal_rate_limit.ts)
-- -- a funcao SQL nao hardcoda a politica, so' executa a operacao atomica.
create or replace function public.registrar_tentativa_portal_renovacao(
  p_chave text,
  p_janela_segundos integer,
  p_limite integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tentativas integer;
begin
  insert into public.portal_renovacao_rate_limit (chave, janela_inicio, tentativas, atualizado_em)
  values (p_chave, now(), 1, now())
  on conflict (chave) do update set
    tentativas = case
      when public.portal_renovacao_rate_limit.janela_inicio <= now() - make_interval(secs => p_janela_segundos)
        then 1
      else public.portal_renovacao_rate_limit.tentativas + 1
    end,
    janela_inicio = case
      when public.portal_renovacao_rate_limit.janela_inicio <= now() - make_interval(secs => p_janela_segundos)
        then now()
      else public.portal_renovacao_rate_limit.janela_inicio
    end,
    atualizado_em = now()
  returning tentativas into v_tentativas;

  return v_tentativas <= p_limite;
end;
$$;
