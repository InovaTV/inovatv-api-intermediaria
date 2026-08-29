// Executor de renovacao UniTV (painel de revenda "ResellerSystem",
// panel-web.revenda.site) -- Etapa 2, 2026-08-28 (inovatv_central/
// CLAUDE.md, "Etapa 2 -- Renovacao Automatica UniTV").
//
// TRANSPORTE, nao investigacao: a mecanica ja foi comprovada ponta a
// ponta na POC `poc-pagbank-unitv-renew` (docs/pagamentos/
// POC_PAGBANK_UNITV_TESTE_013_PONTA_A_PONTA.md) e no teste manual real
// (docs/unitv/UNITV_RENOVACAO_TESTE_REAL.md). Este modulo so' porta
// aquela mecanica para o runner do GitHub Actions (Node 20), no mesmo
// job do Sigma (arquitetura C1), com a mesma disciplina de resultado.
//
// Roda no runner (Node), nao numa Edge Function -- por isso usa
// `node:crypto` sincrono (a POC usava SubtleCrypto por rodar em Deno).
// AES-128-CBC + PKCS7 (padrao do node:crypto e do CryptoJS do painel).
//
// Contratos confirmados por captura passiva autenticada no painel
// (2026-08-28, sessao supervisionada):
//   - POST /api/account        -> resolve `id` a partir do `sn` e le
//                                 `expireTime` (reconsulta independente)
//   - POST /api/account/renew  -> renova (comprovado na POC)
//   Request: JSON -> AES-CBC -> HEX MAIUSCULO, enviado como body cru.
//   Response: envelope texto puro {returnCode,errorMessage,jumpCode,data};
//   returnCode 0 = aceito; `data` (quando presente) = HEX AES do payload.
//
// Chave/IV AES sao FIXOS do protocolo do painel (embutidos no bundle JS
// deles, iguais para qualquer revendedor/sessao) -- nao sao segredo
// nosso. Confirmados decifrando trafego real na captura de 2026-08-28.
//
// Parametros de pacote sao CONSTANTES: o painel expoe um unico pacote
// ("Plano Basico", package_id=1) e a renovacao mensal InovaTV e' sempre
// "+1 mes" -> pre_auth_id=123 (o mesmo valor da POC; confirmado no
// catalogo /api/dealer-core/package/package-name da captura). NAO ha'
// resolucao de pacote por cliente.
//
// dealer_token / dealer_name vem SO' de env (UNITV_DEALER_TOKEN /
// UNITV_DEALER_NAME) -- nunca hardcoded, nunca logado.
//
// Disciplina de resultado (identica ao Sigma): NUNCA decide "sucesso"
// pelo returnCode:0 nem pelo texto da resposta -- so' depois de
// reconsultar `expireTime` no painel e confirmar que avancou. Nenhum
// retry automatico do proprio `renew` (poderia consumir 1 credito duas
// vezes) -- so' a LEITURA de reconsulta e' repetida algumas vezes
// (segura), porque o painel avisa "entra em vigor em ~5 min".

import crypto from "node:crypto";

// --- Criptografia de transporte do painel (fixa, nao e' segredo nosso) ---
const UNITV_AES_KEY = Buffer.from("93403d3aa2ec48b4", "utf8"); // 16 bytes -> AES-128
const UNITV_AES_IV = Buffer.from("7cf0127d190cb909", "utf8"); // 16 bytes

// --- Constantes de renovacao mensal (unico caso da InovaTV) ---
export const UNITV_API_BASE = "https://panel-web.revenda.site";
export const UNITV_PACKAGE_ID = 1;
export const UNITV_POINTS_TYPE = 1; // creditos mensais
export const UNITV_AUTH_CYCLE = 1; // 1 ciclo
export const UNITV_POINTS = 1; // 1 credito
export const UNITV_PRE_AUTH_ID = 123; // "1 Mes" (catalogo confirmado 2026-08-28)

const HTTP_TIMEOUT_MS = 15000;
const RECONSULTA_TENTATIVAS = 3;
const RECONSULTA_INTERVALO_MS = 4000;

const sleepReal = (ms) => new Promise((r) => setTimeout(r, ms));

// sign = MD5("dealer" + id + points_type + points) -- confirmado byte a
// byte com trafego real (docs/unitv/UNITV_RENOVACAO_TESTE_REAL.md).
export function unitvSign(id, pointsType, points) {
  return crypto.createHash("md5").update(`dealer${id}${pointsType}${points}`).digest("hex");
}

// JSON string -> AES-128-CBC(PKCS7) -> HEX MAIUSCULO. Body cru da
// requisicao (sem envelope, sem base64).
export function unitvEncrypt(plaintext) {
  const c = crypto.createCipheriv("aes-128-cbc", UNITV_AES_KEY, UNITV_AES_IV);
  const buf = Buffer.concat([c.update(String(plaintext), "utf8"), c.final()]);
  return buf.toString("hex").toUpperCase();
}

// HEX -> AES-128-CBC decrypt -> UTF-8 string. Aplicado ao campo `data`
// do envelope da resposta.
export function unitvDecrypt(hex) {
  const d = crypto.createDecipheriv("aes-128-cbc", UNITV_AES_KEY, UNITV_AES_IV);
  const buf = Buffer.concat([d.update(Buffer.from(String(hex).trim(), "hex")), d.final()]);
  return buf.toString("utf8");
}

// "YYYY-MM-DD HH:MM:SS" (horario de Sao Paulo -- o request manda
// time_zone: "America/Sao_Paulo") -> ISO com offset -03:00 fixo (o
// Brasil nao tem mais horario de verao desde 2019). Devolve null se o
// formato nao bater -- nunca inventa data.
export function spDateToIso(s) {
  if (typeof s !== "string") return null;
  const m = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}-03:00`;
}

// Chamada generica a uma rota do painel. Cifra o payload, envia o HEX
// cru, le o envelope texto puro, valida returnCode, decifra `data`.
// fetchImpl injetavel para teste (default: fetch global do Node 20).
async function callUnitvApi(path, payloadObj, { fetchImpl, timeoutMs = HTTP_TIMEOUT_MS }) {
  let resp;
  try {
    resp = await fetchImpl(`${UNITV_API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: unitvEncrypt(JSON.stringify(payloadObj)),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    return { ok: false, reason: "falha_rede", detalhe: e && e.message ? e.message : String(e) };
  }

  let text;
  try {
    text = await resp.text();
  } catch (e) {
    return { ok: false, reason: "resposta_ilegivel", detalhe: String(e) };
  }

  let env;
  try {
    env = JSON.parse(text);
  } catch {
    return { ok: false, reason: "resposta_nao_json", httpStatus: resp.status };
  }

  if (env.returnCode !== 0) {
    return {
      ok: false,
      reason: "erro_api",
      returnCode: env.returnCode,
      errorMessage: typeof env.errorMessage === "string" ? env.errorMessage : null,
    };
  }

  let data = null;
  if (env.data) {
    try {
      data = JSON.parse(unitvDecrypt(env.data));
    } catch {
      return { ok: false, reason: "data_indecifravel" };
    }
  }
  return { ok: true, data, jumpCode: env.jumpCode, errorMessage: env.errorMessage ?? null };
}

// Resolve a conta UniTV a partir do `sn` (== `usuario` do cadastro
// Rocket -- juncao confirmada 2026-08-28: Rocket.usuario "gcnv6v" ->
// painel sn "gcnv6v" -> id 3433363). Devolve `id` (numero interno da
// conta, exigido pelo /renew) e `expireTime` (para a reconsulta
// independente). NUNCA escolhe por posicao: exige exatamente 1
// correspondencia EXATA de `sn` na lista.
export async function resolverContaUnitv(sn, {
  fetchImpl = globalThis.fetch,
  dealerToken = process.env.UNITV_DEALER_TOKEN,
  dealerName = process.env.UNITV_DEALER_NAME,
} = {}) {
  if (typeof sn !== "string" || sn.trim() === "") return { ok: false, reason: "sn_invalido" };
  if (!dealerToken || !dealerName) return { ok: false, reason: "credenciais_ausentes" };

  const r = await callUnitvApi("/api/account", {
    package_id: UNITV_PACKAGE_ID,
    dealer_token: dealerToken,
    dealer_name: dealerName,
    time_zone: "America/Sao_Paulo",
    page: 1,
    pageSize: 10,
    keyword: sn,
  }, { fetchImpl });
  if (!r.ok) return r;

  const list = Array.isArray(r.data && r.data.list) ? r.data.list : [];
  const exatos = list.filter((a) => a && a.sn === sn);
  if (exatos.length === 0) return { ok: false, reason: "nao_encontrado" };
  if (exatos.length > 1) return { ok: false, reason: "ambiguo" };

  const conta = exatos[0];
  if (conta.customer != null && conta.customer !== "UniTV") {
    return { ok: false, reason: "customer_inesperado", customer: conta.customer };
  }
  return {
    ok: true,
    id: conta.id,
    sn: conta.sn,
    expireTimeRaw: conta.expireTime ?? null,
    expireTimeIso: spDateToIso(conta.expireTime),
    customer: conta.customer ?? null,
    packageName: conta.package_name ?? null,
  };
}

// Renova UM acesso UniTV. Mesmo contrato de retorno de
// renovarUmAcessoSigma (renovacao-sigma-workflow.mjs):
//   { resultado: "sucesso" | "falha" | "resultado_ambiguo",
//     vencimentoConfirmado?: string ISO, detalhe?: string }
//
// - "sucesso": SO' quando o expireTime do painel avancou na reconsulta.
// - "falha": painel recusou o /renew (returnCode != 0 -- ex.: credito
//   insuficiente), ou o expireTime nao avancou.
// - "resultado_ambiguo": nao deu pra determinar com seguranca (falha de
//   rede/leitura, id divergente entre token e painel, etc.) -- NUNCA
//   assume sucesso/falha por suposicao.
//
// `sn` e `id` vem do token (tokens_renovacao.unitv_sn / unitv_id). O
// `id` do token e' revalidado contra o `id` que o painel devolve pelo
// `sn` -- divergencia -> ambiguo (nunca renova um id que nao casa).
export async function renovarUmAcessoUniTV({
  sn,
  id,
  fetchImpl = globalThis.fetch,
  dealerToken = process.env.UNITV_DEALER_TOKEN,
  dealerName = process.env.UNITV_DEALER_NAME,
  sleep = sleepReal,
} = {}) {
  if (typeof sn !== "string" || sn.trim() === "") {
    return { resultado: "resultado_ambiguo", detalhe: "sn ausente no token" };
  }
  if (!dealerToken || !dealerName) {
    return { resultado: "resultado_ambiguo", detalhe: "credenciais UniTV ausentes (UNITV_DEALER_TOKEN/UNITV_DEALER_NAME)" };
  }

  const opts = { fetchImpl, dealerToken, dealerName };

  // 1) Baseline -- resolve id + expireTime atual no painel.
  const antes = await resolverContaUnitv(sn, opts);
  if (!antes.ok) {
    return { resultado: "resultado_ambiguo", detalhe: `falha ao resolver conta UniTV antes da renovacao (${antes.reason})` };
  }
  if (id != null && String(antes.id) !== String(id)) {
    return { resultado: "resultado_ambiguo", detalhe: `id UniTV divergente (token=${id}, painel=${antes.id})` };
  }
  const contaId = antes.id;
  const expireAntes = antes.expireTimeRaw;

  // 2) /renew -- uma unica tentativa, sem retry (retry consumiria credito
  //    de novo). NUNCA confia no returnCode:0 sozinho.
  const sign = unitvSign(contaId, UNITV_POINTS_TYPE, UNITV_POINTS);
  const renew = await callUnitvApi("/api/account/renew", {
    package_id: UNITV_PACKAGE_ID,
    points_type: UNITV_POINTS_TYPE,
    auth_cycle: UNITV_AUTH_CYCLE,
    points: UNITV_POINTS,
    pre_auth_id: UNITV_PRE_AUTH_ID,
    sn,
    id: contaId,
    sign,
    dealer_token: dealerToken,
    dealer_name: dealerName,
  }, { fetchImpl });

  // So' um returnCode != 0 EXPLICITO do painel e' uma falha determinada
  // (ex.: sem credito) -- o painel processou e recusou. Qualquer outra
  // falha do /renew (rede caiu, corpo ilegivel) e' INCERTA: a renovacao
  // pode ter landado do lado do servidor mesmo sem a gente ler a
  // resposta -> quem decide e' a reconsulta independente abaixo.
  if (!renew.ok && renew.reason === "erro_api") {
    const msg = renew.errorMessage ? `: ${renew.errorMessage}` : "";
    return { resultado: "falha", detalhe: `painel UniTV recusou a renovacao (rc=${renew.returnCode}${msg})` };
  }
  const renewIncerto = !renew.ok;

  // 3) Reconsulta independente (o painel avisa "entra em vigor em ~5
  //    min" -- alguns retries curtos SO' na leitura, nunca no /renew).
  //    Se o expireTime avancou, a renovacao landou -- inclusive quando
  //    o proprio /renew falhou no transporte (renewIncerto).
  let expireDepois = null;
  let ultimoReconsultaReason = null;
  for (let tentativa = 1; tentativa <= RECONSULTA_TENTATIVAS; tentativa++) {
    const depois = await resolverContaUnitv(sn, opts);
    if (depois.ok) {
      expireDepois = depois.expireTimeRaw;
      if (expireDepois && expireAntes && expireDepois !== expireAntes) {
        return { resultado: "sucesso", vencimentoConfirmado: spDateToIso(expireDepois) };
      }
    } else {
      ultimoReconsultaReason = depois.reason;
    }
    if (tentativa < RECONSULTA_TENTATIVAS) await sleep(RECONSULTA_INTERVALO_MS);
  }

  if (expireDepois == null) {
    return {
      resultado: "resultado_ambiguo",
      detalhe: `renovacao enviada mas falha ao reconsultar a conta depois (${ultimoReconsultaReason ?? "sem detalhe"})`,
    };
  }
  // expireTime NAO avancou.
  if (renewIncerto) {
    return {
      resultado: "resultado_ambiguo",
      detalhe: `/renew falhou no transporte (${renew.reason}${renew.detalhe ? ": " + renew.detalhe : ""}) e o expireTime nao mudou -- nao da' pra afirmar se renovou`,
    };
  }
  return {
    resultado: "falha",
    detalhe: `expireTime nao avancou apos a renovacao (antes=${expireAntes ?? "?"}, depois=${expireDepois ?? "?"})`,
  };
}
