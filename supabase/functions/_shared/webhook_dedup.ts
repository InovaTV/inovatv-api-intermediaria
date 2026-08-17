// Deduplicacao atomica por message_id da Meta (Componente 3 §9,
// decisao arquitetural 3, inovatv_central CLAUDE.md). "upsert" com
// ignoreDuplicates gera exatamente "insert ... on conflict do
// nothing" no Postgres -- atomicidade vem da propria constraint PK,
// sem lock explicito nem transacao manual.
//
// Achado A da revisao (2026-08-17): erro real de banco NUNCA pode ser
// confundido com "duplicata" -- os dois tinham o mesmo efeito antes
// (mensagem descartada em silencio). Agora sao 3 estados
// inequivocos: "nova"/"duplicada" (retorno normal) e erro real
// (throw, propaga pro chamador -- nunca convertido em "duplicada").

import { getServiceClient } from "./supabase_client.ts";

export type ResultadoDedup = "nova" | "duplicada";

export async function registrarMensagemSeNova(
  messageId: string,
): Promise<ResultadoDedup> {
  const client = getServiceClient();

  const { data, error } = await client
    .from("webhook_mensagens_processadas")
    .upsert(
      { message_id: messageId },
      { onConflict: "message_id", ignoreDuplicates: true },
    )
    .select("message_id");

  // Erro real (conexao, permissao, etc.) -- propaga. Nunca vira
  // "duplicada" so porque algo deu errado.
  if (error) throw error;

  // ignoreDuplicates: true -- em conflito, nenhuma linha e' retornada.
  return (data?.length ?? 0) > 0 ? "nova" : "duplicada";
}
