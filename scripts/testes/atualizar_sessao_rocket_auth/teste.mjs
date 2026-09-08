// Testes locais de supabase/functions/atualizar-sessao-rocket/index.ts
// (REAL, importado sem alteracao) -- provam a autenticacao dupla
// adicionada em 2026-09-08:
//
//   1. X-Internal-Token continua funcionando INTEGRALMENTE
//      (mesmo caminho que scripts/atualizar-sessao-remota.mjs usa);
//   2. operador autorizado (Supabase Auth + PAINEL_EMAIL_AUTORIZADO) funciona;
//   3. usuario Supabase autenticado mas com e-mail NAO autorizado -> 401;
//   4. requisicao sem NENHUMA autenticacao -> 401.
//
// + regressao: OPTIONS/405/400/500 e a logica de rocket_session_estado
//   continuam iguais.
//
// _shared/auth_painel.ts e _shared/http.ts sao REAIS. So'
// _shared/supabase_client.ts (npm:@supabase/supabase-js, nao resolvivel
// sob tsx) e _shared/rocket_session_check.ts (rede) sao fakes.
//
// Como rodar: npx tsx scripts/testes/atualizar_sessao_rocket_auth/teste.mjs

import { register } from "node:module";
register("./mock-loader.mjs", import.meta.url);

const supa = await import("./fake_supabase_client.mjs");
const rocketCheck = await import("./fake_rocket_session_check.mjs");

const TOKEN_INTERNO = "token-interno-sessao-rocket-de-teste-longo";
const EMAIL_AUTORIZADO = "operador@inovatv.test";

let handler;
globalThis.Deno = {
  serve: (fn) => {
    handler = fn;
  },
  env: {
    get: (nome) => {
      if (nome === "SESSAO_ROCKET_UPDATE_TOKEN") return TOKEN_INTERNO;
      if (nome === "PAINEL_EMAIL_AUTORIZADO") return EMAIL_AUTORIZADO;
      return undefined;
    },
  },
};

await import("../../../supabase/functions/atualizar-sessao-rocket/index.ts");

let falhas = 0;
function ok(cond, msg) {
  if (!cond) {
    falhas++;
    console.error(`FALHA: ${msg}`);
  } else {
    console.log(`ok: ${msg}`);
  }
}

const CORPO_VALIDO = { sessionid: "sess-abc-123", csrftoken: "csrf-xyz-789" };

function req({
  method = "POST",
  internalToken, // string | undefined  -> undefined = header ausente
  authorization, // string | undefined  -> undefined = header ausente
  corpo = CORPO_VALIDO,
  corpoBruto,
} = {}) {
  const headers = {};
  if (internalToken !== undefined) headers["X-Internal-Token"] = internalToken;
  if (authorization !== undefined) headers["Authorization"] = authorization;
  const semCorpo = method === "GET" || method === "HEAD" || method === "OPTIONS";
  if (!semCorpo) headers["Content-Type"] = "application/json";
  return new Request("https://example.test/atualizar-sessao-rocket", {
    method,
    headers,
    body: semCorpo
      ? undefined
      : corpoBruto !== undefined
        ? corpoBruto
        : JSON.stringify(corpo),
  });
}
const corpoJson = (r) => r.json().catch(() => null);

function resetTudo() {
  supa.resetarFake();
  rocketCheck.resetar();
}

// ============================================================
// 1. Token interno continua funcionando INTEGRALMENTE
// ============================================================
{
  resetTudo();
  const resp = await handler(req({ internalToken: TOKEN_INTERNO }));
  const body = await corpoJson(resp);
  ok(resp.status === 200, "1: X-Internal-Token valido -> HTTP 200");
  ok(body?.outcome === "atualizada", "1: X-Internal-Token valido -> outcome 'atualizada'");
  ok(body?.sessaoValidada === true, "1: sessaoValidada reflete o verificarSessaoRocket (fake=valida)");
  ok(
    supa.chamadasDeRpc().length === 1 &&
      supa.chamadasDeRpc()[0].nome === "rocket_sessao_definir",
    "1: rocket_sessao_definir chamado exatamente 1x",
  );
  ok(
    supa.chamadasDeRpc()[0].params.p_sessionid === CORPO_VALIDO.sessionid &&
      supa.chamadasDeRpc()[0].params.p_csrftoken === CORPO_VALIDO.csrftoken,
    "1: sessionid/csrftoken do corpo repassados sem alteracao a rocket_sessao_definir",
  );
  ok(
    supa.chamadasDeUpdate().length === 1 &&
      supa.chamadasDeUpdate()[0].tabela === "rocket_session_estado" &&
      supa.chamadasDeUpdate()[0].filtros.id === 1,
    "1: rocket_session_estado atualizado (update ... eq id=1) -- inalterado",
  );
  ok(
    supa.chamadasDeGetUser().length === 0,
    "1: caminho Supabase Auth NAO exercitado (getUser nunca chamado) -- sem custo extra pro script",
  );
  ok(
    rocketCheck.chamadasRegistradas().length === 1,
    "1: verificarSessaoRocket chamado 1x (logica de validacao intacta)",
  );
}

// 1b. Token interno valido + corpo JSON invalido -> 400 (auth passou, chega no parse)
{
  resetTudo();
  const resp = await handler(
    req({ internalToken: TOKEN_INTERNO, corpo: undefined, corpoBruto: "{ nao e json" }),
  );
  ok(resp.status === 400, "1b: X-Internal-Token valido + JSON invalido -> 400 (auth ok, falha no corpo)");
  ok(supa.chamadasDeRpc().length === 0, "1b: Vault nunca escrito com corpo invalido");
}

// 1c. Token interno valido + Authorization presente -> ainda 200; getUser NUNCA chamado (short-circuit)
{
  resetTudo();
  const resp = await handler(
    req({ internalToken: TOKEN_INTERNO, authorization: "Bearer qualquer-coisa" }),
  );
  const body = await corpoJson(resp);
  ok(
    resp.status === 200 && body?.outcome === "atualizada",
    "1c: X-Internal-Token vence mesmo com header Authorization presente",
  );
  ok(
    supa.chamadasDeGetUser().length === 0,
    "1c: getUser nao e' chamado quando X-Internal-Token ja' valeu",
  );
}

// ============================================================
// 2. Operador autorizado (Supabase Auth) funciona
// ============================================================
{
  resetTudo();
  supa.definirUsuarioAutenticado(EMAIL_AUTORIZADO);
  const resp = await handler(req({ authorization: "Bearer token-supabase-operador" })); // sem X-Internal-Token
  const body = await corpoJson(resp);
  ok(resp.status === 200, "2: operador autorizado -> HTTP 200");
  ok(body?.outcome === "atualizada", "2: operador autorizado -> outcome 'atualizada'");
  ok(
    supa.chamadasDeGetUser().length === 1 &&
      supa.chamadasDeGetUser()[0] === "token-supabase-operador",
    "2: getUser chamado com o access token do header Authorization (sem o prefixo 'Bearer ')",
  );
  ok(
    supa.chamadasDeRpc().length === 1 &&
      supa.chamadasDeRpc()[0].nome === "rocket_sessao_definir",
    "2: rocket_sessao_definir chamado apos operador autorizado",
  );
  ok(
    supa.chamadasDeUpdate().length === 1,
    "2: rocket_session_estado atualizado apos operador autorizado",
  );
}

// 2b. E-mail autorizado em caixa diferente -> aceito (verificarOperador compara case-insensitive)
{
  resetTudo();
  supa.definirUsuarioAutenticado(EMAIL_AUTORIZADO.toUpperCase());
  const resp = await handler(req({ authorization: "Bearer token-operador-maiusculo" }));
  ok(resp.status === 200, "2b: e-mail autorizado em caixa diferente -> 200 (comparacao case-insensitive)");
}

// ============================================================
// 3. Usuario Supabase autenticado, e-mail NAO autorizado -> 401
// ============================================================
{
  resetTudo();
  supa.definirUsuarioAutenticado("outro@intruso.test");
  const resp = await handler(req({ authorization: "Bearer token-de-outro-usuario" }));
  const body = await corpoJson(resp);
  ok(resp.status === 401, "3: usuario Supabase com e-mail NAO autorizado -> HTTP 401");
  ok(body?.message === "Nao autorizado", "3: mensagem generica 'Nao autorizado' (nao revela o motivo)");
  ok(supa.chamadasDeGetUser().length === 1, "3: getUser foi consultado (o token era valido; o e-mail nao)");
  ok(supa.chamadasDeRpc().length === 0, "3: rocket_sessao_definir NUNCA chamado -> Vault intocado");
  ok(supa.chamadasDeUpdate().length === 0, "3: rocket_session_estado NUNCA tocado");
  ok(rocketCheck.chamadasRegistradas().length === 0, "3: verificarSessaoRocket nem chega a ser chamado");
}

// 3b. Authorization presente mas access token invalido/expirado (getUser retorna erro) -> 401
{
  resetTudo();
  supa.definirGetUserComErro("token expired");
  const resp = await handler(req({ authorization: "Bearer token-expirado" }));
  ok(resp.status === 401, "3b: access token Supabase invalido/expirado -> 401");
  ok(supa.chamadasDeRpc().length === 0, "3b: Vault intocado com token Supabase invalido");
}

// 3c. X-Internal-Token errado E sem Authorization -> 401
{
  resetTudo();
  const resp = await handler(req({ internalToken: "token-errado" }));
  ok(resp.status === 401, "3c: X-Internal-Token errado, sem Authorization -> 401");
  ok(supa.chamadasDeGetUser().length === 0, "3c: getUser nao e' chamado quando nao ha' header Authorization");
  ok(supa.chamadasDeRpc().length === 0, "3c: Vault intocado");
}

// 3d. X-Internal-Token errado + Authorization de usuario NAO autorizado -> 401 (nenhum caminho vale)
{
  resetTudo();
  supa.definirUsuarioAutenticado("intruso@x.test");
  const resp = await handler(req({ internalToken: "token-errado", authorization: "Bearer t" }));
  ok(resp.status === 401, "3d: X-Internal-Token errado + operador nao autorizado -> 401");
  ok(supa.chamadasDeRpc().length === 0, "3d: Vault intocado");
}

// ============================================================
// 4. Requisicao sem NENHUMA autenticacao -> 401
// ============================================================
{
  resetTudo();
  const resp = await handler(req({})); // sem X-Internal-Token, sem Authorization
  const body = await corpoJson(resp);
  ok(resp.status === 401, "4: sem X-Internal-Token e sem Authorization -> HTTP 401");
  ok(body?.message === "Nao autorizado", "4: mensagem generica 'Nao autorizado'");
  ok(supa.chamadasDeGetUser().length === 0, "4: getUser nao e' chamado sem header Authorization");
  ok(supa.chamadasDeRpc().length === 0, "4: rocket_sessao_definir NUNCA chamado");
  ok(supa.chamadasDeUpdate().length === 0, "4: rocket_session_estado NUNCA tocado");
}

// ============================================================
// 5. Comportamento nao-auth INALTERADO (regressao)
// ============================================================

// 5a. OPTIONS -> corsResponse 200, antes de qualquer auth
{
  resetTudo();
  const resp = await handler(req({ method: "OPTIONS", internalToken: undefined }));
  ok(resp.status === 200, "5a: OPTIONS -> 200 (corsResponse, inalterado)");
  ok(
    supa.chamadasDeGetUser().length === 0 && supa.chamadasDeRpc().length === 0,
    "5a: OPTIONS nao exercita auth nem Vault",
  );
}

// 5b. Auth ok (interno) + metodo GET -> 405 (ordem: auth antes de metodo, inalterado)
{
  resetTudo();
  const resp = await handler(req({ method: "GET", internalToken: TOKEN_INTERNO }));
  ok(resp.status === 405, "5b: GET com auth valida -> 405 metodo nao suportado (inalterado)");
}

// 5c. Auth ok (interno) + corpo sem csrftoken -> 400 (inalterado)
{
  resetTudo();
  const resp = await handler(req({ internalToken: TOKEN_INTERNO, corpo: { sessionid: "x" } }));
  ok(resp.status === 400, "5c: corpo sem csrftoken -> 400 (inalterado)");
  ok(supa.chamadasDeRpc().length === 0, "5c: Vault intocado sem csrftoken");
}

// 5d. Auth ok + rocket_sessao_definir retorna erro -> 500 (inalterado)
{
  resetTudo();
  supa.definirErroRpc("vault indisponivel");
  const resp = await handler(req({ internalToken: TOKEN_INTERNO }));
  ok(resp.status === 500, "5d: erro ao gravar no Vault -> 500 (inalterado)");
  ok(rocketCheck.chamadasRegistradas().length === 0, "5d: verificarSessaoRocket nao roda se o Vault falhou");
}

// 5e. Auth ok + verificarSessaoRocket diz invalida -> 200, sessaoValidada=false, status nao mexido (inalterado)
{
  resetTudo();
  rocketCheck.definirResultado({ valida: false });
  const resp = await handler(req({ internalToken: TOKEN_INTERNO }));
  const body = await corpoJson(resp);
  ok(
    resp.status === 200 && body?.sessaoValidada === false,
    "5e: sessao gravada mas nao confirmada -> 200 sessaoValidada=false (inalterado)",
  );
  const payload = supa.chamadasDeUpdate()[0].payload;
  ok(
    !("status" in payload),
    "5e: update NAO seta status='valida' quando a checagem nao confirmou (inalterado)",
  );
}

// 5f. Operador autorizado + checagem invalida -> mesmo comportamento do 5e (o caminho novo nao muda a logica pos-auth)
{
  resetTudo();
  supa.definirUsuarioAutenticado(EMAIL_AUTORIZADO);
  rocketCheck.definirResultado({ valida: false });
  const resp = await handler(req({ authorization: "Bearer token-operador" }));
  const body = await corpoJson(resp);
  ok(
    resp.status === 200 && body?.sessaoValidada === false,
    "5f: via operador, checagem invalida -> 200 sessaoValidada=false (logica pos-auth identica ao caminho interno)",
  );
  ok(
    !("status" in supa.chamadasDeUpdate()[0].payload),
    "5f: via operador, update tambem nao seta status='valida' sem confirmacao",
  );
}

console.log(`\n${falhas === 0 ? "TODOS OS TESTES PASSARAM" : `${falhas} FALHA(S)`}`);
process.exit(falhas === 0 ? 0 : 1);
