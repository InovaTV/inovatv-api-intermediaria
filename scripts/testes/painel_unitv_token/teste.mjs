// Testes locais de supabase/functions/_shared/unitv_token_painel.ts (REAL,
// nucleo puro) -- "Atualizar e Validar Token UniTV" no Painel/Admin
// (decisao aprovada 2026-09-07, inovatv_central/CLAUDE.md, "Frente --
// Fluxo de Renovacao Automatica" / autocura UniTV).
//
// O modulo alvo nao tem NENHUM import (zero env, zero supabase-js) ->
// nao precisa de mock-loader: as deps sao 100% injetadas.
//
// Regras que estes testes travam (fluxo OBRIGATORIO da decisao):
//   1. formato invalido -> nada e' tocado (probar/gravarVault nunca
//      chamados).
//   2. token novo que NAO autentica no /api/account -> Vault INTOCADO
//      (gravarVault/lerVault nunca chamados); nenhum diagnostico gravado.
//   3. sucesso -> valida NOVO -> grava SO' o Vault -> rele -> revalida ->
//      diagnostico token_vivo; probar chamado exatamente 2x, gravarVault
//      exatamente 1x.
//   4. reler o Vault e obter valor diferente -> revalidacao_falhou
//      (vault_diferente); sem 2a sonda.
//   5. revalidacao (5o passo) falha -> revalidacao_falhou (api_account) +
//      diagnostico gravado a partir da sonda real.
//   6. erro ao gravar o Vault -> erro_gravar; lerVault nunca chamado.
//   7. validarTokenAtual: token vivo / morto / sem token.
//   8. classificarResolucao / veredictoDeProbe / derivarBadge /
//      montarLinhaDiagnostico (probe_return_code SEMPRE null).
//   9. I6 -- o valor do token NUNCA aparece em log nem no objeto de
//      retorno.
//
// Rodar: npx tsx scripts/testes/painel_unitv_token/teste.mjs

import {
  atualizarTokenUnitv,
  classificarResolucao,
  derivarBadge,
  montarLinhaDiagnostico,
  normalizarTokenBruto,
  validarTokenAtual,
  veredictoDeProbe,
} from "../../../supabase/functions/_shared/unitv_token_painel.ts";

let falhas = 0;
function ok(cond, msg) {
  if (!cond) {
    falhas++;
    console.error(`FALHA: ${msg}`);
  } else {
    console.log(`ok: ${msg}`);
  }
}

const TOKEN_OK = "0123456789abcdef0123456789abcdef"; // 32 hex minusculo
const TOKEN_OK_UPPER = "0123456789ABCDEF0123456789ABCDEF";
const TOKEN_OUTRO = "ffffffffffffffffffffffffffffffff";

const PROBE_OK = { classe: "ok", ancoraResolveu: true };
const PROBE_OK_ANCORA_DRIFT = { classe: "ok", ancoraResolveu: false };
const PROBE_MORTO_300 = { classe: "auth_reject", returnCode: 300 };
const PROBE_OUTAGE = { classe: "transport_fail", httpStatus: 502 };

function contadores() {
  return {
    probar: 0,
    gravarVault: 0,
    lerVault: 0,
    gravarDiagnostico: 0,
    linhasDiag: [],
    tokensProbados: [],
    tokensGravados: [],
  };
}

// captura de console.log p/ o teste de vazamento (I6)
let logs = [];
const logOrig = console.log;
function capturar() {
  logs = [];
  console.log = (...a) =>
    logs.push(
      a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "),
    );
}
function parar() {
  console.log = logOrig;
}

// =====================================================================
// 1. normalizarTokenBruto
// =====================================================================
{
  ok(
    JSON.stringify(normalizarTokenBruto(TOKEN_OK)) ===
      JSON.stringify({ ok: true, token: TOKEN_OK }),
    "1: 32 hex minusculo -> ok",
  );
  ok(
    JSON.stringify(normalizarTokenBruto(TOKEN_OK_UPPER)) ===
      JSON.stringify({ ok: true, token: TOKEN_OK }),
    "1: 32 hex MAIUSCULO -> normalizado p/ minusculo",
  );
  ok(
    normalizarTokenBruto(`  ${TOKEN_OK}\n`).ok === true,
    "1: espacos em volta sao aparados",
  );
  ok(normalizarTokenBruto(TOKEN_OK.slice(0, 31)).ok === false, "1: 31 chars -> rejeita");
  ok(normalizarTokenBruto(TOKEN_OK + "0").ok === false, "1: 33 chars -> rejeita");
  ok(normalizarTokenBruto("g".repeat(32)).ok === false, "1: nao-hex -> rejeita");
  ok(normalizarTokenBruto("").ok === false, "1: vazio -> rejeita");
  ok(normalizarTokenBruto(null).ok === false, "1: null -> rejeita");
  ok(normalizarTokenBruto(123).ok === false, "1: numero -> rejeita");
}

// =====================================================================
// 2. classificarResolucao / veredictoDeProbe / derivarBadge
// =====================================================================
{
  ok(classificarResolucao({ ok: true }).classe === "ok", "2: ok:true -> classe ok");
  ok(
    classificarResolucao({ ok: true }).ancoraResolveu === true,
    "2: ok:true -> ancoraResolveu true",
  );
  for (const reason of ["nao_encontrado", "ambiguo", "customer_inesperado"]) {
    const r = classificarResolucao({ ok: false, reason });
    ok(
      r.classe === "ok" && r.ancoraResolveu === false,
      `2: reason=${reason} (token autenticou) -> classe ok, ancoraResolveu false`,
    );
  }
  const morto = classificarResolucao({ ok: false, reason: "unavailable", returnCode: 300, httpStatus: 200 });
  ok(morto.classe === "auth_reject" && morto.returnCode === 300, "2: unavailable + returnCode 300 -> auth_reject");
  const tr = classificarResolucao({ ok: false, reason: "unavailable", httpStatus: 502 });
  ok(tr.classe === "transport_fail" && tr.httpStatus === 502, "2: unavailable sem returnCode -> transport_fail");
  ok(
    classificarResolucao({ ok: false, reason: "credenciais_ausentes" }).classe === "transport_fail",
    "2: credenciais_ausentes -> transport_fail (nunca 'morto')",
  );
  ok(
    classificarResolucao({ ok: false, reason: "sn_invalido" }).classe === "transport_fail",
    "2: sn_invalido -> transport_fail",
  );

  ok(veredictoDeProbe({ classe: "ok" }) === "token_vivo", "2: veredicto ok -> token_vivo");
  ok(veredictoDeProbe({ classe: "auth_reject" }) === "token_morto", "2: veredicto auth_reject -> token_morto");
  ok(
    veredictoDeProbe({ classe: "transport_fail" }) === "indeterminado_outage",
    "2: veredicto transport_fail -> indeterminado_outage",
  );

  ok(derivarBadge("token_vivo").badge === "verde", "2: badge token_vivo -> verde");
  const bm = derivarBadge("token_morto");
  ok(bm.badge === "vermelho", "2: badge token_morto -> vermelho");
  ok(
    /nova captura/i.test(bm.detalhe),
    "2: badge token_morto diz explicitamente 'nova captura' ao operador",
  );
  ok(derivarBadge("indeterminado_outage").badge === "alerta", "2: badge outage -> alerta");
  ok(derivarBadge(null).badge === "sem_dado", "2: badge sem veredito -> sem_dado");
}

// =====================================================================
// 3. montarLinhaDiagnostico -- probe_return_code SEMPRE null
// =====================================================================
{
  const semProbe = montarLinhaDiagnostico("indeterminado", "painel:validar", null);
  ok(semProbe.probe_total === 0 && semProbe.ancora_status === "ausente", "3: probe null -> total 0, ancora ausente");

  const vivo = montarLinhaDiagnostico("token_vivo", "painel:validar", PROBE_OK);
  ok(vivo.probe_total === 1 && vivo.probe_ok === 1 && vivo.ancora_status === "ok", "3: probe ok -> total 1 / ok 1 / ancora ok");

  const drift = montarLinhaDiagnostico("token_vivo", "painel:validar", PROBE_OK_ANCORA_DRIFT);
  ok(drift.probe_ok === 1 && drift.ancora_status === "nao_resolveu", "3: probe ok + ancoraResolveu false -> ancora nao_resolveu");

  const morto = montarLinhaDiagnostico("token_morto", "painel:validar", PROBE_MORTO_300);
  ok(morto.probe_auth_reject === 1 && morto.origem_return_code === 300, "3: probe auth_reject 300 -> auth_reject 1 / origem_return_code 300");
  ok(morto.probe_return_code === null, "3: probe_return_code SEMPRE null (nunca serve de batida do healer)");

  const out = montarLinhaDiagnostico("indeterminado_outage", "painel:validar", PROBE_OUTAGE);
  ok(out.probe_transport_fail === 1 && out.origem_http_status === 502, "3: probe transport_fail -> transport_fail 1 / origem_http_status 502");

  ok(vivo.painel_msg === null && vivo.alertado_jose === false, "3: painel_msg null, alertado_jose false (Painel nunca alerta)");
}

// helper: deps de atualizarTokenUnitv com sondas configuraveis
function depsAtualizar(over = {}) {
  const c = contadores();
  const seqProbar = over.probar ?? [PROBE_OK, PROBE_OK]; // [novo, revalidacao]
  let i = 0;
  const deps = {
    probar: async (t) => {
      c.probar++;
      c.tokensProbados.push(t);
      if (over.probarThrows && c.probar === over.probarThrows) throw new Error("boom-probe");
      const r = seqProbar[Math.min(i, seqProbar.length - 1)];
      i++;
      return r;
    },
    gravarVault: async (t) => {
      c.gravarVault++;
      c.tokensGravados.push(t);
      if (over.gravarVaultThrows) throw new Error("boom-vault");
    },
    lerVault: async () => {
      c.lerVault++;
      if (over.lerVault === "throw") throw new Error("boom-ler");
      return over.lerVault !== undefined ? over.lerVault : c.tokensGravados[c.tokensGravados.length - 1] ?? null;
    },
    gravarDiagnostico: async (linha) => {
      c.gravarDiagnostico++;
      c.linhasDiag.push(linha);
    },
    log: over.log ?? (() => {}),
  };
  return { deps, c };
}

// =====================================================================
// 4. atualizar -- HAPPY PATH
// =====================================================================
{
  const { deps, c } = depsAtualizar();
  const r = await atualizarTokenUnitv(TOKEN_OK, deps);
  ok(r.outcome === "sucesso" && r.veredito === "token_vivo", "4: outcome sucesso / token_vivo");
  ok(c.probar === 2, "4b: probar chamado exatamente 2x (novo + revalidacao)");
  ok(c.gravarVault === 1 && c.tokensGravados[0] === TOKEN_OK, "4c: gravarVault 1x, com o token novo");
  ok(c.lerVault === 1, "4d: lerVault 1x");
  ok(c.gravarDiagnostico === 1, "4e: 1 diagnostico gravado");
  ok(
    c.linhasDiag[0].veredito === "token_vivo" && c.linhasDiag[0].motivo_origem === "painel:atualizar" && c.linhasDiag[0].probe_return_code === null,
    "4f: diagnostico = token_vivo / painel:atualizar / probe_return_code null",
  );
  ok(JSON.stringify(r).indexOf(TOKEN_OK) === -1, "4g: token NUNCA aparece no objeto de retorno (I6)");
}

// HAPPY PATH -- token MAIUSCULO normalizado + ancora com drift ainda e' valido
{
  const { deps, c } = depsAtualizar({ probar: [PROBE_OK_ANCORA_DRIFT, PROBE_OK_ANCORA_DRIFT] });
  const r = await atualizarTokenUnitv(`  ${TOKEN_OK_UPPER} `, deps);
  ok(r.outcome === "sucesso", "4h: MAIUSCULO + espacos + ancora drift -> sucesso (token autenticou)");
  ok(c.tokensGravados[0] === TOKEN_OK, "4i: gravou o token normalizado (minusculo)");
}

// =====================================================================
// 5. FORMATO INVALIDO -> nada e' tocado
// =====================================================================
{
  const { deps, c } = depsAtualizar();
  const r = await atualizarTokenUnitv("xyz", deps);
  ok(r.outcome === "formato_invalido", "5: outcome formato_invalido");
  ok(c.probar === 0 && c.gravarVault === 0 && c.lerVault === 0 && c.gravarDiagnostico === 0, "5b: probar/gravarVault/lerVault/diagnostico NUNCA chamados");
}

// =====================================================================
// 6. TOKEN NOVO NAO AUTENTICA -> Vault INTOCADO
// =====================================================================
{
  const { deps, c } = depsAtualizar({ probar: [PROBE_MORTO_300, PROBE_OK] });
  const r = await atualizarTokenUnitv(TOKEN_OK, deps);
  ok(r.outcome === "token_novo_invalido" && r.classe === "auth_reject" && r.origem_return_code === 300, "6: token_novo_invalido / auth_reject / 300");
  ok(c.probar === 1, "6b: probar chamado so' 1x (a sonda do token novo)");
  ok(c.gravarVault === 0 && c.lerVault === 0, "6c: Vault INTOCADO (gravarVault/lerVault nunca chamados)");
  ok(c.gravarDiagnostico === 0, "6d: nenhum diagnostico gravado (nao poluir historico com paste ruim)");
}

// token novo: sonda LANCA -> token_novo_invalido, transport_fail
{
  const { deps, c } = depsAtualizar({ probarThrows: 1 });
  const r = await atualizarTokenUnitv(TOKEN_OK, deps);
  ok(r.outcome === "token_novo_invalido" && r.classe === "transport_fail", "6e: sonda do token novo lanca -> token_novo_invalido / transport_fail");
  ok(c.gravarVault === 0, "6f: Vault intocado quando a sonda lanca");
}

// token novo: transport_fail (painel fora) -> token_novo_invalido, sem gravar
{
  const { deps, c } = depsAtualizar({ probar: [PROBE_OUTAGE, PROBE_OK] });
  const r = await atualizarTokenUnitv(TOKEN_OK, deps);
  ok(r.outcome === "token_novo_invalido" && r.classe === "transport_fail", "6g: painel fora ao validar o token novo -> token_novo_invalido");
  ok(c.gravarVault === 0, "6h: nao grava se nao conseguiu confirmar que o token novo e' valido");
}

// =====================================================================
// 7. ERRO AO GRAVAR O VAULT -> erro_gravar, lerVault nunca chamado
// =====================================================================
{
  const { deps, c } = depsAtualizar({ gravarVaultThrows: true });
  const r = await atualizarTokenUnitv(TOKEN_OK, deps);
  ok(r.outcome === "erro_gravar", "7: outcome erro_gravar");
  ok(c.probar === 1 && c.lerVault === 0 && c.gravarDiagnostico === 0, "7b: parou apos gravarVault falhar (lerVault/diagnostico nunca)");
}

// =====================================================================
// 8. RELER O VAULT E OBTER VALOR DIFERENTE -> revalidacao_falhou
// =====================================================================
{
  const { deps, c } = depsAtualizar({ lerVault: TOKEN_OUTRO });
  const r = await atualizarTokenUnitv(TOKEN_OK, deps);
  ok(r.outcome === "revalidacao_falhou" && r.motivo === "vault_diferente", "8: reler != gravado -> revalidacao_falhou / vault_diferente");
  ok(c.probar === 1, "8b: sem 2a sonda quando o Vault relido nao bate");
  ok(c.gravarDiagnostico === 0, "8c: nenhum diagnostico nesse caso");
}

// reler retorna null -> vault_diferente
{
  const { deps } = depsAtualizar({ lerVault: null });
  const r = await atualizarTokenUnitv(TOKEN_OK, deps);
  ok(r.outcome === "revalidacao_falhou" && r.motivo === "vault_diferente", "8d: reler null -> revalidacao_falhou / vault_diferente");
}

// reler LANCA -> vault_diferente
{
  const { deps } = depsAtualizar({ lerVault: "throw" });
  const r = await atualizarTokenUnitv(TOKEN_OK, deps);
  ok(r.outcome === "revalidacao_falhou" && r.motivo === "vault_diferente", "8e: reler lanca -> revalidacao_falhou / vault_diferente");
}

// =====================================================================
// 9. REVALIDACAO (5o passo) FALHA -> revalidacao_falhou / api_account
// =====================================================================
{
  const { deps, c } = depsAtualizar({ probar: [PROBE_OK, PROBE_MORTO_300] });
  const r = await atualizarTokenUnitv(TOKEN_OK, deps);
  ok(r.outcome === "revalidacao_falhou" && r.motivo === "api_account" && r.classe === "auth_reject", "9: token relido do Vault nao autentica -> revalidacao_falhou / api_account");
  ok(c.gravarVault === 1, "9b: o Vault JA foi gravado (por isso e' critico)");
  ok(c.gravarDiagnostico === 1 && c.linhasDiag[0].veredito === "token_morto" && c.linhasDiag[0].motivo_origem === "painel:atualizar-revalidacao", "9c: diagnostico gravado da sonda real (token_morto / painel:atualizar-revalidacao)");
}

// revalidacao lanca -> tratada como transport_fail -> api_account
{
  const { deps } = depsAtualizar({ probarThrows: 2, probar: [PROBE_OK, PROBE_OK] });
  const r = await atualizarTokenUnitv(TOKEN_OK, deps);
  ok(r.outcome === "revalidacao_falhou" && r.motivo === "api_account", "9d: sonda de revalidacao lanca -> revalidacao_falhou / api_account");
}

// =====================================================================
// 10. validarTokenAtual
// =====================================================================
{
  // token vivo
  let probou = null;
  const r = await validarTokenAtual({
    obterTokenAtual: async () => TOKEN_OK,
    probar: async (t) => { probou = t; return PROBE_OK; },
    gravarDiagnostico: async () => {},
  });
  ok(r.outcome === "validado" && r.veredito === "token_vivo" && r.resumo.badge === "verde", "10: token vivo -> validado / token_vivo / verde");
  ok(probou === TOKEN_OK, "10b: sondou o token atual");
  ok(JSON.stringify(r).indexOf(TOKEN_OK) === -1, "10c: token nao aparece no retorno de validarTokenAtual (I6)");
}
{
  // token morto
  const linhas = [];
  const r = await validarTokenAtual({
    obterTokenAtual: async () => TOKEN_OK,
    probar: async () => PROBE_MORTO_300,
    gravarDiagnostico: async (l) => linhas.push(l),
  });
  ok(r.outcome === "validado" && r.veredito === "token_morto" && r.resumo.badge === "vermelho" && r.origem_return_code === 300, "10d: token morto -> validado / token_morto / vermelho / 300");
  ok(linhas.length === 1 && linhas[0].motivo_origem === "painel:validar", "10e: 1 diagnostico gravado com motivo painel:validar");
}
{
  // sem token no Vault nem no secret
  let sondou = false;
  let gravou = false;
  const r = await validarTokenAtual({
    obterTokenAtual: async () => "",
    probar: async () => { sondou = true; return PROBE_OK; },
    gravarDiagnostico: async () => { gravou = true; },
  });
  ok(r.outcome === "sem_token" && r.resumo.badge === "vermelho", "10f: sem token -> sem_token / vermelho");
  ok(sondou === false && gravou === false, "10g: sem token -> nao sonda nem grava diagnostico");
}
{
  // obterTokenAtual LANCA -> tratado como sem token
  const r = await validarTokenAtual({
    obterTokenAtual: async () => { throw new Error("boom"); },
    probar: async () => PROBE_OK,
    gravarDiagnostico: async () => {},
  });
  ok(r.outcome === "sem_token", "10h: obterTokenAtual lanca -> sem_token");
}
{
  // sonda lanca -> transport_fail -> indeterminado_outage
  const r = await validarTokenAtual({
    obterTokenAtual: async () => TOKEN_OK,
    probar: async () => { throw new Error("boom"); },
    gravarDiagnostico: async () => {},
  });
  ok(r.outcome === "validado" && r.veredito === "indeterminado_outage" && r.resumo.badge === "alerta", "10i: sonda lanca -> indeterminado_outage / alerta");
}
{
  // gravarDiagnostico lanca -> nao derruba a validacao
  const r = await validarTokenAtual({
    obterTokenAtual: async () => TOKEN_OK,
    probar: async () => PROBE_OK,
    gravarDiagnostico: async () => { throw new Error("insert falhou"); },
  });
  ok(r.outcome === "validado" && r.veredito === "token_vivo", "10j: gravarDiagnostico lanca -> validacao ainda retorna (best-effort)");
}

// =====================================================================
// 11. I6 -- valor do token NUNCA em console.log (caminho feliz + falha)
// =====================================================================
{
  capturar();
  const { deps } = depsAtualizar({ log: (evento, dados) => console.log("[painel-unitv-token-atualizar]", JSON.stringify({ evento, ...(dados ?? {}) })) });
  await atualizarTokenUnitv(TOKEN_OK, deps);
  parar();
  const blob = logs.join("\n");
  ok(blob.length > 0, "11: houve log estruturado no caminho feliz");
  ok(blob.indexOf(TOKEN_OK) === -1, "11b: token NUNCA aparece no log (I6) -- caminho feliz");
}
{
  capturar();
  const { deps } = depsAtualizar({
    probar: [PROBE_OK, PROBE_MORTO_300],
    log: (evento, dados) => console.log("[painel-unitv-token-atualizar]", JSON.stringify({ evento, ...(dados ?? {}) })),
  });
  await atualizarTokenUnitv(TOKEN_OK, deps);
  parar();
  ok(logs.join("\n").indexOf(TOKEN_OK) === -1, "11c: token NUNCA aparece no log (I6) -- caminho revalidacao_falhou");
}

console.log(`\n${falhas === 0 ? "TODOS OS TESTES PASSARAM" : `${falhas} FALHA(S)`}`);
process.exit(falhas === 0 ? 0 : 1);
