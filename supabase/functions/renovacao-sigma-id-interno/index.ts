// Resolve FRESH o id_cliente numerico interno do Rocket a partir do
// public_id -- exclusivo para o workflow renovacao-sigma.yml, chamado
// ANTES do executarCliqueAddPagamento.
//
// Reaproveita: sessao Rocket do Vault (rocket_sessao_ler), constantes/
// cookie/lerSigmaInfo de _shared/rocket_sigma_contexto.ts,
// http helpers. Nenhum secret novo -- mesmo X-Internal-Token
// (RENOVACAO_SIGMA_CALLBACK_TOKEN) ja usado por renovacao-sigma-cliente.
//
// Passos: GET server-side de /gerenciador/cliente/info/{public_id}/
// (HTML server-rendered) -> extrai cliente_id="(\d+)" -> valida o ID
// com sigma/info -> devolve SO' o ID. NUNCA devolve/loga HTML, M3U,
// senha ou cookie. Sem cache/stale/fallback. Nenhum POST.

import { errorResponse, jsonResponse } from "../_shared/http.ts";
import { getServiceClient } from "../_shared/supabase_client.ts";
import {
  ROCKET_BASE_URL,
  ROCKET_USER_AGENT,
  montarCookieHeader,
  lerSigmaInfo,
} from "../_shared/rocket_sigma_contexto.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RE_CLIENTE_ID = /cliente_id="(\d+)"/;

Deno.serve(async (req: Request) => {
  const tokenInterno = Deno.env.get("RENOVACAO_SIGMA_CALLBACK_TOKEN");
  const tokenRecebido = req.headers.get("X-Internal-Token");
  if (!tokenInterno || !tokenRecebido || tokenRecebido !== tokenInterno) {
    return errorResponse("Nao autorizado", 401);
  }
  if (req.method !== "POST") {
    return errorResponse("Metodo nao suportado, use POST", 405);
  }

  let body: { publicId?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Corpo precisa ser JSON valido");
  }
  const publicId = body?.publicId;
  if (!publicId || !UUID_PATTERN.test(publicId)) {
    return errorResponse("publicId ausente ou invalido");
  }

  const client = getServiceClient();
  const { data: sessao, error: erroLer } = await client.rpc("rocket_sessao_ler");
  const linha = Array.isArray(sessao) ? sessao[0] : sessao;
  const sessionid: string | null = linha?.sessionid ?? null;
  const csrftoken: string | null = linha?.csrftoken ?? null;
  if (erroLer || !sessionid || !csrftoken) {
    return jsonResponse({ outcome: "unavailable", motivo: "sem_sessao" });
  }

  const cookieHeader = montarCookieHeader(sessionid, csrftoken);

  // --- GET server-side do HTML server-rendered ---
  let html: string;
  try {
    const res = await fetch(
      `${ROCKET_BASE_URL}/gerenciador/cliente/info/${encodeURIComponent(publicId)}/`,
      {
        method: "GET",
        redirect: "manual",
        headers: {
          Cookie: cookieHeader,
          "User-Agent": ROCKET_USER_AGENT,
          Referer: `${ROCKET_BASE_URL}/gerenciador/`,
        },
      },
    );
    if (res.status >= 300 && res.status < 400) {
      // redirect -> normalmente /accounts/login/ -> sessao invalida
      return jsonResponse({ outcome: "unavailable", motivo: "auth" });
    }
    if (!res.ok) {
      return jsonResponse({ outcome: "unavailable", motivo: "http" });
    }
    html = await res.text();
  } catch {
    return jsonResponse({ outcome: "unavailable", motivo: "excecao" });
  }

  const m = html.match(RE_CLIENTE_ID);
  // html descartado -- nunca sai daqui
  html = "";
  if (!m) {
    return jsonResponse({ outcome: "nao_encontrado" });
  }
  const idInterno = m[1];

  // --- Cross-check: o ID e' aceito pelo sigma/info? ---
  const sigma = await lerSigmaInfo(cookieHeader, idInterno);
  if (sigma.outcome === "success" || sigma.outcome === "pacote_vazio") {
    return jsonResponse({ outcome: "resolvido", idInterno });
  }
  return jsonResponse({ outcome: "unavailable", motivo: "sigma_invalido" });
});
