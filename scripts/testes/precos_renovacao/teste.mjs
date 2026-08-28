// Teste local de _shared/precos_renovacao.ts.
// Funcao pura, sem I/O -- importada real, sem mock.
//
// NAO existe regra comercial de lote. O valor de cada acesso e' o
// valor real dele no Rocket (em centavos, ja convertido pelo chamador)
// e o total e' a SOMA exata -- sem constante fixa, sem desconto, sem
// recalculo. Vale para 2 acessos e para qualquer N futuro.
//   30 + 30 -> 60      35 + 35 -> 70      30 + 50 -> 80
// resolverPrecoLote retorna null so' quando ha' < 2 acessos ou algum
// acesso sem valor real utilizavel.
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

const acc = (servidor, valorCentavos, tipo = "sigma") => ({
  tipo,
  servidorNome: servidor,
  planoNome: "Mensal",
  valorCentavos,
});

// --- 30 + 30 = 60 ---
{
  const r = resolverPrecoLote([acc("BLAZE", 3000), acc("NewOne", 3000)]);
  ok(r !== null, "30+30: resolve");
  ok(JSON.stringify(r.valorPorAcessoCentavos) === "[3000,3000]", "30+30: valor real por acesso, na ordem");
  ok(r.totalCentavos === 6000, "30+30: total 6000 (R$ 60,00)");
  ok(r.totalCentavos === r.valorPorAcessoCentavos.reduce((a, b) => a + b, 0), "30+30: total = soma");
  ok(r.regraAplicada === "soma_valores_rocket", "30+30: rotulo interno de auditoria");
  ok(!/promo|desconto|R\$|cliente/i.test(r.regraAplicada), "30+30: rotulo e' interno, nao texto de cliente");
}

// --- 35 + 35 = 70 ---
{
  const r = resolverPrecoLote([acc("BLAZE", 3500), acc("NewOne", 3500)]);
  ok(r.totalCentavos === 7000, "35+35: total 7000 (R$ 70,00)");
  ok(JSON.stringify(r.valorPorAcessoCentavos) === "[3500,3500]", "35+35: 3500 por acesso");
}

// --- valores DIFERENTES: 30 + 50 = 80 ---
{
  const r = resolverPrecoLote([acc("BLAZE", 3000), acc("NewOne", 5000)]);
  ok(r.totalCentavos === 8000, "30+50: total 8000 (R$ 80,00) -- soma, nunca media/desconto");
  ok(JSON.stringify(r.valorPorAcessoCentavos) === "[3000,5000]", "30+50: cada acesso mantem o SEU valor");
}

// --- valores diferentes, ordem preservada: 50 + 30 = 80 ---
{
  const r = resolverPrecoLote([acc("NewOne", 5000), acc("BLAZE", 3000)]);
  ok(JSON.stringify(r.valorPorAcessoCentavos) === "[5000,3000]", "50+30: ordem de entrada preservada");
  ok(r.totalCentavos === 8000, "50+30: total 8000");
}

// --- N=3: o RESOLVEDOR sabe somar 3 valores (30 + 40 + 50 = 120).
// Isto prova SO' a capacidade da funcao pura de somar N valores -- NAO
// significa que o Orquestrador oferece lote para 3 acessos. A operacao
// de lote permanece limitada a exatamente 2 acessos (gate
// `acessosLote.length !== 2` no Orquestrador; ver Teste J em
// orchestrator_multiplos_acessos: N=3 -> fallback, nunca lote).
{
  const r = resolverPrecoLote([acc("A", 3000), acc("B", 4000), acc("C", 5000)]);
  ok(r !== null && r.totalCentavos === 12000, "N=3: resolvedor soma os 3 valores reais (R$ 120,00)");
  ok(JSON.stringify(r.valorPorAcessoCentavos) === "[3000,4000,5000]", "N=3: um valor real por acesso, na ordem");
}

// --- tipo misto (sigma + unitv) nao muda a soma ---
{
  const r = resolverPrecoLote([acc("BLAZE", 3000, "sigma"), acc("UNITV", 3500, "unitv")]);
  ok(r !== null && r.totalCentavos === 6500, "misto: soma dos valores reais, tipo nao interfere");
}

// --- sem valor real utilizavel -> null (nunca inventa) ---
{
  ok(resolverPrecoLote([acc("BLAZE", 3000), acc("NewOne", null)]) === null, "acesso sem valor -> null");
  ok(resolverPrecoLote([acc("BLAZE", 0), acc("NewOne", 3000)]) === null, "valor 0 -> null");
  ok(resolverPrecoLote([acc("BLAZE", -100), acc("NewOne", 3000)]) === null, "valor negativo -> null");
  ok(resolverPrecoLote([acc("BLAZE", 30.5), acc("NewOne", 3000)]) === null, "valor nao inteiro (centavos) -> null");
}

// --- < 2 acessos -> null ---
{
  ok(resolverPrecoLote([acc("BLAZE", 3000)]) === null, "N=1: null");
  ok(resolverPrecoLote([]) === null, "N=0: null");
}

// --- a funcao NAO muta a entrada ---
{
  const entrada = [acc("BLAZE", 3000), acc("NewOne", 5000)];
  const copia = JSON.stringify(entrada);
  resolverPrecoLote(entrada);
  ok(JSON.stringify(entrada) === copia, "resolverPrecoLote nao muta o array de entrada");
}

console.log(`\n${falhas === 0 ? "TODOS OS TESTES PASSARAM" : `${falhas} FALHA(S)`}`);
process.exit(falhas === 0 ? 0 : 1);
