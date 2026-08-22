-- conhecimento_institucional
-- Camada de Conhecimento Empresarial (Componente 2, inovatv_central
-- CLAUDE.md, "Especificação Técnica -- Componente 2 (CONCLUIDA/
-- APROVADA, 2026-08-15)"). Schema identico ao ja fechado la (secao
-- 6): dona so do conteudo institucional -- planos, suporte, politicas
-- -- nunca dado de cliente.
--
-- ARQUIVO CRIADO PARA REVISAO -- NAO APLICADO no banco remoto ate
-- aprovacao explicita do usuario (mesmo processo ja usado em toda
-- migration anterior deste repositorio: criar -> revisar -> so entao
-- aplicar manualmente via SQL Editor do Supabase).
--
-- palavras_chave: normalizado em minusculas/sem acento no momento da
-- carga (Componente 2 §7) -- a normalizacao da PERGUNTA do cliente
-- acontece em runtime, na busca; as palavras-chave armazenadas aqui
-- ja devem estar no mesmo formato para a comparacao funcionar.

create table if not exists public.conhecimento_institucional (
  id             uuid primary key default gen_random_uuid(),
  categoria      text not null,
  titulo         text not null,
  palavras_chave text[] not null default '{}',
  conteudo       text not null,
  ativo          boolean not null default true,
  atualizado_em  timestamptz not null default now()
);

alter table public.conhecimento_institucional enable row level security;

-- Nenhuma policy para anon/authenticated. Isolamento de acesso
-- explicito conforme Componente 1 §17 -- so service_role (usado
-- pelas Edge Functions) acessa esta tabela. Curadoria em V1 e' via
-- Supabase Studio/SQL direto (Componente 2 §8 -- sem painel de
-- administracao proprio nesta fase, decisao explicita).
