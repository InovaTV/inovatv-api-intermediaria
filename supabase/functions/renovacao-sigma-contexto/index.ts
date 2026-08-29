// Contexto Sigma de um cliente para o workflow renovacao-sigma.yml
// (GitHub Actions) -- dado o idClienteInterno JA' RESOLVIDO pelo
// Playwright, devolve o pacote atual, o expires_at do Sigma e a
// validade da sessao. Roda DENTRO do Supabase (o runner do GitHub
// Actions e' bloqueado pela borda/Cloudflare no trafego direto ao
// Rocket -- mesma causa que criou renovacao-sigma-cliente).
//
// Chamada nas duas pontas do fluxo, com o MESMO contrato:
//   - antes do clique: usa `pacoteAtual` (pra achar a opcao do
//     <select>) e `expiresAt` (baseline);
//   - depois do clique: usa so' `expiresAt` (reconsulta).
//
// A resolucao do idClienteInterno NAO acontece mais aqui -- a lista de
// clientes do Rocket passou a ser materializada por JavaScript (Vue),
// entao o #btn_add_pagamento_{id} so' existe no DOM renderizado, nunca
// no HTML cru. Isso e' feito pelo Playwright, dentro do workflow
// (scripts/renovacao-sigma-workflow.mjs + scripts/lib/resolver-id-interno-dom.mjs).
//
// Auth: X-Internal-Token dedicado (RENOVACAO_SIGMA_CALLBACK_TOKEN) --
// o MESMO secret ja compartilhado por renovacao-sigma-cliente e
// renovacao-sigma-resultado. NENHUM secret novo. A sessao do Rocket
// vem do Vault via rocket_sessao_ler (SECURITY DEFINER + grant so a
// service_role); SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY sao injetados
// pela plataforma.
//
// Somente leitura. A resposta NUNCA contem cookie, sessionid,
// csrftoken, senha, device_key/OTP nem HTML autenticado bruto -- so'
// pacoteAtual e expiresAt.

import { errorResponse, jsonResponse } from "../_shared/http.ts";
import { getServiceClient } from "../_shared/supabase_client.ts";
import { verificarSessaoRocket } from "../_shared/rocket_session_check.ts";
import { lerSigmaInfo, montarCookieHeader, type SigmaInfoResultado } from "../_shared/rocket_sigma_contexto.ts";

const ID_INTERNO_PATTERN = /^\d+$/;

// Camada A (Iteracao 1, 2026-08-29) -- retry curto e limitado da leitura
// do contexto Sigma, SO' para `unavailable` (que agora inclui o
// `Unauthenticated` reclassificado -- ver _shared/rocket_sigma_contexto.ts).
// `success` / `pacote_vazio` sao terminais e nunca re-tentam.
//
// backoffMs[i] = espera ANTES da tentativa i (i=0 sem espera). jitter =
// +-20%. Exposto como objeto mutavel so' pra os testes acelerarem o
// backoff (nunca alterado em producao).
export const SIGMA_CTX_RETRY = {
  tentativas: 4,
  backoffMs: [0, 400, 900, 1600] as number[],
  jitter: 0.2,
};

function esperaComJitter(ms: number, jitter: number): number {
  if (ms <= 0) return 0;
  const fator = 1 + (Math.random() * 2 - 1) * jitter; // +-jitter
  return Math.max(0, Math.round(ms * fator));
}

async function lerSigmaInfoComRetry(
  cookieHeader: string,
  idClienteInterno: string,
): Promise<{ resultado: SigmaInfoResultado; tentativas: number }> {
  const { tentativas, backoffMs, jitter } = SIGMA_CTX_RETRY;
  let ultimo: SigmaInfoResultado = { outcome: "unavailable", motivo: "excecao" };
  for (let i = 0; i < tentativas; i++) {
    const base = backoffMs[i] ?? backoffMs[backoffMs.length - 1] ?? 0;
    const espera = esperaComJitter(base, jitter);
    if (espera > 0) await new Promise((r) => setTimeout(r, espera));
    ultimo = await lerSigmaInfo(cookieHeader, idClienteInterno);
    // Retry SOMENTE em unavailable.
    if (ultimo.outcome !== "unavailable") return { resultado: ultimo, tentativas: i + 1 };
  }
  return { resultado: ultimo, tentativas };
}

Deno.serve(async (req: Request) => {
  const tokenInterno = Deno.env.get("RENOVACAO_SIGMA_CALLBACK_TOKEN");
  const tokenRecebido = req.headers.get("X-Internal-Token");
  if (!tokenInterno || !tokenRecebido || tokenRecebido !== tokenInterno) {
    return errorResponse("Nao autorizado", 401);
  }

  if (req.method !== "POST") {
    return errorResponse("Metodo nao suportado, use POST", 405);
  }

  let body: { idClienteInterno?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Corpo da requisicao precisa ser JSON valido");
  }

  const idClienteInterno = (body.idClienteInterno ?? "").trim();
  if (!ID_INTERNO_PATTERN.test(idClienteInterno)) {
    return errorResponse("Campo obrigatorio: idClienteInterno (somente digitos)");
  }

  // --- Sessao do Vault (unico caminho de leitura) ---
  let sessionid: string | null = null;
  let csrftoken: string | null = null;
  try {
    const { data } = await getServiceClient().rpc("rocket_sessao_ler");
    const linha = Array.isArray(data) ? data[0] : data;
    sessionid = linha?.sessionid ?? null;
    csrftoken = linha?.csrftoken ?? null;
  } catch {
    return jsonResponse({ outcome: "unavailable", etapa: "sessao_vault" });
  }
  if (!sessionid || !csrftoken) {
    return jsonResponse({ outcome: "sessao_expirada", detalhe: "sessao do Vault ausente" });
  }

  const cookieHeader = montarCookieHeader(sessionid, csrftoken);

  // --- Checagem de sessao (mesma logica de rocket_session_check.ts).
  // {valida:false} e' o unico sinal inequivoco de sessao expirada;
  // {erroRede:true} NAO aborta ("falha de rede nunca marca invalida",
  // mesma disciplina do workflow atual). ---
  const checagem = await verificarSessaoRocket(sessionid, csrftoken);
  if ("valida" in checagem && checagem.valida === false) {
    return jsonResponse({ outcome: "sessao_expirada", detalhe: "sessao invalida (login)" });
  }

  try {
    const { resultado: sigma, tentativas } = await lerSigmaInfoComRetry(cookieHeader, idClienteInterno);
    if (sigma.outcome === "unavailable") {
      // `sigma_info_auth` = rejeicao de autenticacao do painel (transitorio,
      // ja re-tentado N vezes). Distinto de `sessao_expirada`, que e' a
      // NOSSA sessao do Vault, tratada acima.
      const etapa = sigma.motivo === "auth_painel" ? "sigma_info_auth" : "sigma_info";
      return jsonResponse({ outcome: "unavailable", etapa, tentativas });
    }
    if (sigma.outcome === "pacote_vazio") {
      return jsonResponse({ outcome: "pacote_vazio", tentativas });
    }
    return jsonResponse({
      outcome: "success",
      sessaoValida: true,
      pacoteAtual: sigma.package,
      expiresAt: sigma.expiresAt,
      tentativas,
    });
  } catch {
    return jsonResponse({ outcome: "unavailable", etapa: "excecao" });
  }
});
