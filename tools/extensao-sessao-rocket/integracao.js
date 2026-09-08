// Etapa 2A -- PREPARACAO da integracao com atualizar-sessao-rocket.
//
// Nesta etapa NADA e' enviado:
// - INTEGRACAO_HABILITADA e' false;
// - enviarSessaoParaRocket() para na trava dura, sem ler cookies e sem
//   fetch;
// - descreverChamadaAtualizarSessao() so' devolve um DESCRITOR textual
//   do que a etapa de integracao fara' (sem token real, sem cookie).

import { SUPABASE_URL, INTEGRACAO_HABILITADA } from "./config.js";

export { INTEGRACAO_HABILITADA };

export const URL_ATUALIZAR_SESSAO_ROCKET = `${SUPABASE_URL}/functions/v1/atualizar-sessao-rocket`;

/**
 * Descreve (sem executar) a chamada que a etapa de integracao fara'.
 * NAO le cookies, NAO monta corpo real, NAO faz fetch. So' texto.
 * @returns {{
 *   habilitada: boolean,
 *   metodo: string,
 *   url: string,
 *   headersPlanejados: string[],
 *   corpoPlanejado: string,
 *   observacao: string
 * }}
 */
export function descreverChamadaAtualizarSessao() {
  return {
    habilitada: INTEGRACAO_HABILITADA, // false na etapa 2A
    metodo: "POST",
    url: URL_ATUALIZAR_SESSAO_ROCKET,
    headersPlanejados: [
      "Authorization: Bearer <access_token do operador Supabase>",
      "apikey: <anon key publica>",
      "Content-Type: application/json",
    ],
    corpoPlanejado:
      "{ sessionid, csrftoken } -- lidos SO' na etapa de integracao, nunca aqui",
    observacao:
      "Etapa 2A: preparacao apenas. Nada e' enviado; sessionid/csrftoken nao sao lidos.",
  };
}

/**
 * Trava dura da Etapa 2A. Sem cookies, sem fetch, sem envio.
 * @returns {{ enviado: false, motivo: string }}
 */
export async function enviarSessaoParaRocket() {
  if (!INTEGRACAO_HABILITADA) {
    return { enviado: false, motivo: "integracao_desabilitada_etapa_2a" };
  }
  // A etapa de integracao futura implementa daqui para baixo (coletar
  // sessionid/csrftoken, fetch com Authorization: Bearer, tratar
  // resposta). Nada disso existe na etapa 2A.
  throw new Error("enviarSessaoParaRocket: nao implementado nesta etapa");
}
