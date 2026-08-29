// Testes locais de supabase/functions/renovacao-sigma-resultado/index.ts
// (REAL) -- Etapa 2 (Renovacao UniTV, Bloco 4).
//
// Foco: (1) sucesso UniTV segue o MESMO caminho de sucesso existente
// (template pagamento_confirmado); (2) rocketDesync gera nota de
// sistema + aviso ao Jose, SEM acionarTransferenciaHumana e SEM 2a
// mensagem ao cliente; (3) falha/ambiguo seguem a transferencia
// generica de sempre.
//
// _shared/http.ts e _shared/mensagens_fixas.ts sao REAIS. As demais
// deps sao fakes que so' registram chamadas.
//
// Como rodar: npx tsx scripts/testes/renovacao_sigma_resultado_unitv/teste.mjs

import { register } from "node:module";
register("./mock-loader.mjs", import.meta.url);

const fTok = await import("./fake_tokens_renovacao.mjs");
const fLote = await import("./fake_renovacoes_lote.mjs");
const fConv = await import("./fake_conversas_estado.mjs");
const fNotif = await import("./fake_notificacao_transferencia.mjs");
const fMsg = await import("./fake_mensagens_atendimento.mjs");
const fWa = await import("./fake_whatsapp_client.mjs");

const TOKEN_INTERNO = "callback-token-de-teste";
let handler;
globalThis.Deno = {
  serve: (fn) => { handler = fn; },
  env: { get: (n) => (n === "RENOVACAO_SIGMA_CALLBACK_TOKEN" ? TOKEN_INTERNO : n === "WHATSAPP_JOSE_NUMERO" ? "5511777777777" : undefined) },
};

await import("../../../supabase/functions/renovacao-sigma-resultado/index.ts");

let falhas = 0;
function ok(cond, msg) {
  if (!cond) { falhas++; console.error(`FALHA: ${msg}`); }
  else console.log(`ok: ${msg}`);
}

function req(corpo) {
  return new Request("https://x.test/renovacao-sigma-resultado", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Internal-Token": TOKEN_INTERNO },
    body: JSON.stringify(corpo),
  });
}
function resetar() {
  fTok.resetar(); fLote.resetar(); fConv.resetar(); fNotif.resetar(); fMsg.resetar(); fWa.resetar();
}
const TOKEN_UNITV = {
  conversation_id: "conv-1",
  cliente_nome: "José Antonio Dos Santos",
  plano_nome: "Mensal",
  servidor_nome: "UNITV",
  telefone: "5517981625486",
};

// =====================================================================
// C1: individual UniTV sucesso, SEM rocketDesync -> caminho de sucesso
//     normal (template), nada de rocket/transferencia.
// =====================================================================
{
  resetar();
  fTok.configurarToken(TOKEN_UNITV);
  const resp = await handler(req({ operacao_id: "op-1", resultado: "sucesso", vencimentoConfirmado: "2026-12-03T02:31:01-03:00" }));
  const body = await resp.json();
  ok(body.outcome === "sucesso_processado", "C1: outcome sucesso_processado");
  ok(fWa.templatesEnviados().some((t) => t.nome === "pagamento_confirmado"), "C1: template pagamento_confirmado enviado (caminho normal)");
  ok(fConv.acionamentos().length === 0, "C1: NENHUM acionarTransferenciaHumana");
  ok(!fWa.templatesEnviados().some((t) => t.nome === "nova_transferencia_humana"), "C1: sem aviso de transferencia");
  ok(!fMsg.mensagens().some((m) => /Rocket/.test(m.texto)), "C1: sem nota de sistema sobre Rocket");
}

// =====================================================================
// C2: individual UniTV sucesso + rocketDesync -> template normal +
//     nota de sistema + aviso ao Jose; NUNCA acionarTransferenciaHumana,
//     NUNCA 2a mensagem ao cliente.
// =====================================================================
{
  resetar();
  fTok.configurarToken(TOKEN_UNITV);
  const resp = await handler(req({ operacao_id: "op-2", resultado: "sucesso", vencimentoConfirmado: "2026-12-03T02:31:01-03:00", rocketDesync: true }));
  await resp.json();
  ok(fWa.templatesEnviados().some((t) => t.nome === "pagamento_confirmado"), "C2: cliente ainda recebe o sucesso (template pagamento_confirmado)");
  ok(fConv.acionamentos().length === 0, "C2: rocketDesync NUNCA aciona transferencia humana (sem aguardando_humano)");
  ok(fNotif.notificacoes().length === 0, "C2: rocketDesync NUNCA chama notificarTransferenciaHumana");
  ok(fMsg.mensagens().some((m) => m.origem === "sistema" && /NÃO sincronizado no Rocket/.test(m.texto)), "C2: nota de sistema sobre a dessincronia");
  const aviso = fWa.templatesEnviados().find((t) => t.nome === "nova_transferencia_humana");
  ok(aviso && aviso.parametros[0] === "renovacao_unitv:rocket_desync", "C2: aviso ao Jose com motivo 'renovacao_unitv:rocket_desync'");
  // 2a mensagem ao cliente: so' o template de sucesso (nao ha' enviarMensagemWhatsApp ao cliente no caminho individual)
  ok(fWa.mensagensEnviadas().length === 0, "C2: nenhuma 2a mensagem de texto ao cliente");
}

// =====================================================================
// C3: individual UniTV falha -> transferencia generica de sempre.
// =====================================================================
{
  resetar();
  fTok.configurarToken(TOKEN_UNITV);
  const resp = await handler(req({ operacao_id: "op-3", resultado: "falha", detalhe: "painel recusou (rc=1001)" }));
  await resp.json();
  ok(!fWa.templatesEnviados().some((t) => t.nome === "pagamento_confirmado"), "C3: falha -> nenhum template de sucesso");
  const acion = fConv.acionamentos();
  ok(acion.length === 1 && acion[0].motivo === "renovacao_sigma:falha", "C3: acionarTransferenciaHumana com motivo 'renovacao_sigma:falha'");
  ok(fNotif.notificacoes().length === 1, "C3: notificarTransferenciaHumana chamado");
}

// =====================================================================
// C4: LOTE 2xUniTV, ambos sucesso, 1 com rocketDesync -> concluida,
//     mensagem consolidada, SEM transferencia, MAS com nota+aviso da
//     dessincronia (independente de estadoFinal).
// =====================================================================
{
  resetar();
  fLote.configurarLote({ grupo_id: "grp-1", conversation_id: "conv-lote", telefone: "5517000000000" });
  fLote.configurarFilhos([{ id: "f1" }, { id: "f2" }]);
  const resp = await handler(req({
    operacao_id: "op-4", grupo_id: "grp-1",
    resultados: [
      { token_id: "f1", tipo: "unitv", servidor_nome: "UNITV", cliente_nome: "A", resultado: "sucesso", vencimentoConfirmado: "2026-12-03T02:31:01-03:00" },
      { token_id: "f2", tipo: "unitv", servidor_nome: "UNITV", cliente_nome: "B", resultado: "sucesso", vencimentoConfirmado: "2026-12-10T02:31:01-03:00", rocketDesync: true },
    ],
  }));
  const body = await resp.json();
  ok(body.outcome === "lote_concluida", "C4: lote concluida (todos sucesso)");
  ok(fWa.mensagensEnviadas().length === 1, "C4: 1 mensagem consolidada ao cliente");
  ok(fConv.acionamentos().length === 0, "C4: lote concluida -> NENHUMA transferencia");
  ok(fMsg.mensagens().some((m) => m.origem === "sistema" && /NÃO sincronizou no Rocket/.test(m.texto)), "C4: nota de sistema da dessincronia (uma vez)");
  const aviso = fWa.templatesEnviados().find((t) => t.nome === "nova_transferencia_humana");
  ok(aviso && aviso.parametros[0] === "renovacao_unitv:rocket_desync", "C4: aviso ao Jose da dessincronia");
}

// =====================================================================
// C5: LOTE parcial (1 sucesso UniTV, 1 falha) -> transferencia
//     generica de lote (avisarCliente:false), comportamento existente.
// =====================================================================
{
  resetar();
  fLote.configurarLote({ grupo_id: "grp-2", conversation_id: "conv-lote-2", telefone: "5517000000001" });
  fLote.configurarFilhos([{ id: "g1" }, { id: "g2" }]);
  const resp = await handler(req({
    operacao_id: "op-5", grupo_id: "grp-2",
    resultados: [
      { token_id: "g1", tipo: "unitv", servidor_nome: "UNITV", cliente_nome: "A", resultado: "sucesso", vencimentoConfirmado: "2026-12-03T02:31:01-03:00" },
      { token_id: "g2", tipo: "unitv", servidor_nome: "UNITV", cliente_nome: "B", resultado: "falha", detalhe: "painel recusou" },
    ],
  }));
  const body = await resp.json();
  ok(body.outcome === "lote_parcial", "C5: lote parcial");
  ok(fConv.acionamentos().length === 1, "C5: parcial -> acionarTransferenciaHumana (comportamento existente)");
  ok(fNotif.notificacoes().length === 1 && fNotif.notificacoes()[0].opcoes?.avisarCliente === false, "C5: notificarTransferenciaHumana com avisarCliente:false");
}

console.log(`\n${falhas === 0 ? "TODOS OS TESTES PASSARAM" : `${falhas} FALHA(S)`}`);
process.exit(falhas === 0 ? 0 : 1);
