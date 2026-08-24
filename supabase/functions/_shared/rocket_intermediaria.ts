// Wrapper HTTP fino que chama /match e /status da propria API
// intermediaria (nunca fala com o Rocket direto, nunca importa codigo
// de match/status -- Componente 1 §5, inovatv_central). Timeout 5s,
// SEM retry -- falha vira "unavailable" diretamente (Componente 1
// §11), nunca confundido com "no_match"/"unlinked".

export interface MatchCandidate {
  publicId: string | null;
  nome: string | null;
  usuario: string | null;
}

export type MatchOutcome =
  | "no_match"
  | "single_match"
  | "multiple_matches"
  | "unavailable"
  | "invalid_request";

export interface MatchResult {
  outcome: MatchOutcome;
  candidates: MatchCandidate[];
}

export type StatusOutcome = "success" | "unavailable" | "invalid_request";
export type LinkState = "linked" | "unlinked";

export interface StatusCliente {
  nome: string | null;
  vencimento: string | null;
  planoNome: string | null;
  servidorNome: string | null;
  telas: number | null;
}

export interface StatusResult {
  outcome: StatusOutcome;
  linkState: LinkState;
  publicId: string | null;
  syncedAt: string | null;
  cliente?: StatusCliente;
}

const TIMEOUT_MS = 5000;

function baseUrl(): string {
  const url = Deno.env.get("SUPABASE_URL");
  if (!url) throw new Error("SUPABASE_URL ausente");
  return url;
}

function authHeader(): Record<string, string> {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY ausente");
  return { Authorization: `Bearer ${key}` };
}

export async function chamarMatch(telefone: string): Promise<MatchResult> {
  try {
    const url = `${baseUrl()}/functions/v1/match?telefone=${encodeURIComponent(telefone)}`;
    const resp = await fetch(url, {
      headers: authHeader(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!resp.ok) return { outcome: "unavailable", candidates: [] };

    const data = await resp.json();
    return {
      outcome: data?.outcome ?? "unavailable",
      candidates: Array.isArray(data?.candidates) ? data.candidates : [],
    };
  } catch {
    // Timeout (AbortSignal.timeout), rede fora, JSON invalido, env
    // ausente -- tudo cai aqui, tudo vira "unavailable" (nunca
    // no_match).
    return { outcome: "unavailable", candidates: [] };
  }
}

export async function chamarStatus(publicId: string): Promise<StatusResult> {
  const fallback: StatusResult = {
    outcome: "unavailable",
    linkState: "unlinked",
    publicId: null,
    syncedAt: null,
  };

  if (!publicId) return fallback;

  try {
    const url = `${baseUrl()}/functions/v1/status/${encodeURIComponent(publicId)}`;
    const resp = await fetch(url, {
      headers: authHeader(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // status/index.ts devolve 400 so para invalid_request (UUID mal
    // formado) -- corpo ainda tem outcome valido, nao tratar como
    // unavailable generico so por nao ser 2xx.
    if (!resp.ok && resp.status !== 400) return fallback;

    const data = await resp.json();
    return {
      outcome: data?.outcome ?? "unavailable",
      linkState: data?.linkState ?? "unlinked",
      publicId: data?.publicId ?? null,
      syncedAt: data?.syncedAt ?? null,
      cliente: data?.cliente,
    };
  } catch {
    return fallback;
  }
}
