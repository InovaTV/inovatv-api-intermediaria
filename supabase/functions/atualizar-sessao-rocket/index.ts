// Atualiza a sessao do Rocket (sessionid+csrftoken) apos um login
// manual novo. Unico ponto de escrita do Vault -- chamado por um
// unico comando local (scripts/atualizar-sessao-remota.mjs, deste
// mesmo repositorio -- migrado de inovatv_meta_business_agent em
// 2026-08-23, ver docs/renovacao_automatica/SESSAO_ROCKET_MONITORAMENTO.md),
// nunca pela Painel de Atendimento nem por nenhum outro consumidor.
//
// Fronteiras (regras explicitas do usuario, nao negociaveis nesta
// implementacao):
// - sessionid/csrftoken NUNCA aparecem em log, resposta ou erro.
// - Protegida por token interno dedicado (SESSAO_ROCKET_UPDATE_TOKEN),
//   checado ANTES de tudo, mesmo padrao ja usado no Orquestrador.
// - Nao mexe no mecanismo de renovacao ja comprovado (nenhum import
//   de whatsapp_client/gemini_client/validador aqui).
// - Faz UMA verificacao real (GET /gerenciador/) logo depois de
//   gravar, pra dar confirmacao imediata em vez de esperar o proximo
//   ciclo do monitoramento.

import { getServiceClient } from "../_shared/supabase_client.ts";
import { verificarSessaoRocket } from "../_shared/rocket_session_check.ts";
import { jsonResponse, errorResponse, corsResponse } from "../_shared/http.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsResponse();

  const tokenInterno = Deno.env.get("SESSAO_ROCKET_UPDATE_TOKEN");
  const tokenRecebido = req.headers.get("X-Internal-Token");
  if (!tokenInterno || !tokenRecebido || tokenRecebido !== tokenInterno) {
    return errorResponse("Nao autorizado", 401);
  }

  if (req.method !== "POST") {
    return errorResponse("Metodo nao suportado, use POST", 405);
  }

  let body: { sessionid?: string; csrftoken?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Corpo da requisicao precisa ser JSON valido");
  }

  const { sessionid, csrftoken } = body;
  if (!sessionid || !csrftoken) {
    return errorResponse("Campos obrigatorios: sessionid, csrftoken");
  }

  const client = getServiceClient();

  const { error: erroDefinir } = await client.rpc("rocket_sessao_definir", {
    p_sessionid: sessionid,
    p_csrftoken: csrftoken,
  });
  if (erroDefinir) {
    console.error("Falha ao gravar sessao no Vault:", erroDefinir.message);
    return errorResponse("Falha ao gravar a sessao", 500);
  }

  const resultado = await verificarSessaoRocket(sessionid, csrftoken);
  const sessaoValidada = "valida" in resultado && resultado.valida === true;

  const agora = new Date().toISOString();
  const updatePayload: Record<string, unknown> = { atualizado_em: agora };
  if (sessaoValidada) {
    updatePayload.status = "valida";
    updatePayload.ultima_verificacao_bem_sucedida_em = agora;
    updatePayload.sessao_invalidada_em = null;
    updatePayload.alerta_issue_numero = null;
    updatePayload.alerta_issue_criado_em = null;
  }
  // Se a verificacao nao confirmar sucesso (invalida ou erro de rede),
  // NAO mexe no status aqui -- deixa o proximo ciclo do monitoramento
  // decidir com mais uma amostra, evitando marcar "valida" por engano
  // com base numa unica checagem logo apos a gravacao.

  const { error: erroEstado } = await client
    .from("rocket_session_estado")
    .update(updatePayload)
    .eq("id", 1);
  if (erroEstado) {
    console.error("Falha ao atualizar estado:", erroEstado.message);
  }

  return jsonResponse({
    outcome: "atualizada",
    sessaoValidada,
  });
});
