// Testes locais de supabase/functions/renovacao-iniciar/index.ts (REAL) --
// Portal de Renovacao Tope TV (topetv.com.br/renovacao).
//
// Checkpoint 4A: GET (formulario) + POST etapa=telefone (identificacao
// direto no Rocket + lista de acessos com checkbox).
// Checkpoint 4B: POST etapa=carrinho (selecao -> criacao de
// tokens_renovacao/renovacoes_lote). Nenhuma cobranca ainda -- isso e'
// so' no ACEITO (Checkpoint 4C, confirmarRenovacao()).
//
// So' o supabase_client e' fake (via mock-loader) -- tokens_renovacao.ts,
// renovacoes_lote.ts e conversas_estado.ts sao os modulos REAIS. fetch e
// Deno.env sao mockados globalmente (Rocket real nao e' chamado).
//
// Como rodar: npx tsx scripts/testes/renovacao_iniciar/teste.mjs

import { register } from "node:module";
register("./mock-loader.mjs", import.meta.url);

const { resetar: resetarDb, seed, lerTabela, configurarRateLimit } = await import("./fake_supabase_client.mjs");
const { resetar: resetarConfirmacao, configurar: configurarConfirmacao, chamadas: chamadasConfirmacao } =
  await import("./fake_renovacao_confirmacao.mjs");

const ENV = {
  ROCKET_BASE_URL: "https://rocket.example.test",
  ROCKET_API_KEY: "api-key-de-teste",
  SUPABASE_URL: "https://supabase.example.test",
  RENOVACAO_SIGMA_CALLBACK_TOKEN: "callback-token-de-teste",
};

let handler;
let respostasLista = [];
let respostasDetalhe = {};
let respostasUnitvConta = {}; // sn -> resposta de renovacao-unitv-conta
let urlsChamadas = [];

globalThis.Deno = {
  serve: (fn) => { handler = fn; },
  env: { get: (k) => ENV[k] },
};

function fetchPadrao() {
  return async (url) => {
    const u = String(url);
    urlsChamadas.push(u);
    if (u.includes("/gerenciador/api/v1/clientes/")) {
      const resp = respostasLista.shift() ?? { paginacao: { total: 0 }, itens: [] };
      return { ok: true, status: 200, json: async () => resp };
    }
    if (u.includes("/gerenciador/api/v1/cliente/")) {
      const id = u.split("/cliente/")[1];
      const r = respostasDetalhe[id];
      if (!r) return { ok: true, status: 404, json: async () => ({ detail: "nao encontrado" }) };
      return { ok: true, status: 200, json: async () => r };
    }
    if (u.includes("/functions/v1/renovacao-unitv-conta")) {
      // sn vai no corpo, nao na URL -- resolvido no chamador do fetch
      // (ver override especifico abaixo, quando precisamos do sn).
      return { ok: true, status: 200, json: async () => ({ outcome: "indisponivel" }) };
    }
    throw new Error("URL inesperada no fake: " + u);
  };
}
globalThis.fetch = fetchPadrao();

await import("../../../supabase/functions/renovacao-iniciar/index.ts");

let falhas = 0;
let total = 0;
function ok(cond, msg) {
  total++;
  if (cond) console.log("ok:", msg);
  else { falhas++; console.error("FALHA:", msg); }
}

function resetar() {
  respostasLista = [];
  respostasDetalhe = {};
  respostasUnitvConta = {};
  urlsChamadas = [];
  resetarDb();
  resetarConfirmacao();
  globalThis.fetch = fetchPadrao();
}

function reqGet() {
  return new Request("https://x.test/renovacao-iniciar", { method: "GET" });
}
function reqPostForm(campos) {
  const params = new URLSearchParams();
  for (const [chave, valor] of campos) params.append(chave, valor);
  return new Request("https://x.test/renovacao-iniciar", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
}

function clienteDetalhe(overrides = {}) {
  return {
    cliente: {
      nome: "Cliente Teste",
      servidor: { nome: "BLAZE" },
      plano: { nome: "Mensal" },
      valor: "35.00",
      vencimento: "2027-01-13T23:59:00-03:00",
      usuario: "828667229",
      senha: "SENHA-SECRETA-NUNCA-DEVE-APARECER",
      device_key_or_OTP_code: "DEVKEY-NUNCA-DEVE-APARECER",
      ...overrides,
    },
  };
}

// =======================================================================
// Checkpoint 4A -- regressao (mesmos casos de antes, formulario mudou
// pra lista de pares em vez de objeto, mas o comportamento e' o mesmo).
// =======================================================================
{
  resetar();
  const resp = await handler(reqGet());
  const html = await resp.text();
  ok(resp.status === 200, "4A GET: HTTP 200");
  ok(html.includes('name="telefone"'), "4A GET: formulario de telefone presente");
}

{
  resetar();
  respostasLista.push({ paginacao: { total: 0 }, itens: [] });
  const resp = await handler(reqPostForm([["etapa", "telefone"], ["telefone", "17999999999"]]));
  const html = await resp.text();
  ok(html.includes("Não encontramos"), "4A no_match: pagina de nao encontrado");
}

{
  resetar();
  respostasLista.push({ paginacao: { total: 1 }, itens: [{ id: "pub-1", nome: "José Antônio", usuario: "828667229" }] });
  respostasDetalhe["pub-1"] = clienteDetalhe();
  const resp = await handler(reqPostForm([["etapa", "telefone"], ["telefone", "17999999999"]]));
  const html = await resp.text();
  ok(html.includes("BLAZE") && html.includes('value="pub-1"'), "4A single_match: carrinho renderizado");
  ok(html.includes('name="etapa" value="carrinho"'), "4A single_match: formulario aponta pra etapa=carrinho");
  ok(!html.includes("SENHA-SECRETA-NUNCA-DEVE-APARECER"), "4A single_match: senha NUNCA aparece no HTML");
  ok(!html.includes("DEVKEY-NUNCA-DEVE-APARECER"), "4A single_match: device_key NUNCA aparece no HTML");

  // Correcao de UX (Checkpoint 7, apos teste real): checkbox NUNCA nasce
  // marcado, e o botao Continuar nasce desabilitado -- nao pode dar a
  // impressao de "todos serao renovados".
  ok(!/<input type="checkbox"[^>]*checked/.test(html), "4A single_match: checkbox NUNCA nasce marcado");
  ok(/id="btn-continuar"[^>]*disabled/.test(html), "4A single_match: botao Continuar nasce desabilitado");
  ok(html.includes("Selecione abaixo quais acessos"), "4A single_match: texto explicativo de selecao presente");
  ok(html.includes("Selecione pelo menos um acesso"), "4A single_match: aviso de selecao minima presente");
}

{
  resetar();
  respostasLista.push({ paginacao: { total: 0 }, itens: [] });
  const respNoMatch = await handler(reqPostForm([["etapa", "telefone"], ["telefone", "17999999999"]]));
  const htmlNoMatch = await respNoMatch.text();

  resetar();
  globalThis.fetch = async () => { throw new Error("Rocket fora do ar"); };
  const respUnavailable = await handler(reqPostForm([["etapa", "telefone"], ["telefone", "17999999999"]]));
  const htmlUnavailable = await respUnavailable.text();
  ok(htmlUnavailable === htmlNoMatch, "4A unavailable: mesmo HTML exato de no_match (anti-enumeracao)");
  globalThis.fetch = fetchPadrao();
}

{
  resetar();
  respostasLista.push({
    paginacao: { total: 2 },
    itens: [
      { id: "pub-C", nome: "Cliente Completo", usuario: "usuarioC" },
      { id: "pub-D", nome: "Cliente Incompleto", usuario: "usuarioD" },
    ],
  });
  respostasDetalhe["pub-C"] = clienteDetalhe({ servidor: { nome: "UNITV" } });
  // pub-D: sem entrada em respostasDetalhe -> 404 -> consultarClienteCompletoRocket = unavailable -> descartado
  const resp = await handler(reqPostForm([["etapa", "telefone"], ["telefone", "17999999999"]]));
  const html = await resp.text();
  ok(html.includes('value="pub-C"'), "4A dado incompleto: candidato completo aparece");
  ok(!html.includes('value="pub-D"'), "4A dado incompleto: candidato incompleto e' descartado, nunca exibido");
}

{
  // O card agora usa o SERVIDOR como titulo (correcao de UX, Checkpoint 7)
  // -- e' o campo relevante para testar escaping aqui, ja que o nome do
  // cliente deixou de ser exibido por item.
  resetar();
  respostasLista.push({ paginacao: { total: 1 }, itens: [{ id: "pub-F", nome: "Cliente Teste", usuario: "u" }] });
  respostasDetalhe["pub-F"] = clienteDetalhe({ servidor: { nome: "<script>alert(1)</script>" } });
  const resp = await handler(reqPostForm([["etapa", "telefone"], ["telefone", "17999999999"]]));
  const html = await resp.text();
  ok(!html.includes("<script>alert(1)</script>"), "4A escaping: servidor com HTML nunca aparece cru na pagina");
  ok(html.includes("&lt;script&gt;"), "4A escaping: servidor com HTML aparece escapado");
}

// =======================================================================
// Checkpoint 4B -- etapa=carrinho
// =======================================================================

// -----------------------------------------------------------------------
// 1 item selecionado -- caminho INDIVIDUAL (tokens_renovacao), sem lote.
// -----------------------------------------------------------------------
{
  resetar();
  respostasLista.push({ paginacao: { total: 1 }, itens: [{ id: "pub-1", nome: "José Antônio", usuario: "828667229" }] });
  respostasDetalhe["pub-1"] = clienteDetalhe();

  const resp = await handler(reqPostForm([
    ["etapa", "carrinho"],
    ["telefone", "5517999999999"],
    ["publicId", "pub-1"],
  ]));
  const html = await resp.text();
  ok(resp.status === 200, "4B individual: HTTP 200");
  ok(html.includes("Confirme sua renovação"), "4B individual: tela de conferencia renderizada");
  ok(html.includes("BLAZE"), "4B individual: servidor exibido na conferencia");
  ok(html.includes("35,00"), "4B individual: total exibido");
  ok(html.includes("828667229"), "4B individual: usuario do acesso exibido individualmente na conferencia");
  ok(html.includes("1 acesso selecionado"), "4B individual: resumo no singular");
  ok(html.includes("Total a pagar"), "4B individual: rotulo 'Total a pagar' presente");
  ok(html.includes("gerada uma cobrança Pix"), "4B individual: texto explicativo do Pix presente");
  ok(html.includes('name="etapa" value="confirmar"'), "4B individual: formulario aponta pra etapa=confirmar");
  ok(html.includes('name="acao" value="aceitar"') && html.includes('name="acao" value="cancelar"'), "4B individual: botoes ACEITO e CANCELAR presentes");

  const tokens = lerTabela("tokens_renovacao");
  ok(tokens.length === 1, "4B individual: exatamente 1 linha criada em tokens_renovacao");
  ok(tokens[0].grupo_id == null, "4B individual: grupo_id null (nao e' lote)");
  ok(tokens[0].public_id === "pub-1", "4B individual: public_id correto");
  ok(tokens[0].valor_esperado_centavos === 3500, "4B individual: valor em centavos correto (35.00 -> 3500)");
  ok(tokens[0].estado === "aguardando_confirmacao", "4B individual: token nasce aguardando_confirmacao");
  ok(lerTabela("renovacoes_lote").length === 0, "4B individual: nenhuma linha criada em renovacoes_lote");

  const conversas = lerTabela("conversas_estado");
  ok(conversas.length === 1 && conversas[0].telefone === "5517999999999", "4B individual: conversa criada/reaproveitada pelo telefone certo");
}

// -----------------------------------------------------------------------
// 2 itens selecionados -- caminho de LOTE (renovacoes_lote), 1 unica
// cobranca pelo total (a cobranca em si so' e' criada no ACEITO, 4C --
// aqui so' confere a "capa" + os 2 filhos).
// -----------------------------------------------------------------------
{
  resetar();
  respostasLista.push({
    paginacao: { total: 2 },
    itens: [
      { id: "pub-A", nome: "Cliente A", usuario: "usuarioA" },
      { id: "pub-B", nome: "Cliente B", usuario: "usuarioB" },
    ],
  });
  respostasDetalhe["pub-A"] = clienteDetalhe({ servidor: { nome: "BLAZE" }, valor: "35.00" });
  respostasDetalhe["pub-B"] = clienteDetalhe({ servidor: { nome: "NewOne" }, valor: "35.00" });

  const resp = await handler(reqPostForm([
    ["etapa", "carrinho"],
    ["telefone", "5517999999999"],
    ["publicId", "pub-A"],
    ["publicId", "pub-B"],
  ]));
  const html = await resp.text();
  ok(resp.status === 200, "4B lote: HTTP 200");
  ok(html.includes("BLAZE") && html.includes("NewOne"), "4B lote: os 2 servidores aparecem na conferencia");
  ok(html.includes("70,00"), "4B lote: total somado (35 + 35 = 70,00)");
  ok(html.includes("2 acessos selecionados"), "4B lote: resumo no plural, com a quantidade certa");
  ok(html.includes("Total a pagar"), "4B lote: rotulo 'Total a pagar' presente");

  const lotes = lerTabela("renovacoes_lote");
  ok(lotes.length === 1, "4B lote: exatamente 1 linha criada em renovacoes_lote (capa)");
  ok(lotes[0].valor_total_centavos === 7000, "4B lote: valor_total_centavos correto");
  ok(lotes[0].regra_aplicada === "soma_valores_rocket", "4B lote: regra_aplicada reaproveitada");

  const filhos = lerTabela("tokens_renovacao").filter((t) => t.grupo_id === lotes[0].grupo_id);
  ok(filhos.length === 2, "4B lote: exatamente 2 filhos em tokens_renovacao, com o grupo_id da capa");
}

// -----------------------------------------------------------------------
// Seguranca -- publicId fora do conjunto autoritativo (tamperado no
// formulario) e' ignorado, nunca usado pra criar token.
// -----------------------------------------------------------------------
{
  resetar();
  respostasLista.push({ paginacao: { total: 1 }, itens: [{ id: "pub-1", nome: "José Antônio", usuario: "828667229" }] });
  respostasDetalhe["pub-1"] = clienteDetalhe();
  // publicId forjado, nunca fez parte da lista deste telefone.
  respostasDetalhe["pub-FORJADO"] = clienteDetalhe({ servidor: { nome: "OUTRO-SERVIDOR" } });

  const resp = await handler(reqPostForm([
    ["etapa", "carrinho"],
    ["telefone", "5517999999999"],
    ["publicId", "pub-1"],
    ["publicId", "pub-FORJADO"],
  ]));
  const html = await resp.text();
  ok(!html.includes("OUTRO-SERVIDOR"), "4B seguranca: publicId forjado nunca aparece na conferencia");

  const tokens = lerTabela("tokens_renovacao");
  ok(tokens.length === 1 && tokens[0].public_id === "pub-1", "4B seguranca: so' o publicId legitimo vira token");
}

// -----------------------------------------------------------------------
// Nenhum publicId selecionado -- erro generico, nenhum token criado.
// -----------------------------------------------------------------------
{
  resetar();
  const resp = await handler(reqPostForm([["etapa", "carrinho"], ["telefone", "5517999999999"]]));
  const html = await resp.text();
  ok(html.includes("Não foi possível continuar"), "4B sem selecao: erro generico");
  ok(lerTabela("tokens_renovacao").length === 0, "4B sem selecao: nenhum token criado");
}

// -----------------------------------------------------------------------
// Ja existe token ativo pro publicId -- rejeita, nao cria outro (mesmo
// indice unico parcial ja usado no fluxo WhatsApp).
// -----------------------------------------------------------------------
{
  resetar();
  respostasLista.push({ paginacao: { total: 1 }, itens: [{ id: "pub-1", nome: "José Antônio", usuario: "828667229" }] });
  respostasDetalhe["pub-1"] = clienteDetalhe();
  seed("tokens_renovacao", [{
    id: "tok-existente", token_hash: "hash-existente", conversation_id: "conv-x",
    public_id: "pub-1", telefone: "5517999999999", cliente_nome: "X", servidor_nome: "BLAZE",
    plano_nome: "Mensal", valor_esperado_centavos: 3500, vencimento_atual: "2027-01-13T23:59:00-03:00",
    estado: "autorizada", criado_em: new Date().toISOString(), expira_em: new Date().toISOString(),
    grupo_id: null, tipo: "sigma",
  }]);

  const resp = await handler(reqPostForm([
    ["etapa", "carrinho"], ["telefone", "5517999999999"], ["publicId", "pub-1"],
  ]));
  const html = await resp.text();
  ok(html.includes("Já existe uma renovação em andamento"), "4B duplicado: mensagem de renovacao ja em andamento");
  ok(lerTabela("tokens_renovacao").length === 1, "4B duplicado: nenhum token novo criado (continua so' o existente)");
}

// -----------------------------------------------------------------------
// UniTV -- classificacao correta + resolucao de conta via
// renovacao-unitv-conta (chamada interna, nunca fala com o Rocket
// diretamente pra isso).
// -----------------------------------------------------------------------
{
  resetar();
  respostasLista.push({ paginacao: { total: 1 }, itens: [{ id: "pub-unitv", nome: "Cliente UniTV", usuario: "3tnjsc" }] });
  respostasDetalhe["pub-unitv"] = clienteDetalhe({ servidor: { nome: "UNITV" }, usuario: "3tnjsc" });

  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    urlsChamadas.push(u);
    if (u.includes("/gerenciador/api/v1/clientes/")) {
      const resp = respostasLista.shift() ?? { paginacao: { total: 0 }, itens: [] };
      return { ok: true, status: 200, json: async () => resp };
    }
    if (u.includes("/gerenciador/api/v1/cliente/")) {
      const id = u.split("/cliente/")[1];
      const r = respostasDetalhe[id];
      if (!r) return { ok: true, status: 404, json: async () => ({ detail: "nao encontrado" }) };
      return { ok: true, status: 200, json: async () => r };
    }
    if (u.includes("/functions/v1/renovacao-unitv-conta")) {
      const corpo = JSON.parse(opts.body);
      ok(corpo.sn === "3tnjsc", "4B UniTV: sn correto enviado a renovacao-unitv-conta");
      return { ok: true, status: 200, json: async () => ({ outcome: "resolvido", id: 4242 }) };
    }
    throw new Error("URL inesperada: " + u);
  };

  const resp = await handler(reqPostForm([
    ["etapa", "carrinho"], ["telefone", "5517999999999"], ["publicId", "pub-unitv"],
  ]));
  ok(resp.status === 200, "4B UniTV: HTTP 200");

  const tokens = lerTabela("tokens_renovacao");
  ok(tokens.length === 1 && tokens[0].tipo === "unitv", "4B UniTV: token criado com tipo='unitv'");
  ok(tokens[0].unitv_sn === "3tnjsc" && tokens[0].unitv_id === 4242, "4B UniTV: unitv_sn/unitv_id resolvidos e gravados");
  ok(tokens[0].usuario == null, "4B UniTV: usuario (Sigma) fica null, o real e' unitv_sn");

  globalThis.fetch = fetchPadrao();
}

// -----------------------------------------------------------------------
// UniTV nao resolve (ambiguo/nao encontrado) -- rejeita, nenhum token.
// -----------------------------------------------------------------------
{
  resetar();
  respostasLista.push({ paginacao: { total: 1 }, itens: [{ id: "pub-unitv2", nome: "Cliente UniTV 2", usuario: "sn-x" }] });
  respostasDetalhe["pub-unitv2"] = clienteDetalhe({ servidor: { nome: "UNITV" }, usuario: "sn-x" });

  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/gerenciador/api/v1/clientes/")) {
      const resp = respostasLista.shift() ?? { paginacao: { total: 0 }, itens: [] };
      return { ok: true, status: 200, json: async () => resp };
    }
    if (u.includes("/gerenciador/api/v1/cliente/")) {
      const id = u.split("/cliente/")[1];
      const r = respostasDetalhe[id];
      return r ? { ok: true, status: 200, json: async () => r } : { ok: true, status: 404, json: async () => ({}) };
    }
    if (u.includes("/functions/v1/renovacao-unitv-conta")) {
      return { ok: true, status: 200, json: async () => ({ outcome: "ambiguo" }) };
    }
    throw new Error("URL inesperada: " + u);
  };

  const resp = await handler(reqPostForm([
    ["etapa", "carrinho"], ["telefone", "5517999999999"], ["publicId", "pub-unitv2"],
  ]));
  const html = await resp.text();
  ok(html.includes("Não conseguimos confirmar esse acesso"), "4B UniTV ambiguo: pagina de erro especifica");
  ok(lerTabela("tokens_renovacao").length === 0, "4B UniTV ambiguo: nenhum token criado");

  globalThis.fetch = fetchPadrao();
}

// =======================================================================
// Checkpoint 4C -- etapa=confirmar (ACEITO/CANCELAR -> Pix)
//
// confirmarRenovacao() e' um FAKE aqui (ver fake_renovacao_confirmacao.mjs)
// -- a logica real de pagamento/cobranca ja e' testada a fundo em outras
// suites (vinculo_operacao_renovacao: 24 testes; notificacao_transferencia_
// humana: 97 testes). O que interessa aqui e' so' a fronteira: chamado
// com os parametros certos, cada outcome vira o HTML certo, o token
// bruto nunca aparece numa URL/redirect.
// =======================================================================

// -----------------------------------------------------------------------
// ACEITO -> confirmada: tela do Pix com brCode/paymentLinkUrl/token
// embutidos (nunca em URL), script de QR e polling presentes.
// -----------------------------------------------------------------------
{
  resetar();
  configurarConfirmacao({
    outcome: "confirmada",
    operacaoId: "op-teste-1",
    brCode: "00020101BRCODETESTE",
    paymentLinkUrl: "https://openpix.com.br/pay/teste-1",
  });

  const resp = await handler(reqPostForm([
    ["etapa", "confirmar"], ["token", "token-bruto-teste"], ["telefone", "5517999999999"], ["acao", "aceitar"],
  ]));
  const html = await resp.text();
  ok(resp.status === 200, "4C aceito: HTTP 200 (nunca redirect -- pagina renderizada direto)");
  ok(html.includes("00020101BRCODETESTE"), "4C aceito: brCode aparece na pagina (copia e cola)");
  ok(html.includes("token-bruto-teste"), "4C aceito: token embutido na pagina/JS (necessario pro polling)");
  ok(!/href="[^"]*token-bruto-teste/.test(html), "4C aceito: token NUNCA aparece dentro de um href/URL");
  ok(html.includes("https://openpix.com.br/pay/teste-1"), "4C aceito: paymentLinkUrl presente (link alternativo)");
  ok(html.includes("QRCode("), "4C aceito: script de geracao do QR Code presente");
  ok(html.includes("/functions/v1/renovacao-status"), "4C aceito: polling aponta pro caminho relativo (same-origin)");
  ok(html.includes("fetch("), "4C aceito: polling via fetch (nao recarrega a pagina)");

  ok(chamadasConfirmacao.length === 1, "4C aceito: confirmarRenovacao chamada exatamente 1 vez");
  const chamada = chamadasConfirmacao[0];
  ok(chamada.acao === "aceitar", "4C aceito: acao=aceitar repassada corretamente");
  ok(chamada.origem === "link", "4C aceito: origem='link' (distingue do caminho WhatsApp)");
  ok(chamada.telefoneOrigem === "5517999999999", "4C aceito: telefoneOrigem repassado (camada extra de defesa)");
  ok(typeof chamada.tokenHash === "string" && chamada.tokenHash.length === 64, "4C aceito: tokenHash e' SHA-256 hex (64 chars), nunca o bruto");
  ok(chamada.tokenHash !== "token-bruto-teste", "4C aceito: tokenHash NUNCA e' igual ao token bruto");
}

// -----------------------------------------------------------------------
// CANCELAR -> cancelada.
// -----------------------------------------------------------------------
{
  resetar();
  configurarConfirmacao({ outcome: "cancelada" });
  const resp = await handler(reqPostForm([
    ["etapa", "confirmar"], ["token", "token-x"], ["acao", "cancelar"],
  ]));
  const html = await resp.text();
  ok(html.includes("Cancelado"), "4C cancelar: pagina de cancelamento");
  ok(chamadasConfirmacao[0].acao === "cancelar", "4C cancelar: acao=cancelar repassada");
}

// -----------------------------------------------------------------------
// Demais outcomes -- cada um vira a pagina certa, nenhuma excecao.
// -----------------------------------------------------------------------
const casos = [
  ["falha_cobranca", "Algo deu errado"],
  ["token_expirado", "Link expirado"],
  ["ja_decidido", "Já decidido"],
  ["token_inexistente", "Não foi possível continuar"],
  ["telefone_nao_confere", "Não foi possível continuar"],
];
for (const [outcome, textoEsperado] of casos) {
  resetar();
  configurarConfirmacao({ outcome });
  const resp = await handler(reqPostForm([
    ["etapa", "confirmar"], ["token", "token-x"], ["acao", "aceitar"],
  ]));
  const html = await resp.text();
  ok(html.includes(textoEsperado), `4C outcome '${outcome}': pagina com texto '${textoEsperado}'`);
}

// -----------------------------------------------------------------------
// Entrada invalida -- nunca chama confirmarRenovacao.
// -----------------------------------------------------------------------
{
  resetar();
  const resp1 = await handler(reqPostForm([["etapa", "confirmar"], ["acao", "aceitar"]])); // sem token
  ok((await resp1.text()).includes("Não foi possível continuar"), "4C sem token: erro generico");
  ok(chamadasConfirmacao.length === 0, "4C sem token: confirmarRenovacao NUNCA chamada");

  resetar();
  const resp2 = await handler(reqPostForm([["etapa", "confirmar"], ["token", "t"], ["acao", "algo-invalido"]]));
  ok((await resp2.text()).includes("Não foi possível continuar"), "4C acao invalida: erro generico");
  ok(chamadasConfirmacao.length === 0, "4C acao invalida: confirmarRenovacao NUNCA chamada");
}

// =======================================================================
// Checkpoint 5 -- rate limiting da etapa=telefone (integracao com o
// roteamento real de renovacao-iniciar). A logica atomica/concorrencia
// do modulo em si ja e' provada isoladamente em
// scripts/testes/portal_rate_limit/ (13 testes) -- aqui so' confirmamos
// a FIACAO: bloqueado = mesma pagina generica de sempre, e o Rocket
// nunca chega a ser consultado quando bloqueado.
// =======================================================================
{
  resetar();
  respostasLista.push({ paginacao: { total: 0 }, itens: [] });
  const respNoMatch = await handler(reqPostForm([["etapa", "telefone"], ["telefone", "17999999999"]]));
  const htmlNoMatch = await respNoMatch.text();

  resetar();
  configurarRateLimit(false);
  const respBloqueado = await handler(reqPostForm([["etapa", "telefone"], ["telefone", "17999999999"]]));
  const htmlBloqueado = await respBloqueado.text();

  ok(htmlBloqueado === htmlNoMatch, "5) rate limit atingido: HTML IDENTICO ao de 'nao encontramos' -- nunca revela que foi o limite");
  ok(respBloqueado.status === 200, "5) rate limit atingido: HTTP 200 (mesma disciplina das demais paginas genericas)");
  ok(urlsChamadas.length === 0, "5) rate limit atingido: o Rocket NUNCA chega a ser consultado (bloqueio acontece antes)");
}

{
  // Funcionamento normal continua igual quando permitido (rate limit
  // liberado explicitamente, mesmo default de todos os testes acima).
  resetar();
  configurarRateLimit(true);
  respostasLista.push({ paginacao: { total: 1 }, itens: [{ id: "pub-1", nome: "José Antônio", usuario: "828667229" }] });
  respostasDetalhe["pub-1"] = clienteDetalhe();
  const resp = await handler(reqPostForm([["etapa", "telefone"], ["telefone", "17999999999"]]));
  const html = await resp.text();
  ok(html.includes("BLAZE") && html.includes('value="pub-1"'), "5) rate limit permitido: fluxo normal do Portal continua identico");
}

// =======================================================================
// Regra de exibicao do nome (revisao de UX pos-Checkpoint 7, antes do
// deploy) -- puramente apresentacao, nao muda identificacao/consulta/
// selecao/token/Pix. Regra: nomes DISTINTOS entre os acessos -> mostra
// "Nome — Servidor"; nomes IGUAIS -> so' o servidor (layout atual).
// Testado nas duas telas (carrinho e conferencia).
// =======================================================================

// -----------------------------------------------------------------------
// Cenario A -- mesmo cliente em todos os acessos -> nome NAO repetido,
// so' o servidor como titulo (carrinho).
// -----------------------------------------------------------------------
{
  resetar();
  respostasLista.push({
    paginacao: { total: 2 },
    itens: [
      { id: "pub-jose-1", nome: "José", usuario: "u1" },
      { id: "pub-jose-2", nome: "José", usuario: "u2" },
    ],
  });
  respostasDetalhe["pub-jose-1"] = clienteDetalhe({ servidor: { nome: "ChannelTV" } });
  respostasDetalhe["pub-jose-2"] = clienteDetalhe({ servidor: { nome: "UNITV" } });

  const resp = await handler(reqPostForm([["etapa", "telefone"], ["telefone", "17999999999"]]));
  const html = await resp.text();
  ok(html.includes("<strong>ChannelTV</strong>"), "cenario A (carrinho): titulo e' so' o servidor, sem nome repetido");
  ok(html.includes("<strong>UNITV</strong>"), "cenario A (carrinho): idem pro segundo acesso");
  ok(!html.includes("José — "), "cenario A (carrinho): nome NAO aparece no titulo quando e' o mesmo em todos os acessos");
}

// -----------------------------------------------------------------------
// Cenario B -- clientes DIFERENTES compartilhando o telefone -> nome
// aparece em cada card, junto com o servidor (carrinho).
// -----------------------------------------------------------------------
{
  resetar();
  respostasLista.push({
    paginacao: { total: 2 },
    itens: [
      { id: "pub-joao", nome: "João", usuario: "u1" },
      { id: "pub-maria", nome: "Maria", usuario: "u2" },
    ],
  });
  respostasDetalhe["pub-joao"] = clienteDetalhe({ nome: "João", servidor: { nome: "ChannelTV" } });
  respostasDetalhe["pub-maria"] = clienteDetalhe({ nome: "Maria", servidor: { nome: "UNITV" } });

  const resp = await handler(reqPostForm([["etapa", "telefone"], ["telefone", "17999999999"]]));
  const html = await resp.text();
  ok(html.includes("<strong>João — ChannelTV</strong>"), "cenario B (carrinho): nome + servidor quando os nomes sao diferentes");
  ok(html.includes("<strong>Maria — UNITV</strong>"), "cenario B (carrinho): idem pro segundo cliente/acesso");
}

// -----------------------------------------------------------------------
// Mesma regra na tela de CONFERENCIA (2 itens do mesmo cliente -> sem
// nome; usa o fluxo real de carrinho -> conferencia, nao so' a
// identificacao).
// -----------------------------------------------------------------------
{
  resetar();
  respostasLista.push({
    paginacao: { total: 2 },
    itens: [
      { id: "pub-mesmo-1", nome: "Ana", usuario: "u1" },
      { id: "pub-mesmo-2", nome: "Ana", usuario: "u2" },
    ],
  });
  respostasDetalhe["pub-mesmo-1"] = clienteDetalhe({ nome: "Ana", servidor: { nome: "BLAZE" } });
  respostasDetalhe["pub-mesmo-2"] = clienteDetalhe({ nome: "Ana", servidor: { nome: "NewOne" } });

  const resp = await handler(reqPostForm([
    ["etapa", "carrinho"], ["telefone", "5517999999999"],
    ["publicId", "pub-mesmo-1"], ["publicId", "pub-mesmo-2"],
  ]));
  const html = await resp.text();
  ok(html.includes("<strong>BLAZE</strong>"), "cenario A (conferencia): titulo e' so' o servidor");
  ok(!html.includes("Ana — "), "cenario A (conferencia): nome NAO repetido quando e' o mesmo cliente");
}

// -----------------------------------------------------------------------
// Mesma regra na tela de CONFERENCIA, clientes diferentes -> nome
// aparece em cada card.
// -----------------------------------------------------------------------
{
  resetar();
  respostasLista.push({
    paginacao: { total: 2 },
    itens: [
      { id: "pub-dif-1", nome: "Carlos", usuario: "u1" },
      { id: "pub-dif-2", nome: "Beatriz", usuario: "u2" },
    ],
  });
  respostasDetalhe["pub-dif-1"] = clienteDetalhe({ nome: "Carlos", servidor: { nome: "BLAZE" } });
  respostasDetalhe["pub-dif-2"] = clienteDetalhe({ nome: "Beatriz", servidor: { nome: "NewOne" } });

  const resp = await handler(reqPostForm([
    ["etapa", "carrinho"], ["telefone", "5517999999999"],
    ["publicId", "pub-dif-1"], ["publicId", "pub-dif-2"],
  ]));
  const html = await resp.text();
  ok(html.includes("<strong>Carlos — BLAZE</strong>"), "cenario B (conferencia): nome + servidor exibidos quando diferentes");
  ok(html.includes("<strong>Beatriz — NewOne</strong>"), "cenario B (conferencia): idem pro segundo cliente/acesso");
}

// -----------------------------------------------------------------------
// Nenhum acesso selecionado inicialmente / botao desabilitado / logica
// de habilitacao presente no HTML gerado. NOTA HONESTA: este teste roda
// em Node, sem DOM real -- prova que (a) nenhum checkbox nasce marcado,
// (b) o botao nasce "disabled", (c) a logica de habilitacao (JS) esta'
// presente e correta no HTML gerado. Nao executa um clique real num
// navegador -- isso so' um teste manual/E2E provaria de verdade.
// -----------------------------------------------------------------------
{
  resetar();
  respostasLista.push({
    paginacao: { total: 2 },
    itens: [
      { id: "pub-x1", nome: "Cliente X", usuario: "u1" },
      { id: "pub-x2", nome: "Cliente X", usuario: "u2" },
    ],
  });
  respostasDetalhe["pub-x1"] = clienteDetalhe({ servidor: { nome: "BLAZE" } });
  respostasDetalhe["pub-x2"] = clienteDetalhe({ servidor: { nome: "NewOne" } });

  const resp = await handler(reqPostForm([["etapa", "telefone"], ["telefone", "17999999999"]]));
  const html = await resp.text();

  const totalCheckboxes = (html.match(/<input type="checkbox" name="publicId"/g) || []).length;
  const totalMarcados = (html.match(/<input type="checkbox" name="publicId"[^>]*checked/g) || []).length;
  ok(totalCheckboxes === 2, "nenhum-selecionado: os 2 checkboxes existem");
  ok(totalMarcados === 0, "nenhum-selecionado: NENHUM checkbox nasce marcado (nem com 2 acessos)");
  ok(/id="btn-continuar"[^>]*disabled/.test(html), "botao desabilitado: 'Continuar' nasce desabilitado");
  ok(html.includes("botao.disabled = !algumMarcado"), "botao habilita apos selecao: logica de habilitacao presente e correta no HTML gerado");
  ok(html.includes("addEventListener('change', atualizar)"), "botao habilita apos selecao: listener de mudanca ligado a cada checkbox");
}

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
