// Fase 2A da autocura do UNITV_DEALER_TOKEN (2026-08-30, inovatv_central/
// CLAUDE.md). FONTE VIVA do dealer token do painel de revenda UniTV:
//
//   1. Vault  -- RPC unitv_dealer_token_ler (SECURITY DEFINER, so'
//      service_role). Valor vivo, que a futura autocura (Fase 4) podera
//      atualizar via unitv_dealer_token_definir.
//   2. FALLBACK -- Edge secret UNITV_DEALER_TOKEN (bootstrap e ultimo
//      recurso; comportamento pre-2A). O secret NUNCA e' removido.
//
// A Fase 2A NAO rotaciona nada: Vault e secret comecam com o MESMO
// valor. Este modulo so' muda DE ONDE o token e' lido, nunca o valor.
//
// NUNCA loga o valor -- so' um status ("vault indisponivel/vazio ->
// fallback"). Cache em memoria de 30s para nao repetir a RPC dentro de
// um mesmo processamento.
//
// scripts/lib/unitv-renovar.mjs (executor congelado) NAO usa este
// modulo -- no runner do GitHub Actions quem resolve o token e'
// scripts/renovacao-sigma-workflow.mjs (lerDealerTokenVault), com a
// mesma logica Vault -> fallback do env.

import { getServiceClient } from "./supabase_client.ts";

const CACHE_TTL_MS = 30_000;
let cache: { valor: string; em: number } | null = null;

// Injecoes opcionais SO' para teste -- producao usa os defaults.
export interface ObterDealerTokenOpts {
  supa?: { rpc: (nome: string) => Promise<{ data: unknown; error?: unknown }> };
  env?: (nome: string) => string | undefined;
  agora?: () => number;
  ignorarCache?: boolean;
}

// Zera o cache em memoria (usado nos testes entre casos).
export function limparCacheDealerToken(): void {
  cache = null;
}

export async function obterDealerToken(opts: ObterDealerTokenOpts = {}): Promise<string> {
  const agora = opts.agora ?? (() => Date.now());
  const env = opts.env ?? ((n: string) => Deno.env.get(n));

  if (!opts.ignorarCache && cache && agora() - cache.em < CACHE_TTL_MS) {
    return cache.valor;
  }

  // 1) Vault
  let doVault = "";
  try {
    const supa = opts.supa ?? getServiceClient();
    const { data } = await supa.rpc("unitv_dealer_token_ler");
    const t = typeof data === "string"
      ? data
      : (Array.isArray(data) && typeof data[0] === "string" ? data[0] : null);
    if (t && t.trim() !== "") doVault = t;
  } catch {
    // cai no fallback
  }

  if (doVault) {
    cache = { valor: doVault, em: agora() };
    return doVault;
  }

  // 2) Fallback: Edge secret (comportamento pre-2A). Cacheado tambem
  //    (30s), para nao martelar um Vault indisponivel -- e como a
  //    Fase 2A nao rotaciona, Vault == secret, entao e' inofensivo.
  const secret = env("UNITV_DEALER_TOKEN") ?? "";
  console.log("[unitv-dealer-token] vault indisponivel/vazio -> fallback do secret");
  if (secret) cache = { valor: secret, em: agora() };
  return secret;
}
