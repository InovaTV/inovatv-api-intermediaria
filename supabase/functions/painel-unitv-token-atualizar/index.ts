// painel-unitv-token-atualizar (decisao aprovada 2026-09-07,
// inovatv_central/CLAUDE.md "Frente -- Fluxo de Renovacao Automatica").
//
// Fluxo OBRIGATORIO (nucleo em _shared/unitv_token_painel.ts):
//   token informado -> validar formato (32 hex) -> validar /api/account
//   read-only com o token NOVO -> SOMENTE se valido gravar Vault
//   (unitv_dealer_token_definir, origem 'recaptura_manual', por = e-mail
//   do operador) -> reler Vault -> revalidar /api/account -> sucesso.
//
// Falha de validacao em qualquer passo ANTES da gravacao NUNCA modifica
// o token atual. NAO faz login, NAO resolve CAPTCHA, NAO ativa F4/F5,
// NAO chama /api/account/renew, NAO toca o Edge secret UNITV_DEALER_TOKEN
// (so' o Vault -- invariante I4). NUNCA retorna nem loga o valor do
// token (I6): o corpo da resposta so' tem `outcome` e metadados.

import { verificarOperador, respostaNaoAutorizado } from "../_shared/auth_painel.ts";
import { jsonResponse, errorResponse, corsResponse } from "../_shared/http.ts";
import { getServiceClient } from "../_shared/supabase_client.ts";
import { resolverContaUnitv } from "../_shared/unitv_conta.ts";
import {
  atualizarTokenUnitv,
  classificarResolucao,
  type LinhaDiagnosticoPainel,
  type ProbeResultado,
} from "../_shared/unitv_token_painel.ts";

function criarProbar(): (token: string) => Promise<ProbeResultado> {
  const anchorSn = Deno.env.get("UNITV_DIAG_ANCHOR_SN")?.trim() ?? "";
  const dealerName = Deno.env.get("UNITV_DEALER_NAME")?.trim() ?? "";
  return async (token: string) => {
    if (!anchorSn || !dealerName) return { classe: "transport_fail" };
    const r = await resolverContaUnitv(anchorSn, { dealerToken: token, dealerName });
    return classificarResolucao(r);
  };
}

function criarDepsBanco(porEmail: string) {
  const supa = getServiceClient();
  return {
    gravarVault: async (token: string) => {
      const { error } = await supa.rpc("unitv_dealer_token_definir", {
        p_token: token,
        p_origem: "recaptura_manual",
        p_por: porEmail,
      });
      if (error) throw new Error(`unitv_dealer_token_definir: ${error.message ?? "erro"}`);
    },
    lerVault: async (): Promise<string | null> => {
      const { data } = await supa.rpc("unitv_dealer_token_ler");
      if (typeof data === "string") return data;
      if (Array.isArray(data) && typeof data[0] === "string") return data[0];
      return null;
    },
    gravarDiagnostico: async (linha: LinhaDiagnosticoPainel) => {
      const { error } = await supa.from("unitv_token_diagnostico").insert(linha);
      if (error) {
        console.log(
          "[painel-unitv-token-atualizar] erro ao gravar diagnostico",
          JSON.stringify({ erro: String(error.message ?? error) }),
        );
      }
    },
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsResponse();
  if (req.method !== "POST") {
    return errorResponse("Metodo nao suportado, use POST", 405);
  }

  const auth = await verificarOperador(req);
  if (!auth.autorizado) return respostaNaoAutorizado(auth.motivo);

  let corpo: { token?: unknown };
  try {
    corpo = await req.json();
  } catch {
    return errorResponse("Corpo da requisicao precisa ser JSON valido", 400);
  }
  if (typeof corpo?.token !== "string") {
    return errorResponse("Campo obrigatorio: token (string)", 400);
  }

  const banco = criarDepsBanco(auth.email);
  const resultado = await atualizarTokenUnitv(corpo.token, {
    probar: criarProbar(),
    gravarVault: banco.gravarVault,
    lerVault: banco.lerVault,
    gravarDiagnostico: banco.gravarDiagnostico,
    log: (evento, dados) =>
      console.log(
        "[painel-unitv-token-atualizar]",
        JSON.stringify({ evento, ...(dados ?? {}) }),
      ),
  });

  // Todos os desfechos do fluxo (inclusive falhas) voltam como HTTP 200
  // com `outcome` -- a UI ramifica por ele. Nao-2xx fica so' p/ auth
  // (401) / metodo (405) / corpo malformado (400).
  return jsonResponse(resultado, 200);
});
