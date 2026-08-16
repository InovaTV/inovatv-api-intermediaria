// Acesso a tabela conversas_estado (Componente 5 §7, inovatv_central).
// So o minimo necessario para o nucleo do Orquestrador nesta etapa --
// assumir()/encerrar() chegam quando a Interface Humana Web for
// especificada em codigo (etapa futura, fora de escopo aqui).

import { getServiceClient } from "./supabase_client.ts";
import type { ConversaEstado } from "./types.ts";

// Etapa 6, terceira fatia (correcao de atomicidade, Componente 1 §16 /
// Componente 5 §12). Chama a RPC acionar_transferencia_humana
// (migration 20260816120000, ainda NAO aplicada) -- UPDATE em
// conversas_estado + 2 INSERTs em mensagens_atendimento_humano numa
// unica transacao Postgres. Envio de WhatsApp/aviso ao Jose ficam
// para uma fatia futura. Nao decide QUANDO transferir -- isso e' do
// orquestrador (validador reprovado ou Gemini tipo==="transferir");
// esta funcao so' executa.
//
// Distingue dois desfechos deliberadamente (nao apenas sucesso/erro):
// "ja_transferida" -- outra requisicao concorrente ja transicionou
// essa conversa (guarda "and estado = 'normal'" da RPC nao encontrou
// linha) -- esperado sob concorrencia, NAO e' falha de atomicidade.
// Qualquer outro erro da RPC propaga (throw) -- transferencia NAO
// confirmada, tratado como falha real pelo chamador.
export async function acionarTransferenciaHumana(
  conversationId: string,
  motivo: string,
  conteudoCliente: string,
  textoIa: string,
): Promise<
  | { outcome: "acionada"; conversa: ConversaEstado }
  | { outcome: "ja_transferida" }
> {
  const client = getServiceClient();

  const { data, error } = await client.rpc("acionar_transferencia_humana", {
    p_conversation_id: conversationId,
    p_motivo: motivo,
    p_conteudo_cliente: conteudoCliente,
    p_texto_ia: textoIa,
  });

  if (error) {
    if (error.code === "P0001") {
      return { outcome: "ja_transferida" };
    }
    throw error;
  }

  return { outcome: "acionada", conversa: data as ConversaEstado };
}

// Busca a conversa pelo telefone. Se nao existir ainda, cria uma nova
// linha em estado 'normal' -- "estabelecer a conversa" (decisao do
// usuario sobre conversation_id, 2026-08-15: gerado pelo Postgres no
// insert, nunca derivado do telefone).
export async function buscarOuCriarConversa(
  telefone: string,
): Promise<ConversaEstado> {
  const client = getServiceClient();

  const { data: existente, error: erroSelect } = await client
    .from("conversas_estado")
    .select("*")
    .eq("telefone", telefone)
    .maybeSingle();

  if (erroSelect) throw erroSelect;
  if (existente) return existente as ConversaEstado;

  const { data: criada, error: erroInsert } = await client
    .from("conversas_estado")
    .insert({ telefone, estado: "normal" })
    .select("*")
    .single();

  if (erroInsert) throw erroInsert;
  return criada as ConversaEstado;
}
