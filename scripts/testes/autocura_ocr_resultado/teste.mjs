// F3-A -- testes de _shared/autocura_resultado.ts (REAL) com fakes.
//
// Regras travadas:
//   * outcome='calibracao' -> registrar_fim(ciclo_id,'calibracao',null,...)
//     + INSERT em autocura_unitv_ocr_metricas com SO' as colunas da
//     allowlist (nunca predicao/imagem/valor).
//   * outcome != 'calibracao' -> registrar_fim(outcome, failure_class);
//     NAO grava metricas.
//   * metrics.estilo_alterado === true -> alerta ao Jose (dedupe 24h).
//   * login_posts nunca > 0 (o runner nao tem credenciais).
//
// Rodar: npx tsx scripts/testes/autocura_ocr_resultado/teste.mjs

import { makeFakeSupa } from "../_autocura_lib/fake_supa.mjs";

const mod = await import("../../../supabase/functions/_shared/autocura_resultado.ts");

let falhas = 0;
function ok(c, m) { if (!c) { falhas++; console.error(`FALHA: ${m}`); } else console.log(`ok: ${m}`); }

const NOW = Date.parse("2026-08-30T03:10:00.000Z");
const agora = () => new Date(NOW);

function envioContador() {
  const c = { n: 0, params: [] };
  const fn = async (num, nome, idi, params) => { c.n++; c.params.push({ nome, idi, params }); return { outcome: "success", messageId: "x" }; };
  return { fn, c };
}

function supaFake({ metricasExistentes = [] } = {}) {
  return makeFakeSupa({
    config: null, estado: null, agora,
    rpcHandlers: { autocura_unitv_registrar_fim: () => ({ data: null, error: null }) },
    tabelasExtra: { autocura_unitv_ocr_metricas: metricasExistentes },
  });
}

const METRICAS_OK = {
  amostras_total: 20, amostras_4_segmentos: 20, amostras_gate_ok: 19,
  amostras_formato_invalido: 0, amostras_obviamente_invalida: 1,
  score_top1_p50: 0.991, score_top1_p90: 0.999, score_top1_min: 0.94,
  margem_p50: 0.42, margem_p10: 0.19,
  bucket_alta: 19, bucket_media: 1, bucket_baixa: 0,
  refreshes_total: 19, runner_sha: "deadbee", estilo_alterado: false,
  captcha_confianca_bucket: "alta", login_posts: 0,
};

// 1. calibracao ok -> registrar_fim('calibracao') + insert de metricas com allowlist
{
  const e = envioContador();
  const supa = supaFake();
  const r = await mod.processarResultado(
    { ciclo_id: "c1", outcome: "calibracao", metrics: { ...METRICAS_OK } },
    { supa, enviarTemplate: e.fn, numeroJose: "5517900000000", agora },
  );
  ok(r.outcome === "processado", "1: processado");
  const rf = supa._rpcArgs.find((x) => x.nome === "autocura_unitv_registrar_fim");
  ok(rf && rf.args.p_ciclo_id === "c1" && rf.args.p_outcome === "calibracao" && rf.args.p_failure_class === null, "1b: registrar_fim('calibracao', null)");
  ok(rf.args.p_metrics.captcha_refreshes === 19 && rf.args.p_metrics.captcha_confianca_bucket === "alta", "1c: metrics do registrar_fim");
  const ins = supa._inserts.find((x) => x.table === "autocura_unitv_ocr_metricas");
  ok(ins, "1d: inseriu 1 linha em autocura_unitv_ocr_metricas");
  ok(ins.row.ciclo_id === "c1" && ins.row.amostras_total === 20 && ins.row.score_top1_p50 === 0.991, "1e: campos agregados gravados");
  // nenhuma chave suspeita
  const proibidas = ["predicao", "captcha", "imagem", "png", "base64", "digitos", "valor", "login_posts", "captcha_confianca_bucket"];
  ok(proibidas.every((k) => !(k in ins.row)), "1f: linha de metricas NAO carrega predicao/imagem/valor/login_posts");
  ok(e.c.n === 0, "1g: sem alerta (estilo_alterado false)");
}

// 2. outcome != calibracao (falha do runner) -> registrar_fim(outcome, failure_class); SEM metricas
{
  const supa = supaFake();
  await mod.processarResultado(
    { ciclo_id: "c2", outcome: "indeterminado", failure_class: "excecao", metrics: { login_posts: 0 } },
    { supa, enviarTemplate: envioContador().fn, numeroJose: "x", agora },
  );
  const rf = supa._rpcArgs.find((x) => x.nome === "autocura_unitv_registrar_fim");
  ok(rf.args.p_outcome === "indeterminado" && rf.args.p_failure_class === "excecao", "2: registrar_fim(indeterminado, excecao)");
  ok(!supa._inserts.some((x) => x.table === "autocura_unitv_ocr_metricas"), "2b: NAO grava metricas quando nao e' calibracao");
}

// 3. estilo_alterado -> alerta ao Jose (1a vez)
{
  const e = envioContador();
  const supa = supaFake();
  await mod.processarResultado(
    { ciclo_id: "c3", outcome: "calibracao", metrics: { ...METRICAS_OK, estilo_alterado: true } },
    { supa, enviarTemplate: e.fn, numeroJose: "5517900000000", agora },
  );
  ok(e.c.n === 1, "3: alerta enviado quando estilo_alterado");
  ok(/estilo|dimensao/i.test(e.c.params[0].params[0]), "3b: mensagem fala de estilo/dimensao do CAPTCHA");
}

// 4. estilo_alterado mas ja houve alerta nas ultimas 24h -> dedupe (nao re-alerta)
{
  const e = envioContador();
  // 1 linha previa com estilo_alterado nas ultimas 24h; a desta execucao sera a 2a
  const supa = supaFake({ metricasExistentes: [{ id: "prev", estilo_alterado: true, executado_em: new Date(NOW - 3 * 3_600_000).toISOString() }] });
  await mod.processarResultado(
    { ciclo_id: "c4", outcome: "calibracao", metrics: { ...METRICAS_OK, estilo_alterado: true } },
    { supa, enviarTemplate: e.fn, numeroJose: "5517900000000", agora },
  );
  ok(e.c.n === 0, "4: dedupe -- nao re-alerta estilo dentro de 24h");
}

// 5. estilo_alterado + numeroJose vazio -> nao quebra, nao envia
{
  const e = envioContador();
  const supa = supaFake();
  const r = await mod.processarResultado(
    { ciclo_id: "c5", outcome: "calibracao", metrics: { ...METRICAS_OK, estilo_alterado: true } },
    { supa, enviarTemplate: e.fn, numeroJose: "", agora },
  );
  ok(r.outcome === "processado" && e.c.n === 0, "5: sem numero do Jose -> processa sem alertar");
}

console.log(falhas === 0 ? "\nTODOS OS TESTES OK" : `\n${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
