// Acesso a tabela mensagens_conversa (Componente 5 §12, inovatv_central,
// renomeada de mensagens_atendimento_humano na Fatia 1 do Painel de
// Atendimento, 2026-08-16 -- migration 20260816140000 faz o RENAME real
// no banco, este arquivo so passa a apontar pro nome novo).
//
// Revisao de escopo (2026-08-16): deixou de ser so' "escopo minimo
// hibrido" -- agora e' log permanente de TODA mensagem, em qualquer
// estado (normal ou aguardando_humano), nao so durante transferencia/
// atendimento humano (mudanca de comportamento aplicada no Orquestrador,
// Fatia 2). episodioId e' nullable: populado so quando a mensagem
// pertence a um episodio de atendimento humano em aberto, null no fluxo
// normal so-IA.

import { getServiceClient } from "./supabase_client.ts";
import type { ConversaEpisodio, MensagemAtendimento, OrigemMensagem } from "./types.ts";

export async function inserirMensagem(
  conversationId: string,
  origem: OrigemMensagem,
  texto: string,
  episodioId: string | null = null,
): Promise<MensagemAtendimento> {
  const client = getServiceClient();

  const { data, error } = await client
    .from("mensagens_conversa")
    .insert({ conversation_id: conversationId, episodio_id: episodioId, origem, texto })
    .select("*")
    .single();

  if (error) throw error;
  return data as MensagemAtendimento;
}

// Saudacao inicial (decisao de produto 2026-08-31) -- o Orquestrador
// usa isto para decidir se e' o PRIMEIRO contato de uma conversa
// (count === 0 => nenhuma mensagem ja registrada => envia a saudacao
// fixa uma unica vez). Aditiva: nenhuma funcao existente e' alterada.
export async function contarMensagensDaConversa(
  conversationId: string,
): Promise<number> {
  const client = getServiceClient();

  const { count, error } = await client
    .from("mensagens_conversa")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId);

  if (error) throw error;
  return count ?? 0;
}

// Ultima mensagem da IA nesta conversa (plano "Selecao de acesso",
// secao 4-A, inovatv-wasender-lab). O Orquestrador usa isto so' pra
// decidir se uma LISTA de multiplos acessos acabou de ser apresentada
// (gatilho da selecao numerica "1"/"2" em conversa normal). Best-
// effort no chamador (try/catch -> null). Aditiva: nenhuma funcao
// existente e' alterada.
export async function buscarUltimaMensagemIa(
  conversationId: string,
): Promise<string | null> {
  const client = getServiceClient();

  const { data, error } = await client
    .from("mensagens_conversa")
    .select("texto")
    .eq("conversation_id", conversationId)
    .eq("origem", "ia")
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data?.texto as string | undefined) ?? null;
}

// Historico completo de uma conversa (Componente 5 §8) -- usado pelo
// Painel pra mostrar tudo que ja foi trocado, sem limite de janela de
// tempo. Nao usado pelo Orquestrador (ele so insere, nunca precisa
// reler historico pra decidir nada -- Arquitetura §16).
export async function listarMensagens(
  conversationId: string,
): Promise<MensagemAtendimento[]> {
  const client = getServiceClient();

  const { data, error } = await client
    .from("mensagens_conversa")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("criado_em", { ascending: true });

  if (error) throw error;
  return (data ?? []) as MensagemAtendimento[];
}

// Historico de episodios de uma conversa (Componente 5 §7-B) -- usado
// junto com listarMensagens() pra montar a tela de historico completo
// do Painel.
export async function listarEpisodios(
  conversationId: string,
): Promise<ConversaEpisodio[]> {
  const client = getServiceClient();

  const { data, error } = await client
    .from("conversas_episodios")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("iniciado_em", { ascending: true });

  if (error) throw error;
  return (data ?? []) as ConversaEpisodio[];
}
