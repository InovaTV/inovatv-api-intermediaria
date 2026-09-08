// Logica PURA da extensao de captura de sessao do Rocket.
//
// Regras estruturais (garantidas por este arquivo):
// - Deteccao de cookie: nunca recebe, le, guarda ou retorna VALOR de
//   cookie -- so' presenca (booleano ESTRITO por nome).
// - Logica de auth (etapa 2A): so' funcoes puras de ESTADO -- nao le
//   token, nao faz rede, nao toca chrome.*, nao retorna e-mail.
// - Sem dependencias, sem I/O, sem chrome.*, sem rede.
// - Reutilizada tal e qual pelo popup (popup.js) e pelos testes.

// Dominio unico que esta extensao inspeciona.
export const URL_ROCKET = "https://app.rocketgestor.com/";

// Os UNICOS cookies que esta extensao considera. Qualquer outro nome
// e' ignorado -- a extensao nunca le nem reporta outros cookies.
export const COOKIES_ALVO = ["sessionid", "csrftoken"];

/**
 * Avalia a presenca dos cookies de sessao do Rocket.
 *
 * @param {Record<string, boolean>} presenca  presenca[nome] === true
 *        significa "o cookie <nome> existe neste navegador". Qualquer
 *        outro valor (false, undefined, string, numero, objeto) conta
 *        como AUSENTE -- comparacao estrita com `true` para que nenhum
 *        valor de cookie possa ser confundido com "presente".
 * @returns {{
 *   completo: boolean,
 *   encontrados: string[],
 *   faltando: string[],
 *   mensagem: string
 * }}
 */
export function avaliarSessaoRocket(presenca) {
  const p = presenca && typeof presenca === "object" ? presenca : {};

  const encontrados = [];
  const faltando = [];
  for (const nome of COOKIES_ALVO) {
    if (p[nome] === true) encontrados.push(nome);
    else faltando.push(nome);
  }

  const completo = faltando.length === 0;

  let mensagem;
  if (completo) {
    mensagem =
      "Sessao do Rocket detectada: sessionid e csrftoken estao presentes neste navegador.";
  } else if (encontrados.length === 0) {
    mensagem =
      `Nenhum cookie de sessao do Rocket encontrado. Faltando: ${faltando.join(", ")}. ` +
      "Faca login em app.rocketgestor.com neste navegador e tente de novo.";
  } else {
    mensagem =
      `Sessao incompleta. Encontrado: ${encontrados.join(", ")}. ` +
      `Faltando: ${faltando.join(", ")}.`;
  }

  return { completo, encontrados, faltando, mensagem };
}

// ===========================================================================
// Etapa 2A -- logica PURA de estado da autenticacao do operador.
//
// Nada aqui le token, faz rede, toca chrome.* ou retorna e-mail. Recebe
// so' o essencial ja' extraido pelo popup e devolve um veredito de UI.
// ===========================================================================

/**
 * O access token esta expirado (ou perto disso)?
 *
 * @param {number} expiraEmEpochS  `expires_at` (epoch em SEGUNDOS).
 * @param {number} agoraEpochS     agora, epoch em SEGUNDOS.
 * @param {number} [margemS=60]    considera expirado se faltar <= margemS.
 * @returns {boolean}  true tambem para entrada invalida (fail-safe).
 */
export function tokenExpirado(expiraEmEpochS, agoraEpochS, margemS = 60) {
  if (typeof expiraEmEpochS !== "number" || !Number.isFinite(expiraEmEpochS)) {
    return true;
  }
  if (typeof agoraEpochS !== "number" || !Number.isFinite(agoraEpochS)) {
    return true;
  }
  return agoraEpochS >= expiraEmEpochS - margemS;
}

/**
 * A sessao autenticada e' do operador autorizado?
 *
 * NAO retorna o e-mail -- so' o veredito. A checagem definitiva de
 * autorizacao continua no servidor (PAINEL_EMAIL_AUTORIZADO dentro de
 * atualizar-sessao-rocket); esta funcao so' antecipa o resultado na UI.
 *
 * @param {{email?: string} | null | undefined} sessao
 * @param {string} emailAutorizado
 * @returns {{ autenticado: boolean, autorizado: boolean, rotulo: string }}
 */
export function avaliarOperador(sessao, emailAutorizado) {
  const emailSessao =
    sessao && typeof sessao === "object" && typeof sessao.email === "string"
      ? sessao.email.trim()
      : "";

  if (!emailSessao) {
    return { autenticado: false, autorizado: false, rotulo: "Nao autenticado" };
  }

  const autorizado =
    typeof emailAutorizado === "string" &&
    emailSessao.toLowerCase() === emailAutorizado.trim().toLowerCase();

  return {
    autenticado: true,
    autorizado,
    rotulo: autorizado
      ? "Operador autorizado"
      : "Autenticado, mas NAO e' o operador autorizado",
  };
}

/**
 * Deriva o estado da UI de auth a partir da sessao lida do storage.
 *
 * @param {{
 *   sessao?: {email?: string, expires_at?: number} | null,
 *   agoraEpochS?: number,
 *   margemS?: number
 * }} entrada
 * @param {string} emailAutorizado
 * @returns {{
 *   tela: "login" | "operador" | "nao_operador",
 *   rotulo: string,
 *   podeLogout: boolean,
 *   precisaRenovar: boolean,
 *   envioRocketHabilitado: boolean
 * }}
 */
export function derivarEstadoAuth(entrada, emailAutorizado) {
  const { sessao = null, agoraEpochS, margemS, integracaoHabilitada = false } =
    entrada ?? {};
  const op = avaliarOperador(sessao, emailAutorizado);

  if (!op.autenticado) {
    return {
      tela: "login",
      rotulo: op.rotulo,
      podeLogout: false,
      precisaRenovar: false,
      envioRocketHabilitado: false,
    };
  }

  const precisaRenovar = tokenExpirado(
    sessao && typeof sessao === "object" ? sessao.expires_at : undefined,
    typeof agoraEpochS === "number" ? agoraEpochS : Math.floor(Date.now() / 1000),
    typeof margemS === "number" ? margemS : 60,
  );

  return {
    tela: op.autorizado ? "operador" : "nao_operador",
    rotulo: op.rotulo,
    podeLogout: true,
    precisaRenovar,
    // So' o operador AUTORIZADO e com a integracao ligada pode enviar.
    envioRocketHabilitado: op.autorizado === true && integracaoHabilitada === true,
  };
}

/**
 * Texto seguro para a UI a partir do resultado do envio. Recebe so'
 * codigos + nomes de cookie -- NUNCA valores.
 * @param {{ ok?: boolean, resultado?: string, faltando?: string[] }} r
 * @returns {string}
 */
export function mensagemResultadoEnvio(r) {
  const base = {
    sessao_atualizada_validada: "Sessao atualizada e validada.",
    sessao_atualizada: "Sessao atualizada (validacao pendente no servidor).",
    sem_operador: "Faca login como operador autorizado primeiro.",
    nao_autorizado_servidor: "Operador nao autorizado pelo servidor.",
    cookie_faltando:
      "Falta cookie de sessao do Rocket. Faca login em app.rocketgestor.com e tente de novo.",
    desabilitada: "Integracao desabilitada.",
    erro: "Nao foi possivel atualizar a sessao. Tente de novo.",
  };
  let msg = base[r && r.resultado] || "Nao foi possivel atualizar a sessao.";
  if (
    r &&
    r.resultado === "cookie_faltando" &&
    Array.isArray(r.faltando) &&
    r.faltando.length
  ) {
    msg += " Faltando: " + r.faltando.join(", ") + ".";
  }
  return msg;
}
