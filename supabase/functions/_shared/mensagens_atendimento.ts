// Acesso a tabela mensagens_atendimento_humano (Componente 5 §12,
// inovatv_central) -- escopo minimo hibrido, nunca historico completo
// (Arquitetura Formal §14 revisada). So inserirMensagem() nesta etapa;
// listarMensagens() chega quando a Interface Humana Web precisar ler.

import { getServiceClient } from "./supabase_client.ts";
import type { MensagemAtendimento, OrigemMensagem } from "./types.ts";

export async function inserirMensagem(
  conversationId: string,
  origem: OrigemMensagem,
  texto: string,
): Promise<MensagemAtendimento> {
  const client = getServiceClient();

  const { data, error } = await client
    .from("mensagens_atendimento_humano")
    .insert({ conversation_id: conversationId, origem, texto })
    .select("*")
    .single();

  if (error) throw error;
  return data as MensagemAtendimento;
}
