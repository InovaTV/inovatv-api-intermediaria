-- acionar_transferencia_humana
-- Etapa 6, terceira fatia (correcao de atomicidade, Componente 1 §16 /
-- Componente 5 §7 e §12). Substitui a sequencia de 3 chamadas
-- separadas (marcarAguardandoHumano + 2x inserirMensagem) por uma
-- unica transacao Postgres -- corpo de FUNCTION e' atomico por
-- natureza (sem COMMIT interno possivel, diferente de PROCEDURE):
-- qualquer erro em um INSERT desfaz o UPDATE tambem, sem nenhum
-- codigo de compensacao/rollback manual.
--
-- Guarda de concorrencia (mesmo padrao de "assumir", Componente 5
-- §9): so transiciona se a conversa ainda estiver 'normal' -- evita
-- disparar a transferencia duas vezes pra mesma conversa em chamadas
-- concorrentes (ex.: duas mensagens quase simultaneas do cliente). A
-- excecao 'conversa_ja_aguardando_humano_ou_inexistente' precisa ser
-- tratada conscientemente pelo lado TypeScript (etapa futura,
-- integracao) -- distinguir "outra requisicao ja transferiu" (esperado
-- sob concorrencia, nao e' falha) de um erro real da RPC (transferencia
-- nao confirmada). Nao decidido/implementado nesta migration.
--
-- Escopo deliberadamente minimo, revisado e aprovado sem alteracoes:
-- so transiciona a conversa e registra as duas mensagens, de forma
-- atomica. SECURITY INVOKER (padrao) -- service_role ja tem BYPASSRLS
-- nativamente, nao precisa de SECURITY DEFINER. Sem tabela de log
-- nova, sem compensacao, sem ampliar responsabilidade da funcao.

create or replace function public.acionar_transferencia_humana(
  p_conversation_id  uuid,
  p_motivo           text,
  p_conteudo_cliente text,
  p_texto_ia         text
)
returns public.conversas_estado
language plpgsql
as $$
declare
  v_conversa public.conversas_estado;
begin
  update public.conversas_estado
  set estado = 'aguardando_humano',
      motivo = p_motivo,
      entrou_em_espera = now(),
      atualizado_em = now()
  where conversation_id = p_conversation_id
    and estado = 'normal'
  returning * into v_conversa;

  if not found then
    raise exception 'conversa_ja_aguardando_humano_ou_inexistente'
      using errcode = 'P0001';
  end if;

  insert into public.mensagens_atendimento_humano (conversation_id, origem, texto)
  values (p_conversation_id, 'cliente', p_conteudo_cliente);

  insert into public.mensagens_atendimento_humano (conversation_id, origem, texto)
  values (p_conversation_id, 'ia', p_texto_ia);

  return v_conversa;
end;
$$;

revoke all on function public.acionar_transferencia_humana(uuid, text, text, text) from public;
grant execute on function public.acionar_transferencia_humana(uuid, text, text, text) to service_role;
