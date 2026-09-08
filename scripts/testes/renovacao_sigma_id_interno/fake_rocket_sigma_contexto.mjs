export const ROCKET_BASE_URL = "https://app.rocketgestor.com";
export const ROCKET_USER_AGENT = "UA-teste";
export function montarCookieHeader(s, c) { return `sessionid=${s}; csrftoken=${c}`; }
let sigmaOut = { outcome: "success", package: "Mensal", expiresAt: null };
export function setSigma(o) { sigmaOut = o; }
export const chamadasSigma = [];
export async function lerSigmaInfo(cookieHeader, id) {
  chamadasSigma.push({ cookieHeader, id });
  return sigmaOut;
}
