// Testes da logica PURA da extensao (lib.js).
//
// Sem Chrome, sem rede, sem credenciais reais -- so' PRESENCA
// (booleana) entra, so' um veredito estruturado (nomes de cookie +
// mensagem) sai. Nenhum valor de cookie e' construido nem passado.
//
// Rodar:  node tools/extensao-sessao-rocket/testes/teste.mjs
//    ou:  npx tsx tools/extensao-sessao-rocket/testes/teste.mjs

import { avaliarSessaoRocket, COOKIES_ALVO, URL_ROCKET } from "../lib.js";

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

console.log(`\n${falhas === 0 ? "TODOS OS TESTES PASSARAM" : `${falhas} FALHA(S)`}`);
process.exit(falhas === 0 ? 0 : 1);
