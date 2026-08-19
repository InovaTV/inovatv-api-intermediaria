-- Painel de Atendimento -- desempate real para a previa da lista
-- (correcao 2026-08-19, segunda parte -- inovatv_central CLAUDE.md).
--
-- Achado durante a validacao da migration anterior
-- (20260819000000_painel_previa_ignora_sistema.sql), aplicada e
-- verificada nesta mesma sessao: mensagens inseridas pela mesma
-- transacao Postgres (RPCs acionar_transferencia_humana/
-- assumir_atendimento/encerrar_atendimento_humano, todas plpgsql, uma
-- unica transacao por chamada) compartilham o MESMO valor de
-- criado_em -- "now()" em Postgres e' constante durante toda a
-- transacao (transaction_timestamp()), nunca muda entre instrucoes.
--
-- Confirmado com dado real: na conversa de teste (Js Informatica Rp,
-- 17981625486), a mensagem do cliente ("quero cancelar meu plano") e
-- a resposta da IA ("Entendi que voce deseja...") -- ambas inseridas
-- por acionar_transferencia_humana -- tem
-- criado_em = 2026-08-16T17:49:04.584724+00:00 nas DUAS linhas,
-- identico ate o microssegundo. "order by criado_em desc" (usado pela
-- migration anterior) nao tem como desempatar isso -- o Postgres
-- devolve uma linha arbitraria entre as empatadas, sem garantia. Na
-- pratica, apos aplicar a migration anterior, a previa mostrou a
-- mensagem do cliente em vez da resposta da IA (o resultado esperado
-- pelo usuario) -- nao errado por acaso, e' o comportamento
-- estruturalmente nao-deterministico do empate se manifestando.
--
-- Isso nao e' um caso raro de teste -- e' o caminho real de toda
-- transferencia automatica feita pelo Orquestrador em producao
-- (Componente 1 SS16 chama exatamente acionar_transferencia_humana).
-- O fluxo normal (mensagem do cliente + resposta da IA numa conversa
-- comum, fora de transferencia) NAO tem esse problema -- cada
-- insercao la' e' uma chamada PostgREST separada (Orquestrador,
-- orchestrator/index.ts), logo uma transacao proprio por mensagem,
-- com now() genuinamente distinto.
--
-- NAO APLICAR sem confirmacao explicita separada desta sessao --
-- mesma disciplina de checkpoint proprio (CLAUDE.md, secao 0-B),
-- mesmo sendo continuacao direta da migration anterior.
--
-- O que esta migration faz:
--   1. Coluna nova em mensagens_conversa: seq (bigserial). Diferente
--      de now(), nextval() de uma sequence NUNCA empata, mesmo
--      chamado varias vezes na mesma transacao -- cada linha recebe
--      um numero estritamente maior que a anterior, na ordem real de
--      insercao. Ao adicionar a coluna, o Postgres reescreve a tabela
--      preenchendo os valores na ordem fisica de armazenamento -- para
--      esta tabela (append-only, nunca UPDATE/DELETE, ver comentario
--      em mensagens_conversa) isso equivale a ordem real de insercao.
--   2. Corrige de novo a previa das conversas ja afetadas pelo
--      empate, agora desempatando por seq em vez de so criado_em.
--   3. Trigger atualizado para usar seq como criterio de ordenacao
--      (substitui criado_em como ORDER BY -- seq e' estritamente
--      monotonico, criado_em sozinho nao e' confiavel para isso).
--
-- O que esta migration deliberadamente NAO faz:
--   - nao remove nem substitui a coluna criado_em -- continua sendo o
--     campo de exibicao/agrupamento por dia (Fatia 3,
--     separador de data) e o campo de negocio
--     (ultima_mensagem_cliente_em). seq e' so' um criterio de
--     ordenacao interno, nunca mostrado na UI;
--   - nao mexe em listarMensagens() (2a coluna, historico completo) --
--     fora de escopo desta correcao (pedido explicito do usuario:
--     "nao mexa na segunda coluna"). Mesmo risco de empate existe la'
--     (order by criado_em, sem desempate), mas nao foi observado
--     causar problema pratico ate agora (ordem fisica retornada bateu
--     com a ordem real de insercao nos casos verificados) -- registrado
--     como achado relacionado, nao corrigido aqui;
--   - nao muda as RPCs (acionar_transferencia_humana/
--     assumir_atendimento/encerrar_atendimento_humano) -- elas nao
--     especificam a coluna seq nos INSERTs, entao continuam
--     funcionando sem nenhuma alteracao, recebendo o valor default da
--     sequence automaticamente;
--   - nao toca em Edge Functions, secrets, Realtime ou frontend.
--
-- Idempotencia: aditiva ("add column if not exists"), backfill com
-- guarda "is distinct from" -- segura de rodar duas vezes por engano.

begin;

-- ===== PASSO 1: coluna de desempate monotonico =====

alter table public.mensagens_conversa
  add column if not exists seq bigserial;

comment on column public.mensagens_conversa.seq is
  'Desempate monotonico de insercao (correcao 2026-08-19, migration 20260819010000). criado_em sozinho nao desempata mensagens inseridas na mesma transacao (RPCs acionar_transferencia_humana/assumir_atendimento/encerrar_atendimento_humano usam now(), constante durante toda a transacao Postgres). nextval() de bigserial nunca empata, mesmo dentro da mesma transacao -- usado como criterio de ORDER BY em atualizar_conversa_ao_inserir_mensagem(). Nunca exibido na UI, nunca substitui criado_em como campo de negocio/agrupamento.';

-- ===== PASSO 2: corrige de novo a previa das conversas afetadas =====

update public.conversas_estado ce
set ultima_mensagem_texto = ultima.texto
from (
  select distinct on (conversation_id) conversation_id, texto
  from public.mensagens_conversa
  where origem <> 'sistema'
  order by conversation_id, seq desc
) as ultima
where ultima.conversation_id = ce.conversation_id
  and ce.ultima_mensagem_texto is distinct from ultima.texto;

update public.conversas_estado ce
set ultima_mensagem_texto = null
where ce.ultima_mensagem_texto is not null
  and not exists (
    select 1
    from public.mensagens_conversa mc
    where mc.conversation_id = ce.conversation_id
      and mc.origem <> 'sistema'
  );

-- ===== PASSO 3: trigger passa a desempatar por seq =====

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
            and mc.origem <> 'sistema'
          order by mc.seq desc
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
            and mc.origem <> 'sistema'
          order by mc.seq desc
          limit 1
        )
    where conversation_id = new.conversation_id;
  end if;

  return new;
end;
$$;

comment on function public.atualizar_conversa_ao_inserir_mensagem() is
  'Painel de Atendimento -- mantem atualizado_em / ultima_mensagem_cliente_em / ultima_mensagem_texto. Dispara para QUALQUER insercao em mensagens_conversa, inclusive as feitas direto em SQL pelas RPCs de transferencia/assumir/encerrar. ultima_mensagem_texto ignora origem=sistema (migration 20260819000000) e desempata por seq, nunca so criado_em (migration 20260819010000 -- criado_em sozinho empata quando varias mensagens sao inseridas na mesma transacao Postgres).';

-- ===== PASSO 4: fim da transacao =====

commit;
