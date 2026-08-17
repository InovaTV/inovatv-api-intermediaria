import { getServiceClient } from "./supabase_client.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://inovatv-api-intermediaria.vercel.app",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export type VerificacaoOperador =
  | { autorizado: true; email: string }
  | {
      autorizado: false;
      motivo:
        | "token_ausente"
        | "configuracao_ausente"
        | "token_invalido"
        | "email_nao_autorizado";
    };

export async function verificarOperador(
  req: Request,
): Promise<VerificacaoOperador> {
  const authHeader = req.headers.get("Authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    return { autorizado: false, motivo: "token_ausente" };
  }

  const token = authHeader.slice("Bearer ".length).trim();

  if (!token) {
    return { autorizado: false, motivo: "token_invalido" };
  }

  const emailAutorizado = Deno.env.get("PAINEL_EMAIL_AUTORIZADO")?.trim();

  if (!emailAutorizado) {
    return { autorizado: false, motivo: "configuracao_ausente" };
  }

  try {
    const supabase = getServiceClient();

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);

    if (error || !user?.email) {
      return { autorizado: false, motivo: "token_invalido" };
    }

    if (user.email.toLowerCase() !== emailAutorizado.toLowerCase()) {
      return { autorizado: false, motivo: "email_nao_autorizado" };
    }

    return { autorizado: true, email: user.email };
  } catch {
    return { autorizado: false, motivo: "token_invalido" };
  }
}

export function respostaNaoAutorizado(motivo: string): Response {
  return new Response(JSON.stringify({ outcome: "unauthorized", motivo }), {
    status: 401,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
    },
  });
}