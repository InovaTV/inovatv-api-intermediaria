-- Base Evolutiva de Suporte (camada de dados) -- arquitetura conceitual
-- aprovada em 2026-09-11 (conversa "evolucao da IA para suporte tecnico
-- baseado em casos reais"). Esta migration cria SOMENTE a camada de
-- dados -- Orchestrator, Gemini, SYSTEM_PROMPT, processamento de
-- imagens, integracao Hostinger, painel de curadoria, pipeline
-- automatico de aprendizado, algoritmo de busca e memoria de
-- tentativas em runtime continuam FORA de escopo, deliberadamente.
--
-- NAO substitui public.conhecimento_institucional (migration
-- 20260822120000) -- essa tabela continua intocada, em uso normal
-- pelo Orquestrador (_shared/conhecimento.ts), exatamente como esta.
-- Se conhecimento_suporte um dia substituir conhecimento_institucional,
-- isso e' decisao futura separada, NAO decidida nem migrada aqui.
--
-- Convencoes seguidas, todas conferidas nas migrations reais existentes
-- antes de escrever esta (nenhuma inventada):
-- - uuid primary key default gen_random_uuid() (conversas_estado,
--   tokens_renovacao, conhecimento_institucional).
-- - timestamptz not null default now() para carimbos de tempo; SEM
--   trigger de auto-update em atualizado_em -- nenhuma tabela do
--   projeto usa trigger para isso, e' responsabilidade do chamador
--   (mesmo padrao de conhecimento_institucional.atualizado_em).
-- - text[] not null default '{}' para arrays (identico a
--   conhecimento_institucional.palavras_chave).
-- - check (col in (...)) para campos de estado fechado/pequeno
--   (identico a conversas_estado.estado e tokens_renovacao.estado) --
--   usado aqui em status/resultado/tipo. aplicativo/servidor/
--   dispositivo/categoria ficam texto livre, sem check, pelo mesmo
--   motivo que categoria em conhecimento_institucional e' livre: sao
--   vocabularios abertos que crescem com o tempo.
-- - Nenhuma migration existente usa "on delete"/"on update" em nenhuma
--   FK (conferido com grep em todo o diretorio) -- o padrao do projeto
--   e' o comportamento padrao do Postgres (RESTRICT/NO ACTION), nunca
--   CASCADE. Mantido aqui de proposito: um conhecimento_suporte usado
--   por uma tentativa/evidencia/midia NAO pode ser apagado sem
--   primeiro remover essas referencias -- protege o historico, que e'
--   exatamente o requisito explicito desta tarefa.
-- - RLS habilitado, ZERO policy para anon/authenticated -- so'
--   service_role (usado pelas Edge Functions) acessa, mesmo padrao de
--   toda tabela do projeto ate hoje.
--
-- conversation_id: conferido antes de criar a FK -- e' uuid primary
-- key em public.conversas_estado (migration 20260815210000). Como o
-- tipo e' compativel e a tabela existe e e' inequivoca, usa FK real
-- (mesmo padrao ja usado por tokens_renovacao.conversation_id).

-- ---------------------------------------------------------------------
-- 1) conhecimento_suporte -- nucleo da Base Evolutiva. Cada linha e' um
-- procedimento (generico ou especifico por aplicativo/servidor/
-- dispositivo). conhecimento_pai_id permite encadear procedimentos
-- relacionados ao MESMO problema (ex.: tentativa especifica antes de
-- uma generica) -- so' o relacionamento existe aqui; a logica de
-- percorrer a cadeia em sequencia fica para depois, nao implementada
-- nesta etapa.
-- ---------------------------------------------------------------------
create table public.conhecimento_suporte (
  id                   uuid primary key default gen_random_uuid(),
  -- Contexto de aplicabilidade -- todos nullable: null significa "se
  -- aplica independente deste eixo" (ex.: um procedimento de
  -- aplicativo que vale para qualquer servidor tem servidor=null).
  aplicativo           text null,
  servidor             text null,
  dispositivo          text null,
  categoria            text not null,
  titulo               text not null,
  problema             text not null,
  sintomas             text[] not null default '{}',
  palavras_chave       text[] not null default '{}',
  procedimento         text not null,
  -- Posicao na sequencia de diagnostico do MESMO problema (ver
  -- conhecimento_pai_id). Null = nao faz parte de uma sequencia
  -- conhecida ainda.
  ordem                integer null,
  resultado_validado   boolean not null default false,
  -- Proveniencia (ex.: "Atendimento real, cliente X, 2026-09-11,
  -- confirmado pelo cliente"). Null permitido -- nem todo conhecimento
  -- (ex.: importado de material institucional antigo) tem um caso real
  -- de origem identificavel.
  fonte                text null,
  status               text not null default 'candidato'
                         check (status in ('candidato', 'revisao', 'ativo', 'arquivado')),
  versao               integer not null default 1,
  conhecimento_pai_id  uuid null references public.conhecimento_suporte(id),
  atualizado_em        timestamptz not null default now(),
  constraint conhecimento_suporte_ordem_positiva
    check (ordem is null or ordem >= 1),
  constraint conhecimento_suporte_versao_positiva
    check (versao >= 1)
);

comment on table public.conhecimento_suporte is
  'Base Evolutiva de Suporte -- procedimentos de suporte tecnico, '
  'genericos ou especificos por aplicativo/servidor/dispositivo. '
  'Camada de dados apenas -- nao consumida ainda pelo Orquestrador '
  '(2026-09-11). Convive com conhecimento_institucional, nao a '
  'substitui.';

-- Indices: os 3 eixos de contexto (filtro futuro mais obvio: "achar
-- conhecimento deste aplicativo/servidor/dispositivo") sao
-- majoritariamente null hoje (a maioria das entradas tende a ser
-- generica) -- indice parcial (so' linhas preenchidas) evita indexar
-- o que na pratica sera' um monte de NULL sem utilidade de busca.
-- categoria e status sao NOT NULL e ja usados como filtro pelo padrao
-- existente (conhecimento_institucional filtra por "ativo"); indice
-- pleno faz sentido para os dois. conhecimento_pai_id e' FK
-- auto-referente, indexado pelo mesmo motivo que toda FK usada em
-- lookup e' indexada no projeto (tokens_renovacao_operacao_id_idx).
create index conhecimento_suporte_aplicativo_idx
  on public.conhecimento_suporte (aplicativo) where aplicativo is not null;
create index conhecimento_suporte_servidor_idx
  on public.conhecimento_suporte (servidor) where servidor is not null;
create index conhecimento_suporte_dispositivo_idx
  on public.conhecimento_suporte (dispositivo) where dispositivo is not null;
create index conhecimento_suporte_categoria_idx
  on public.conhecimento_suporte (categoria);
create index conhecimento_suporte_status_idx
  on public.conhecimento_suporte (status);
create index conhecimento_suporte_pai_idx
  on public.conhecimento_suporte (conhecimento_pai_id) where conhecimento_pai_id is not null;

alter table public.conhecimento_suporte enable row level security;

-- ---------------------------------------------------------------------
-- 2) tentativas_suporte -- memoria operacional: qual conhecimento foi
-- tentado, em qual conversa, com que resultado. NAO e' lida/escrita
-- por nenhum codigo ainda -- so' o schema existe nesta etapa.
-- ---------------------------------------------------------------------
create table public.tentativas_suporte (
  id                       uuid primary key default gen_random_uuid(),
  conversation_id          uuid not null references public.conversas_estado(conversation_id),
  conhecimento_id          uuid not null references public.conhecimento_suporte(id),
  resultado                text not null default 'pendente'
                             check (resultado in ('pendente', 'sucesso', 'falha')),
  proximo_procedimento_id  uuid null references public.conhecimento_suporte(id),
  criado_em                timestamptz not null default now()
);

comment on table public.tentativas_suporte is
  'Registro de qual conhecimento de suporte foi tentado em qual '
  'conversa e com que resultado. Camada de dados apenas -- nenhum '
  'codigo grava/le esta tabela ainda (2026-09-11).';

create index tentativas_suporte_conversation_id_idx
  on public.tentativas_suporte (conversation_id);
create index tentativas_suporte_conhecimento_id_idx
  on public.tentativas_suporte (conhecimento_id);

alter table public.tentativas_suporte enable row level security;

-- ---------------------------------------------------------------------
-- 3) evidencias_suporte -- proveniencia/evidencia de um conhecimento
-- (atendimento real, confirmacao do cliente, imagem, video, outro).
-- conversation_id nullable: nem toda evidencia vem de uma conversa
-- rastreavel (ex.: material institucional antigo, sem atendimento de
-- origem).
-- ---------------------------------------------------------------------
create table public.evidencias_suporte (
  id               uuid primary key default gen_random_uuid(),
  conhecimento_id  uuid not null references public.conhecimento_suporte(id),
  tipo             text not null
                     check (tipo in ('atendimento_real', 'confirmacao_cliente', 'imagem', 'video', 'outro')),
  descricao        text not null,
  conversation_id  uuid null references public.conversas_estado(conversation_id),
  criado_em        timestamptz not null default now()
);

comment on table public.evidencias_suporte is
  'Evidencias que sustentam um conhecimento de suporte (caso real, '
  'confirmacao do cliente, imagem, video). Camada de dados apenas -- '
  'nenhum codigo grava/le esta tabela ainda (2026-09-11).';

create index evidencias_suporte_conhecimento_id_idx
  on public.evidencias_suporte (conhecimento_id);
create index evidencias_suporte_conversation_id_idx
  on public.evidencias_suporte (conversation_id) where conversation_id is not null;

alter table public.evidencias_suporte enable row level security;

-- ---------------------------------------------------------------------
-- 4) midia_suporte -- SO' referencia (url + metadados) a um recurso de
-- midia. NUNCA guarda binario, NAO cria bucket de Storage, NAO integra
-- com Hostinger nesta etapa -- isso fica para decisao futura separada
-- (arquitetura conceitual ja registrada, "Infraestrutura de conteudo
-- -- Hostinger").
-- ---------------------------------------------------------------------
create table public.midia_suporte (
  id               uuid primary key default gen_random_uuid(),
  conhecimento_id  uuid not null references public.conhecimento_suporte(id),
  tipo             text not null check (tipo in ('imagem', 'video', 'pdf')),
  url              text not null,
  titulo           text not null,
  descricao        text null,
  contexto         text null,
  ordem            integer null,
  criado_em        timestamptz not null default now(),
  constraint midia_suporte_ordem_positiva check (ordem is null or ordem >= 1)
);

comment on table public.midia_suporte is
  'Referencia (url + metadados) a midia complementar de um '
  'conhecimento de suporte -- nunca o binario. Camada de dados '
  'apenas -- nenhum codigo grava/le esta tabela ainda (2026-09-11).';

create index midia_suporte_conhecimento_id_idx
  on public.midia_suporte (conhecimento_id);

alter table public.midia_suporte enable row level security;
