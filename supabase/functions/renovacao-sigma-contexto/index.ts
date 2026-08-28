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
import { lerSigmaInfo, montarCookieHeader } from "../_shared/rocket_sigma_contexto.ts";

const ID_INTERNO_PATTERN = /^\d+$/;

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
    const sigma = await lerSigmaInfo(cookieHeader, idClienteInterno);
    if (sigma.outcome === "unavailable") {
      return jsonResponse({ outcome: "unavailable", etapa: "sigma_info" });
    }
    if (sigma.outcome === "pacote_vazio") {
      return jsonResponse({ outcome: "pacote_vazio" });
    }
    return jsonResponse({
      outcome: "success",
      sessaoValida: true,
      pacoteAtual: sigma.package,
      expiresAt: sigma.expiresAt,
    });
  } catch {
    return jsonResponse({ outcome: "unavailable", etapa: "excecao" });
  }
});
