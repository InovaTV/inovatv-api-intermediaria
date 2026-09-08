// Testes da logica PURA da extensao (lib.js).
//
// Sem Chrome, sem rede, sem credenciais reais -- so' PRESENCA
// (booleana) entra, so' um veredito estruturado (nomes de cookie +
// mensagem) sai. Nenhum valor de cookie e' construido nem passado.
//
// Rodar:  node tools/extensao-sessao-rocket/testes/teste.mjs
//    ou:  npx tsx tools/extensao-sessao-rocket/testes/teste.mjs

import {
  avaliarSessaoRocket,
  COOKIES_ALVO,
  URL_ROCKET,
  tokenExpirado,
  avaliarOperador,
  derivarEstadoAuth,
} from "../lib.js";
import {
  INTEGRACAO_HABILITADA,
  URL_ATUALIZAR_SESSAO_ROCKET,
  descreverChamadaAtualizarSessao,
  enviarSessaoParaRocket,
} from "../integracao.js";
import {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  OPERADOR_AUTORIZADO_EMAIL,
} from "../config.js";

let falhas = 0;
function ok(cond, msg) {
  if (!cond) {
    falhas++;
    console.error(`FALHA: ${msg}`);
  } else {
    console.log(`ok: ${msg}`);
  }
}
const shape = (o) => Object.keys(o).sort().join(",");

// --- 1. Os dois cookies presentes ---
{
  const r = avaliarSessaoRocket({ sessionid: true, csrftoken: true });
  ok(r.completo === true, "1: os dois presentes -> completo=true");
  ok(r.faltando.length === 0, "1: nada faltando");
  ok(
    shape(r) === "completo,encontrados,faltando,mensagem",
    "1: retorno e' exatamente {completo, encontrados, faltando, mensagem}",
  );
  ok(
    r.encontrados.every((n) => COOKIES_ALVO.includes(n)),
    "1: 'encontrados' so' contem nomes de COOKIES_ALVO",
  );
  ok(
    /sessionid/.test(r.mensagem) && /csrftoken/.test(r.mensagem),
    "1: mensagem cita os dois nomes",
  );
}

// --- 2. So' sessionid presente ---
{
  const r = avaliarSessaoRocket({ sessionid: true, csrftoken: false });
  ok(r.completo === false, "2: so' sessionid -> completo=false");
  ok(
    r.faltando.length === 1 && r.faltando[0] === "csrftoken",
    "2: faltando = ['csrftoken'] (nome do cookie ausente)",
  );
  ok(
    r.encontrados.length === 1 && r.encontrados[0] === "sessionid",
    "2: encontrados = ['sessionid']",
  );
  ok(r.mensagem.includes("csrftoken"), "2: mensagem informa o cookie que falta, pelo nome");
}

// --- 3. So' csrftoken presente ---
{
  const r = avaliarSessaoRocket({ csrftoken: true });
  ok(r.completo === false, "3: so' csrftoken -> completo=false");
  ok(r.faltando.join(",") === "sessionid", "3: faltando = ['sessionid']");
  ok(r.mensagem.includes("sessionid"), "3: mensagem informa 'sessionid' pelo nome");
}

// --- 4. Nenhum cookie presente ---
{
  const r = avaliarSessaoRocket({ sessionid: false, csrftoken: false });
  ok(r.completo === false, "4: nenhum -> completo=false");
  ok(r.encontrados.length === 0, "4: encontrados vazio");
  ok(r.faltando.join(",") === "sessionid,csrftoken", "4: faltando lista os dois nomes");
  ok(/login/i.test(r.mensagem), "4: mensagem orienta a fazer login no Rocket");
}

// --- 5. Entrada undefined / null / nao-objeto -> tratada como nenhum ---
{
  for (const entrada of [undefined, null, "x", 42, true, NaN]) {
    const r = avaliarSessaoRocket(entrada);
    ok(
      r.completo === false && r.faltando.length === 2 && r.encontrados.length === 0,
      `5: entrada ${String(entrada)} -> nenhum cookie considerado presente`,
    );
  }
}

// --- 6. Chaves desconhecidas sao ignoradas (nunca considera outros cookies) ---
{
  const r = avaliarSessaoRocket({
    sessionid: true,
    csrftoken: true,
    banco_sessao: true,
    xsrf: true,
    __proto__: true,
  });
  ok(r.completo === true, "6: chaves extras nao quebram a avaliacao");
  ok(
    r.encontrados.join(",") === "sessionid,csrftoken",
    "6: 'encontrados' ignora 'banco_sessao'/'xsrf' -- so' os 2 alvos",
  );
  ok(
    !r.mensagem.includes("banco_sessao") && !r.mensagem.includes("xsrf"),
    "6: nome de cookie desconhecido nunca aparece na saida",
  );
}

// --- 7. Value-blindness: qualquer coisa != true conta como AUSENTE ---
{
  const r = avaliarSessaoRocket({ sessionid: "VALOR-SECRETO-DE-COOKIE", csrftoken: 1 });
  ok(
    r.completo === false && r.faltando.join(",") === "sessionid,csrftoken",
    "7: valores truthy que nao sao 'true' NAO contam como presente (== true estrito)",
  );
  ok(
    !JSON.stringify(r).includes("VALOR-SECRETO-DE-COOKIE"),
    "7: nada do que entrou como 'valor' aparece na saida",
  );
}

// --- 8. Determinismo: mesma entrada -> mesma saida ---
{
  const a = JSON.stringify(avaliarSessaoRocket({ sessionid: true, csrftoken: false }));
  const b = JSON.stringify(avaliarSessaoRocket({ sessionid: true, csrftoken: false }));
  ok(a === b, "8: funcao e' deterministica (sem estado, sem I/O)");
}

// --- 9. Constantes expostas / escopo do dominio ---
{
  ok(
    COOKIES_ALVO.length === 2 &&
      COOKIES_ALVO.includes("sessionid") &&
      COOKIES_ALVO.includes("csrftoken"),
    "9: COOKIES_ALVO = ['sessionid','csrftoken'] e nada mais",
  );
  ok(
    URL_ROCKET === "https://app.rocketgestor.com/",
    "9: URL_ROCKET aponta somente para o dominio do Rocket",
  );
}

// ===========================================================================
// Etapa 2A -- logica PURA de estado de autenticacao (sem rede, sem creds)
// ===========================================================================

// --- 10. tokenExpirado ---
{
  const agora = 1_000_000;
  ok(tokenExpirado(agora + 3600, agora, 60) === false, "10: token com folga -> nao expirado");
  ok(tokenExpirado(agora - 10, agora, 60) === true, "10: token no passado -> expirado");
  ok(tokenExpirado(agora + 30, agora, 60) === true, "10: dentro da margem (30s < 60s) -> tratado como expirado");
  ok(tokenExpirado(agora + 60, agora, 60) === true, "10: exatamente na margem -> expirado (>=)");
  ok(tokenExpirado(agora + 61, agora, 60) === false, "10: 1s alem da margem -> ainda valido");
  ok(tokenExpirado("nao-numero", agora, 60) === true, "10: expires_at invalido -> fail-safe expirado");
  ok(tokenExpirado(agora + 3600, undefined, 60) === true, "10: 'agora' invalido -> fail-safe expirado");
}

// --- 11. avaliarOperador (nunca retorna o e-mail) ---
{
  const r0 = avaliarOperador(null, OPERADOR_AUTORIZADO_EMAIL);
  ok(r0.autenticado === false && r0.autorizado === false, "11: sessao null -> nao autenticado");
  ok(r0.rotulo === "Nao autenticado", "11: rotulo 'Nao autenticado'");

  const r1 = avaliarOperador({ email: "" }, OPERADOR_AUTORIZADO_EMAIL);
  ok(r1.autenticado === false, "11: e-mail vazio -> nao autenticado");

  const r2 = avaliarOperador({ email: OPERADOR_AUTORIZADO_EMAIL }, OPERADOR_AUTORIZADO_EMAIL);
  ok(r2.autenticado === true && r2.autorizado === true, "11: e-mail == autorizado -> operador autorizado");
  ok(r2.rotulo === "Operador autorizado", "11: rotulo 'Operador autorizado'");

  const r3 = avaliarOperador(
    { email: "  " + OPERADOR_AUTORIZADO_EMAIL.toUpperCase() + "  " },
    OPERADOR_AUTORIZADO_EMAIL,
  );
  ok(r3.autorizado === true, "11: comparacao e' case-insensitive + trim");

  const r4 = avaliarOperador({ email: "outra.pessoa@intruso.test" }, OPERADOR_AUTORIZADO_EMAIL);
  ok(r4.autenticado === true && r4.autorizado === false, "11: outro e-mail -> autenticado mas NAO autorizado");
  ok(
    r4.rotulo === "Autenticado, mas NAO e' o operador autorizado",
    "11: rotulo distingue 'autenticado, nao operador'",
  );

  ok(
    !JSON.stringify(r4).includes("outra.pessoa@intruso.test") &&
      !JSON.stringify(r2).includes(OPERADOR_AUTORIZADO_EMAIL),
    "11: o retorno NUNCA contem o e-mail (nem o autorizado, nem o autenticado)",
  );
}

// --- 12. derivarEstadoAuth (estados da UI) ---
{
  const sem = derivarEstadoAuth({ sessao: null }, OPERADOR_AUTORIZADO_EMAIL);
  ok(sem.tela === "login", "12: sem sessao -> tela 'login'");
  ok(sem.podeLogout === false, "12: sem sessao -> sem logout");
  ok(sem.envioRocketHabilitado === false, "12: sem sessao -> envio desabilitado");

  const agora = 2_000_000;
  const opOk = derivarEstadoAuth(
    { sessao: { email: OPERADOR_AUTORIZADO_EMAIL, expires_at: agora + 3600 }, agoraEpochS: agora },
    OPERADOR_AUTORIZADO_EMAIL,
  );
  ok(opOk.tela === "operador", "12: operador com token fresco -> tela 'operador'");
  ok(opOk.podeLogout === true, "12: operador -> pode logout");
  ok(opOk.precisaRenovar === false, "12: token fresco -> nao precisa renovar");
  ok(opOk.envioRocketHabilitado === false, "12: ETAPA 2A -- envio desabilitado MESMO para o operador autorizado");

  const opVelho = derivarEstadoAuth(
    { sessao: { email: OPERADOR_AUTORIZADO_EMAIL, expires_at: agora - 5 }, agoraEpochS: agora },
    OPERADOR_AUTORIZADO_EMAIL,
  );
  ok(opVelho.precisaRenovar === true, "12: token expirado -> precisaRenovar=true");
  ok(opVelho.tela === "operador", "12: expirado nao derruba a tela (renovacao e' automatica)");

  const naoOp = derivarEstadoAuth(
    { sessao: { email: "x@y.test", expires_at: agora + 3600 }, agoraEpochS: agora },
    OPERADOR_AUTORIZADO_EMAIL,
  );
  ok(naoOp.tela === "nao_operador", "12: autenticado nao-operador -> tela 'nao_operador'");
  ok(naoOp.envioRocketHabilitado === false, "12: nao-operador -> envio desabilitado");
  ok(naoOp.podeLogout === true, "12: nao-operador -> pode logout (para trocar de conta)");
}

// --- 13. integracao: PREPARACAO apenas, nada e' enviado ---
{
  ok(INTEGRACAO_HABILITADA === false, "13: INTEGRACAO_HABILITADA e' false na etapa 2A");
  ok(
    URL_ATUALIZAR_SESSAO_ROCKET === `${SUPABASE_URL}/functions/v1/atualizar-sessao-rocket`,
    "13: URL alvo montada a partir da URL publica do projeto",
  );

  const d = descreverChamadaAtualizarSessao();
  ok(d.habilitada === false, "13: descritor.habilitada === false");
  ok(d.metodo === "POST" && d.url.endsWith("/functions/v1/atualizar-sessao-rocket"), "13: descritor: POST na Edge Function");
  ok(
    d.headersPlanejados.some((h) => h.startsWith("Authorization: Bearer")) &&
      d.headersPlanejados.some((h) => h.startsWith("apikey:")),
    "13: descritor lista Authorization Bearer + apikey (planejados)",
  );
  ok(
    /sessionid/.test(d.corpoPlanejado) && /csrftoken/.test(d.corpoPlanejado) &&
      /etapa de integracao/i.test(d.corpoPlanejado),
    "13: descritor diz que sessionid/csrftoken so' entram na etapa de integracao",
  );
  ok(
    !JSON.stringify(d).includes(SUPABASE_ANON_KEY),
    "13: descritor NAO contem o valor real da anon key (so' o placeholder <anon key publica>)",
  );

  // enviarSessaoParaRocket() nunca faz fetch na etapa 2A.
  const fetchOriginal = globalThis.fetch;
  let fetchChamado = false;
  globalThis.fetch = () => {
    fetchChamado = true;
    throw new Error("fetch NAO deveria ser chamado na etapa 2A");
  };
  try {
    const env = await enviarSessaoParaRocket();
    ok(
      env.enviado === false && env.motivo === "integracao_desabilitada_etapa_2a",
      "13: enviarSessaoParaRocket() -> { enviado:false, motivo:'integracao_desabilitada_etapa_2a' }",
    );
    ok(fetchChamado === false, "13: enviarSessaoParaRocket() NAO tocou a rede");
  } finally {
    globalThis.fetch = fetchOriginal;
  }
}

// --- 14. config: sem secret privado ---
{
  const partes = SUPABASE_ANON_KEY.split(".");
  const claims = JSON.parse(
    Buffer.from(partes[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
  );
  ok(claims.role === "anon", "14: SUPABASE_ANON_KEY tem role 'anon' (NAO service_role)");
  ok(claims.ref === "nduxsuxkopuvhwugdkqi", "14: anon key e' do projeto correto");
  ok(SUPABASE_URL === "https://nduxsuxkopuvhwugdkqi.supabase.co", "14: SUPABASE_URL e' a URL publica do projeto");

  // O CODIGO de config.js (fora dos comentarios) nao pode conter
  // secret privado. Mencoes em comentario ("NAO e' a service_role")
  // sao a justificativa de seguranca -- essas sao permitidas.
  const { readFileSync } = await import("node:fs");
  const cfgTxt = readFileSync(new URL("../config.js", import.meta.url), "utf8");
  const cfgCodigo = cfgTxt
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
  ok(!/service_role/i.test(cfgCodigo), "14: config.js nao usa 'service_role' em CODIGO (so' em comentario)");
  ok(!/SESSAO_ROCKET_UPDATE_TOKEN/.test(cfgCodigo), "14: config.js nao referencia SESSAO_ROCKET_UPDATE_TOKEN em CODIGO");

  // Exatamente 1 JWT no arquivo inteiro, e e' a anon key publica.
  const jwts = cfgTxt.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) || [];
  ok(
    jwts.length === 1 && jwts[0] === SUPABASE_ANON_KEY,
    "14: config.js tem exatamente 1 JWT e e' a anon key publica (nenhum outro token)",
  );
}

console.log(`\n${falhas === 0 ? "TODOS OS TESTES PASSARAM" : `${falhas} FALHA(S)`}`);
process.exit(falhas === 0 ? 0 : 1);
