// Etapa 2B -- integracao REAL com atualizar-sessao-rocket.
//
// enviarSessaoParaRocket():
// - so' age se INTEGRACAO_HABILITADA;
// - exige operador autenticado E autorizado (sessao Supabase);
// - le sessionid + csrftoken via chrome.cookies (UNICO ponto que le o
//   .value); se faltar qualquer um -> NAO faz POST;
// - POST atualizar-sessao-rocket com Authorization: Bearer <access
//   token do operador> + apikey: <anon key publica>;
// - NAO armazena os cookies; NAO exibe/loga valores de cookie/token/
//   corpo; limpa as variaveis sensiveis no finally;
// - retorna so' um codigo de resultado seguro (nunca valores).
//
// O SESSAO_ROCKET_UPDATE_TOKEN (token interno) NAO existe aqui -- a
// extensao usa exclusivamente o caminho Supabase Auth.

import { SUPABASE_URL, SUPABASE_ANON_KEY, INTEGRACAO_HABILITADA, OPERADOR_AUTORIZADO_EMAIL } from "./config.js";
import { URL_ROCKET, avaliarOperador } from "./lib.js";
import { sessaoValida } from "./auth.js";

export { INTEGRACAO_HABILITADA };

export const URL_ATUALIZAR_SESSAO_ROCKET = `${SUPABASE_URL}/functions/v1/atualizar-sessao-rocket`;

/** Descritor textual (sem valores reais) da chamada. */
export function descreverChamadaAtualizarSessao() {
  return {
    habilitada: INTEGRACAO_HABILITADA,
    metodo: "POST",
    url: URL_ATUALIZAR_SESSAO_ROCKET,
    headersPlanejados: [
      "Authorization: Bearer <access_token do operador Supabase>",
      "apikey: <anon key publica>",
      "Content-Type: application/json",
    ],
    corpoPlanejado:
      "{ sessionid, csrftoken } -- lidos de chrome.cookies no clique, nunca armazenados/exibidos/logados",
    observacao:
      "Etapa 2B: integracao ativa. Os valores dos cookies so' existem no corpo da requisicao.",
  };
}

/**
 * @returns {Promise<{ ok: boolean, resultado: string, faltando?: string[] }>}
 *   resultado in: sessao_atualizada_validada | sessao_atualizada |
 *   sem_operador | cookie_faltando | nao_autorizado_servidor |
 *   desabilitada | erro
 */
export async function enviarSessaoParaRocket() {
  if (!INTEGRACAO_HABILITADA) {
    return { ok: false, resultado: "desabilitada" };
  }

  // 10. operador autenticado E autorizado?
  const sessao = await sessaoValida(); // renova sozinho se necessario
  const op = avaliarOperador(sessao, OPERADOR_AUTORIZADO_EMAIL);
  if (!op.autenticado || !op.autorizado) {
    return { ok: false, resultado: "sem_operador" };
  }

  let c1 = null;
  let c2 = null;
  let sessionid = null;
  let csrftoken = null;
  let accessToken = null;
  let corpo = null;
  try {
    c1 = await chrome.cookies.get({ url: URL_ROCKET, name: "sessionid" });
    c2 = await chrome.cookies.get({ url: URL_ROCKET, name: "csrftoken" });

    // 9. faltando cookie -> NENHUM POST
    const faltando = [];
    if (!c1 || !c1.value) faltando.push("sessionid");
    if (!c2 || !c2.value) faltando.push("csrftoken");
    if (faltando.length) return { ok: false, resultado: "cookie_faltando", faltando };

    sessionid = c1.value;
    csrftoken = c2.value;
    accessToken = sessao.access_token;
    corpo = JSON.stringify({ sessionid, csrftoken });

    let res;
    try {
      res = await fetch(URL_ATUALIZAR_SESSAO_ROCKET, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          apikey: SUPABASE_ANON_KEY,
          "Content-Type": "application/json",
        },
        body: corpo,
      });
    } catch {
      return { ok: false, resultado: "erro" };
    }

    if (res.status === 401) return { ok: false, resultado: "nao_autorizado_servidor" };

    const dados = await res.json().catch(() => null);
    if (res.ok && dados && dados.outcome === "atualizada") {
      return {
        ok: true,
        resultado: dados.sessaoValidada ? "sessao_atualizada_validada" : "sessao_atualizada",
      };
    }
    return { ok: false, resultado: "erro" };
  } finally {
    // 7. limpar referencias sensiveis (JS nao zera string; e' o maximo
    // possivel -- as strings ficam elegiveis a GC).
    if (c1) c1.value = null;
    if (c2) c2.value = null;
    c1 = c2 = sessionid = csrftoken = accessToken = corpo = null;
  }
}
