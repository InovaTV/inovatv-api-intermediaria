-- conversas_estado
-- Estado operacional minimo da IA propria (inovatv_central, CLAUDE.md,
-- Componente 1 §17 / Componente 5 §7). Nunca historico de mensagens --
-- so o suficiente pra a IA nao responder sozinha enquanto
-- aguardando_humano, e pra Interface Humana Web assumir/encerrar.
--
-- conversation_id: identificador proprio da conversa, gerado quando a
-- conversa e estabelecida -- deliberadamente separado do telefone
-- (decisao do usuario, 2026-08-15): telefone identifica o cliente,
-- conversation_id identifica a conversa operacional. Sao conceitos
-- diferentes mesmo que a V1 mantenha 1:1 entre eles (ver UNIQUE
-- abaixo).
--
-- UNIQUE(telefone): restricao pragmatica de V1, nao decisao de
-- arquitetura permanente. Nesta fase nao existe conceito de multiplas
-- conversas/sessoes por telefone -- a mesma linha e reaproveitada
-- indefinidamente (normal <-> aguardando_humano). Se sessoes
-- independentes forem necessarias no futuro, esta restricao e o
-- modelo de estado sao revisados juntos.

create table if not exists public.conversas_estado (
  conversation_id  uuid primary key default gen_random_uuid(),
  telefone         text not null unique,
  estado           text not null default 'normal' check (estado in ('normal', 'aguardando_humano')),
  motivo           text,
  entrou_em_espera timestamptz,
  assumido_por     text,
  assumido_em      timestamptz,
  atualizado_em    timestamptz not null default now()
);

alter table public.conversas_estado enable row level security;

-- Nenhuma policy para anon/authenticated. Isolamento de acesso
-- explicito conforme Componente 1 §17 -- so service_role (usado
-- pelas Edge Functions) acessa esta tabela.
