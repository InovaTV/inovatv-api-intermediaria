// Garante que CATALOGO_EVENTOS de supabase/functions/_shared/renovacao_eventos.ts
// (Deno) e de scripts/lib/renovacao-eventos.mjs (Node, usado so' pelo
// workflow do GitHub Actions) nunca fiquem dessincronizados -- os dois
// existem duplicados de proposito (o workflow roda node puro, sem tsx,
// nao pode importar o .ts), entao nada impede alguem editar um sem o
// outro. Este teste falha se isso acontecer.
//
// Como rodar: npx tsx scripts/testes/renovacao_eventos/teste_catalogos_sincronizados.mjs

// renovacao_eventos.ts importa supabase_client.ts (que por sua vez
// importa "npm:@supabase/supabase-js@2", especificador so' valido no
// Deno) -- precisa do mesmo mock-loader.mjs de teste.mjs so' pra viabilizar
// o import; este teste nao grava nada, so' compara os dois objetos
// CATALOGO_EVENTOS exportados.
const { register } = await import("node:module");
register("./mock-loader.mjs", import.meta.url);

const { CATALOGO_EVENTOS: CATALOGO_DENO } = await import("../../../supabase/functions/_shared/renovacao_eventos.ts");
const { CATALOGO_EVENTOS: CATALOGO_NODE } = await import("../../lib/renovacao-eventos.mjs");

let falhas = 0;
let total = 0;
function ok(cond, msg) {
  total++;
  if (!cond) { falhas++; console.error(`FALHA: ${msg}`); }
  else console.log(`ok: ${msg}`);
}

const chavesDeno = Object.keys(CATALOGO_DENO).sort();
const chavesNode = Object.keys(CATALOGO_NODE).sort();

ok(chavesDeno.length === chavesNode.length, `mesma quantidade de codigos (Deno=${chavesDeno.length}, Node=${chavesNode.length})`);
ok(JSON.stringify(chavesDeno) === JSON.stringify(chavesNode), "mesmo conjunto de codigos nos dois catalogos");

const codigosDivergentes = [];
for (const codigo of chavesDeno) {
  const deno = CATALOGO_DENO[codigo];
  const node = CATALOGO_NODE[codigo];
  if (!node) continue; // ja coberto pela checagem de conjunto acima
  if (deno.etapa !== node.etapa || deno.nivel !== node.nivel) {
    codigosDivergentes.push(codigo);
  }
}
ok(codigosDivergentes.length === 0, `nenhum codigo com etapa/nivel divergente entre os dois catalogos (divergentes: ${codigosDivergentes.join(", ") || "nenhum"})`);

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
