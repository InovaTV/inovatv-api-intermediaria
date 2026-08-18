-- Painel de Atendimento -- Aviso de Novas Mensagens, Fatia 1 (schema + trigger)
-- inovatv_central, CLAUDE.md, planejamento aprovado 2026-08-17
-- ("Planejamento -- Aviso de Novas Mensagens", 7/7 decisoes fechadas).
--
-- NAO APLICADA AINDA. Aplicar manualmente no SQL Editor do Supabase
-- so' depois de revisao explicita deste diff -- mesma disciplina ja
-- usada na Fatia 1 original do Painel de Atendimento (migration
-- 20260816140000_painel_atendimento_fatia1.sql).
--
-- Decisoes aprovadas que este arquivo implementa (numeracao igual a
-- do planejamento):
--   Decisao 2 -- persistencia server-side (nao localStorage):
--     visto_em (ultima vez que um operador abriu a conversa) +
--     ultima_mensagem_cliente_em (denormalizado, mantido por
--     trigger).
--   Decisao 3 -- marcar como visto sera' feito por um endpoint
--     dedicado numa fatia futura (painel-atendimento-marcar-visto,
--     ainda NAO criado aqui) -- por isso visto_em nasce sempre a
--     partir do backfill desta migration, nunca escrito por nenhum
--     codigo ainda.
--   Decisao 4 (4.1.b) -- atualizado_em passa a ser tocado por
--     QUALQUER insercao de mensagem (cliente/ia/humano/sistema), nao
--     so' pelas RPCs de transicao de estado -- corrige a lacuna
--     descrita no planejamento (conversa atendida so' pela IA, sem
--     transferencia, nao subia na lista).
--   Decisao 5 -- so' origem = 'cliente' atualiza
--     ultima_mensagem_cliente_em.
--
-- Por que um TRIGGER de banco, nao um hook em codigo TypeScript:
-- acionar_transferencia_humana (migration 20260816120000/
-- 20260816140000) insere mensagens 'cliente' DIRETO em SQL, fora do
-- helper inserirMensagem() do Orquestrador. Um trigger e' a unica
-- forma de nao perder esse caminho -- fonte unica de verdade,
-- independente de qual codigo fez o INSERT.
--
-- O que este arquivo explicitamente NAO faz, por instrucao do usuario:
--   - nenhuma Edge Function nova (painel-atendimento-marcar-visto
--     fica para uma fatia futura);
--   - nenhuma alteracao em painel-atendimento-abrir/index.ts;
--   - nenhuma alteracao no Orquestrador ou no Webhook;
--   - nenhuma policy de RLS nova -- as duas colunas ficam cobertas
--     pela policy de SELECT ja existente, painel_le_conversas_estado
--     (migration 20260817140000) -- "select *" ja inclui qualquer
--     coluna nova automaticamente, sem precisar de policy propria;
--   - nenhum secret novo, nenhuma alteracao na Meta.
--
-- Idempotencia: diferente da migration 20260816140000 (que fazia
-- RENAME + backfill nao repetivel, por isso tinha guarda de "aborta
-- se ja aplicada"), esta e' aditiva e usa "add column if not exists",
-- "create or replace function" e "drop trigger if exists" -- segura
-- de rodar duas vezes por engano, sem quebrar nem duplicar dado.

begin;

-- ===== PASSO 1: colunas novas em conversas_estado =====

alter table public.conversas_estado
  add column if not exists visto_em timestamptz;

alter table public.conversas_estado
  add column if not exists ultima_mensagem_cliente_em timestamptz;

comment on column public.conversas_estado.visto_em is
  'Ultima vez que um operador abriu esta conversa no Painel de Atendimento. Escrito por um endpoint dedicado (fatia futura) -- esta migration so preenche via backfill.';

comment on column public.conversas_estado.ultima_mensagem_cliente_em is
  'Denormalizado, mantido por trigger (trg_mensagens_conversa_atualiza_conversa). Timestamp da mensagem mais recente com origem=''cliente'' desta conversa.';

-- ===== PASSO 2: backfill =====
-- "Tudo que ja existe hoje conta como lido no dia em que o recurso
-- nasce" (planejamento, secao 9) -- evita um backlog falso de "nao
-- lidas" assim que a feature entrar em producao.

-- 2a. ultima_mensagem_cliente_em = mensagem 'cliente' mais recente ja
-- existente por conversa (permanece null se a conversa nunca teve
-- nenhuma mensagem de cliente).
update public.conversas_estado ce
set ultima_mensagem_cliente_em = ultima.criado_em
from (
  select conversation_id, max(criado_em) as criado_em
  from public.mensagens_conversa
  where origem = 'cliente'
  group by conversation_id
) as ultima
where ultima.conversation_id = ce.conversation_id
  and ce.ultima_mensagem_cliente_em is distinct from ultima.criado_em;

-- 2b. visto_em = now() para toda conversa que ainda nao tem visto_em
-- preenchido -- guarda "is null" torna este passo seguro de re-rodar
-- (nao sobrescreve visto_em real que um endpoint futuro venha a
-- gravar).
update public.conversas_estado
set visto_em = now()
where visto_em is null;

-- ===== PASSO 3: trigger em mensagens_conversa =====

create or replace function public.atualizar_conversa_ao_inserir_mensagem()
returns trigger
language plpgsql
as $$
begin
  if new.origem = 'cliente' then
    update public.conversas_estado
    set atualizado_em = greatest(atualizado_em, now()),
        ultima_mensagem_cliente_em = greatest(coalesce(ultima_mensagem_cliente_em, new.criado_em), new.criado_em)
    where conversation_id = new.conversation_id;
  else
    update public.conversas_estado
    set atualizado_em = greatest(atualizado_em, now())
    where conversation_id = new.conversation_id;
  end if;

  return new;
end;
$$;

comment on function public.atualizar_conversa_ao_inserir_mensagem() is
  'Painel de Atendimento -- Aviso de Novas Mensagens. Fonte unica de verdade para atualizado_em/ultima_mensagem_cliente_em: dispara para QUALQUER insercao em mensagens_conversa, inclusive as feitas direto em SQL pela RPC acionar_transferencia_humana (nao so pelo helper TypeScript inserirMensagem()).';

drop trigger if exists trg_mensagens_conversa_atualiza_conversa
  on public.mensagens_conversa;

create trigger trg_mensagens_conversa_atualiza_conversa
  after insert on public.mensagens_conversa
  for each row
  execute function public.atualizar_conversa_ao_inserir_mensagem();

-- ===== PASSO 4: fim da transacao =====

commit;
