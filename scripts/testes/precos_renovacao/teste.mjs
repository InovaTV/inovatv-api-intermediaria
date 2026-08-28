// Teste local de _shared/precos_renovacao.ts (Etapa 1, 2026-08-29).
// Funcao pura, sem I/O -- importada real, sem mock.
//
// Regra COMERCIAL INTERNA: 2 acessos -> R$ 30,00 cada / R$ 60,00 total.
// Nenhum N diferente de 2 tem regra ainda -> null (o Orquestrador cai
// no fallback "escolha 1"). O rotulo da regra e' interno (auditoria),
// NUNCA vai ao cliente.
//
// Como rodar: npx tsx scripts/testes/precos_renovacao/teste.mjs

import { resolverPrecoLote } from "../../../supabase/functions/_shared/precos_renovacao.ts";

let falhas = 0;
function ok(cond, msg) {
  if (!cond) {
    falhas++;
    console.error(`FALHA: ${msg}`);
  } else {
    console.log(`ok: ${msg}`);
  }
}

const sigma = (servidor) => ({ tipo: "sigma", servidorNome: servidor, planoNome: "Mensal" });
const unitv = (servidor) => ({ tipo: "unitv", servidorNome: servidor, planoNome: "Mensal" });

// --- N = 2 (unica regra hoje) ---
{
  const r = resolverPrecoLote([sigma("BLAZE"), sigma("NewOne")]);
  ok(r !== null, "N=2: regra encontrada");
  ok(JSON.stringify(r.valorPorAcessoCentavos) === "[3000,3000]", "N=2: R$ 30,00 por acesso (3000 centavos)");
  ok(r.totalCentavos === 6000, "N=2: total R$ 60,00 (6000 centavos)");
  ok(r.totalCentavos === r.valorPorAcessoCentavos.reduce((a, b) => a + b, 0), "N=2: total = soma dos valores por acesso");
  ok(typeof r.regraAplicada === "string" && r.regraAplicada.length > 0, "N=2: rotulo interno da regra presente");
  ok(!/promo|desconto|R\$|cliente/i.test(r.regraAplicada), "N=2: rotulo e' interno -- nao e' texto de cliente");
}

// --- N = 2 tambem vale para tipo misto (Sigma + UniTV), Etapa 2 futura ---
{
  const r = resolverPrecoLote([sigma("BLAZE"), unitv("UNITV")]);
  ok(r !== null && r.totalCentavos === 6000, "N=2 misto (sigma+unitv): mesma regra de 2 acessos");
}

// --- N != 2 -> sem regra (null) ---
{
  ok(resolverPrecoLote([sigma("BLAZE")]) === null, "N=1: sem regra de lote (null)");
  ok(resolverPrecoLote([sigma("A"), sigma("B"), sigma("C")]) === null, "N=3: sem regra de lote (null)");
  ok(resolverPrecoLote([]) === null, "N=0: sem regra de lote (null)");
}

// --- a funcao NAO muta a entrada ---
{
  const entrada = [sigma("BLAZE"), sigma("NewOne")];
  const copia = JSON.stringify(entrada);
  resolverPrecoLote(entrada);
  ok(JSON.stringify(entrada) === copia, "resolverPrecoLote nao muta o array de entrada");
}

console.log(`\n${falhas === 0 ? "TODOS OS TESTES PASSARAM" : `${falhas} FALHA(S)`}`);
process.exit(falhas === 0 ? 0 : 1);
