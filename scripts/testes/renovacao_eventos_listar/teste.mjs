// Testes locais de supabase/functions/renovacao-eventos-listar/index.ts
// (REAL, importado sem alteracao) -- Tela 1 do Painel de Monitoramento
// de Renovacoes (2026-09-14).
//
// So' _shared/supabase_client.ts e' fake (estado em memoria); auth_painel.ts,
// http.ts, tokens_renovacao.ts e renovacoes_lote.ts sao os modulos REAIS,
// exatamente como em producao.
//
// Cobre: autenticacao (ausente/invalida/nao autorizada/config ausente),
// resposta valida (avulsa + lote), filtro por `resultado` (unico filtro
// real do contrato) atraves da paginacao, paginacao, ordenacao,
// ausencia de resultados, tratamento de erro (503), sanitizacao (sem
// token_hash/campos internos vazando), e regressao de metodo/CORS.
//
// Como rodar: npx tsx scripts/testes/renovacao_eventos_listar/teste.mjs

import { register } from "node:module";
register("./mock-loader.mjs", import.meta.url);

const supa = await import("./fake_supabase_client.mjs");

let PAINEL_EMAIL = "operador@inovatv.test";
const EMAIL_AUTORIZADO = "operador@inovatv.test";

let handler;
globalThis.Deno = {
  serve: (fn) => {
    handler = fn;
  },
  env: {
    get: (nome) => (nome === "PAINEL_EMAIL_AUTORIZADO" ? PAINEL_EMAIL : undefined),
  },
};

await import("../../../supabase/functions/renovacao-eventos-listar/index.ts");

let falhas = 0;
let total = 0;
function ok(cond, msg) {
  total++;
  if (!cond) {
    falhas++;
    console.error(`FALHA: ${msg}`);
  } else {
    console.log(`ok: ${msg}`);
  }
}

// authorization: string -> header enviado; null -> header OMITIDO
// (nunca `undefined` pra isso -- default de parametro so' dispara em
// `undefined`, entao um `{ authorization: undefined }` explicito cairia
// no default abaixo em vez de omitir o header).
function req({ method = "GET", query = "", authorization = "Bearer token-operador-valido" } = {}) {
  const headers = {};
  if (authorization) headers["Authorization"] = authorization;
  return new Request(`https://x.test/renovacao-eventos-listar${query}`, { method, headers });
}
const corpoJson = (r) => r.json().catch(() => null);

function resetTudo() {
  supa.resetar();
  PAINEL_EMAIL = EMAIL_AUTORIZADO;
}
function autenticar() {
  supa.definirUsuarioAutenticado(EMAIL_AUTORIZADO);
}

const BASE_MS = new Date("2026-09-10T12:00:00-03:00").getTime();
function iso(offsetMin) {
  return new Date(BASE_MS + offsetMin * 60_000).toISOString();
}

function avulsa(over = {}) {
  const id = over.id ?? crypto.randomUUID();
  return {
    id,
    grupo_id: null,
    token_hash: `hash-secreto-${id}`,
    telefone: "5517900000001",
    cliente_nome: "Cliente Avulso",
    servidor_nome: "BLAZE",
    plano_nome: "Mensal",
    valor_esperado_centavos: 3500,
    vencimento_atual: iso(0),
    vencimento_confirmado: null,
    motivo_falha: null,
    estado: "autorizada",
    criado_em: iso(0),
    expira_em: iso(0),
    tipo: "sigma",
    operacao_id: null,
    sessao_id: null,
    ...over,
  };
}
function loteCapa(over = {}) {
  return {
    grupo_id: over.grupo_id ?? crypto.randomUUID(),
    token_hash: `hash-lote-secreto-${crypto.randomUUID()}`,
    telefone: "5517900000002",
    estado: "autorizada",
    valor_total_centavos: 7000,
    regra_aplicada: "soma_valores_rocket",
    criado_em: iso(0),
    expira_em: iso(0),
    operacao_id: null,
    sessao_id: null,
    ...over,
  };
}
function filho(grupoId, over = {}) {
  const id = over.id ?? crypto.randomUUID();
  return {
    id,
    grupo_id: grupoId,
    token_hash: `hash-filho-secreto-${id}`,
    telefone: "5517900000002",
    cliente_nome: "Cliente Lote",
    servidor_nome: "NewOne",
    plano_nome: "Mensal",
    valor_esperado_centavos: 3500,
    vencimento_atual: iso(0),
    vencimento_confirmado: null,
    motivo_falha: null,
    estado: "autorizada",
    criado_em: iso(0),
    expira_em: iso(0),
    tipo: "sigma",
    ...over,
  };
}

// =====================================================================
// 1. Autenticacao ausente/invalida
// =====================================================================
{
  resetTudo();
  const resp = await handler(req({ authorization: null }));
  const body = await corpoJson(resp);
  ok(resp.status === 401, "1a: sem header Authorization -> 401");
  ok(body?.outcome === "unauthorized" && body?.motivo === "token_ausente", "1a: motivo token_ausente");
  ok(supa.chamadasDeGetUser().length === 0, "1a: getUser nunca chamado sem header");
  ok(supa.chamadasNaTabela("tokens_renovacao") === 0, "1a: tokens_renovacao nunca consultada");
  ok(supa.chamadasNaTabela("renovacoes_lote") === 0, "1a: renovacoes_lote nunca consultada");
}
{
  resetTudo();
  const resp = await handler(req({ authorization: "Basic algumacoisa" }));
  const body = await corpoJson(resp);
  ok(resp.status === 401, "1b: header sem prefixo 'Bearer ' -> 401");
  ok(body?.motivo === "token_ausente", "1b: motivo token_ausente (nao comeca com 'Bearer ')");
}
{
  resetTudo();
  // Espaco ASCII comum e' removido pelo proprio Headers (whitespace de
  // HTTP e' aparado nas bordas do valor do header antes mesmo do
  // handler rodar) -- um NBSP ( ) sobrevive a essa normalizacao
  // mas ainda e' removido por String.prototype.trim(), exercitando de
  // fato o branch "token vazio apos trim" de auth_painel.ts.
  const resp = await handler(req({ authorization: "Bearer  " }));
  const body = await corpoJson(resp);
  ok(resp.status === 401, "1c: 'Bearer' com token vazio apos trim -> 401");
  ok(body?.motivo === "token_invalido", "1c: motivo token_invalido (token vazio apos trim)");
}
{
  resetTudo();
  supa.definirGetUserComErro("token expirado");
  const resp = await handler(req({ authorization: "Bearer token-expirado" }));
  const body = await corpoJson(resp);
  ok(resp.status === 401, "1d: access token invalido/expirado (getUser retorna erro) -> 401");
  ok(body?.motivo === "token_invalido", "1d: motivo token_invalido");
  ok(supa.chamadasNaTabela("tokens_renovacao") === 0, "1d: nenhuma tabela consultada com token invalido");
}
{
  resetTudo();
  PAINEL_EMAIL = undefined;
  autenticar();
  const resp = await handler(req());
  const body = await corpoJson(resp);
  ok(resp.status === 401, "1e: PAINEL_EMAIL_AUTORIZADO nao configurado -> 401");
  ok(body?.motivo === "configuracao_ausente", "1e: motivo configuracao_ausente");
  PAINEL_EMAIL = EMAIL_AUTORIZADO;
}

// =====================================================================
// 2. Operador autenticado mas NAO autorizado (e-mail diferente)
// =====================================================================
{
  resetTudo();
  supa.definirUsuarioAutenticado("intruso@fora.test");
  const resp = await handler(req({ authorization: "Bearer token-de-outro" }));
  const body = await corpoJson(resp);
  ok(resp.status === 401, "2: e-mail autenticado mas nao autorizado -> 401");
  ok(body?.motivo === "email_nao_autorizado", "2: motivo email_nao_autorizado");
  ok(supa.chamadasNaTabela("tokens_renovacao") === 0, "2: tokens_renovacao nunca consultada (barrado antes)");
  ok(supa.chamadasNaTabela("renovacoes_lote") === 0, "2: renovacoes_lote nunca consultada (barrado antes)");
}

// =====================================================================
// 3. Resposta valida -- avulsa + lote, todos os 5 resultados, contagens
// =====================================================================
{
  resetTudo();
  autenticar();

  seedCenarioCompleto();

  const resp = await handler(req());
  const body = await corpoJson(resp);
  ok(resp.status === 200, "3: HTTP 200 com operador autorizado");
  ok(body.outcome === "success", "3: outcome success");
  ok(body.pagina === 1, "3: pagina default = 1");
  ok(body.totalGeral === 5, "3: totalGeral reflete todo o conjunto (3 avulsas + 2 lotes)");
  ok(body.total === 5, "3: total (sem filtro) == totalGeral");
  ok(body.itens.length === 5, "3: 5 itens retornados (todos cabem numa pagina)");
  ok(
    body.contagens.ok === 1 && body.contagens.falha === 1 && body.contagens.espera === 1 &&
      body.contagens.parcial === 1 && body.contagens.cancel === 1,
    "3: contagens por resultado corretas (1 de cada um dos 5)",
  );

  const itemOk = body.itens.find((i) => i.resultado === "ok" && i.tipo === "avulsa");
  ok(itemOk?.diagnostico?.startsWith("Novo vencimento:"), "3: avulsa concluida -> diagnostico com novo vencimento");
  ok(itemOk?.qtdAcessos === 1, "3: avulsa -> qtdAcessos 1");

  const itemFalha = body.itens.find((i) => i.resultado === "falha" && i.tipo === "avulsa");
  ok(itemFalha?.diagnostico === "Falha — Sessão Sigma expirada", "3: avulsa falha -> diagnostico com motivo humanizado (prefixo conhecido)");

  const itemParcial = body.itens.find((i) => i.resultado === "parcial");
  ok(itemParcial?.tipo === "lote", "3: resultado parcial so' existe pra lote");
  ok(itemParcial?.diagnostico === "1 de 2 acessos concluídos", "3: lote parcial -> diagnostico com contagem de acessos");
  ok(itemParcial?.qtdAcessos === 2, "3: lote parcial -> qtdAcessos = numero de filhos");
  ok(itemParcial?.servidor.includes("+"), "3: lote com servidores diferentes -> servidor concatenado com '+'");

  const itemCancel = body.itens.find((i) => i.resultado === "cancel");
  ok(itemCancel?.tipo === "lote", "3: lote cancelado presente");
  ok(itemCancel?.diagnostico === "Cancelada pelo cliente", "3: lote 'cancelada' -> diagnostico cancelamento pelo cliente");
}

// =====================================================================
// 4. Ordenacao -- mais recente primeiro, avulsa e lote intercalados
// =====================================================================
{
  resetTudo();
  autenticar();
  supa.seed("tokens_renovacao", [avulsa({ criado_em: iso(10), estado: "autorizada" })]);
  supa.seed("renovacoes_lote", [loteCapa({ grupo_id: "g-meio", criado_em: iso(20), estado: "autorizada" })]);
  supa.seed("tokens_renovacao", [avulsa({ criado_em: iso(30), estado: "autorizada" })]);

  const body = await corpoJson(await handler(req()));
  ok(body.itens.length === 3, "4: 3 itens (2 avulsas + 1 lote)");
  ok(
    body.itens[0].criadoEm === iso(30) && body.itens[1].criadoEm === iso(20) && body.itens[2].criadoEm === iso(10),
    "4: ordenados por criadoEm decrescente, avulsa e lote no mesmo criterio",
  );
}

// =====================================================================
// 5. Filtro por `resultado` -- unico filtro do contrato real, aplicado
//    ANTES da paginacao (nunca so' dentro da pagina atual)
// =====================================================================
{
  resetTudo();
  autenticar();
  // 25 avulsas 'falha' + 3 avulsas 'ok', pra provar que o filtro por
  // resultado atravessa varias paginas (POR_PAGINA = 20).
  const falhas = Array.from({ length: 25 }, (_, i) =>
    avulsa({ criado_em: iso(i), estado: "renovacao_falhou", motivo_falha: "renovacao_sigma:falha" }));
  const oks = Array.from({ length: 3 }, (_, i) =>
    avulsa({ criado_em: iso(100 + i), estado: "renovacao_concluida" }));
  supa.seed("tokens_renovacao", [...falhas, ...oks]);

  const p1 = await corpoJson(await handler(req({ query: "?resultado=falha&pagina=1" })));
  ok(p1.total === 25, "5: filtro resultado=falha -> total=25 (so' as falhas, atraves de toda a base)");
  ok(p1.totalGeral === 28, "5: totalGeral continua contando TUDO (25+3), nao so' o filtro");
  ok(p1.itens.length === 20 && p1.itens.every((i) => i.resultado === "falha"), "5: pagina 1 do filtro -> 20 itens, todos 'falha'");

  const p2 = await corpoJson(await handler(req({ query: "?resultado=falha&pagina=2" })));
  ok(p2.itens.length === 5 && p2.itens.every((i) => i.resultado === "falha"), "5: pagina 2 do filtro -> os 5 restantes, todos 'falha'");

  const pOk = await corpoJson(await handler(req({ query: "?resultado=ok" })));
  ok(pOk.total === 3 && pOk.itens.every((i) => i.resultado === "ok"), "5: filtro resultado=ok -> so' as 3 concluidas");

  const pInvalido = await handler(req({ query: "?resultado=xyz" }));
  ok(pInvalido.status === 400, "5: resultado invalido -> 400");
  const bInvalido = await corpoJson(pInvalido);
  ok(bInvalido.outcome === "error", "5: resultado invalido -> outcome error (contrato de erro generico)");
}

// =====================================================================
// 6. Paginacao
// =====================================================================
{
  resetTudo();
  autenticar();
  supa.seed("tokens_renovacao", Array.from({ length: 45 }, (_, i) => avulsa({ criado_em: iso(i), estado: "autorizada" })));

  const p1 = await corpoJson(await handler(req({ query: "?pagina=1" })));
  ok(p1.itens.length === 20, "6: pagina 1 -> 20 itens (POR_PAGINA)");
  const p3 = await corpoJson(await handler(req({ query: "?pagina=3" })));
  ok(p3.itens.length === 5, "6: pagina 3 (45 itens, 20/pagina) -> os 5 restantes");
  const p4 = await corpoJson(await handler(req({ query: "?pagina=4" })));
  ok(p4.itens.length === 0 && p4.outcome === "success", "6: pagina alem do total -> itens vazio, outcome success (nunca erro)");

  for (const invalido of ["0", "-1", "abc", "1.5"]) {
    const r = await handler(req({ query: `?pagina=${invalido}` }));
    ok(r.status === 400, `6: pagina='${invalido}' -> 400`);
  }
}

// =====================================================================
// 7. Ausencia de resultados
// =====================================================================
{
  resetTudo();
  autenticar();
  const body = await corpoJson(await handler(req()));
  ok(body.outcome === "success", "7a: base vazia -> ainda outcome success (nao e' erro)");
  ok(body.total === 0 && body.totalGeral === 0 && body.itens.length === 0, "7a: base vazia -> total/totalGeral/itens zerados");
  ok(
    body.contagens.ok === 0 && body.contagens.falha === 0 && body.contagens.parcial === 0 &&
      body.contagens.cancel === 0 && body.contagens.espera === 0,
    "7a: base vazia -> todas as contagens zeradas",
  );

  supa.seed("tokens_renovacao", [avulsa({ estado: "renovacao_concluida" })]);
  const filtrado = await corpoJson(await handler(req({ query: "?resultado=falha" })));
  ok(filtrado.itens.length === 0 && filtrado.total === 0, "7b: filtro sem nenhuma correspondencia -> itens vazio");
  ok(filtrado.contagens.ok === 1, "7b: contagens continuam refletindo o conjunto REAL (1 ok), mesmo filtrando por 'falha'");
}

// =====================================================================
// 8. Tratamento de erro (banco indisponivel)
// =====================================================================
{
  resetTudo();
  autenticar();
  supa.definirErroTabela("tokens_renovacao", "conexao recusada");
  const resp = await handler(req({ query: "?pagina=2" }));
  const body = await corpoJson(resp);
  ok(resp.status === 503, "8a: erro em tokens_renovacao -> 503");
  ok(body.outcome === "unavailable", "8a: outcome unavailable");
  ok(body.pagina === 2, "8a: pagina do request preservada mesmo no erro");
  ok(
    body.total === 0 && body.totalGeral === 0 && body.itens.length === 0 &&
      Object.values(body.contagens).every((n) => n === 0),
    "8a: shape de erro com todos os totais/itens/contagens zerados (contrato de erro)",
  );
}
{
  resetTudo();
  autenticar();
  supa.definirErroTabela("renovacoes_lote", "conexao recusada");
  const resp = await handler(req());
  ok(resp.status === 503, "8b: erro em renovacoes_lote tambem -> 503 (Promise.all falha se qualquer uma falhar)");
}

// =====================================================================
// 9. Sanitizacao -- nunca vaza token_hash nem campo fora do contrato
// =====================================================================
{
  resetTudo();
  autenticar();
  seedCenarioCompleto();
  const resp = await handler(req());
  const bruto = await resp.text();
  ok(!bruto.includes("hash-secreto-"), "9a: token_hash de avulsa nunca aparece na resposta");
  ok(!bruto.includes("hash-lote-secreto-"), "9b: token_hash de lote nunca aparece na resposta");
  ok(!bruto.includes("hash-filho-secreto-"), "9c: token_hash de filho de lote nunca aparece na resposta");

  const body = JSON.parse(bruto);
  const CHAVES_ESPERADAS = [
    "tipo", "id", "criadoEm", "quandoFormatado", "clienteNome", "telefone",
    "servidor", "qtdAcessos", "valorFormatado", "resultado", "diagnostico", "vencimentoFormatado",
  ].sort();
  for (const item of body.itens) {
    ok(
      JSON.stringify(Object.keys(item).sort()) === JSON.stringify(CHAVES_ESPERADAS),
      `9d: item (${item.tipo}) expõe exatamente o conjunto de campos do contrato, nada a mais`,
    );
  }
}

// =====================================================================
// 10. Regressao -- metodo/CORS (comportamento existente, nao mexido)
// =====================================================================
{
  resetTudo();
  const resp = await handler(req({ method: "OPTIONS", authorization: null }));
  ok(resp.status === 200, "10a: OPTIONS -> 200 (corsResponse, antes de qualquer auth)");
  ok(supa.chamadasDeGetUser().length === 0, "10a: OPTIONS nunca exercita auth");
}
{
  resetTudo();
  autenticar();
  const resp = await handler(req({ method: "POST" }));
  ok(resp.status === 405, "10b: metodo POST -> 405 (so' aceita GET)");
}

function seedCenarioCompleto() {
  // 3 avulsas -- ok / falha / espera.
  supa.seed("tokens_renovacao", [
    avulsa({
      criado_em: iso(50),
      estado: "renovacao_concluida",
      vencimento_confirmado: iso(60 * 24 * 30),
    }),
    avulsa({
      criado_em: iso(40),
      estado: "renovacao_falhou",
      motivo_falha: "renovacao_sigma:sessao_expirada",
    }),
    avulsa({ criado_em: iso(30), estado: "autorizada" }),
  ]);

  // Lote 1 -- parcial (1 filho concluido, 1 falhou).
  const g1 = "grupo-parcial";
  supa.seed("renovacoes_lote", [loteCapa({ grupo_id: g1, criado_em: iso(20), estado: "parcial" })]);
  supa.seed("tokens_renovacao", [
    filho(g1, { criado_em: iso(20), servidor_nome: "BLAZE", estado: "renovacao_concluida" }),
    filho(g1, { criado_em: iso(21), servidor_nome: "NewOne", estado: "renovacao_falhou" }),
  ]);

  // Lote 2 -- cancelada.
  const g2 = "grupo-cancelado";
  supa.seed("renovacoes_lote", [loteCapa({ grupo_id: g2, criado_em: iso(10), estado: "cancelada" })]);
  supa.seed("tokens_renovacao", [filho(g2, { criado_em: iso(10), estado: "cancelada" })]);
}

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
