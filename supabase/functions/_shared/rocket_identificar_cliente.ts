// Identificacao de cliente por telefone, DIRETO no Rocket -- Portal de
// Renovacao Tope TV (renovacao-iniciar). Mesmo endpoint que
// match/index.ts usa (GET /gerenciador/api/v1/clientes/), mesma decisao
// 0/1/N por paginacao.total -- so' chamado diretamente (ROCKET_API_KEY/
// ROCKET_BASE_URL ja disponiveis em qualquer Edge Function deste
// projeto, mesmo padrao ja usado por _shared/rocket_valor_cliente.ts),
// sem depender de /match (que exige JWT do Supabase -- decisao
// arquitetural registrada no Checkpoint 1: nao tornar /match publico so'
// pro Portal).
//
// Escopo deliberadamente minimo: so' o parametro `telefone`, nunca os
// outros campos que /match aceita (nome/usuario/email/mac/pix/busca) --
// o Portal so' identifica por telefone. Isso E' uma pequena sobreposicao
// consciente com a logica 0/1/N de match/index.ts (registrada e aceita
// na investigacao do Checkpoint 1), nao uma tentativa de reinventar
// match/status.
//
// Nunca repassa senha/device_key_or_OTP_code -- mesmo principio de
// match/index.ts. Cada candidato devolve so' publicId/nome/usuario
// (dado minimo pra decidir 0/1/N e montar a lista inicial); dados
// completos por acesso (servidor/plano/valor/vencimento) vem depois,
// UM candidato de cada vez, via consultarClienteCompletoRocket
// (_shared/rocket_valor_cliente.ts, ja existente, NAO duplicado aqui).

const TIMEOUT_MS = 10000;

export interface CandidatoRocket {
  publicId: string;
  nome: string | null;
  usuario: string | null;
}

export type OutcomeIdentificacao = "no_match" | "single_match" | "multiple_matches" | "unavailable";

export interface ResultadoIdentificacao {
  outcome: OutcomeIdentificacao;
  candidatos: CandidatoRocket[];
}

function normalizeCandidato(cliente: Record<string, unknown>): CandidatoRocket | null {
  if (typeof cliente.id !== "string") return null;
  return {
    publicId: cliente.id,
    nome: typeof cliente.nome === "string" ? cliente.nome : null,
    usuario: typeof cliente.usuario === "string" ? cliente.usuario : null,
  };
}

export async function buscarClientesPorTelefone(telefone: string): Promise<ResultadoIdentificacao> {
  const rocketBaseUrl = Deno.env.get("ROCKET_BASE_URL");
  const rocketApiKey = Deno.env.get("ROCKET_API_KEY");
  if (!rocketBaseUrl || !rocketApiKey || !telefone) {
    return { outcome: "unavailable", candidatos: [] };
  }

  const params = new URLSearchParams({ telefone, page: "1", page_size: "10" });

  let resp: Response;
  try {
    resp = await fetch(`${rocketBaseUrl}/gerenciador/api/v1/clientes/?${params.toString()}`, {
      headers: { "X-API-Key": rocketApiKey },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { outcome: "unavailable", candidatos: [] };
  }

  if (!resp.ok) return { outcome: "unavailable", candidatos: [] };

  const data = await resp.json().catch(() => null);
  const total = data?.paginacao?.total ?? 0;
  const itens = Array.isArray(data?.itens) ? data.itens : [];
  const candidatos = itens
    .map((c: Record<string, unknown>) => normalizeCandidato(c))
    .filter((c: CandidatoRocket | null): c is CandidatoRocket => c !== null);

  if (total === 0) return { outcome: "no_match", candidatos: [] };
  return { outcome: total === 1 ? "single_match" : "multiple_matches", candidatos };
}
