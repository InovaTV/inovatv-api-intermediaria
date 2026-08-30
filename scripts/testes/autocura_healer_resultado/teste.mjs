// F4 -- testes de _shared/autocura_resultado.ts (REAL) no canal='healer'.
//
// Regras travadas:
//   * outcome='sucesso' -> registrar_fim(ciclo,'sucesso',null,{...}) +
//     3a validacao INDEPENDENTE (le Vault + /api/account read-only):
//       passou -> alerta informativo (MSG_AUTOCURA_OK)
//       falhou -> alerta CRITICO (MSG_AUTOCURA_SUCESSO_MAS_3A_FALHOU)
//   * outcome='falhou' -> registrar_fim(ciclo,'falhou',failure_class,{...})
//       revalidacao_falhou -> MSG_AUTOCURA_REVALIDACAO_CRITICA
//       outros             -> msgAutocuraFalhou(failure_class)
//   * dedupe 6h: se ha ciclo 'disparo' com alertado_jose=true nas ultimas
//     6h -> NAO re-alerta, registrar_fim recebe alertado_jose=false.
//   * NUNCA insere em autocura_unitv_ocr_metricas no canal healer.
//   * numeroJose vazio -> processa sem alertar, sem quebrar.
//
// Rodar: npx tsx scripts/testes/autocura_healer_resultado/teste.mjs

import { makeFakeSupa } from "../_autocura_lib/fake_supa.mjs";

const mod = await import("../../../supabase/functions/_shared/autocura_resultado.ts");

let falhas = 0;
function ok(c, m) { if (!c) { falhas++; console.error(`FALHA: ${m}`); } else console.log(`ok: ${m}`); }

const NOW = Date.parse("2026-08-30T12:00:00.000Z");
const agora = () => new Date(NOW);
const TOKEN = "0123456789abcdef0123456789abcdef";

function envio() {
  const c = { n: 0, textos: [] };
  const fn = async (_num, _nome, _idi, params) => { c.n++; c.textos.push(params[0]); return { outcome: "success", messageId: "x" }; };
  return { fn, c };
}

function supaHealer({ ciclos = [], vault = TOKEN } = {}) {
  return makeFakeSupa({
    config: null, estado: null, agora,
    rpcHandlers: {
      autocura_unitv_registrar_fim: () => ({ data: null, error: null }),
      unitv_dealer_token_ler: () => ({ data: vault, error: null }),
    },
    tabelasExtra: { autocura_unitv_ciclos: ciclos },
  });
}

const depsBase = (supa, e, over = {}) => ({
  supa, enviarTemplate: e.fn, numeroJose: "5517900000000", agora,
  canal: "healer", anchorSn: "ANCORA", dealerName: "dealer",
  resolverConta: over.resolverConta ?? (async () => ({ ok: true })),
});

// 1. SUCESSO + 3a validacao OK -> registrar_fim + alerta informativo
{
  const supa = supaHealer();
  const e = envio();
  const r = await mod.processarResultado(
    { ciclo_id: "d1", outcome: "sucesso", metrics: { login_posts: 1, vault_gravado: true, captcha_refreshes: 2, captcha_confianca_bucket: "alta" } },
    depsBase(supa, e),
  );
  ok(r.outcome === "processado", "1: processado");
  const rf = supa._rpcArgs.find((x) => x.nome === "autocura_unitv_registrar_fim");
  ok(rf && rf.args.p_outcome === "sucesso" && rf.args.p_failure_class === null, "1b: registrar_fim(sucesso,null)");
  ok(rf.args.p_metrics.login_posts === 1 && rf.args.p_metrics.vault_gravado === true
     && rf.args.p_metrics.captcha_refreshes === 2 && rf.args.p_metrics.alertado_jose === true, "1c: metrics do registrar_fim (com alertado_jose=true)");
  ok(supa._rpcArgs.some((x) => x.nome === "unitv_dealer_token_ler"), "1d: leu o Vault para a 3a validacao");
  ok(e.c.n === 1 && e.c.textos[0] === mod.MSG_AUTOCURA_OK, "1e: alerta informativo (MSG_AUTOCURA_OK)");
  ok(!supa._inserts.some((x) => x.table === "autocura_unitv_ocr_metricas"), "1f: NAO insere em autocura_unitv_ocr_metricas");
}

// 2. SUCESSO mas 3a validacao FALHA -> alerta CRITICO
{
  const supa = supaHealer();
  const e = envio();
  await mod.processarResultado(
    { ciclo_id: "d2", outcome: "sucesso", metrics: { login_posts: 1, vault_gravado: true } },
    depsBase(supa, e, { resolverConta: async () => ({ ok: false }) }),
  );
  ok(e.c.n === 1 && e.c.textos[0] === mod.MSG_AUTOCURA_SUCESSO_MAS_3A_FALHOU, "2: 3a validacao falha -> MSG_AUTOCURA_SUCESSO_MAS_3A_FALHOU");
}

// 3. SUCESSO mas Vault veio vazio -> 3a validacao falha
{
  const supa = supaHealer({ vault: null });
  const e = envio();
  await mod.processarResultado(
    { ciclo_id: "d3", outcome: "sucesso", metrics: { login_posts: 1, vault_gravado: true } },
    depsBase(supa, e),
  );
  ok(e.c.n === 1 && e.c.textos[0] === mod.MSG_AUTOCURA_SUCESSO_MAS_3A_FALHOU, "3: Vault vazio -> alerta critico de 3a validacao");
}

// 4. FALHOU (login_recusado) -> registrar_fim + alerta com a classe
{
  const supa = supaHealer();
  const e = envio();
  await mod.processarResultado(
    { ciclo_id: "d4", outcome: "falhou", failure_class: "login_recusado", metrics: { login_posts: 1, vault_gravado: false } },
    depsBase(supa, e),
  );
  const rf = supa._rpcArgs.find((x) => x.nome === "autocura_unitv_registrar_fim");
  ok(rf.args.p_outcome === "falhou" && rf.args.p_failure_class === "login_recusado", "4: registrar_fim(falhou, login_recusado)");
  ok(e.c.n === 1 && /login_recusado/.test(e.c.textos[0]), "4b: alerta cita a failure_class");
  ok(!supa._rpcArgs.some((x) => x.nome === "unitv_dealer_token_ler"), "4c: NAO faz 3a validacao quando outcome != sucesso");
}

// 5. FALHOU (revalidacao_falhou) -> alerta CRITICO especifico
{
  const supa = supaHealer();
  const e = envio();
  await mod.processarResultado(
    { ciclo_id: "d5", outcome: "falhou", failure_class: "revalidacao_falhou", metrics: { login_posts: 1, vault_gravado: true } },
    depsBase(supa, e),
  );
  ok(e.c.n === 1 && e.c.textos[0] === mod.MSG_AUTOCURA_REVALIDACAO_CRITICA, "5: revalidacao_falhou -> MSG_AUTOCURA_REVALIDACAO_CRITICA");
}

// 6. DEDUPE 6h: ja houve ciclo disparo com alerta nas ultimas 6h -> nao re-alerta
{
  const supa = supaHealer({
    ciclos: [{ id: "prev", tipo: "disparo", alertado_jose: true, ended_at: new Date(NOW - 2 * 3_600_000).toISOString() }],
  });
  const e = envio();
  await mod.processarResultado(
    { ciclo_id: "d6", outcome: "falhou", failure_class: "excecao", metrics: { login_posts: 1 } },
    depsBase(supa, e),
  );
  ok(e.c.n === 0, "6: dedupe -- nao re-alerta dentro de 6h");
  const rf = supa._rpcArgs.find((x) => x.nome === "autocura_unitv_registrar_fim");
  ok(rf.args.p_metrics.alertado_jose === false, "6b: registrar_fim recebe alertado_jose=false");
}

// 6c. ciclo antigo (> 6h) NAO conta para dedupe -> alerta normalmente
{
  const supa = supaHealer({
    ciclos: [{ id: "velho", tipo: "disparo", alertado_jose: true, ended_at: new Date(NOW - 9 * 3_600_000).toISOString() }],
  });
  const e = envio();
  await mod.processarResultado(
    { ciclo_id: "d6c", outcome: "falhou", failure_class: "excecao", metrics: {} },
    depsBase(supa, e),
  );
  ok(e.c.n === 1, "6c: alerta de disparo com alertado_jose > 6h nao bloqueia");
}

// 7. numeroJose vazio -> processa, registrar_fim, sem alerta, sem quebrar
{
  const supa = supaHealer();
  const e = envio();
  const r = await mod.processarResultado(
    { ciclo_id: "d7", outcome: "sucesso", metrics: { login_posts: 1, vault_gravado: true } },
    { ...depsBase(supa, e), numeroJose: "" },
  );
  ok(r.outcome === "processado" && e.c.n === 0, "7: sem numero do Jose -> processa sem alertar");
  ok(supa._rpcArgs.some((x) => x.nome === "autocura_unitv_registrar_fim"), "7b: ainda fecha o ciclo");
}

// 8. cross-check canal x outcome (funcao pura)
{
  ok(mod.outcomePermitidoNoCanal("healer", "sucesso") === true, "8a: healer aceita 'sucesso'");
  ok(mod.outcomePermitidoNoCanal("healer", "falhou") === true, "8b: healer aceita 'falhou'");
  ok(mod.outcomePermitidoNoCanal("healer", "calibracao") === false, "8c: healer REJEITA 'calibracao'");
  ok(mod.outcomePermitidoNoCanal("ocr", "sucesso") === false, "8d: ocr REJEITA 'sucesso'");
  ok(mod.outcomePermitidoNoCanal("ocr", "calibracao") === true, "8e: ocr aceita 'calibracao'");
}

console.log(falhas === 0 ? "\nTODOS OS TESTES OK" : `\n${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
