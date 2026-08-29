-- Peca 3 do gerenciamento de estado conversacional (2026-08-29, regra
-- arquitetural aprovada em inovatv_central/CLAUDE.md). Ciclo de vida
-- garantido dos estados NAO-terminais: uma operacao de renovacao presa
-- SEMPRE alcanca um estado terminal automaticamente, apos o proprio
-- expira_em (2h), sem depender de correcao manual no banco. Sem isso,
-- um webhook OpenPix perdido/atrasado deixa o lote preso em
-- 'autorizada' PARA SEMPRE e o indice unico parcial
-- (tokens_renovacao_ativo_unico_por_acesso_idx) bloqueia toda nova
-- renovacao dos acessos daquele lote.
--
-- RPC nova: expira um lote 'autorizada' (+ filhos 'autorizada') numa
-- transacao, gate CAS por estado. Distinta de marcar_lote_como_falha:
--   'expirada' = a janela de 2h fechou sem pagamento confirmado (a
--                renovacao NUNCA foi tentada);
--   'falhou'   = a renovacao foi tentada e deu erro.
-- A distincao importa para o rastro de auditoria de um fluxo com
-- dinheiro. NUNCA toca 'renovacao_em_andamento' (esse caso ja e'
-- coberto por buscarLotesEmAndamentoAntigos + marcarEstadoFinalLote).
--
-- DELIBERADAMENTE NAO toca cobrancas_pix -- a cobranca fica 'pendente'
-- pro Caso D do watchdog conciliar (reconsulta a Woovi; se COMPLETED,
-- pagamento e' registrado e a renovacao vira responsabilidade de um
-- atendente -- nunca perdida).
--
-- Aplicacao: MANUAL via SQL Editor do Supabase (mesmo processo de toda
-- migration deste repositorio) -- este arquivo e' o artefato revisado,
-- nao roda sozinho.

create or replace function public.expirar_lote_autorizado(p_operacao_id uuid)
returns public.renovacoes_lote
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lote public.renovacoes_lote;
begin
  update public.renovacoes_lote
     set estado = 'expirada'
   where operacao_id = p_operacao_id
     and estado = 'autorizada'
  returning * into v_lote;

  -- CAS: 0 linhas -> o lote ja avancou (webhook ganhou a corrida, ou
  -- outro watchdog). O chamador trata NULL como "nada a fazer".
  if v_lote.grupo_id is null then
    return null;
  end if;

  update public.tokens_renovacao
     set estado = 'expirada'
   where grupo_id = v_lote.grupo_id
     and estado = 'autorizada';

  return v_lote;
end;
$$;

revoke all on function public.expirar_lote_autorizado(uuid) from public, anon, authenticated;
grant execute on function public.expirar_lote_autorizado(uuid) to service_role;
