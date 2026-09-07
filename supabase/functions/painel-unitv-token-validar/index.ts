// painel-unitv-token-validar (decisao aprovada 2026-09-07,
// inovatv_central/CLAUDE.md "Frente -- Fluxo de Renovacao Automatica").
//
// Botao "Validar agora": sonda AO VIVO, read-only, o token que ESTA no
// Vault agora (obterDealerToken, Vault -> fallback do secret, ignorando
// o cache de 30s), via POST /api/account resolvendo o SN ancora -- a
// MESMA validacao que renovacao-unitv-conta / diagnosticarTokenUnitv
// ja usam. Grava 1 linha em unitv_token_diagnostico p/ manter "ultima
// validacao" fresca.
//
// NAO faz login, NAO resolve CAPTCHA, NAO chama /api/account/renew, NAO
// altera o token. NUNCA retorna nem loga o valor do token (I6).

import { verificarOperador, respostaNaoAutorizado } from "../_shared/auth_painel.ts";
import { jsonResponse, errorResponse, corsResponse } from "../_shared/http.ts";
import { getServiceClient } from "../_shared/supabase_client.ts";
import { obterDealerToken } from "../_shared/unitv_dealer_token.ts";
import { resolverContaUnitv } from "../_shared/unitv_conta.ts";
import {
  classificarResolucao,
  validarTokenAtual,
  type LinhaDiagnosticoPainel,
  type ProbeResultado,
} from "../_shared/unitv_token_painel.ts";

// Sonda read-only: token -> ProbeResultado ja classificado. Sem ancora
// ou dealer_name configurados -> transport_fail (indeterminado), nunca
// "morto" nem "vivo".
function criarProbar(): (token: string) => Promise<ProbeResultado> {
  const anchorSn = Deno.env.get("UNITV_DIAG_ANCHOR_SN")?.trim() ?? "";
  const dealerName = Deno.env.get("UNITV_DEALER_NAME")?.trim() ?? "";
  return async (token: string) => {
    if (!anchorSn || !dealerName) return { classe: "transport_fail" };
    const r = await resolverContaUnitv(anchorSn, { dealerToken: token, dealerName });
    return classificarResolucao(r);
  };
}

function criarGravarDiagnostico(): (
  linha: LinhaDiagnosticoPainel,
) => Promise<void> {
  const supa = getServiceClient();
  return async (linha: LinhaDiagnosticoPainel) => {
    const { error } = await supa.from("unitv_token_diagnostico").insert(linha);
    if (error) {
      console.log(
        "[painel-unitv-token-validar] erro ao gravar diagnostico",
        JSON.stringify({ erro: String(error.message ?? error) }),
      );
    }
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsResponse();
  if (req.method !== "POST") {
    return errorResponse("Metodo nao suportado, use POST", 405);
  }

  const auth = await verificarOperador(req);
  if (!auth.autorizado) return respostaNaoAutorizado(auth.motivo);

  const resultado = await validarTokenAtual({
    obterTokenAtual: () => obterDealerToken({ ignorarCache: true }),
    probar: criarProbar(),
    gravarDiagnostico: criarGravarDiagnostico(),
  });

  return jsonResponse({ outcome: "success", resultado });
});
