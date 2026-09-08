// Atualiza a sessao do Rocket (sessionid+csrftoken) apos um login
// manual novo. Unico ponto de escrita do Vault.
//
// Dois chamadores aceitos (ver bloco de autenticacao abaixo):
//   1. O comando local scripts/atualizar-sessao-remota.mjs, deste
//      mesmo repositorio (migrado de inovatv_meta_business_agent em
//      2026-08-23, ver docs/renovacao_automatica/SESSAO_ROCKET_MONITORAMENTO.md)
//      -- autentica por X-Internal-Token (INALTERADO).
//   2. Uma captura iniciada pelo proprio operador (ex.: futura
//      extensao de navegador) -- autentica por Authorization: Bearer
//      <access token do Supabase> de um operador ja autorizado por
//      PAINEL_EMAIL_AUTORIZADO, via o mesmo verificarOperador() do
//      Painel de Atendimento.
// A Painel de Atendimento (app) nao chama este endpoint; so' a conta
// de operador dela e' reaproveitada como identidade valida no caminho 2.
//
// Fronteiras (regras explicitas do usuario, nao negociaveis nesta
// implementacao):
// - sessionid/csrftoken NUNCA aparecem em log, resposta ou erro.
// - Autenticacao checada ANTES de tudo. Qualquer falha (sem auth,
//   X-Internal-Token errado, JWT invalido, e-mail nao autorizado)
//   responde igual: 401 "Nao autorizado", sem revelar qual caminho
//   falhou.
// - Nenhum secret novo: SESSAO_ROCKET_UPDATE_TOKEN e
//   PAINEL_EMAIL_AUTORIZADO ja existem.
// - Nao mexe no mecanismo de renovacao ja comprovado (nenhum import
//   de whatsapp_client/gemini_client/validador aqui).
// - Faz UMA verificacao real (GET /gerenciador/) logo depois de
//   gravar, pra dar confirmacao imediata em vez de esperar o proximo
//   ciclo do monitoramento. Essa logica de validacao, o Vault e a
//   tabela rocket_session_estado NAO foram alterados nesta mudanca.

import { getServiceClient } from "../_shared/supabase_client.ts";
import { verificarSessaoRocket } from "../_shared/rocket_session_check.ts";
import { verificarOperador } from "../_shared/auth_painel.ts";
import { jsonResponse, errorResponse, corsResponse } from "../_shared/http.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsResponse();

  // --- Autenticacao: dois caminhos, qualquer um basta ---
  // Caminho 1 (INALTERADO): X-Internal-Token === SESSAO_ROCKET_UPDATE_TOKEN.
  const tokenInterno = Deno.env.get("SESSAO_ROCKET_UPDATE_TOKEN");
  const tokenRecebido = req.headers.get("X-Internal-Token");
  const tokenInternoOk =
    !!tokenInterno && !!tokenRecebido && tokenRecebido === tokenInterno;

  // Caminho 2 (novo): operador autorizado via Supabase Auth. So' e'
  // avaliado se o caminho 1 nao valeu E ha' header Authorization --
  // assim o fluxo do atualizar-sessao-remota.mjs nunca paga uma
  // chamada extra ao Supabase Auth.
  let operadorOk = false;
  if (!tokenInternoOk && req.headers.get("Authorization")) {
    const verificacao = await verificarOperador(req);
    operadorOk = verificacao.autorizado === true;
  }

  if (!tokenInternoOk && !operadorOk) {
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
