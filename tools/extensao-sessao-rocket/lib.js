// Logica PURA da etapa 1 da extensao de captura de sessao do Rocket.
//
// Regras estruturais desta etapa (garantidas por este arquivo):
// - Nunca recebe, le, guarda ou retorna VALOR de cookie -- so'
//   presenca (booleano ESTRITO por nome).
// - Sem dependencias, sem I/O, sem chrome.*, sem rede.
// - Reutilizada tal e qual pelo popup (popup.js) e pelos testes
//   (testes/teste.mjs).

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
