// Testes locais de _shared/autocura_monitor.ts (REAL) -- F2 da autocura
// do UNITV_DEALER_TOKEN (2026-08-30). Foco: REGRA DA DUPLA CONFIRMACAO.
//
// autocura_monitor.ts nao importa supabase-js (recebe `supa` via deps) e
// so' importa mensagens_fixas.ts (limpo) + um `import type` de
// unitv_token_diag.ts (apagado em runtime) -> NAO precisa de mock-loader.
//
// Regras travadas aqui:
//   * batida 2 = execucao do tick (token_morto, codigo C).
//   * batida 1 = execucao valida anterior MAIS RECENTE: token_morto,
//     mesmo C, criado_em < tickStart, dentro de [tickStart-24h,
//     tickStart-gap_min], e APOS o ultimo token_vivo.
//   * sem batida 1 -> pendente.
//   * token_vivo posterior a uma sequencia -> invalida; recomeca de nova morte.
//   * nunca usa linha arbitrariamente antiga -- pega a confirmacao valida
//     mais recente.
//   * token_vivo / indeterminado_outage / indeterminado / diag nulo ->
//     nao confirma, nao alerta.
//
// Como rodar: npx tsx scripts/testes/autocura_monitor_confirmacao/teste.mjs

import { makeFakeSupa, configInerte, estadoZerado } from "../_autocura_lib/fake_supa.mjs";

const mon = await import("../../../supabase/functions/_shared/autocura_monitor.ts");

let falhas = 0;
function ok(cond, msg) {
  if (!cond) { falhas++; console.error(`FALHA: ${msg}`); }
  else console.log(`ok: ${msg}`);
}

const NOW = Date.parse("2026-08-30T12:00:00.000Z");
const agora = () => new Date(NOW);
const isoMinAtras = (m) => new Date(NOW - m * 60_000).toISOString();

// diag fake -- devolve um ResultadoDiagnostico fixo (ou null)
function fakeDiag(res) {
  return async () => res;
}
const semAlerta = async () => ({ outcome: "success", messageId: "x" });

async function rodar({ diagnosticos = [], diag, config = configInerte(), estado = estadoZerado() }) {
  const supa = makeFakeSupa({ config, estado, diagnosticos, agora });
  const resumo = await mon.executarTickMonitor({
    supa,
    diagnosticar: fakeDiag(diag),
    enviarTemplate: semAlerta,
    numeroJose: "5517900000000",
    agora,
  });
  return { resumo, estado, supa };
}

const TM = (c) => ({ veredito: "token_morto", probe_return_code: c, ancora_status: "nao_resolveu" });
const TV = { veredito: "token_vivo", probe_return_code: null, ancora_status: "ok" };

// 1. sem batida 1 -> pendente
{
  const { resumo } = await rodar({ diagnosticos: [], diag: TM(5) });
  ok(resumo.confirmacao === "pendente", "1: sem historico -> pendente");
  ok(resumo.batida1_criado_em == null, "1b: batida1 nula");
}

// 2. batida 1 recente demais (< gap de 10min) -> pendente
{
  const { resumo } = await rodar({
    diagnosticos: [{ criado_em: isoMinAtras(5), veredito: "token_morto", probe_return_code: 5 }],
    diag: TM(5),
  });
  ok(resumo.confirmacao === "pendente", "2: batida 1 a 5min (< gap 10) -> pendente");
}

// 3. batida 1 valida [gap, 24h], mesmo C, sem token_vivo -> confirmado, PEGA A MAIS RECENTE
{
  const d = [
    { criado_em: isoMinAtras(1500), veredito: "token_morto", probe_return_code: 5 }, // 25h -> fora da janela
    { criado_em: isoMinAtras(600), veredito: "token_morto", probe_return_code: 5 },  // 10h -> valida
    { criado_em: isoMinAtras(60), veredito: "token_morto", probe_return_code: 5 },   // 1h -> valida e MAIS RECENTE
  ];
  const { resumo } = await rodar({ diagnosticos: d, diag: TM(5) });
  ok(resumo.confirmacao === "confirmado", "3: batida 1 valida -> confirmado");
  ok(resumo.batida1_criado_em === isoMinAtras(60), "3b: escolheu a batida 1 valida MAIS RECENTE (1h), nao a de 10h nem a de 25h");
}

// 4. token_vivo APOS a batida 1 -> sequencia invalidada -> pendente
{
  const d = [
    { criado_em: isoMinAtras(600), veredito: "token_morto", probe_return_code: 5 }, // morte antiga
    { criado_em: isoMinAtras(300), veredito: "token_vivo", probe_return_code: null }, // recuperou
    // nao ha nova morte anterior a este tick
  ];
  const { resumo } = await rodar({ diagnosticos: d, diag: TM(5) });
  ok(resumo.confirmacao === "pendente", "4: token_vivo depois da morte antiga invalida a sequencia -> pendente");
}

// 5. duas sequencias separadas por token_vivo -> usa a RECENTE, ignora a antiga
{
  const d = [
    { criado_em: isoMinAtras(1200), veredito: "token_morto", probe_return_code: 5 }, // sequencia antiga
    { criado_em: isoMinAtras(1100), veredito: "token_morto", probe_return_code: 5 },
    { criado_em: isoMinAtras(800), veredito: "token_vivo", probe_return_code: null },  // recuperou
    { criado_em: isoMinAtras(90), veredito: "token_morto", probe_return_code: 5 },     // nova morte, valida (>= gap, <= 24h, apos o vivo)
  ];
  const { resumo } = await rodar({ diagnosticos: d, diag: TM(5) });
  ok(resumo.confirmacao === "confirmado", "5: nova sequencia apos recuperacao -> confirmado");
  ok(resumo.batida1_criado_em === isoMinAtras(90), "5b: batida 1 = a morte da sequencia RECENTE (90min), nunca a antiga (>18h)");
}

// 6. batida 1 fora da janela de 24h (unica candidata) -> pendente
{
  const { resumo } = await rodar({
    diagnosticos: [{ criado_em: isoMinAtras(1500), veredito: "token_morto", probe_return_code: 5 }],
    diag: TM(5),
  });
  ok(resumo.confirmacao === "pendente", "6: unica candidata a 25h -> fora da janela -> pendente");
}

// 7. probe_return_code diferente entre as batidas -> nao casa -> pendente
{
  const { resumo } = await rodar({
    diagnosticos: [{ criado_em: isoMinAtras(60), veredito: "token_morto", probe_return_code: 7 }],
    diag: TM(5),
  });
  ok(resumo.confirmacao === "pendente", "7: batida 1 com C=7, batida 2 com C=5 -> pendente");
}

// 8. token_vivo no tick atual -> nao_aplica + zera dedupe do alerta
{
  const est = estadoZerado({ ultimo_codigo_desconhecido_alertado: 5, ultimo_codigo_desconhecido_alertado_em: isoMinAtras(30) });
  const { resumo } = await rodar({ diagnosticos: [], diag: TV, estado: est });
  ok(resumo.confirmacao === "nao_aplica", "8: token_vivo -> nao_aplica");
  ok(est.ultimo_codigo_desconhecido_alertado === null, "8b: token_vivo zera o dedupe (ultimo_codigo_desconhecido_alertado)");
}

// 9. indeterminado_outage -> nao confirma, nao alerta
{
  const { resumo } = await rodar({
    diagnosticos: [{ criado_em: isoMinAtras(60), veredito: "token_morto", probe_return_code: 5 }],
    diag: { veredito: "indeterminado_outage", probe_return_code: null, ancora_status: "nao_resolveu" },
  });
  ok(resumo.confirmacao === "nao_aplica", "9: indeterminado_outage -> nao_aplica (mesmo com batida 1 no historico)");
}

// 10. diag == null (rotina de diagnostico lancou) -> tratado como indeterminado
{
  const { resumo } = await rodar({ diagnosticos: [], diag: null });
  ok(resumo.veredito === "indeterminado", "10: diag nulo -> veredito indeterminado");
  ok(resumo.confirmacao === "nao_aplica", "10b: diag nulo -> nao_aplica");
}

// 11. contadores: total_ticks +1 sempre; total_token_morto_confirmado +1 so' no confirmado
{
  const est = estadoZerado({ total_ticks: 4, total_token_morto_confirmado: 1 });
  await rodar({
    diagnosticos: [{ criado_em: isoMinAtras(60), veredito: "token_morto", probe_return_code: 5 }],
    diag: TM(5), estado: est,
  });
  ok(est.total_ticks === 5, "11: total_ticks incrementado");
  ok(est.total_token_morto_confirmado === 2, "11b: total_token_morto_confirmado incrementado no confirmado");
}

console.log(falhas === 0 ? "\nTODOS OS TESTES OK" : `\n${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
