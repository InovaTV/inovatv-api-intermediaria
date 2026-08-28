// Leitura do "contexto Sigma" de um cliente para o workflow
// renovacao-sigma.yml (GitHub Actions) -- devolve o id_cliente
// interno (numerico), o pacote atual e o expires_at do Sigma, a
// partir da sessao autenticada do Rocket. Substitui os fetch diretos
// que o runner fazia a app.rocketgestor.com para:
//   - GET /gerenciador/                              (checagem de sessao)
//   - GET /gerenciador/cliente/info/{public_id}/     (id_cliente interno)
//   - GET /gerenciador/cliente/sigma/info/?cliente_id=...  (antes e depois)
// esses eram bloqueados pela borda/Cloudflare no trafego do GitHub
// Actions (mesmo motivo que criou renovacao-sigma-cliente, commit
// d528377). Rodando aqui, dentro do Supabase, a resposta e' a pagina
// real.
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
// os campos ja extraidos. O "diagnostico" de id_nao_encontrado e' so'
// contadores inteiros.
//
// Duas fases, um unico endpoint:
//   - sem idClienteInterno (exige clienteNome + telefone): faz o
//     scrape da pagina e devolve { idClienteInterno, pacoteAtual,
//     expiresAt, sessaoValida }.
//   - com idClienteInterno (digitos): pula o scrape e devolve so'
//     { sessaoValida, expiresAt } -- reconsulta pos-clique.

import { errorResponse, jsonResponse } from "../_shared/http.ts";
import { getServiceClient } from "../_shared/supabase_client.ts";
import { verificarSessaoRocket } from "../_shared/rocket_session_check.ts";
import {
  lerPaginaClienteHtml,
  lerSigmaInfo,
  montarCookieHeader,
  resolverIdInterno,
} from "../_shared/rocket_sigma_contexto.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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

  let body: {
    publicId?: string;
    clienteNome?: string;
    telefone?: string;
    idClienteInterno?: string;
  };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Corpo da requisicao precisa ser JSON valido");
  }

  const publicId = (body.publicId ?? "").trim();
  if (!UUID_PATTERN.test(publicId)) {
    return errorResponse("Campo obrigatorio: publicId (uuid valido)");
  }

  const idClienteInternoEntrada = (body.idClienteInterno ?? "").trim();
  const faseDepois = idClienteInternoEntrada.length > 0;
  if (faseDepois && !ID_INTERNO_PATTERN.test(idClienteInternoEntrada)) {
    return errorResponse("idClienteInterno deve conter somente digitos");
  }

  const clienteNome = (body.clienteNome ?? "").trim();
  const telefone = (body.telefone ?? "").trim();
  if (!faseDepois && (clienteNome.length === 0 || telefone.length === 0)) {
    return errorResponse("Fase 'antes' exige clienteNome e telefone");
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
    if (faseDepois) {
      const sigma = await lerSigmaInfo(cookieHeader, idClienteInternoEntrada);
      if (sigma.outcome === "unavailable") {
        return jsonResponse({ outcome: "unavailable", etapa: "sigma_info" });
      }
      if (sigma.outcome === "pacote_vazio") {
        return jsonResponse({ outcome: "pacote_vazio" });
      }
      return jsonResponse({ outcome: "success", sessaoValida: true, expiresAt: sigma.expiresAt });
    }

    const pagina = await lerPaginaClienteHtml(cookieHeader, publicId);
    if (!pagina.ok) {
      return jsonResponse({ outcome: "unavailable", etapa: "pagina_cliente", status: pagina.status });
    }

    const resolucao = resolverIdInterno(pagina.html, clienteNome, telefone);
    if (resolucao.ids.length === 0) {
      return jsonResponse({
        outcome: "id_nao_encontrado",
        diagnostico: {
          paginaStatus: pagina.status,
          paginaTamanho: pagina.html.length,
          totalBotoes: resolucao.totalBotoes,
          botoesComNomeAlvo: resolucao.botoesComNomeAlvo,
        },
      });
    }
    if (resolucao.ids.length > 1) {
      return jsonResponse({ outcome: "id_ambiguo", candidatos: resolucao.ids });
    }
    const idClienteInterno = resolucao.ids[0];

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
      idClienteInterno,
      pacoteAtual: sigma.package,
      expiresAt: sigma.expiresAt,
    });
  } catch {
    return jsonResponse({ outcome: "unavailable", etapa: "excecao" });
  }
});
