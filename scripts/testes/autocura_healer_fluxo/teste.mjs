// F4 -- testes do NUCLEO do healer (scripts/lib/autocura-unitv-healer.mjs,
// REAL) com dependencias fake. Prova as garantias exigidas antes do 1o
// login real (mensagem do usuario 2026-08-30):
//   * nenhuma possibilidade de 2o POST de login (nem transporte, nem recusa);
//   * token invalido / shape invalido / validacao falha -> NUNCA grava Vault;
//   * sucesso -> grava Vault e revalida;
//   * falha na revalidacao -> estado revalidacao_falhou (critico);
//   * nenhuma referencia a /renew, cobranca ou fluxo de renovacao (ver
//     autocura_healer_nao_age).
//
// Rodar: npx tsx scripts/testes/autocura_healer_fluxo/teste.mjs

import { executarHealer, FAIL } from "../../lib/autocura-unitv-healer.mjs";

let falhas = 0;
function ok(c, m) { if (!c) { falhas++; console.error(`FALHA: ${m}`); } else console.log(`ok: ${m}`); }

const TOKEN_OK = "0123456789abcdef0123456789abcdef"; // 32 hex minusculo
const GRAY = new Uint8Array(4);

// analisar() fake configuravel
function analisarSempre(res) { return () => res; }
const ALTA_1234 = { gateOk: true, bucket: "alta", predicao: "1234" };
const BAIXA = { gateOk: false, bucket: "baixa", predicao: "" };

function makeDeps(over = {}) {
  const chamadas = { postLogin: 0, gravarVault: 0, lerVault: 0, refreshCaptcha: 0, capturarCaptcha: 0, validarConta: 0, reportar: 0, reportado: null };
  const deps = {
    cicloId: "ciclo-teste",
    cfg: { capRefreshCaptcha: over.cap ?? 3 },
    capturarCaptcha: async () => { chamadas.capturarCaptcha++; return over.captcha === undefined ? { gray: GRAY, w: 2, h: 2 } : (typeof over.captcha === "function" ? over.captcha() : over.captcha); },
    analisar: over.analisar ?? analisarSempre(ALTA_1234),
    refreshCaptcha: async () => { chamadas.refreshCaptcha++; },
    postLogin: async (codigo) => {
      chamadas.postLogin++;
      if (typeof over.postLogin === "function") return over.postLogin(codigo, chamadas.postLogin);
      return over.postLogin ?? { resultado: "sucesso", token: TOKEN_OK };
    },
    validarConta: async (t) => {
      chamadas.validarConta++;
      if (typeof over.validarConta === "function") return over.validarConta(t, chamadas.validarConta);
      return over.validarConta ?? { ok: true };
    },
    gravarVault: async (t) => {
      chamadas.gravarVault++;
      if (over.gravarVaultThrows) throw new Error("boom-vault");
      chamadas._ultimoTokenGravado = t;
    },
    lerVault: async () => {
      chamadas.lerVault++;
      if (typeof over.lerVault === "function") return over.lerVault(chamadas.lerVault);
      return over.lerVault !== undefined ? over.lerVault : TOKEN_OK;
    },
    reportar: async (p) => { chamadas.reportar++; chamadas.reportado = p; },
    log: () => {},
  };
  return { deps, chamadas };
}

// 1. HAPPY PATH -----------------------------------------------------------
{
  const { deps, chamadas } = makeDeps();
  const r = await executarHealer(deps);
  ok(r.outcome === "sucesso" && r.failureClass === null, "1: outcome sucesso");
  ok(chamadas.postLogin === 1, "1b: postLogin chamado exatamente 1x");
  ok(chamadas.gravarVault === 1, "1c: gravarVault chamado exatamente 1x");
  ok(chamadas._ultimoTokenGravado === TOKEN_OK, "1d: gravou o token novo");
  ok(chamadas.validarConta === 2, "1e: validarConta 2x (novo + revalidacao)");
  ok(chamadas.reportado.outcome === "sucesso" && chamadas.reportado.metrics.login_posts === 1
     && chamadas.reportado.metrics.vault_gravado === true && chamadas.reportado.metrics.captcha_refreshes === 0
     && chamadas.reportado.metrics.captcha_confianca_bucket === "alta", "1f: payload de sucesso completo");
}

// 2. CAPTCHA NUNCA ATINGE ALTA -> aborta SEM POST -----------------------
{
  const { deps, chamadas } = makeDeps({ cap: 3, analisar: analisarSempre(BAIXA) });
  const r = await executarHealer(deps);
  ok(r.outcome === "falhou" && r.failureClass === FAIL.CAPTCHA_SEM_CONFIANCA, "2: falhou captcha_sem_confianca");
  ok(chamadas.postLogin === 0, "2b: postLogin NUNCA chamado");
  ok(chamadas.gravarVault === 0, "2c: gravarVault NUNCA chamado");
  ok(chamadas.refreshCaptcha === 2, "2d: refreshCaptcha cap-1 vezes");
  ok(chamadas.reportado.metrics.login_posts === 0 && chamadas.reportado.metrics.captcha_refreshes === 3, "2e: metrics login_posts=0, refreshes=cap");
}

// 3. LOGIN RECUSA -> 1 POST, sem 2o, sem Vault -------------------------
{
  const { deps, chamadas } = makeDeps({ postLogin: { resultado: "recusa" } });
  const r = await executarHealer(deps);
  ok(r.outcome === "falhou" && r.failureClass === FAIL.LOGIN_RECUSADO, "3: falhou login_recusado");
  ok(chamadas.postLogin === 1, "3b: postLogin EXATAMENTE 1x (sem retry)");
  ok(chamadas.gravarVault === 0, "3c: Vault intocado");
  ok(chamadas.reportado.metrics.login_posts === 1, "3d: metrics login_posts=1");
}

// 4. LOGIN TRANSPORTE -> 1 POST, SEM RETRY (ajuste 2026-08-30) ---------
{
  const { deps, chamadas } = makeDeps({ postLogin: { resultado: "transporte" } });
  const r = await executarHealer(deps);
  ok(r.outcome === "falhou" && r.failureClass === FAIL.LOGIN_TRANSPORTE, "4: falhou login_transporte");
  ok(chamadas.postLogin === 1, "4b: postLogin EXATAMENTE 1x -- NENHUM retry de transporte");
  ok(chamadas.gravarVault === 0, "4c: Vault intocado");
}

// 4b. postLogin LANCA excecao -> transporte, 1 chamada -----------------
{
  const { deps, chamadas } = makeDeps({ postLogin: () => { throw new Error("net"); } });
  const r = await executarHealer(deps);
  ok(r.outcome === "falhou" && r.failureClass === FAIL.LOGIN_TRANSPORTE, "4b1: excecao no postLogin -> login_transporte");
  ok(chamadas.postLogin === 1, "4b2: postLogin 1x mesmo lancando");
}

// 5. TOKEN COM SHAPE INVALIDO -> NUNCA grava Vault --------------------
for (const bad of ["NOTHEXNOTHEXNOTHEXNOTHEXNOTHEX123", "abc", "0123456789ABCDEF0123456789ABCDEF", "0123456789abcdef0123456789abcde", "0123456789abcdef0123456789abcdef0", ""]) {
  const { deps, chamadas } = makeDeps({ postLogin: { resultado: "sucesso", token: bad } });
  const r = await executarHealer(deps);
  ok(r.outcome === "falhou" && r.failureClass === FAIL.TOKEN_SHAPE_INVALIDO, `5[${JSON.stringify(bad).slice(0, 12)}]: token_shape_invalido`);
  ok(chamadas.gravarVault === 0, `5b[${JSON.stringify(bad).slice(0, 12)}]: Vault intocado`);
}

// 6. /api/account do token novo FALHA -> NUNCA grava Vault ------------
{
  const { deps, chamadas } = makeDeps({ validarConta: { ok: false, returnCode: 7 } });
  const r = await executarHealer(deps);
  ok(r.outcome === "falhou" && r.failureClass === FAIL.TOKEN_NOVO_INVALIDO, "6: token_novo_invalido");
  ok(chamadas.gravarVault === 0, "6b: Vault intocado quando validacao do token novo falha");
  ok(chamadas.reportado.metrics.validar_return_code === 7, "6c: returnCode observado nas metrics");
}

// 7. GRAVOU Vault mas re-leitura DIFERE -> revalidacao_falhou --------
{
  const { deps, chamadas } = makeDeps({ lerVault: "ffffffffffffffffffffffffffffffff" });
  const r = await executarHealer(deps);
  ok(r.outcome === "falhou" && r.failureClass === FAIL.REVALIDACAO_FALHOU, "7: revalidacao_falhou (vault difere)");
  ok(chamadas.gravarVault === 1, "7b: Vault foi gravado (a falha e' na revalidacao)");
  ok(chamadas.reportado.metrics.vault_gravado === true, "7c: metrics vault_gravado=true");
}

// 8. Re-leitura IGUAL mas 2a /api/account falha -> revalidacao_falhou
{
  const { deps, chamadas } = makeDeps({ validarConta: (t, n) => (n === 1 ? { ok: true } : { ok: false }) });
  const r = await executarHealer(deps);
  ok(r.outcome === "falhou" && r.failureClass === FAIL.REVALIDACAO_FALHOU, "8: revalidacao_falhou (2a validacao)");
  ok(chamadas.gravarVault === 1, "8b: Vault gravado; falha so' na revalidacao");
}

// 9. gravarVault LANCA -> excecao, sem sucesso -----------------------
{
  const { deps } = makeDeps({ gravarVaultThrows: true });
  const r = await executarHealer(deps);
  ok(r.outcome === "falhou" && r.failureClass === FAIL.EXCECAO, "9: excecao ao gravar Vault");
}

// 10. GARANTIA GLOBAL: postLogin nunca chamado > 1x, em nenhum cenario
{
  const cenarios = [
    {},
    { postLogin: { resultado: "recusa" } },
    { postLogin: { resultado: "transporte" } },
    { postLogin: { resultado: "sucesso", token: "abc" } },
    { validarConta: { ok: false } },
    { lerVault: "ffffffffffffffffffffffffffffffff" },
    { postLogin: () => { throw new Error("x"); } },
  ];
  let maxPost = 0;
  for (const c of cenarios) {
    const { deps, chamadas } = makeDeps(c);
    await executarHealer(deps);
    maxPost = Math.max(maxPost, chamadas.postLogin);
  }
  ok(maxPost <= 1, `10: postLogin <= 1 em TODOS os cenarios (max observado: ${maxPost})`);
}

// 11. reportar e' SEMPRE chamado exatamente 1x ----------------------
{
  const { deps, chamadas } = makeDeps({ postLogin: { resultado: "recusa" } });
  await executarHealer(deps);
  ok(chamadas.reportar === 1, "11: reportar chamado exatamente 1x (ciclo nunca fica orfao pelo runner)");
}

console.log(falhas === 0 ? "\nTODOS OS TESTES OK" : `\n${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
