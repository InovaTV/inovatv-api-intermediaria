-- Painel de Atendimento -- Previa da lista (Fatia 1 do plano de
-- evolucao em 3 colunas), inovatv_central CLAUDE.md.
-- Fatia 1 aprovada em 2026-08-18, apos revisao tecnica completa
-- (arquitetura, backfill, concorrencia) registrada na conversa.
--
-- NAO APLICAR sem confirmacao explicita separada desta sessao --
-- "migration executada" e' sempre um checkpoint proprio (CLAUDE.md,
-- secao 0-B), mesmo dentro de um bloco ja aprovado. Aplicar
-- manualmente no SQL Editor do Supabase (ou via CLI, com essa
-- confirmacao), mesma disciplina de toda migration anterior deste
-- repositorio.
--
-- O que esta migration faz:
--   1. Uma coluna nova em conversas_estado: ultima_mensagem_texto
--      (previa da ultima mensagem da conversa, qualquer origem).
--   2. Backfill dessa coluna a partir do que ja existe em
--      mensagens_conversa (sem chamada externa -- nome_snapshot NAO
--      e' backfillado aqui, ver nota abaixo).
--   3. Estende o trigger ja existente
--      (atualizar_conversa_ao_inserir_mensagem) para manter essa
--      coluna atualizada em toda insercao de mensagem futura.
--
-- O que esta migration deliberadamente NAO faz (decisoes fechadas
-- durante a revisao tecnica, nao esquecidas):
--   - nao cria ultima_mensagem_origem -- sem consumidor real hoje, a
--     lista so precisa do texto da previa, nunca de quem mandou;
--   - nao cria nenhuma coluna de timestamp auxiliar para proteger a
--     previa contra concorrencia -- confirmado que mensagens_conversa
--     .criado_em, consultado via subquery correlacionada dentro do
--     proprio trigger (Passo 3), ja resolve isso sem estrutura nova;
--   - nao faz backfill de nome_snapshot -- exigiria chamar /status do
--     Rocket por telefone, o que uma migration .sql pura nao faz sem
--     uma extensao como pg_net (nao usada neste projeto). Backfill e'
--     passivo: conversas antigas continuam com nome_snapshot null ate
--     a proxima mensagem real ser processada por qualquer uma delas
--     (o codigo TypeScript desta mesma fatia ja resolve isso, sem
--     chamada extra, ver orchestrator/index.ts e
--     painel-atendimento-abrir/index.ts);
--   - nao toca em nenhuma Edge Function, secret ou configuracao da
--     Meta.
--
-- Por que a previa e' resolvida por subquery correlacionada, nunca
-- por "= new.texto" direto: um UPDATE direto com new.texto sofre de
-- "a ultima transacao a COMMITAR vence", nao "a mensagem
-- cronologicamente mais recente vence" -- sob concorrencia real (duas
-- mensagens quase simultaneas na mesma conversa), a ordem de commit
-- pode divergir da ordem de criado_em. A subquery
-- (select texto ... order by criado_em desc limit 1) le a fonte de
-- verdade de novo a cada execucao do UPDATE; como o UPDATE mira
-- sempre a mesma linha de conversas_estado
-- (where conversation_id = new.conversation_id), o Postgres ja
-- serializa duas execucoes concorrentes do trigger para a mesma
-- conversa via lock de linha -- a que fica bloqueada, ao ser
-- desbloqueada, reavalia a subquery (EvalPlanQual) contra o estado ja
-- commitado naquele momento, que ja inclui a mensagem da transacao
-- que acabou de liberar o lock. Resultado: a subquery sempre acaba
-- vendo a mensagem de criado_em mais recente de verdade, independente
-- de qual transacao terminou de commitar primeiro. Mesmo principio ja
-- usado para ultima_mensagem_cliente_em (GREATEST/COALESCE, migration
-- 20260818000000) -- so que adaptado para um campo de texto, que nao
-- da pra comparar diretamente com GREATEST. Validar empiricamente
-- (nao so' por este raciocinio) com um teste de concorrencia real
-- antes de considerar esta fatia encerrada -- ver docs/IMPLEMENTATION.md.
--
-- Idempotencia: mesmo padrao da migration 20260818000000 -- aditiva,
-- "add column if not exists", "create or replace function". Segura
-- de rodar duas vezes por engano, sem quebrar nem duplicar dado.

begin;

-- ===== PASSO 1: coluna nova em conversas_estado =====

alter table public.conversas_estado
  add column if not exists ultima_mensagem_texto text;

comment on column public.conversas_estado.ultima_mensagem_texto is
  'Previa da ultima mensagem da conversa (qualquer origem: cliente/ia/humano/sistema). Mantido por trigger (trg_mensagens_conversa_atualiza_conversa) via subquery correlacionada contra mensagens_conversa -- nunca "= new.texto" direto, para nao regredir sob concorrencia (ver comentario no topo desta migration).';

-- ===== PASSO 2: backfill =====
-- Mesma tecnica ja usada para ultima_mensagem_cliente_em (migration
-- 20260818000000, Passo 2a) -- distinct on por conversation_id,
-- pegando a mensagem de maior criado_em. So toca conversas que ja tem
-- pelo menos uma mensagem; conversas sem nenhuma permanecem null.

update public.conversas_estado ce
set ultima_mensagem_texto = ultima.texto
from (
  select distinct on (conversation_id) conversation_id, texto
  from public.mensagens_conversa
  order by conversation_id, criado_em desc
) as ultima
where ultima.conversation_id = ce.conversation_id
  and ce.ultima_mensagem_texto is distinct from ultima.texto;

-- ===== PASSO 3: trigger estendido =====

create or replace function public.atualizar_conversa_ao_inserir_mensagem()
returns trigger
language plpgsql
as $$
begin
  if new.origem = 'cliente' then
    update public.conversas_estado
    set atualizado_em = greatest(atualizado_em, now()),
        ultima_mensagem_cliente_em = greatest(coalesce(ultima_mensagem_cliente_em, new.criado_em), new.criado_em),
        ultima_mensagem_texto = (
          select mc.texto
          from public.mensagens_conversa mc
          where mc.conversation_id = new.conversation_id
          order by mc.criado_em desc
          limit 1
        )
    where conversation_id = new.conversation_id;
  else
    update public.conversas_estado
    set atualizado_em = greatest(atualizado_em, now()),
        ultima_mensagem_texto = (
          select mc.texto
          from public.mensagens_conversa mc
          where mc.conversation_id = new.conversation_id
          order by mc.criado_em desc
          limit 1
        )
    where conversation_id = new.conversation_id;
  end if;

  return new;
end;
$$;

comment on function public.atualizar_conversa_ao_inserir_mensagem() is
  'Painel de Atendimento -- mantem atualizado_em / ultima_mensagem_cliente_em / ultima_mensagem_texto. Dispara para QUALQUER insercao em mensagens_conversa, inclusive as feitas direto em SQL pela RPC acionar_transferencia_humana. ultima_mensagem_texto e resolvido por subquery correlacionada (nunca new.texto direto) para permanecer correto sob concorrencia -- ver comentario no topo da migration 20260818020000_painel_previa_lista.sql.';

-- Nao precisa de "drop trigger" + "create trigger" -- o trigger
-- trg_mensagens_conversa_atualiza_conversa ja existe e referencia a
-- funcao pelo nome; "create or replace function" atualiza o corpo em
-- lugar, o trigger passa a usar a nova versao automaticamente, sem
-- precisar ser recriado.

-- ===== PASSO 4: fim da transacao =====

commit;
