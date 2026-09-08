-- Renovacao Automatica -- mensagem final completa (2026-09-07,
-- inovatv_central/CLAUDE.md). Persiste o `usuario` real do acesso
-- Sigma no snapshot do token, capturado NA CRIACAO DA PROPOSTA (o
-- mesmo valor que o /match|/status daquela requisicao ja trouxe --
-- NUNCA uma consulta nova ao Rocket). Serve so' para a mensagem final
-- de "renovacao concluida" mostrar 🔑 Usuário tambem para Sigma, em vez
-- de "não informado".
--
-- Por que coluna nova (e nao reaproveitar unitv_sn): o CHECK
-- tokens_renovacao_alvo_por_tipo nao proibiria unitv_sn numa linha
-- 'sigma', mas todo o codigo (renovacao-sigma-workflow.mjs, etc.) le
-- unitv_sn SO' dentro de ramos `tipo === 'unitv'` -- overload seria uma
-- armadilha latente. Coluna dedicada, nullable, sem default.
--
-- UniTV continua usando unitv_sn como usuario (validado em producao) --
-- para tipo='unitv' esta coluna fica NULL.
--
-- Escopo: SO' exibicao. A maquina de estados, cobrancas_pix/OpenPix, o
-- ACEITO/CANCELAR, o workflow Sigma e a confirmacao de vencimento NUNCA
-- leem nem escrevem `usuario`. Nenhuma constraint/indice/RLS alterado.
-- Linhas antigas ficam NULL (a mensagem cai no "não informado"
-- honesto). Filhos de lote sao linhas em tokens_renovacao -> herdam a
-- coluna; renovacoes_lote (a "capa") nao precisa de coluna nova.
--
-- Aplicacao: MANUAL via `supabase db query --linked -f <este arquivo>`
-- (mesmo processo de toda migration deste repositorio).

alter table public.tokens_renovacao
  add column if not exists usuario text null;

comment on column public.tokens_renovacao.usuario is
  'Usuario real do acesso, capturado na criacao da proposta (Sigma: /match|/status da mesma requisicao). So exibicao na mensagem final -- a maquina de estados nunca le/escreve. UniTV usa unitv_sn (esta coluna fica NULL). NULL = token anterior a esta coluna, ou usuario nao identificado.';
