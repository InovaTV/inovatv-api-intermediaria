// Testes locais de scripts/lib/renovacao-eventos.mjs (REAL) -- lado
// Node.js do mesmo contrato, usado SO' por renovacao-sigma-workflow.mjs
// (GitHub Actions). Mocka global.fetch em vez de um client Supabase --
// o modulo real faz REST direto, mesmo padrao ja usado por
// lerTokenRenovacao/lerSessaoRocket no proprio workflow.
//
// Como rodar: node scripts/testes/renovacao_eventos/teste_node.mjs

import { criarRegistradorDeEventos, CATALOGO_EVENTOS as CATALOGO_NODE } from "../../lib/renovacao-eventos.mjs";

let falhas = 0;
let total = 0;
function ok(cond, msg) {
  total++;
  if (!cond) { falhas++; console.error(`FALHA: ${msg}`); }
  else console.log(`ok: ${msg}`);
}

const fetchOriginal = globalThis.fetch;
let chamadas = [];
let modoFetch = "sucesso"; // "sucesso" | "http_erro" | "rede_falha" | "trava"

globalThis.fetch = async (url, opts) => {
  chamadas.push({ url, opts });
  if (modoFetch === "rede_falha") throw new TypeError("fetch failed (simulado)");
  if (modoFetch === "trava") {
    await new Promise((_, reject) => {
      opts.signal?.addEventListener("abort", () => reject(new Error("AbortError (simulado)")));
    });
  }
  if (modoFetch === "http_erro") {
    return { ok: false, status: 500, text: async () => "erro simulado" };
  }
  return { ok: true, status: 201, text: async () => "" };
};

const registrarEvento = criarRegistradorDeEventos({
  supabaseUrl: "https://fake.supabase.co",
  supabaseServiceRoleKey: "fake-service-role-key",
  origem: "renovacao-sigma-workflow",
});

// ---------------------------------------------------------------------
// Insert bem-sucedido -- URL, headers e corpo corretos.
// ---------------------------------------------------------------------
{
  chamadas = [];
  modoFetch = "sucesso";
  await registrarEvento({
    codigo: "processamento_clique_executado",
    tokenId: "tok-1",
    servidor: "sigma",
    detalhe: { plano: "Trimestral", dealer_token: "nao_deveria_ir" },
  });

  ok(chamadas.length === 1, "registrarEvento chama fetch 1 vez");
  const [{ url, opts }] = chamadas;
  ok(url === "https://fake.supabase.co/rest/v1/renovacao_eventos", "URL correta (REST direto, mesmo padrao do workflow)");
  ok(opts.method === "POST", "metodo POST");
  ok(opts.headers.apikey === "fake-service-role-key", "header apikey correto");
  ok(opts.headers.Authorization === "Bearer fake-service-role-key", "header Authorization correto");

  const corpo = JSON.parse(opts.body);
  ok(corpo.codigo === "processamento_clique_executado", "corpo com codigo correto");
  ok(corpo.etapa === "processamento", "etapa derivada do catalogo");
  ok(corpo.nivel === "info", "nivel derivado do catalogo");
  ok(corpo.token_id === "tok-1", "corpo com token_id");
  ok(corpo.servidor === "sigma", "corpo com servidor");
  ok(corpo.origem === "renovacao-sigma-workflow", "corpo com origem fixa da fabrica");
  ok(corpo.detalhe.dealer_token === undefined, "detalhe sanitizado -- dealer_token removido antes do POST");
  ok(corpo.detalhe.plano === "Trimestral", "detalhe preserva campo de negocio");
}

// ---------------------------------------------------------------------
// Nunca lanca -- codigo desconhecido, sem correlacao, HTTP erro, rede
// falha, timeout.
// ---------------------------------------------------------------------
{
  chamadas = [];
  let lancou = false;
  try {
    await registrarEvento({ codigo: "codigo_inventado", tokenId: "tok-1" });
  } catch { lancou = true; }
  ok(!lancou, "nao lanca para codigo desconhecido");
  ok(chamadas.length === 0, "codigo desconhecido nao chega a chamar fetch");
}
{
  chamadas = [];
  let lancou = false;
  try {
    await registrarEvento({ codigo: "portal_acessado" });
  } catch { lancou = true; }
  ok(!lancou, "nao lanca sem nenhuma correlacao");
  ok(chamadas.length === 0, "sem correlacao nao chega a chamar fetch");
}
{
  chamadas = [];
  modoFetch = "http_erro";
  let lancou = false;
  try {
    await registrarEvento({ codigo: "processamento_iniciado", tokenId: "tok-1" });
  } catch { lancou = true; }
  ok(!lancou, "nao lanca quando a API responde HTTP de erro");
}
{
  chamadas = [];
  modoFetch = "rede_falha";
  let lancou = false;
  try {
    await registrarEvento({ codigo: "processamento_iniciado", tokenId: "tok-1" });
  } catch { lancou = true; }
  ok(!lancou, "nao lanca quando o fetch rejeita (rede)");
}
{
  chamadas = [];
  modoFetch = "trava";
  const inicio = Date.now();
  let lancou = false;
  try {
    await registrarEvento({ codigo: "processamento_iniciado", tokenId: "tok-1" });
  } catch { lancou = true; }
  const duracaoMs = Date.now() - inicio;
  ok(!lancou, "nao lanca quando o fetch trava (timeout via AbortController)");
  ok(duracaoMs < 4000, `respeita o timeout de 3s (levou ${duracaoMs}ms)`);
}

globalThis.fetch = fetchOriginal;

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
