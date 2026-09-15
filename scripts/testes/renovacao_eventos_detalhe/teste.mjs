// Testes locais de supabase/functions/renovacao-eventos-detalhe/index.ts
// (REAL, importado sem alteracao) -- Tela 2 do Painel de Monitoramento
// de Renovacoes (2026-09-14).
//
// So' _shared/supabase_client.ts e' fake (estado em memoria); auth_painel.ts,
// http.ts, tokens_renovacao.ts, renovacoes_lote.ts e renovacao_eventos.ts
// sao os modulos REAIS, exatamente como em producao.
//
// Cobre: autenticacao, identificacao/correlacao (token_id XOR grupo_id),
// avulsa, lote (com cenario parcial), nao encontrado, erro (503),
// sanitizacao (incluindo a camada de leitura defensiva de
// buscarEventosPorCorrelacao, adicionada 2026-09-14), correlacao por
// operacao_id (idem, agora suportada), e a logica de causa-raiz
// (veredito) do mockup v4 aprovado.
//
// IMPORTANTE sobre o item 10 (causa raiz): renovacao-eventos-detalhe
// NUNCA decide o veredito -- so' devolve a timeline crua, em ordem
// cronologica (ver comentario no topo do index.ts real: "este endpoint
// so' entrega dado, nunca decide o texto do veredito"). A funcao
// encontrarRaiz() abaixo e' uma COPIA FIEL de
// painel/app/renovacoes/[id]/page.tsx:encontrarRaiz (mockup v4 ja
// aprovado e implementado) -- reproduzida aqui so' pra provar que o
// CONTRATO de dados que o backend devolve (todos os eventos de erro
// presentes, em ordem crescente de criado_em) sustenta corretamente a
// escolha de causa-raiz que o frontend faz. Nao ha' hoje neste repo um
// harness de teste de componente React -- isto e' o teste mais proximo
// possivel do contrato real sem introduzir um framework novo (ver
// lacuna reportada ao usuario).
//
// Como rodar: npx tsx scripts/testes/renovacao_eventos_detalhe/teste.mjs

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

await import("../../../supabase/functions/renovacao-eventos-detalhe/index.ts");

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
// (nunca `undefined` -- default de parametro so' dispara em
// `undefined`, entao `{ authorization: undefined }` cairia no default).
function req({ method = "GET", query = "", authorization = "Bearer token-operador-valido" } = {}) {
  const headers = {};
  if (authorization) headers["Authorization"] = authorization;
  return new Request(`https://x.test/renovacao-eventos-detalhe${query}`, { method, headers });
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
function evento(over = {}) {
  return {
    id: over.id ?? crypto.randomUUID(),
    criado_em: iso(0),
    sessao_id: null,
    token_id: null,
    grupo_id: null,
    operacao_id: null,
    etapa: "processamento",
    codigo: "processamento_iniciado",
    nivel: "info",
    servidor: null,
    origem: "teste",
    detalhe: {},
    ...over,
  };
}

// Copia fiel de painel/app/renovacoes/[id]/page.tsx:encontrarRaiz --
// ver comentario no topo do arquivo.
function encontrarRaiz(eventos) {
  const falhas = eventos.filter((e) => e.nivel === "erro");
  if (falhas.length === 0) return null;
  const semCallback = [...falhas].reverse().find((e) => e.etapa !== "callback_resultado");
  return semCallback ?? falhas[falhas.length - 1];
}
// Copia fiel do agrupamento por acesso de page.tsx (bloco `useMemo`) --
// separa eventos compartilhados do lote (sem token_id, ou token_id que
// nao e' nenhum dos filhos) dos eventos de CADA filho especifico.
function agruparPorAcesso(eventos, filhos) {
  const filhosOrdem = filhos.map((f) => f.tokenId);
  const porFilho = new Map();
  const semFilho = [];
  for (const e of eventos) {
    if (e.token_id && filhosOrdem.includes(e.token_id)) {
      if (!porFilho.has(e.token_id)) porFilho.set(e.token_id, []);
      porFilho.get(e.token_id).push(e);
    } else {
      semFilho.push(e);
    }
  }
  return { semFilho, porFilho };
}

// =====================================================================
// 1. Autenticacao ausente/invalida
// =====================================================================
{
  resetTudo();
  const resp = await handler(req({ query: "?token_id=00000000-0000-0000-0000-000000000001", authorization: null }));
  const body = await corpoJson(resp);
  ok(resp.status === 401, "1a: sem header Authorization -> 401");
  ok(body?.outcome === "unauthorized" && body?.motivo === "token_ausente", "1a: motivo token_ausente");
  ok(supa.chamadasDeGetUser().length === 0, "1a: getUser nunca chamado sem header");
  ok(supa.chamadasNaTabela("tokens_renovacao") === 0, "1a: nenhuma tabela consultada (barrado antes dos parametros)");
}
{
  resetTudo();
  const resp = await handler(req({ authorization: "Bearer  " }));
  const body = await corpoJson(resp);
  ok(resp.status === 401, "1b: 'Bearer' com token vazio apos trim -> 401");
  ok(body?.motivo === "token_invalido", "1b: motivo token_invalido");
}
{
  resetTudo();
  supa.definirGetUserComErro("token expirado");
  const resp = await handler(req({ authorization: "Bearer token-expirado" }));
  const body = await corpoJson(resp);
  ok(resp.status === 401, "1c: access token invalido/expirado -> 401");
  ok(body?.motivo === "token_invalido", "1c: motivo token_invalido");
}
{
  resetTudo();
  PAINEL_EMAIL = undefined;
  autenticar();
  const resp = await handler(req());
  const body = await corpoJson(resp);
  ok(resp.status === 401, "1d: PAINEL_EMAIL_AUTORIZADO nao configurado -> 401");
  ok(body?.motivo === "configuracao_ausente", "1d: motivo configuracao_ausente");
  PAINEL_EMAIL = EMAIL_AUTORIZADO;
}

// =====================================================================
// 2. Operador autenticado mas NAO autorizado
// =====================================================================
{
  resetTudo();
  supa.definirUsuarioAutenticado("intruso@fora.test");
  const t = avulsa({ estado: "renovacao_concluida" });
  supa.seed("tokens_renovacao", [t]);
  const resp = await handler(req({ query: `?token_id=${t.id}`, authorization: "Bearer x" }));
  const body = await corpoJson(resp);
  ok(resp.status === 401, "2: e-mail nao autorizado -> 401");
  ok(body?.motivo === "email_nao_autorizado", "2: motivo email_nao_autorizado");
  ok(supa.chamadasNaTabela("tokens_renovacao") === 0, "2: nenhuma tabela consultada -- barrado antes de qualquer leitura");
}

// =====================================================================
// 3. Identificacao/correlacao -- exatamente token_id XOR grupo_id,
//    ambos precisam ser UUID valido (mesma validacao de conversation_id
//    do resto do painel, http.ts:conversationIdValido)
// =====================================================================
{
  resetTudo();
  autenticar();

  const semNenhum = await handler(req({ query: "" }));
  ok(semNenhum.status === 400, "3a: nem token_id nem grupo_id -> 400");
  const bodyA = await corpoJson(semNenhum);
  ok(bodyA.message.includes("exatamente um dos dois"), "3a: mensagem explica que precisa de exatamente um dos dois");

  const comOsDois = await handler(
    req({ query: "?token_id=00000000-0000-0000-0000-000000000001&grupo_id=00000000-0000-0000-0000-000000000002" }),
  );
  ok(comOsDois.status === 400, "3b: token_id E grupo_id juntos -> 400");
  const bodyB = await corpoJson(comOsDois);
  ok(bodyB.message.includes("exatamente um dos dois"), "3b: mesma mensagem de 'exatamente um dos dois'");

  const tokenInvalido = await handler(req({ query: "?token_id=nao-e-um-uuid" }));
  ok(tokenInvalido.status === 400, "3c: token_id mal formatado -> 400");
  const bodyC = await corpoJson(tokenInvalido);
  ok(bodyC.message === "token_id invalido", "3c: mensagem 'token_id invalido'");

  const grupoInvalido = await handler(req({ query: "?grupo_id=nao-e-um-uuid" }));
  ok(grupoInvalido.status === 400, "3d: grupo_id mal formatado -> 400");
  const bodyD = await corpoJson(grupoInvalido);
  ok(bodyD.message === "grupo_id invalido", "3d: mensagem 'grupo_id invalido'");

  ok(supa.chamadasNaTabela("tokens_renovacao") === 0, "3e: nenhuma consulta ao banco em qualquer um dos 4 casos invalidos acima");
}

// =====================================================================
// 4. Avulsa completa -- resumo, ids, eventos correlacionados por
//    token_id E por sessao_id, isolamento de outra renovacao
// =====================================================================
{
  resetTudo();
  autenticar();

  const sessaoId = "11111111-1111-1111-1111-111111111111";
  const t = avulsa({
    estado: "renovacao_concluida",
    criado_em: iso(0),
    vencimento_confirmado: iso(60 * 24 * 30),
    sessao_id: sessaoId,
    operacao_id: "op-123",
  });
  supa.seed("tokens_renovacao", [t]);
  supa.seed("renovacao_eventos", [
    // Antes do token existir -- so' correlacionavel por sessao_id.
    evento({ criado_em: iso(1), sessao_id: sessaoId, etapa: "entrada", codigo: "portal_acessado", origem: "renovacao-iniciar" }),
    evento({ criado_em: iso(2), sessao_id: sessaoId, etapa: "identificacao", codigo: "identificacao_sucesso", origem: "renovacao-iniciar" }),
    // Depois do token criado -- correlacionavel por token_id.
    evento({ criado_em: iso(3), token_id: t.id, etapa: "carrinho", codigo: "carrinho_token_criado", origem: "renovacao_confirmacao" }),
    evento({
      criado_em: iso(4),
      token_id: t.id,
      operacao_id: "op-123",
      etapa: "vencimento",
      codigo: "vencimento_confirmado_sucesso",
      origem: "renovacao-sigma-resultado",
      detalhe: { novo_vencimento: "10/10/2026 às 12:00" },
    }),
  ]);
  // Isolamento: outro token/sessao, nunca deve aparecer.
  const outro = avulsa({ sessao_id: "22222222-2222-2222-2222-222222222222" });
  supa.seed("tokens_renovacao", [outro]);
  supa.seed("renovacao_eventos", [
    evento({ token_id: outro.id, sessao_id: outro.sessao_id, criado_em: iso(5), codigo: "carrinho_token_criado", etapa: "carrinho" }),
  ]);

  const resp = await handler(req({ query: `?token_id=${t.id}` }));
  const body = await corpoJson(resp);
  ok(resp.status === 200, "4: HTTP 200");
  ok(body.outcome === "success" && body.tipo === "avulsa", "4: outcome success, tipo avulsa");
  ok(body.resumo.clienteNome === "Cliente Avulso" && body.resumo.telefone === "5517900000001", "4: resumo com cliente/telefone corretos");
  ok(body.resumo.resultado === "ok" && body.resumo.qtdAcessos === 1, "4: resultado mapeado (renovacao_concluida -> ok), qtdAcessos 1");
  ok(body.resumo.vencimentoFormatado === "10/10/2026 às 12:00", "4: vencimentoFormatado formatado em pt-BR/America-Sao_Paulo");
  ok(
    JSON.stringify(body.ids) === JSON.stringify({ tokenId: t.id, grupoId: null, operacaoId: "op-123" }),
    "4: ids -- tokenId presente, grupoId null, operacaoId do token",
  );
  ok(body.filhos === null, "4: filhos null (avulsa nao tem filhos)");
  ok(body.eventos.length === 4, "4: 4 eventos -- 2 por sessao_id (pre-token) + 2 por token_id (pos-token), nenhum do outro token");
  ok(
    body.eventos.every((e) => e.id !== undefined) &&
      body.eventos.map((e) => e.criado_em).every((v, i, arr) => i === 0 || arr[i - 1] <= v),
    "4: eventos em ordem cronologica crescente",
  );
  ok(
    !body.eventos.some((e) => e.token_id === outro.id || e.sessao_id === outro.sessao_id),
    "4: isolamento -- nenhum evento do OUTRO token/sessao vaza pra esta renovacao",
  );
}

// =====================================================================
// 5. Lote completo -- cenario PARCIAL (2 concluidos + 1 falhou),
//    agrupamento por acesso, pagamento compartilhado NAO duplicado
// =====================================================================
{
  resetTudo();
  autenticar();

  const grupoId = crypto.randomUUID();
  const capa = loteCapa({ grupo_id: grupoId, estado: "parcial", criado_em: iso(0), operacao_id: "op-lote-1" });
  const f1 = filho(grupoId, { servidor_nome: "BLAZE", estado: "renovacao_concluida", criado_em: iso(1), vencimento_confirmado: iso(60 * 24 * 30) });
  const f2 = filho(grupoId, { servidor_nome: "NewOne", estado: "renovacao_concluida", criado_em: iso(2), vencimento_confirmado: iso(60 * 24 * 31) });
  const f3 = filho(grupoId, { servidor_nome: "ChannelTV", estado: "renovacao_falhou", criado_em: iso(3), motivo_falha: "renovacao_sigma:falha" });
  supa.seed("renovacoes_lote", [capa]);
  supa.seed("tokens_renovacao", [f1, f2, f3]);

  supa.seed("renovacao_eventos", [
    // Compartilhado do lote inteiro -- 1 pagamento so', sem token_id.
    evento({ criado_em: iso(0), grupo_id: grupoId, etapa: "cobranca_pix", codigo: "cobranca_pix_criada", origem: "renovacao_confirmacao" }),
    evento({ criado_em: iso(0.5), grupo_id: grupoId, operacao_id: "op-lote-1", etapa: "pagamento", codigo: "pagamento_confirmado", origem: "openpix-webhook" }),
    // Por filho -- cada evento carrega token_id DELE + grupo_id (padrao real de renovacao-sigma-resultado).
    evento({ criado_em: iso(1), token_id: f1.id, grupo_id: grupoId, servidor: "sigma", etapa: "processamento", codigo: "processamento_clique_executado", origem: "renovacao-sigma-workflow" }),
    evento({ criado_em: iso(1.1), token_id: f1.id, grupo_id: grupoId, servidor: "sigma", etapa: "vencimento", codigo: "vencimento_confirmado_sucesso", origem: "renovacao-sigma-resultado" }),
    evento({ criado_em: iso(2), token_id: f2.id, grupo_id: grupoId, servidor: "sigma", etapa: "processamento", codigo: "processamento_clique_executado", origem: "renovacao-sigma-workflow" }),
    evento({ criado_em: iso(2.1), token_id: f2.id, grupo_id: grupoId, servidor: "sigma", etapa: "vencimento", codigo: "vencimento_confirmado_sucesso", origem: "renovacao-sigma-resultado" }),
    evento({ criado_em: iso(3), token_id: f3.id, grupo_id: grupoId, servidor: "sigma", etapa: "processamento", codigo: "processamento_sessao_expirada", nivel: "erro", origem: "renovacao-sigma-workflow" }),
    evento({ criado_em: iso(3.1), token_id: f3.id, grupo_id: grupoId, etapa: "callback_resultado", codigo: "resultado_gravado_falha", nivel: "erro", origem: "renovacao-sigma-resultado" }),
  ]);

  const resp = await handler(req({ query: `?grupo_id=${grupoId}` }));
  const body = await corpoJson(resp);
  ok(resp.status === 200, "5: HTTP 200");
  ok(body.outcome === "success" && body.tipo === "lote", "5: outcome success, tipo lote");
  ok(body.resumo.resultado === "parcial", "5: resultado do lote mapeado -> parcial");
  ok(body.resumo.qtdAcessos === 3, "5: qtdAcessos = numero de filhos (3)");
  ok(
    JSON.stringify(body.ids) === JSON.stringify({ tokenId: null, grupoId, operacaoId: "op-lote-1" }),
    "5: ids -- grupoId presente, tokenId null, operacaoId da capa do lote",
  );

  ok(body.filhos.length === 3, "5: 3 filhos retornados");
  ok(
    body.filhos.map((f) => f.tokenId).join(",") === [f1.id, f2.id, f3.id].join(","),
    "5: filhos na ordem de criado_em asc (mesma ordem de buscarFilhosDoLote)",
  );
  ok(body.filhos[0].resultado === "ok" && body.filhos[1].resultado === "ok" && body.filhos[2].resultado === "falha", "5: 2 filhos ok + 1 falha (cenario parcial)");
  ok(body.filhos[2].motivoFalha === "renovacao_sigma:falha", "5: motivoFalha bruto do filho preservado (humanizacao e' so' na lista, nao no detalhe)");

  ok(body.eventos.length === 8, "5: todos os 8 eventos gravados aparecem, nenhum a mais nem a menos");
  const pagamentos = body.eventos.filter((e) => e.codigo === "pagamento_confirmado");
  ok(pagamentos.length === 1, "5: pagamento compartilhado aparece exatamente 1 vez no array de eventos (nunca duplicado)");
  ok(pagamentos[0].token_id === null, "5: evento de pagamento compartilhado nao tem token_id de nenhum filho especifico");

  const { semFilho, porFilho } = agruparPorAcesso(body.eventos, body.filhos);
  ok(semFilho.length === 2, "5: 2 eventos compartilhados (cobranca_pix_criada + pagamento_confirmado), sem token_id de filho");
  ok(!semFilho.some((e) => e.codigo.startsWith("processamento") || e.codigo.startsWith("vencimento")), "5: eventos de processamento/vencimento NUNCA caem no grupo compartilhado");
  ok(porFilho.get(f1.id).length === 2 && porFilho.get(f2.id).length === 2 && porFilho.get(f3.id).length === 2, "5: cada filho tem exatamente os 2 eventos dele, nenhum evento de outro filho misturado");
  ok(
    porFilho.get(f1.id).every((e) => e.token_id === f1.id) && porFilho.get(f3.id).every((e) => e.token_id === f3.id),
    "5: nenhum evento do filho 1 aparece no grupo do filho 3 (isolamento por acesso dentro do lote)",
  );

  // Causa raiz do filho que falhou: o erro REAL (sessao expirada),
  // nunca o resultado_gravado_falha que so' registra o desfecho.
  const raizF3 = encontrarRaiz(porFilho.get(f3.id));
  ok(raizF3?.codigo === "processamento_sessao_expirada", "5: causa raiz do filho 3 -- processamento_sessao_expirada, nao resultado_gravado_falha");
}

// =====================================================================
// 6. Nao encontrado
// =====================================================================
{
  resetTudo();
  autenticar();
  const idInexistente = "99999999-9999-9999-9999-999999999999";
  const respToken = await handler(req({ query: `?token_id=${idInexistente}` }));
  const bodyToken = await corpoJson(respToken);
  ok(respToken.status === 404, "6a: token_id valido mas inexistente -> 404");
  ok(bodyToken.outcome === "nao_encontrado", "6a: outcome nao_encontrado");

  const respGrupo = await handler(req({ query: `?grupo_id=${idInexistente}` }));
  const bodyGrupo = await corpoJson(respGrupo);
  ok(respGrupo.status === 404, "6b: grupo_id valido mas inexistente -> 404");
  ok(bodyGrupo.outcome === "nao_encontrado", "6b: outcome nao_encontrado");
}

// =====================================================================
// 7. Tratamento de erro (banco indisponivel)
// =====================================================================
{
  resetTudo();
  autenticar();
  const t = avulsa({ estado: "autorizada" });
  supa.seed("tokens_renovacao", [t]);
  supa.definirErroTabela("tokens_renovacao", "conexao recusada");
  const resp = await handler(req({ query: `?token_id=${t.id}` }));
  const body = await corpoJson(resp);
  ok(resp.status === 503, "7a: erro ao buscar o token -> 503");
  ok(body.outcome === "unavailable", "7a: outcome unavailable");
}
{
  resetTudo();
  autenticar();
  const grupoId = crypto.randomUUID();
  supa.seed("renovacoes_lote", [loteCapa({ grupo_id: grupoId })]);
  supa.definirErroTabela("renovacao_eventos", "conexao recusada");
  const resp = await handler(req({ query: `?grupo_id=${grupoId}` }));
  ok(resp.status === 503, "7b: lote encontrado mas erro ao buscar a timeline de eventos -> 503 (nao devolve resposta parcial)");
}
{
  resetTudo();
  autenticar();
  const grupoId = crypto.randomUUID();
  supa.definirErroTabela("renovacoes_lote", "conexao recusada");
  const resp = await handler(req({ query: `?grupo_id=${grupoId}` }));
  ok(resp.status === 503, "7c: erro ao buscar a capa do lote -> 503");
}

// =====================================================================
// 8. Sanitizacao -- nunca vaza token_hash nem campo fora do contrato
// =====================================================================
{
  resetTudo();
  autenticar();
  const t = avulsa({ estado: "renovacao_concluida" });
  supa.seed("tokens_renovacao", [t]);
  const resp = await handler(req({ query: `?token_id=${t.id}` }));
  const bruto = await resp.text();
  ok(!bruto.includes("hash-secreto-"), "8a: token_hash nunca aparece na resposta de avulsa");

  const body = JSON.parse(bruto);
  const CHAVES_RESUMO_AVULSA = ["clienteNome", "telefone", "servidor", "plano", "qtdAcessos", "valorFormatado", "resultado", "estadoBruto", "criadoEm", "quandoFormatado", "vencimentoFormatado", "motivoFalha"].sort();
  ok(JSON.stringify(Object.keys(body.resumo).sort()) === JSON.stringify(CHAVES_RESUMO_AVULSA), "8b: resumo de avulsa expõe exatamente o conjunto de campos do contrato");
}
{
  resetTudo();
  autenticar();
  const grupoId = crypto.randomUUID();
  supa.seed("renovacoes_lote", [loteCapa({ grupo_id: grupoId })]);
  supa.seed("tokens_renovacao", [filho(grupoId)]);
  const resp = await handler(req({ query: `?grupo_id=${grupoId}` }));
  const bruto = await resp.text();
  ok(!bruto.includes("hash-lote-secreto-") && !bruto.includes("hash-filho-secreto-"), "8c: token_hash (capa e filho) nunca aparece na resposta de lote");

  const body = JSON.parse(bruto);
  const CHAVES_RESUMO_LOTE = ["clienteNome", "telefone", "qtdAcessos", "valorFormatado", "resultado", "estadoBruto", "criadoEm", "quandoFormatado"].sort();
  ok(JSON.stringify(Object.keys(body.resumo).sort()) === JSON.stringify(CHAVES_RESUMO_LOTE), "8d: resumo de lote expõe exatamente o conjunto de campos do contrato (sem vencimentoFormatado/motivoFalha -- so' existem por filho)");
  const CHAVES_FILHO = ["tokenId", "servidorNome", "planoNome", "tipo", "estado", "resultado", "vencimentoFormatado", "motivoFalha"].sort();
  ok(JSON.stringify(Object.keys(body.filhos[0]).sort()) === JSON.stringify(CHAVES_FILHO), "8e: cada filho expõe exatamente o conjunto de campos do contrato");
}
{
  // Camada de leitura defensiva (2026-09-14, corrigido a pedido do
  // usuario apos a lacuna documentada na rodada anterior de testes):
  // buscarEventosPorCorrelacao agora reaplica sanitizarDetalhe -- a
  // MESMA funcao/politica ja usada na escrita (registrarEvento), nunca
  // uma politica nova -- em cima de `detalhe` antes de devolver ao
  // Painel. Simula um evento "gravado indevidamente" (bypassando
  // registrarEvento -- migracao manual, bug futuro, etc.) com todos os
  // campos que o usuario pediu explicitamente pra nunca vazar.
  resetTudo();
  autenticar();
  const t = avulsa({ estado: "autorizada" });
  supa.seed("tokens_renovacao", [t]);
  supa.seed("renovacao_eventos", [
    evento({
      token_id: t.id,
      criado_em: iso(1),
      detalhe: {
        // Campos de negocio legitimos -- devem SOBREVIVER a sanitizacao.
        plano: "Mensal",
        valor_centavos: 3500,
        // Campos sensiveis "gravados indevidamente" -- nenhum pode
        // sobreviver, mesmo vindo direto do banco (bypass de registrarEvento).
        senha: "abc123",
        password: "abc123",
        token: "tok-bruto-do-cliente",
        access_token: "tok-de-acesso",
        api_key: "sk-xxxxxxxx",
        apiKey: "sk-yyyyyyyy",
        qrCodeTexto: "00020126...brcode-completo",
        brCode: "00020126...brcode-completo",
        paymentLinkUrl: "https://openpix.com.br/pay/abc123",
        dealer_token: "dealer-secreto",
        Authorization: "Bearer segredo-de-outro-sistema",
        service_role_key: "eyJ...",
        cookie: "sessionid=abc",
      },
    }),
  ]);
  const body = await corpoJson(await handler(req({ query: `?token_id=${t.id}` })));
  const detalhe = body.eventos[0].detalhe;
  ok(detalhe.plano === "Mensal" && detalhe.valor_centavos === 3500, "8f: campos de negocio legitimos continuam presentes apos a camada defensiva");
  // "credenciais" (categoria generica citada pelo usuario) nao entra
  // como campo literal aqui de proposito -- nao e' um nome de campo que
  // este codebase realmente produz em algum `detalhe` (ao contrario de
  // paymentLinkUrl, que E' usado em _shared/renovacao_confirmacao.ts).
  // A categoria "credencial" ja esta' coberta pelos campos concretos
  // abaixo (senha/token/api_key/dealer_token/Authorization/service_role) --
  // adicionar um padrao so' pra bater com a palavra "credenciais" seria
  // inventar politica nova sem um caso real por tras.
  for (const campoProibido of [
    "senha", "password", "token", "access_token", "api_key", "apiKey",
    "qrCodeTexto", "brCode", "paymentLinkUrl", "dealer_token", "Authorization",
    "service_role_key", "cookie",
  ]) {
    ok(!(campoProibido in detalhe), `8g: campo '${campoProibido}' nunca chega ao painel, mesmo gravado indevidamente no banco (camada de leitura defensiva)`);
  }
  const bruto2 = JSON.stringify(body);
  ok(!bruto2.includes("abc123") && !bruto2.includes("sk-xxxxxxxx") && !bruto2.includes("openpix.com.br/pay"), "8h: nenhum VALOR sensivel sobrevive na resposta bruta (nao so' a chave, o valor tambem some)");
}

// =====================================================================
// 9. Correlacao por operacao -- agora suportada em buscarEventosPorCorrelacao
// =====================================================================
{
  // 9a/9b: evento gravado SO' com operacao_id (padrao real de
  // openpix-webhook quando o correlation_id do webhook ainda nao
  // resolveu nenhum token/grupo -- ver openpix-webhook/index.ts:109/139)
  // agora E' encontrado, desde que o mesmo operacao_id esteja vinculado
  // ao lote/token consultado.
  resetTudo();
  autenticar();
  const grupoId = crypto.randomUUID();
  const capa = loteCapa({ grupo_id: grupoId, operacao_id: "op-visivel-456" });
  supa.seed("renovacoes_lote", [capa]);
  supa.seed("tokens_renovacao", [filho(grupoId)]);
  supa.seed("renovacao_eventos", [
    evento({ operacao_id: "op-visivel-456", grupo_id: null, token_id: null, sessao_id: null, criado_em: iso(1), etapa: "pagamento", codigo: "pagamento_sem_registro_local", nivel: "erro" }),
  ]);

  const body = await corpoJson(await handler(req({ query: `?grupo_id=${grupoId}` })));
  ok(body.ids.operacaoId === "op-visivel-456", "9a: operacao_id continua exibido em ids.operacaoId");
  ok(
    body.eventos.some((e) => e.codigo === "pagamento_sem_registro_local"),
    "9b: evento gravado SO' com operacao_id agora APARECE na timeline (correlacao por operacao_id funcional)",
  );
}
{
  // 9c: token_id/grupo_id continuam funcionando exatamente como antes
  // (regressao explicita, avulsa E lote, na MESMA chamada que agora
  // tambem aceita operacaoId).
  resetTudo();
  autenticar();
  const t = avulsa({ estado: "autorizada", operacao_id: null });
  supa.seed("tokens_renovacao", [t]);
  supa.seed("renovacao_eventos", [evento({ token_id: t.id, criado_em: iso(1), codigo: "carrinho_token_criado", etapa: "carrinho" })]);
  const bodyAvulsa = await corpoJson(await handler(req({ query: `?token_id=${t.id}` })));
  ok(bodyAvulsa.eventos.length === 1 && bodyAvulsa.eventos[0].codigo === "carrinho_token_criado", "9c: avulsa sem operacao_id -- correlacao por token_id sozinho continua funcionando");

  const grupoId2 = crypto.randomUUID();
  supa.seed("renovacoes_lote", [loteCapa({ grupo_id: grupoId2, operacao_id: null })]);
  supa.seed("tokens_renovacao", [filho(grupoId2)]);
  supa.seed("renovacao_eventos", [evento({ grupo_id: grupoId2, criado_em: iso(1), codigo: "cobranca_pix_criada", etapa: "cobranca_pix" })]);
  const bodyLote = await corpoJson(await handler(req({ query: `?grupo_id=${grupoId2}` })));
  ok(bodyLote.eventos.length === 1 && bodyLote.eventos[0].codigo === "cobranca_pix_criada", "9d: lote sem operacao_id -- correlacao por grupo_id sozinho continua funcionando");
}
{
  // 9e: mistura dos 4 correlatores numa unica renovacao -- prova que
  // eventos por sessao_id, token_id e operacao_id se somam sem
  // duplicar e sem vazar nada de outra renovacao (a soma dos 3 filtros
  // e' uniao via OR, nao intersecao).
  resetTudo();
  autenticar();
  const sessaoId2 = "33333333-3333-3333-3333-333333333333";
  const t2 = avulsa({ estado: "renovacao_concluida", sessao_id: sessaoId2, operacao_id: "op-mix-789" });
  supa.seed("tokens_renovacao", [t2]);
  supa.seed("renovacao_eventos", [
    evento({ sessao_id: sessaoId2, criado_em: iso(1), codigo: "portal_acessado", etapa: "entrada" }),
    evento({ token_id: t2.id, criado_em: iso(2), codigo: "carrinho_token_criado", etapa: "carrinho" }),
    evento({ operacao_id: "op-mix-789", criado_em: iso(3), codigo: "pagamento_confirmado", etapa: "pagamento" }),
  ]);
  const bodyMix = await corpoJson(await handler(req({ query: `?token_id=${t2.id}` })));
  ok(bodyMix.eventos.length === 3, "9e: eventos correlacionados pelos 3 identificadores diferentes (sessao/token/operacao) aparecem juntos, sem duplicar");
}
{
  // 9f: ausencia de eventos -- token/lote existe, mas renovacao_eventos
  // nao tem NENHUMA linha pra nenhum dos 4 identificadores -- deve
  // continuar outcome success com eventos: [], nunca erro.
  resetTudo();
  autenticar();
  const tSemEventos = avulsa({ estado: "autorizada", sessao_id: null, operacao_id: null });
  supa.seed("tokens_renovacao", [tSemEventos]);
  const bodySemEventos = await corpoJson(await handler(req({ query: `?token_id=${tSemEventos.id}` })));
  ok(bodySemEventos.outcome === "success", "9g: token existe mas sem nenhum evento -- ainda outcome success (nao e' erro)");
  ok(Array.isArray(bodySemEventos.eventos) && bodySemEventos.eventos.length === 0, "9h: eventos: [] quando nao ha' nenhuma linha correlacionavel");

  const grupoSemEventos = crypto.randomUUID();
  supa.seed("renovacoes_lote", [loteCapa({ grupo_id: grupoSemEventos, operacao_id: null, sessao_id: null })]);
  supa.seed("tokens_renovacao", [filho(grupoSemEventos)]);
  const bodyLoteSemEventos = await corpoJson(await handler(req({ query: `?grupo_id=${grupoSemEventos}` })));
  ok(bodyLoteSemEventos.outcome === "success" && bodyLoteSemEventos.eventos.length === 0, "9i: lote existe mas sem nenhum evento -- outcome success, eventos: []");
}

// =====================================================================
// 10. Veredito/causa raiz -- mesma logica do mockup v4 aprovado
//     (encontrarRaiz, copiada fielmente no topo deste arquivo)
// =====================================================================
const CENARIOS_RAIZ = [
  {
    nome: "10a: Woovi/OpenPix -- cobranca_pix_falhou antes do callback",
    eventos: [
      evento({ criado_em: iso(1), etapa: "cobranca_pix", codigo: "cobranca_pix_falhou", nivel: "erro" }),
      evento({ criado_em: iso(2), etapa: "callback_resultado", codigo: "resultado_gravado_falha", nivel: "erro" }),
    ],
    raizEsperada: "cobranca_pix_falhou",
  },
  {
    nome: "10b: Rocket -- processamento_cliente_rocket_falhou antes do callback",
    eventos: [
      evento({ criado_em: iso(1), etapa: "processamento", codigo: "processamento_cliente_rocket_falhou", nivel: "erro" }),
      evento({ criado_em: iso(2), etapa: "callback_resultado", codigo: "resultado_gravado_falha", nivel: "erro" }),
    ],
    raizEsperada: "processamento_cliente_rocket_falhou",
  },
  {
    nome: "10c: Sigma -- processamento_sessao_expirada antes do callback",
    eventos: [
      evento({ criado_em: iso(1), etapa: "processamento", codigo: "processamento_sessao_expirada", nivel: "erro", servidor: "sigma" }),
      evento({ criado_em: iso(2), etapa: "callback_resultado", codigo: "resultado_gravado_falha", nivel: "erro" }),
    ],
    raizEsperada: "processamento_sessao_expirada",
  },
  {
    nome: "10d: UniTV -- processamento_painel_indisponivel antes do callback",
    eventos: [
      evento({ criado_em: iso(1), etapa: "processamento", codigo: "processamento_painel_indisponivel", nivel: "erro", servidor: "unitv" }),
      evento({ criado_em: iso(2), etapa: "callback_resultado", codigo: "resultado_gravado_falha", nivel: "erro" }),
    ],
    raizEsperada: "processamento_painel_indisponivel",
  },
  {
    nome: "10e: callback genuinamente a causa -- unico erro e' do proprio callback",
    eventos: [
      evento({ criado_em: iso(1), etapa: "identificacao", codigo: "identificacao_sucesso", nivel: "info" }),
      evento({ criado_em: iso(2), etapa: "callback_resultado", codigo: "callback_sem_token_correspondente", nivel: "erro" }),
    ],
    raizEsperada: "callback_sem_token_correspondente",
  },
];
for (const cenario of CENARIOS_RAIZ) {
  const raiz = encontrarRaiz(cenario.eventos);
  ok(raiz?.codigo === cenario.raizEsperada, `${cenario.nome} -> raiz correta (${cenario.raizEsperada}, nao resultado_gravado_falha)`);
}
// Fim-a-fim atraves do endpoint real (nao so' a funcao pura acima):
// seed um token avulsa cuja falha REAL antecede o callback, confirma
// que o backend devolve os eventos em ordem tal que encontrarRaiz()
// aplicada em cima do `body.eventos` real acha o erro certo.
{
  resetTudo();
  autenticar();
  const t = avulsa({ estado: "renovacao_falhou", motivo_falha: "renovacao_sigma:sessao_expirada" });
  supa.seed("tokens_renovacao", [t]);
  supa.seed("renovacao_eventos", [
    evento({ token_id: t.id, criado_em: iso(1), etapa: "processamento", codigo: "processamento_iniciado", nivel: "info" }),
    evento({ token_id: t.id, criado_em: iso(2), etapa: "processamento", codigo: "processamento_sessao_expirada", nivel: "erro", servidor: "sigma" }),
    evento({ token_id: t.id, criado_em: iso(3), etapa: "callback_resultado", codigo: "resultado_gravado_falha", nivel: "erro" }),
  ]);
  const body = await corpoJson(await handler(req({ query: `?token_id=${t.id}` })));
  const raiz = encontrarRaiz(body.eventos);
  ok(raiz?.codigo === "processamento_sessao_expirada", "10f: fim-a-fim via endpoint real -- raiz = erro real do Sigma, resultado_gravado_falha corretamente descartado");
}

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
