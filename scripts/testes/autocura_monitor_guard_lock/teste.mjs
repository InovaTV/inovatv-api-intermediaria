// Testes locais de _shared/autocura_monitor.ts (REAL) -- F2. Foco:
// GUARDS de execucao (kill_switch / pausado_ate) + LOCK ANTI-SOBREPOSICAO
// COM AQUISICAO ATOMICA.
//
// Regras travadas:
//   * kill_switch=true -> tick_pulado; diagnosticar() NUNCA chamado;
//     o lock NEM e' tentado (a RPC de lock nao e' chamada).
//   * pausado_ate futuro / far-future -> idem (motivo 'pausado').
//   * pausado_ate no passado -> tick roda.
//   * LOCK: aquisicao via RPC autocura_unitv_monitor_adquirir_lock
//     (UPDATE atomico, sem SELECT antes). adquiriu=false -> sobreposto,
//     diagnosticar() NUNCA chamado.
//   * lock stale (>= 10min) -> RPC re-adquire; roda.
//   * o lock e' SEMPRE liberado no fim (sucesso E erro), e SO' se ainda
//     for este tick que o detem (liberacao condicional).
//   * CONCORRENCIA REAL: 2 ticks simultaneos -> EXATAMENTE 1 adquire o
//     lock -> EXATAMENTE 1 executa o diagnostico.
//
// Como rodar: npx tsx scripts/testes/autocura_monitor_guard_lock/teste.mjs

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
const TV = { veredito: "token_vivo", probe_return_code: null, ancora_status: "ok" };

function diagContador(res = TV) {
  const c = { n: 0 };
  const fn = async () => { c.n++; return res; };
  return { fn, c };
}
const enviarNoop = async () => ({ outcome: "success", messageId: "x" });

async function rodar({ config, estado, diag = diagContador() }) {
  const supa = makeFakeSupa({ config, estado, diagnosticos: [], agora });
  const resumo = await mon.executarTickMonitor({
    supa, diagnosticar: diag.fn, enviarTemplate: enviarNoop, numeroJose: "5517900000000", agora,
  });
  return { resumo, diagN: diag.c.n, estado, supa };
}

// 1. kill_switch -> pulado, diag nao chamado, RPC de lock nem e' tentada
{
  const est = estadoZerado();
  const supa = makeFakeSupa({ config: configInerte({ kill_switch: true }), estado: est, diagnosticos: [], agora });
  const d = diagContador();
  const resumo = await mon.executarTickMonitor({ supa, diagnosticar: d.fn, enviarTemplate: enviarNoop, numeroJose: "x", agora });
  ok(resumo.outcome === "pulado" && resumo.motivo_pulado === "kill_switch", "1: kill_switch -> pulado");
  ok(d.c.n === 0, "1b: diagnosticar() nao chamado");
  ok(!supa._rpcs.includes("autocura_unitv_monitor_adquirir_lock"), "1c: RPC de lock nem foi tentada (guard antes do lock)");
}

// 2. pausado_ate futuro -> pulado
{
  const { resumo, diagN } = await rodar({ config: configInerte({ pausado_ate: new Date(NOW + 3_600_000).toISOString() }), estado: estadoZerado() });
  ok(resumo.outcome === "pulado" && resumo.motivo_pulado === "pausado", "2: pausado_ate futuro -> pulado");
  ok(diagN === 0, "2b: diag nao chamado");
}

// 3. pausado_ate far-future ('infinity') -> pulado
{
  const { resumo } = await rodar({ config: configInerte({ pausado_ate: "9999-12-31T00:00:00.000Z" }), estado: estadoZerado() });
  ok(resumo.outcome === "pulado" && resumo.motivo_pulado === "pausado", "3: pausado_ate 'infinity' -> pulado");
}

// 4. pausado_ate no passado -> roda
{
  const { resumo, diagN } = await rodar({ config: configInerte({ pausado_ate: new Date(NOW - 60_000).toISOString() }), estado: estadoZerado() });
  ok(resumo.outcome === "processado" && diagN === 1, "4: pausado_ate no passado -> tick roda");
}

// 5. lock FRESCO (2min) -> RPC devolve adquiriu=false -> sobreposto, diag nao chamado
{
  const est = estadoZerado({ tick_em_andamento_desde: isoMinAtras(2) });
  const { resumo, diagN, supa } = await rodar({ config: configInerte(), estado: est });
  ok(resumo.outcome === "pulado" && resumo.motivo_pulado === "sobreposto", "5: lock fresco -> sobreposto");
  ok(diagN === 0, "5b: diagnosticar() nao chamado sob lock");
  ok(supa._rpcs.includes("autocura_unitv_monitor_adquirir_lock"), "5c: a aquisicao foi via a RPC atomica (nao SELECT+decisao)");
  ok(est.tick_em_andamento_desde === isoMinAtras(2), "5d: lock do outro tick preservado (liberacao condicional nao o zerou)");
}

// 6. lock STALE (11min) -> RPC re-adquire -> roda -> libera no fim
{
  const est = estadoZerado({ tick_em_andamento_desde: isoMinAtras(11) });
  const { resumo, diagN, estado } = await rodar({ config: configInerte(), estado: est });
  ok(resumo.outcome === "processado" && diagN === 1, "6: lock stale (>= 10min) -> tick roda");
  ok(estado.tick_em_andamento_desde === null, "6b: lock LIBERADO ao fim");
}

// 7. lock liberado MESMO com excecao no update final (finally)
{
  const est = estadoZerado();
  const supa = makeFakeSupa({ config: configInerte(), estado: est, diagnosticos: [], agora });
  const fromOrig = supa.from;
  supa.from = (nome) => {
    const b = fromOrig(nome);
    if (nome === "autocura_unitv_monitor_estado") {
      const updOrig = b.update.bind(b);
      b.update = (p) => {
        if (p && Object.prototype.hasOwnProperty.call(p, "total_ticks")) {
          return { eq() { return this; }, then: (_r, rej) => rej(new Error("update do patch final falhou")) };
        }
        return updOrig(p);
      };
    }
    return b;
  };
  let lancou = false;
  try {
    await mon.executarTickMonitor({ supa, diagnosticar: diagContador().fn, enviarTemplate: enviarNoop, numeroJose: "x", agora });
  } catch { lancou = true; }
  ok(lancou === true, "7: excecao no update final propaga (a EF captura e responde 200)");
  ok(est.tick_em_andamento_desde === null, "7b: mesmo com erro, o lock foi liberado no finally");
}

// 8. lock e' assumido ANTES do diagnostico
{
  const est = estadoZerado();
  const supa = makeFakeSupa({ config: configInerte(), estado: est, diagnosticos: [], agora });
  let lockNoMomentoDoDiag = "nao-capturado";
  const diagInspetor = async () => { lockNoMomentoDoDiag = est.tick_em_andamento_desde; return TV; };
  await mon.executarTickMonitor({ supa, diagnosticar: diagInspetor, enviarTemplate: enviarNoop, numeroJose: "x", agora });
  ok(lockNoMomentoDoDiag === new Date(NOW).toISOString(), "8: lock ja assumido quando diagnosticar() rodou");
  ok(est.tick_em_andamento_desde === null, "8b: e liberado ao fim");
}

// 9. CONCORRENCIA REAL: 2 ticks simultaneos, lock LIVRE
{
  const est = estadoZerado();
  const supa = makeFakeSupa({ config: configInerte(), estado: est, diagnosticos: [], agora });
  const contador = { n: 0 };
  const diagCompartilhado = async () => { contador.n++; return TV; };
  const dep = { supa, diagnosticar: diagCompartilhado, enviarTemplate: enviarNoop, numeroJose: "x", agora };
  const [a, b] = await Promise.all([mon.executarTickMonitor(dep), mon.executarTickMonitor(dep)]);
  const outs = [a.outcome, b.outcome].sort();
  const motivos = [a.motivo_pulado, b.motivo_pulado];
  ok(JSON.stringify(outs) === JSON.stringify(["processado", "pulado"]), "9: exatamente 1 'processado' + 1 'pulado'");
  ok(motivos.includes("sobreposto"), "9b: o perdedor pulou com motivo 'sobreposto'");
  ok(contador.n === 1, "9c: diagnosticar() executou EXATAMENTE 1 vez");
  ok(est.tick_em_andamento_desde === null, "9d: lock liberado ao fim (vencedor liberou; perdedor nao tocou)");
  ok(est.total_ticks === 1, "9e: so' o vencedor incrementou total_ticks");
}

// 10. CONCORRENCIA REAL: 2 ticks simultaneos, lock STALE (reclamavel)
{
  const est = estadoZerado({ tick_em_andamento_desde: isoMinAtras(11), total_ticks: 7 });
  const supa = makeFakeSupa({ config: configInerte(), estado: est, diagnosticos: [], agora });
  const contador = { n: 0 };
  const diagCompartilhado = async () => { contador.n++; return TV; };
  const dep = { supa, diagnosticar: diagCompartilhado, enviarTemplate: enviarNoop, numeroJose: "x", agora };
  const [a, b] = await Promise.all([mon.executarTickMonitor(dep), mon.executarTickMonitor(dep)]);
  const outs = [a.outcome, b.outcome].sort();
  ok(JSON.stringify(outs) === JSON.stringify(["processado", "pulado"]), "10: lock stale + 2 concorrentes -> exatamente 1 reclama, 1 pula");
  ok(contador.n === 1, "10b: diagnosticar() executou EXATAMENTE 1 vez");
  ok(est.total_ticks === 8, "10c: exatamente 1 incremento sobre o valor anterior");
  ok(est.tick_em_andamento_desde === null, "10d: lock liberado ao fim");
}

console.log(falhas === 0 ? "\nTODOS OS TESTES OK" : `\n${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
