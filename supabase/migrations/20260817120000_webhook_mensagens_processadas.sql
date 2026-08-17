-- webhook_mensagens_processadas
-- Componente 3 (Webhook WhatsApp Cloud API), decisao arquitetural 3
-- (deduplicacao, inovatv_central CLAUDE.md, aprovada 2026-08-17).
--
-- Deduplicacao atomica por message_id da Meta -- garante que o mesmo
-- evento de webhook (reenviado pela Meta por timeout/retry) nunca
-- resulte em duas execucoes do Orquestrador (Componente 3 §9). A
-- atomicidade vem da propria constraint UNIQUE/PK do Postgres: o
-- Webhook faz "insert ... on conflict do nothing" e confere quantas
-- linhas afetou -- 1 linha = primeira vez, processa; 0 linhas = ja
-- visto, descarta. Nao precisa de lock explicito.
--
-- Retencao: 7 dias, decisao explicita do usuario -- SEM pg_cron nem
-- rotina automatica de limpeza nesta V1. A tabela nao expira sozinha;
-- "7 dias" e uma politica documentada, aplicada manualmente quando
-- necessario com:
--   delete from public.webhook_mensagens_processadas
--   where recebido_em < now() - interval '7 days';
--
-- Sem policy de RLS publica -- mesmo padrao ja usado em
-- conversas_estado/conversas_episodios/mensagens_conversa: acesso so
-- via service_role, dentro da propria Edge Function do Webhook.

create table if not exists public.webhook_mensagens_processadas (
  message_id  text primary key,
  recebido_em timestamptz not null default now()
);

alter table public.webhook_mensagens_processadas enable row level security;
