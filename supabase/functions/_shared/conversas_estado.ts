// Acesso a tabela conversas_estado (Componente 5 §7, inovatv_central).
// So o minimo necessario para o nucleo do Orquestrador nesta etapa --
// assumir()/encerrar() chegam quando a Interface Humana Web for
// especificada em codigo (etapa futura, fora de escopo aqui).

import { getServiceClient } from "./supabase_client.ts";
import type { ConversaEstado } from "./types.ts";

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
