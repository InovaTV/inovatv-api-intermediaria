// Autenticacao das Edge Functions painel-atendimento-* (Componente 5
// §6, inovatv_central). Login restrito a um unico e-mail autorizado
// (o do Jose) -- sem cadastro publico, sem multiplos usuarios na V1.
// Toda Edge Function do Painel chama verificarOperador() antes de
// agir; nenhuma mostra dado de conversa sem sessao valida.
//
// Reaproveita getServiceClient() (service_role) para validar o JWT --
// nao precisa de SUPABASE_ANON_KEY como dependencia nova, e
// client.auth.getUser(token) funciona com qualquer client valido,
// independente do role usado pra criar o client.

import { getServiceClient } from "./supabase_client.ts";

export type VerificacaoOperador =
  | { autorizado: true; email: string }
  | { autorizado: false; motivo: "token_ausente" | "configuracao_ausente" | "token_invalido" | "email_nao_autorizado" };

export async function verificarOperador(req: Request): Promise<VerificacaoOperador> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { autorizado: false, motivo: "token_ausente" };
  }
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) {
    return { autorizado: false, motivo: "token_ausente" };
  }

  const emailAutorizado = Deno.env.get("PAINEL_EMAIL_AUTORIZADO");
  if (!emailAutorizado) {
    return { autorizado: false, motivo: "configuracao_ausente" };
  }

  const client = getServiceClient();
  const { data, error } = await client.auth.getUser(token);

  if (error || !data?.user?.email) {
    return { autorizado: false, motivo: "token_invalido" };
  }

  if (data.user.email.toLowerCase() !== emailAutorizado.toLowerCase()) {
    return { autorizado: false, motivo: "email_nao_autorizado" };
  }

  return { autorizado: true, email: data.user.email };
}

export function respostaNaoAutorizado(motivo: string): Response {
  return new Response(JSON.stringify({ outcome: "unauthorized", motivo }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}
