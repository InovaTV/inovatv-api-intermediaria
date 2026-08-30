// Testes locais de _shared/autocura_monitor.ts (REAL) -- F2. Foco:
// UNICO alerta ao Jose + dedupe por-codigo + janela de 12h.
//
// Regras travadas:
//   * so' UM tipo de alerta em F2 ("token morto confirmado, returnCode C").
//   * confirmado + sem alerta previo -> envia; grava
//     ultimo_codigo_desconhecido_alertado/_em.
//   * confirmado + mesmo C alertado ha < 12h -> suprime.
//   * confirmado + mesmo C alertado ha >= 12h -> re-envia.
//   * confirmado + C diferente do ultimo alertado -> envia.
//   * token_vivo apos um alerta -> zera o dedupe -> proxima confirmacao
//     (mesmo C) volta a alertar.
//   * falha de envio (enviarTemplate -> unavailable OU excecao) -> logado,
//     dedupe NAO atualizado, tick conclui.
//   * numeroJose vazio -> nao envia, sem quebrar.
//
// Como rodar: npx tsx scripts/testes/autocura_monitor_alerta/teste.mjs

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
const isoHorasAtras = (h) => new Date(NOW - h * 3_600_000).toISOString();

const TM = (c) => ({ veredito: "token_morto", probe_return_code: c, ancora_status: "nao_resolveu" });
const TV = { veredito: "token_vivo", probe_return_code: null, ancora_status: "ok" };

// batida 1 padrao para forcar "confirmado" (60min atras, C=5)
const HIST_CONFIRMA = (c = 5) => [{ criado_em: isoMinAtras(60), veredito: "token_morto", probe_return_code: c }];

function envioContador() {
  const chamadas = [];
  const fn = async (numero, nome, idioma, params) => {
    chamadas.push({ numero, nome, idioma, params });
    return { outcome: "success", messageId: "m1" };
  };
  return { fn, chamadas };
}

async function rodar({ diag, diagnosticos, estado = estadoZerado(), config = configInerte(), enviar, numeroJose = "5517900000000" }) {
  const supa = makeFakeSupa({ config, estado, diagnosticos, agora });
  const resumo = await mon.executarTickMonitor({
    supa, diagnosticar: async () => diag, enviarTemplate: enviar, numeroJose, agora,
  });
  return { resumo, estado };
}

// 1. confirmado + sem alerta previo -> envia e grava dedupe
{
  const e = envioContador();
  const est = estadoZerado();
  const { resumo } = await rodar({ diag: TM(5), diagnosticos: HIST_CONFIRMA(5), estado: est, enviar: e.fn });
  ok(resumo.confirmacao === "confirmado", "1: confirmado");
  ok(e.chamadas.length === 1, "1b: enviou 1 alerta");
  ok(e.chamadas[0].nome === "nova_transferencia_humana" && e.chamadas[0].idioma === "pt_BR", "1c: template/idioma corretos");
  ok(/returnCode 5/.test(e.chamadas[0].params[0]), "1d: mensagem cita o returnCode");
  ok(est.ultimo_codigo_desconhecido_alertado === 5, "1e: gravou ultimo_codigo_desconhecido_alertado=5");
  ok(est.ultimo_codigo_desconhecido_alertado_em === new Date(NOW).toISOString(), "1f: gravou o timestamp do alerta");
  ok(resumo.alerta.enviado === true && resumo.alerta.dedupe_suprimiu === false, "1g: resumo.alerta");
}

// 2. mesmo C alertado ha 3h -> suprime
{
  const e = envioContador();
  const est = estadoZerado({ ultimo_codigo_desconhecido_alertado: 5, ultimo_codigo_desconhecido_alertado_em: isoHorasAtras(3) });
  const { resumo } = await rodar({ diag: TM(5), diagnosticos: HIST_CONFIRMA(5), estado: est, enviar: e.fn });
  ok(e.chamadas.length === 0, "2: mesmo C ha 3h -> nao re-envia");
  ok(resumo.alerta.dedupe_suprimiu === true, "2b: resumo marca dedupe_suprimiu");
  ok(est.ultimo_codigo_desconhecido_alertado_em === isoHorasAtras(3), "2c: timestamp do alerta preservado");
}

// 3. mesmo C alertado ha 13h -> re-envia
{
  const e = envioContador();
  const est = estadoZerado({ ultimo_codigo_desconhecido_alertado: 5, ultimo_codigo_desconhecido_alertado_em: isoHorasAtras(13) });
  await rodar({ diag: TM(5), diagnosticos: HIST_CONFIRMA(5), estado: est, enviar: e.fn });
  ok(e.chamadas.length === 1, "3: mesmo C ha 13h (> 12h) -> re-envia");
  ok(est.ultimo_codigo_desconhecido_alertado_em === new Date(NOW).toISOString(), "3b: timestamp atualizado");
}

// 4. C diferente do ultimo alertado -> envia
{
  const e = envioContador();
  const est = estadoZerado({ ultimo_codigo_desconhecido_alertado: 5, ultimo_codigo_desconhecido_alertado_em: isoMinAtras(30) });
  await rodar({ diag: TM(9), diagnosticos: HIST_CONFIRMA(9), estado: est, enviar: e.fn });
  ok(e.chamadas.length === 1, "4: C=9 != ultimo alertado (5) -> envia");
  ok(est.ultimo_codigo_desconhecido_alertado === 9, "4b: dedupe passa a rastrear C=9");
}

// 5. token_vivo apos alerta -> zera dedupe -> proxima confirmacao (mesmo C) alerta de novo
{
  const est = estadoZerado({ ultimo_codigo_desconhecido_alertado: 5, ultimo_codigo_desconhecido_alertado_em: isoMinAtras(10) });
  // tick A: token_vivo
  await rodar({ diag: TV, diagnosticos: [], estado: est, enviar: envioContador().fn });
  ok(est.ultimo_codigo_desconhecido_alertado === null, "5: token_vivo zerou o dedupe");
  // tick B: nova confirmacao do MESMO C=5
  const e = envioContador();
  await rodar({ diag: TM(5), diagnosticos: HIST_CONFIRMA(5), estado: est, enviar: e.fn });
  ok(e.chamadas.length === 1, "5b: apos recuperacao, mesma morte (C=5) volta a alertar");
}

// 6. envio falha (unavailable) -> nao grava dedupe, tick conclui
{
  const est = estadoZerado();
  const enviarFalha = async () => ({ outcome: "unavailable" });
  const { resumo } = await rodar({ diag: TM(5), diagnosticos: HIST_CONFIRMA(5), estado: est, enviar: enviarFalha });
  ok(resumo.confirmacao === "confirmado", "6: confirmado mesmo com envio indisponivel");
  ok(resumo.alerta.enviado === false, "6b: resumo.alerta.enviado=false");
  ok(est.ultimo_codigo_desconhecido_alertado === null, "6c: dedupe NAO gravado (envio falhou)");
  ok(est.total_token_morto_confirmado === 1, "6d: contador de confirmado ainda incrementa");
}

// 7. envio lanca excecao -> capturado, tick conclui, dedupe nao gravado
{
  const est = estadoZerado();
  const enviarExcecao = async () => { throw new Error("boom"); };
  const { resumo } = await rodar({ diag: TM(5), diagnosticos: HIST_CONFIRMA(5), estado: est, enviar: enviarExcecao });
  ok(resumo.confirmacao === "confirmado" && resumo.alerta.enviado === false, "7: excecao no envio nao derruba o tick");
  ok(est.ultimo_codigo_desconhecido_alertado === null, "7b: dedupe nao gravado");
}

// 8. numeroJose vazio -> nao envia, sem quebrar
{
  const e = envioContador();
  const est = estadoZerado();
  const { resumo } = await rodar({ diag: TM(5), diagnosticos: HIST_CONFIRMA(5), estado: est, enviar: e.fn, numeroJose: "" });
  ok(e.chamadas.length === 0 && resumo.confirmacao === "confirmado", "8: sem numero do Jose -> confirma e nao envia");
}

// 9. PENDENTE nunca alerta
{
  const e = envioContador();
  const { resumo } = await rodar({ diag: TM(5), diagnosticos: [], estado: estadoZerado(), enviar: e.fn });
  ok(resumo.confirmacao === "pendente" && e.chamadas.length === 0, "9: pendente nao alerta");
}

console.log(falhas === 0 ? "\nTODOS OS TESTES OK" : `\n${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
