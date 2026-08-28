// Teste local de _shared/tipo_acesso.ts (Etapa 1.5, Lacuna A,
// 2026-08-28). Funcao pura, sem I/O -- importada real.
//
// Regra: 'unitv' SO' quando o servidor normalizado == "UNITV"
// (tolerando espaco/hifen/ponto/underscore e acento). Qualquer outra
// coisa -> 'sigma' (caminho seguro/existente).
//
// Como rodar: npx tsx scripts/testes/tipo_acesso/teste.mjs

import { classificarTipoAcesso } from "../../../supabase/functions/_shared/tipo_acesso.ts";

let falhas = 0;
function ok(cond, msg) {
  if (!cond) {
    falhas++;
    console.error(`FALHA: ${msg}`);
  } else {
    console.log(`ok: ${msg}`);
  }
}

// --- classifica como UniTV ---
for (const s of ["UNITV", "unitv", "UniTV", "Unitv", " UNITV ", "UNI TV", "UNI-TV", "UNI.TV", "UNI_TV", "uni tv"]) {
  ok(classificarTipoAcesso(s) === "unitv", `"${s}" -> unitv`);
}

// --- classifica como Sigma (tudo que nao e' exatamente UNITV) ---
for (const s of [
  "BLAZE",
  "NewOne",
  "ChannelTV",
  "NoxTV",
  "StarPlay-BR1",
  "PlayMax",
  "UNITV BR",       // tem sufixo -> nao e' exatamente "UNITV"
  "MEUUNITV",       // substring, nao token -> NUNCA falso positivo
  "UNITVPLUS",
  "SERVER UNITV 2",
  "",               // ausente -> sigma (caminho seguro)
  "   ",
]) {
  ok(classificarTipoAcesso(s) === "sigma", `"${s}" -> sigma`);
}

// --- null / undefined -> sigma (nunca lanca, nunca 'unitv' sem certeza) ---
ok(classificarTipoAcesso(null) === "sigma", "null -> sigma");
ok(classificarTipoAcesso(undefined) === "sigma", "undefined -> sigma");

console.log(`\n${falhas === 0 ? "TODOS OS TESTES PASSARAM" : `${falhas} FALHA(S)`}`);
process.exit(falhas === 0 ? 0 : 1);
