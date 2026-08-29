// Cliente interno do Orquestrador para resolver a conta UniTV via a
// Edge Function renovacao-unitv-conta -- Etapa 2 (Renovacao UniTV,
// Bloco 4). O Orquestrador NUNCA fala com o painel de revenda direto:
// a resolucao (e o dealer_token) ficam atras da EF.
//
// Auth: X-Internal-Token == RENOVACAO_SIGMA_CALLBACK_TOKEN -- o mesmo
// secret ja compartilhado na familia de chamadas internas de renovacao
// (runner <-> renovacao-sigma-* / renovacao-rocket-vencimento). O
// Orquestrador o le como project secret. NENHUM secret novo.
//
// Contrato de retorno (o chamador so' precisa distinguir 4 casos):
//   { outcome: "resolvido", id }            -> pode criar token/cobranca
//   { outcome: "nao_encontrado" | "ambiguo" | "indisponivel" }
//                                           -> NAO cria token/cobranca
//                                              (mensagem fixa de fallback
//                                               + atendimento humano)
//
// Qualquer falha de transporte/config/JSON -> "indisponivel".

export type ResultadoResolverContaUnitv =
  | { outcome: "resolvido"; id: number }
  | { outcome: "nao_encontrado" | "ambiguo" | "indisponivel" };

const TIMEOUT_MS = 15000;

export async function chamarResolverContaUnitv(sn: string): Promise<ResultadoResolverContaUnitv> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const tokenInterno = Deno.env.get("RENOVACAO_SIGMA_CALLBACK_TOKEN");
  if (!supabaseUrl || !tokenInterno) return { outcome: "indisponivel" };

  let resp: Response;
  try {
    resp = await fetch(`${supabaseUrl}/functions/v1/renovacao-unitv-conta`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Token": tokenInterno },
      body: JSON.stringify({ sn }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { outcome: "indisponivel" };
  }

  let body: { outcome?: string; id?: number };
  try {
    body = await resp.json();
  } catch {
    return { outcome: "indisponivel" };
  }

  if (body.outcome === "resolvido" && typeof body.id === "number") {
    return { outcome: "resolvido", id: body.id };
  }
  if (body.outcome === "nao_encontrado" || body.outcome === "ambiguo") {
    return { outcome: body.outcome };
  }
  return { outcome: "indisponivel" };
}
