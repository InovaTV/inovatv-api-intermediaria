-- Painel de Atendimento -- previa da lista deixa de considerar
-- mensagens de origem='sistema' (correcao 2026-08-19, inovatv_central
-- CLAUDE.md). Achado: o trigger criado pela migration
-- 20260818020000_painel_previa_lista.sql pega a mensagem mais recente
-- de QUALQUER origem, entao "Atendimento humano iniciado"/"encerrado"
-- (mensagens de sistema, geradas por assumir_atendimento/
-- encerrar_atendimento_humano/acionar_transferencia_humana) apareciam
-- na previa da 1a coluna no lugar da ultima mensagem real da conversa
-- (cliente/ia/humano). Eventos de sistema continuam existindo
-- normalmente em mensagens_conversa e no historico da 2a coluna --
-- esta migration so muda QUAL mensagem alimenta o campo
-- ultima_mensagem_texto.
--
-- NAO APLICAR sem confirmacao explicita separada desta sessao --
-- "migration executada" e' sempre um checkpoint proprio (CLAUDE.md,
-- secao 0-B), mesmo dentro de um bloco ja aprovado.
--
-- O que esta migration faz:
--   1. Backfill: recalcula ultima_mensagem_texto de toda conversa que
--      hoje tem esse campo preenchido, usando so mensagens
--      origem <> 'sistema'.
--   2. Conversas cujas UNICAS mensagens sejam de sistema (nenhuma
--      real ainda) tem o campo zerado para null -- nao ha mensagem
--      real pra mostrar.
--   3. Substitui o corpo da funcao ja existente
--      (atualizar_conversa_ao_inserir_mensagem) para que toda
--      insercao futura em mensagens_conversa mantenha o mesmo filtro.
--
-- O que esta migration deliberadamente NAO faz:
--   - nao mexe em nenhuma outra coluna (atualizado_em,
--     ultima_mensagem_cliente_em continuam exatamente como estavam);
--   - nao mexe no trigger em si (so no corpo da funcao que ele ja
--     chama) -- "create or replace function" e suficiente, mesmo
--     principio ja usado na migration 20260818020000;
--   - nao toca em conversas_episodios, RPCs, Edge Functions, Realtime
--     ou qualquer policy.
--
-- Mesma tecnica de subquery correlacionada da migration anterior
-- (nunca "= new.texto" direto) -- ver comentario detalhado sobre
-- concorrencia em 20260818020000_painel_previa_lista.sql, inalterado
-- aqui, so' com o filtro de origem adicionado.
--
-- Idempotencia: aditiva, "create or replace function", backfill com
-- guarda "is distinct from" -- segura de rodar duas vezes por engano.

begin;

-- ===== PASSO 1: backfill (recalcula so' com origem <> 'sistema') =====

update public.conversas_estado ce
set ultima_mensagem_texto = ultima.texto
from (
  select distinct on (conversation_id) conversation_id, texto
  from public.mensagens_conversa
  where origem <> 'sistema'
  order by conversation_id, criado_em desc
) as ultima
where ultima.conversation_id = ce.conversation_id
  and ce.ultima_mensagem_texto is distinct from ultima.texto;

-- ===== PASSO 2: zera conversas sem nenhuma mensagem real ainda =====

update public.conversas_estado ce
set ultima_mensagem_texto = null
where ce.ultima_mensagem_texto is not null
  and not exists (
    select 1
    from public.mensagens_conversa mc
    where mc.conversation_id = ce.conversation_id
      and mc.origem <> 'sistema'
  );

-- ===== PASSO 3: trigger passa a ignorar origem='sistema' =====

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
            and mc.origem <> 'sistema'
          order by mc.criado_em desc
          limit 1
        )
    where conversation_id = new.conversation_id;
  end if;

  return new;
end;
$$;

comment on function public.atualizar_conversa_ao_inserir_mensagem() is
  'Painel de Atendimento -- mantem atualizado_em / ultima_mensagem_cliente_em / ultima_mensagem_texto. Dispara para QUALQUER insercao em mensagens_conversa, inclusive as feitas direto em SQL pela RPC acionar_transferencia_humana. ultima_mensagem_texto ignora origem=sistema (correcao 2026-08-19, migration 20260819000000_painel_previa_ignora_sistema.sql) e e resolvido por subquery correlacionada (nunca new.texto direto) para permanecer correto sob concorrencia -- ver comentario no topo da migration 20260818020000_painel_previa_lista.sql.';

-- ===== PASSO 4: fim da transacao =====

commit;
