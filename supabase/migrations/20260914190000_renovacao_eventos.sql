-- Trilha de auditoria da Renovacao Automatica (Fase 2 do desenho de
-- observabilidade, 2026-09-14, inovatv-api-intermediaria/CLAUDE.md).
-- Objetivo: reconstruir, DEPOIS que uma renovacao termina, o caminho
-- completo que ela percorreu -- sem precisar abrir GitHub Actions,
-- Deno Edge Function logs ou OpenPix pra descobrir onde parou.
--
-- NAO e' acompanhamento em tempo real (sem WebSocket/SSE/polling do
-- painel) -- e' consulta posterior. NAO substitui tokens_renovacao/
-- renovacoes_lote/cobrancas_pix (que continuam sendo a fonte de
-- verdade do ESTADO ATUAL) -- e' aditiva, so' HISTORICO de transicoes
-- (append-only, nunca UPDATE/DELETE em uso normal).
--
-- Correlacao: o unico identificador vivo do inicio ao fim de uma
-- renovacao e' tokens_renovacao.id / renovacoes_lote.grupo_id, mas os
-- dois so' nascem no Carrinho (depois que o cliente ja foi
-- identificado e os acessos ja foram apresentados). Pra cobrir as
-- etapas ANTES disso (entrada no Portal, identificacao por telefone,
-- acessos apresentados), sessao_id (uuid gerado no 1o GET do Portal,
-- carregado como campo oculto pelos POSTs seguintes) e' a chave de
-- correlacao provisoria -- gravada em tokens_renovacao.sessao_id/
-- renovacoes_lote.sessao_id no momento da criacao, pra o painel juntar
-- as duas pontas numa unica timeline. Colunas sessao_id adicionadas
-- aqui; a PROPAGACAO real pelo formulario HTML e' instrumentacao
-- futura (fora do escopo desta migration).
--
-- servidor e' coluna de primeira classe (nao dentro de detalhe) porque
-- e' dimensao de filtro planejada pro painel (Fase 4) -- indexar jsonb
-- a toa pra isso seria desnecessario.
--
-- Aplicacao: MANUAL via SQL Editor do Supabase (mesmo processo de toda
-- migration deste repositorio) -- este arquivo e' o artefato revisado,
-- nao roda sozinho.

alter table public.tokens_renovacao
  add column sessao_id uuid null;

alter table public.renovacoes_lote
  add column sessao_id uuid null;

create table public.renovacao_eventos (
  id           uuid primary key default gen_random_uuid(),
  criado_em    timestamptz not null default now(),

  -- Correlacao -- pelo menos uma das tres precisa existir. Evento de
  -- filho de lote carrega token_id E grupo_id ao mesmo tempo (ver
  -- comentario da constraint mais abaixo).
  sessao_id    uuid null,
  token_id     uuid null references public.tokens_renovacao(id),
  grupo_id     uuid null references public.renovacoes_lote(grupo_id),
  -- Nasce so' na Confirmacao (ACEITO) -- atravessa Pix -> GitHub
  -- Actions -> callback. Sem FK propria (operacao_id vive em
  -- cobrancas_pix.operacao_id, mas o evento pode ser gravado ANTES da
  -- cobranca existir, ex.: confirmacao_aceita).
  operacao_id  uuid null,

  etapa        text not null,
  codigo       text not null,
  nivel        text not null check (nivel in ('info', 'erro')),
  -- So' preenchido a partir da etapa "processamento" (dentro do
  -- workflow) -- nulo em toda etapa anterior.
  servidor     text null check (servidor in ('sigma', 'unitv')),

  -- Nome fixo da function/script que gravou (ex.: 'openpix-webhook',
  -- 'renovacao-sigma-workflow') -- rastreabilidade de origem, nao mais
  -- um dado de negocio.
  origem       text not null,

  -- Payload sanitizado especifico do evento (catalogo de campos
  -- permitidos documentado em _shared/renovacao_eventos.ts, nunca
  -- token bruto/senha/QR code completo/credenciais -- ver a mesma
  -- disciplina ja aplicada a tokens_renovacao.token_hash).
  detalhe      jsonb not null default '{}'::jsonb,

  -- operacao_id sozinho tambem correlaciona (Etapa 8/9, pagamento e
  -- disparo do workflow): nesse ponto do fluxo o token/lote ja existe
  -- no banco mas ainda nao foi RELIDO por quem processa o webhook (so'
  -- cobrancas_pix.public_id/grupo_id estao em mao ali, nao o token_id
  -- de verdade) -- exigir token_id/grupo_id aqui obrigaria uma leitura
  -- extra so' para instrumentacao, o que o desenho da Fase 2 rejeitou
  -- explicitamente (sensor nunca deve pesar no caminho real).
  constraint renovacao_eventos_correlacao_check check (
    sessao_id is not null or token_id is not null or grupo_id is not null or operacao_id is not null
  )
);

create index renovacao_eventos_token_id_idx
  on public.renovacao_eventos (token_id, criado_em)
  where token_id is not null;

create index renovacao_eventos_grupo_id_idx
  on public.renovacao_eventos (grupo_id, criado_em)
  where grupo_id is not null;

create index renovacao_eventos_sessao_id_idx
  on public.renovacao_eventos (sessao_id, criado_em)
  where sessao_id is not null;

create index renovacao_eventos_operacao_id_idx
  on public.renovacao_eventos (operacao_id)
  where operacao_id is not null;

-- RLS habilitado, sem nenhuma policy publica -- mesmo padrao de toda
-- tabela do projeto (so' service_role acessa, sempre de dentro da
-- propria Edge Function/script).
alter table public.renovacao_eventos enable row level security;
