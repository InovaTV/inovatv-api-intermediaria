-- mensagens_atendimento_humano
-- Escopo minimo hibrido de mensagem literal (inovatv_central,
-- CLAUDE.md, Arquitetura Formal §14 revisada / Componente 5 §12).
-- NAO e historico completo de conversa -- so o que e necessario para
-- o humano entender por que foi transferido e continuar o
-- atendimento:
--   - no momento da transferencia: mensagem literal do cliente que
--     provocou a transferencia + texto estruturado do Gemini
--     (origem='cliente' e 'ia', mesmo quando o texto da IA nao foi o
--     que chegou ao cliente -- e so contexto interno pro humano);
--   - enquanto aguardando_humano: mensagens novas do cliente e
--     respostas da Interface Humana Web (origem='cliente' e 'humano');
--   - nunca historico anterior ao gatilho da transferencia, nem
--     conversas que permanecem em estado normal.
--
-- Retencao: mesma politica provisoria do Componente 1 §19 (30-90
-- dias, nao fechada definitivamente) -- nenhum mecanismo de retencao
-- novo criado por esta migration.

create table if not exists public.mensagens_atendimento_humano (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversas_estado(conversation_id),
  origem          text not null check (origem in ('cliente', 'ia', 'humano')),
  texto           text not null,
  criado_em       timestamptz not null default now()
);

create index if not exists idx_mensagens_atendimento_conversation_id
  on public.mensagens_atendimento_humano(conversation_id);

alter table public.mensagens_atendimento_humano enable row level security;

-- Mesma politica de isolamento da conversas_estado -- so service_role
-- acessa, nenhuma policy para anon/authenticated.
