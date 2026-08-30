// F3-A -- testes de _shared/autocura_ocr_agendador.ts (REAL) com fakes.
//
// Regras travadas:
//   * chama autocura_unitv_expirar_orfaos() todo tick.
//   * dispara SO' se ultima calibracao > calibracao_intervalo_h E
//     pode_disparar('calibracao') == true.
//   * o tipo do ciclo e' SEMPRE 'calibracao', o trigger 'agendado' --
//     NUNCA 'disparo'.
//   * dispatch falhou -> fecha o ciclo (registrar_fim) -> nao orfana.
//   * respeita o motivo de pode_disparar (cap_calibracao_diario etc).
//
// Rodar: npx tsx scripts/testes/autocura_ocr_agendador/teste.mjs

import { makeFakeSupa, configInerte } from "../_autocura_lib/fake_supa.mjs";

const mod = await import("../../../supabase/functions/_shared/autocura_ocr_agendador.ts");

let falhas = 0;
function ok(c, m) { if (!c) { falhas++; console.error(`FALHA: ${m}`); } else console.log(`ok: ${m}`); }

const NOW = Date.parse("2026-08-30T03:00:00.000Z");
const agora = () => new Date(NOW);
const hAtras = (h) => new Date(NOW - h * 3_600_000).toISOString();

function fakeRpcs({ podeCalibrar = true, motivo = "ok", orfaos = 0, registrarInicioId = "ciclo-novo-1", registrarInicioErro = null } = {}) {
  return {
    autocura_unitv_expirar_orfaos: () => ({ data: orfaos, error: null }),
    autocura_unitv_pode_disparar: (args) => {
      // so' deve ser chamado com p_tipo='calibracao'
      if (args?.p_tipo !== "calibracao") return { data: [{ pode: false, motivo: "TIPO_ERRADO_" + args?.p_tipo }], error: null };
      return { data: [{ pode: podeCalibrar, motivo }], error: null };
    },
    autocura_unitv_registrar_inicio: (args) => {
      if (args?.p_tipo !== "calibracao" || args?.p_trigger !== "agendado") {
        return { data: null, error: { message: "TIPO/TRIGGER ERRADO: " + JSON.stringify(args) } };
      }
      if (registrarInicioErro) return { data: null, error: { message: registrarInicioErro } };
      return { data: registrarInicioId, error: null };
    },
    autocura_unitv_registrar_fim: () => ({ data: null, error: null }),
  };
}

function contarDispatch() {
  const c = { n: 0, ids: [] };
  const fn = async (id) => { c.n++; c.ids.push(id); return { outcome: "disparado" }; };
  return { fn, c };
}

async function rodar({ ciclos = [], rpcOpts = {}, dispatch }) {
  const supa = makeFakeSupa({
    config: configInerte(),
    estado: null,
    agora,
    rpcHandlers: fakeRpcs(rpcOpts),
    tabelasExtra: { autocura_unitv_ciclos: ciclos },
  });
  const d = dispatch ?? contarDispatch();
  const resumo = await mod.executarAgendadorOcr({ supa, dispararWorkflow: d.fn, agora });
  return { resumo, supa, d };
}

// 1. sem calibracao anterior + pode_disparar ok -> dispara 'calibracao'
{
  const { resumo, supa, d } = await rodar({ ciclos: [] });
  ok(resumo.outcome === "disparado", "1: dispara quando nao ha calibracao anterior");
  ok(d.c.n === 1 && d.c.ids[0] === "ciclo-novo-1", "1b: workflow disparado com o ciclo_id novo");
  ok(supa._rpcs.includes("autocura_unitv_expirar_orfaos"), "1c: chamou expirar_orfaos");
  const ri = supa._rpcArgs.find((r) => r.nome === "autocura_unitv_registrar_inicio");
  ok(ri && ri.args.p_tipo === "calibracao" && ri.args.p_trigger === "agendado", "1d: registrar_inicio('calibracao','agendado')");
  ok(!supa._rpcArgs.some((r) => r.args?.p_tipo === "disparo"), "1e: NENHUMA chamada com p_tipo='disparo'");
}

// 2. calibracao ha 10h (< 24h) -> pulado por intervalo
{
  const { resumo, d } = await rodar({ ciclos: [{ tipo: "calibracao", iniciado_em: hAtras(10) }] });
  ok(resumo.outcome === "pulado" && resumo.motivo === "intervalo_nao_completo", "2: pulado por intervalo (<24h)");
  ok(d.c.n === 0, "2b: nao disparou");
}

// 3. calibracao ha 25h -> intervalo ok, mas pode_disparar nega (cap_calibracao_diario)
{
  const { resumo, d } = await rodar({
    ciclos: [{ tipo: "calibracao", iniciado_em: hAtras(25) }],
    rpcOpts: { podeCalibrar: false, motivo: "cap_calibracao_diario" },
  });
  ok(resumo.outcome === "pulado" && resumo.motivo === "cap_calibracao_diario", "3: respeita motivo de pode_disparar");
  ok(d.c.n === 0, "3b: nao disparou");
}

// 4. pode_disparar nega por kill_switch -> pulado
{
  const { resumo } = await rodar({ ciclos: [], rpcOpts: { podeCalibrar: false, motivo: "kill_switch" } });
  ok(resumo.outcome === "pulado" && resumo.motivo === "kill_switch", "4: kill_switch -> pulado");
}

// 5. registrar_inicio falha (ex.: ciclo ja em andamento) -> pulado, sem dispatch
{
  const { resumo, d } = await rodar({ ciclos: [], rpcOpts: { registrarInicioErro: "ciclo ja em andamento" } });
  ok(resumo.outcome === "pulado" && resumo.motivo === "registrar_inicio_falhou", "5: registrar_inicio falhou -> pulado");
  ok(d.c.n === 0, "5b: nao disparou");
}

// 6. dispatch do workflow falha -> fecha o ciclo (registrar_fim) e reporta pulado
{
  const dispatchFalha = { c: { n: 0, ids: [] }, fn: async (id) => { dispatchFalha.c.n++; dispatchFalha.c.ids.push(id); return { outcome: "falha", detalhe: "HTTP 500" }; } };
  const { resumo, supa } = await rodar({ ciclos: [], dispatch: dispatchFalha });
  ok(resumo.outcome === "pulado" && resumo.motivo === "dispatch_falhou", "6: dispatch falhou -> pulado");
  const rf = supa._rpcArgs.find((r) => r.nome === "autocura_unitv_registrar_fim");
  ok(rf && rf.args.p_ciclo_id === "ciclo-novo-1" && rf.args.p_outcome === "indeterminado", "6b: fechou o ciclo (registrar_fim indeterminado) -> nao orfana");
}

// 7. orfaos fechados sao reportados
{
  const { resumo } = await rodar({ ciclos: [], rpcOpts: { orfaos: 2 } });
  ok(resumo.orfaos_fechados === 2, "7: orfaos_fechados propagado");
}

console.log(falhas === 0 ? "\nTODOS OS TESTES OK" : `\n${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
