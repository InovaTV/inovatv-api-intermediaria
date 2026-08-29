// Testes locais de supabase/functions/openpix-webhook/index.ts (REAL)
// -- mensagem intermediaria "renovacao em andamento" (2026-08-29).
//
// Regras que estes testes travam:
//   1. A mensagem e' enviada UMA vez, so' depois de reivindicarInicio*
//      ter sucesso, e ANTES do dispatch do workflow.
//   2. Reentrega de webhook (reivindicado === null) NAO envia de novo.
//   3. Mesmo caminho para individual e lote -- sem branch por tipo.
//   4. BEST-EFFORT: falha no WhatsApp OU no historico jamais impede
//      dispararWorkflowRenovacaoSigma().
//   5. So' grava no historico quando o envio ao WhatsApp deu "success".
//   6. O webhook nunca envia a mensagem FINAL de sucesso -- o unico
//      texto que ele manda ao cliente e' MENSAGEM_RENOVACAO_EM_ANDAMENTO.
//
// _shared/mensagens_fixas.ts e' REAL. Demais deps sao fakes.
//
// Como rodar: npx tsx scripts/testes/renovacao_em_andamento/teste.mjs

import { register } from "node:module";
register("./mock-loader.mjs", import.meta.url);

const fSig = await import("./fake_openpix_webhook_signature.mjs");
const fPix = await import("./fake_openpix_client.mjs");
const fCob = await import("./fake_cobrancas_pix.mjs");
const fTok = await import("./fake_tokens_renovacao.mjs");
const fLote = await import("./fake_renovacoes_lote.mjs");
const fDisp = await import("./fake_github_actions_dispatch.mjs");
const fWa = await import("./fake_whatsapp_client.mjs");
const fMsg = await import("./fake_mensagens_atendimento.mjs");
const fSeq = await import("./_seq.mjs");

const { MENSAGEM_RENOVACAO_EM_ANDAMENTO } = await import(
  "../../../supabase/functions/_shared/mensagens_fixas.ts"
);

// Shims de ambiente Edge.
let handler;
let pendentes = [];
globalThis.Deno = { serve: (fn) => { handler = fn; }, env: { get: () => undefined } };
globalThis.EdgeRuntime = { waitUntil: (p) => { pendentes.push(p); } };

await import("../../../supabase/functions/openpix-webhook/index.ts");

let falhas = 0;
function ok(cond, msg) {
  if (!cond) { falhas++; console.error(`FALHA: ${msg}`); }
  else console.log(`ok: ${msg}`);
}

function resetar() {
  fSig.resetar(); fPix.resetar(); fCob.resetar(); fTok.resetar();
  fLote.resetar(); fDisp.resetar(); fWa.resetar(); fMsg.resetar(); fSeq.resetarSeq();
  pendentes = [];
}

function req(correlationId, event = "OPENPIX:CHARGE_COMPLETED") {
  return new Request("https://x.test/openpix-webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-webhook-signature": "assinatura-fake" },
    body: JSON.stringify({ event, charge: { correlationID: correlationId } }),
  });
}

async function dispararWebhook(correlationId, event) {
  const resp = await handler(req(correlationId, event));
  await Promise.allSettled(pendentes);
  pendentes = [];
  return resp;
}

function idx(label) { return fSeq.sequencia().indexOf(label); }

// Camada 1 de observabilidade (2026-08-29): captura das linhas de log
// do proprio openpix-webhook (prefixo "[openpix-webhook]"), sem perder
// a saida no console. Resetada por resetarLogs().
const logsWebhook = [];
const _origLog = console.log;
console.log = (...args) => {
  const linha = args.map((a) => (typeof a === "string" ? a : String(a))).join(" ");
  if (linha.includes("[openpix-webhook]")) logsWebhook.push(linha);
  _origLog(...args);
};
function resetarLogs() { logsWebhook.length = 0; }
function logsDoWebhook() { return logsWebhook.slice(); }
function reqRaw(bodyObj) {
  return new Request("https://x.test/openpix-webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-webhook-signature": "assinatura-fake" },
    body: JSON.stringify(bodyObj),
  });
}

// =====================================================================
// C1: individual, caminho feliz.
//     Mensagem UMA vez, texto exato, ao telefone/conversa do token,
//     ANTES do dispatch. Historico gravado. Lote NAO reivindicado.
// =====================================================================
{
  resetar();
  fCob.configurarRetornoPaga({ grupo_id: null });
  fTok.configurar({ telefone: "5517981625486", conversation_id: "conv-1" });

  const resp = await dispararWebhook("op-c1");
  ok(resp.status === 200, "C1: webhook responde 200");

  ok(fWa.enviadasFeitas().length === 1, "C1: enviarMensagemWhatsApp chamado exatamente 1x");
  ok(fWa.enviadasFeitas()[0]?.texto === MENSAGEM_RENOVACAO_EM_ANDAMENTO, "C1: texto e' MENSAGEM_RENOVACAO_EM_ANDAMENTO (exato)");
  ok(fWa.enviadasFeitas()[0]?.telefone === "5517981625486", "C1: enviado ao telefone do token");

  ok(fMsg.inseridasFeitas().length === 1, "C1: inserirMensagem chamado 1x");
  const m = fMsg.inseridasFeitas()[0];
  ok(m?.conversationId === "conv-1" && m?.origem === "ia" && m?.texto === MENSAGEM_RENOVACAO_EM_ANDAMENTO && m?.episodioId === null,
    "C1: historico gravado (conv-1, 'ia', texto exato, episodioId null)");

  ok(fDisp.chamadasFeitas().length === 1 && fDisp.chamadasFeitas()[0] === "op-c1", "C1: workflow disparado 1x com a operacao");
  ok(idx("enviarMensagemWhatsApp") !== -1 && idx("enviarMensagemWhatsApp") < idx("dispararWorkflowRenovacaoSigma"),
    "C1: mensagem enviada ANTES do dispatch");
  ok(fLote.chamadasFeitas().length === 0, "C1: reivindicarInicioRenovacaoLote NAO chamado (individual)");
  ok(fTok.chamadasFeitas().length === 1, "C1: reivindicarInicioRenovacao chamado 1x");
}

// =====================================================================
// C2: lote, caminho feliz. Mesmo comportamento, pelo caminho do lote.
// =====================================================================
{
  resetar();
  fCob.configurarRegistro({ grupo_id: "grp-1", public_id: null });
  fCob.configurarRetornoPaga({ grupo_id: "grp-1" });
  fLote.configurar({ telefone: "5517000000000", conversation_id: "conv-lote" });

  const resp = await dispararWebhook("op-c2");
  ok(resp.status === 200, "C2: webhook responde 200");

  ok(fWa.enviadasFeitas().length === 1 && fWa.enviadasFeitas()[0].texto === MENSAGEM_RENOVACAO_EM_ANDAMENTO,
    "C2: mensagem intermediaria enviada 1x, texto exato");
  ok(fWa.enviadasFeitas()[0].telefone === "5517000000000", "C2: enviada ao telefone do lote");
  const m = fMsg.inseridasFeitas()[0];
  ok(fMsg.inseridasFeitas().length === 1 && m.conversationId === "conv-lote" && m.origem === "ia",
    "C2: historico gravado na conversa do lote");
  ok(fLote.chamadasFeitas().length === 1 && fLote.chamadasFeitas()[0] === "op-c2", "C2: reivindicarInicioRenovacaoLote usado");
  ok(fTok.chamadasFeitas().length === 0, "C2: reivindicarInicioRenovacao (individual) NAO chamado");
  ok(idx("enviarMensagemWhatsApp") < idx("dispararWorkflowRenovacaoSigma"), "C2: mensagem ANTES do dispatch");
  ok(fDisp.chamadasFeitas().length === 1, "C2: workflow disparado 1x");
}

// =====================================================================
// C3: reentrega de webhook -- marcarCobrancaComoPaga afetou uma linha
//     (corrida), mas reivindicarInicioRenovacao devolve null.
//     Nenhuma mensagem, nenhum dispatch.
// =====================================================================
{
  resetar();
  fCob.configurarRetornoPaga({ grupo_id: null });
  fTok.configurar(null);

  const resp = await dispararWebhook("op-c3");
  ok(resp.status === 200, "C3: webhook responde 200");
  ok(fTok.chamadasFeitas().length === 1, "C3: reivindicarInicioRenovacao foi consultado");
  ok(fWa.enviadasFeitas().length === 0, "C3: NENHUMA mensagem intermediaria (reivindicado === null)");
  ok(fMsg.inseridasFeitas().length === 0, "C3: NADA gravado no historico");
  ok(fDisp.chamadasFeitas().length === 0, "C3: workflow NAO disparado");
}

// =====================================================================
// C3b: reentrega de webhook -- lote. reivindicarInicioRenovacaoLote null.
// =====================================================================
{
  resetar();
  fCob.configurarRegistro({ grupo_id: "grp-9", public_id: null });
  fCob.configurarRetornoPaga({ grupo_id: "grp-9" });
  fLote.configurar(null);

  const resp = await dispararWebhook("op-c3b");
  ok(resp.status === 200, "C3b: webhook responde 200");
  ok(fWa.enviadasFeitas().length === 0, "C3b: NENHUMA mensagem (lote reivindicado null)");
  ok(fDisp.chamadasFeitas().length === 0, "C3b: workflow NAO disparado");
}

// =====================================================================
// C4: cobranca ja paga -- marcarCobrancaComoPaga devolve null.
//     iniciarRenovacaoSigma nunca roda.
// =====================================================================
{
  resetar();
  fCob.configurarRetornoPaga(null);

  const resp = await dispararWebhook("op-c4");
  ok(resp.status === 200, "C4: webhook responde 200");
  ok(fTok.chamadasFeitas().length === 0 && fLote.chamadasFeitas().length === 0, "C4: nenhuma reivindicacao de inicio");
  ok(fWa.enviadasFeitas().length === 0, "C4: NENHUMA mensagem intermediaria");
  ok(fDisp.chamadasFeitas().length === 0, "C4: workflow NAO disparado");
}

// =====================================================================
// C5: BEST-EFFORT -- enviarMensagemWhatsApp LANCA excecao.
//     Dispatch acontece mesmo assim; historico nao e' gravado;
//     nenhuma excecao escapa (webhook responde 200).
// =====================================================================
{
  resetar();
  fCob.configurarRetornoPaga({ grupo_id: null });
  fWa.configurarModo("throw");

  const resp = await dispararWebhook("op-c5");
  ok(resp.status === 200, "C5: webhook responde 200 apesar da falha no WhatsApp");
  ok(fWa.enviadasFeitas().length === 1, "C5: houve tentativa de envio");
  ok(fMsg.inseridasFeitas().length === 0, "C5: historico NAO gravado (envio falhou)");
  ok(fDisp.chamadasFeitas().length === 1 && fDisp.chamadasFeitas()[0] === "op-c5",
    "C5: workflow disparado MESMO com falha no WhatsApp");
  ok(idx("dispararWorkflowRenovacaoSigma") !== -1, "C5: dispatch registrado na sequencia");
}

// =====================================================================
// C6: BEST-EFFORT -- enviarMensagemWhatsApp devolve {outcome:"unavailable"}.
//     Historico NAO e' gravado (so' grava em "success"); dispatch ocorre.
// =====================================================================
{
  resetar();
  fCob.configurarRetornoPaga({ grupo_id: null });
  fWa.configurarModo("unavailable");

  const resp = await dispararWebhook("op-c6");
  ok(resp.status === 200, "C6: webhook responde 200");
  ok(fWa.enviadasFeitas().length === 1, "C6: tentativa de envio feita");
  ok(fMsg.inseridasFeitas().length === 0, "C6: historico NAO gravado (outcome != success)");
  ok(fDisp.chamadasFeitas().length === 1, "C6: workflow disparado normalmente");
}

// =====================================================================
// C7: BEST-EFFORT -- inserirMensagem LANCA excecao.
//     Dispatch acontece; nenhuma excecao escapa.
// =====================================================================
{
  resetar();
  fCob.configurarRetornoPaga({ grupo_id: null });
  fMsg.configurarFalha(true);

  const resp = await dispararWebhook("op-c7");
  ok(resp.status === 200, "C7: webhook responde 200 apesar da falha no historico");
  ok(fWa.enviadasFeitas().length === 1, "C7: mensagem foi enviada ao WhatsApp");
  ok(fDisp.chamadasFeitas().length === 1 && fDisp.chamadasFeitas()[0] === "op-c7",
    "C7: workflow disparado MESMO com falha ao gravar historico");
}

// =====================================================================
// C8: reconsulta nao confirma COMPLETED -- nada acontece.
// =====================================================================
{
  resetar();
  fPix.configurar({ outcome: "success", status: "ACTIVE", amountCentavos: 7000 });

  const resp = await dispararWebhook("op-c8");
  ok(resp.status === 200, "C8: webhook responde 200");
  ok(fCob.chamadasFeitas().every((c) => c.fn !== "marcarPaga"), "C8: marcarCobrancaComoPaga NAO chamado");
  ok(fWa.enviadasFeitas().length === 0, "C8: NENHUMA mensagem intermediaria");
  ok(fDisp.chamadasFeitas().length === 0, "C8: workflow NAO disparado");
}

// =====================================================================
// C9: valor pago diverge -- marca divergente, sem mensagem, sem dispatch.
// =====================================================================
{
  resetar();
  fCob.configurarRegistro({ valor_esperado_centavos: 7000 });
  fPix.configurar({ outcome: "success", status: "COMPLETED", amountCentavos: 5000 });

  const resp = await dispararWebhook("op-c9");
  ok(resp.status === 200, "C9: webhook responde 200");
  ok(fCob.chamadasFeitas().some((c) => c.fn === "marcarDivergente"), "C9: marcarCobrancaComoDivergente chamado");
  ok(fCob.chamadasFeitas().every((c) => c.fn !== "marcarPaga"), "C9: marcarCobrancaComoPaga NAO chamado");
  ok(fWa.enviadasFeitas().length === 0, "C9: NENHUMA mensagem intermediaria");
  ok(fDisp.chamadasFeitas().length === 0, "C9: workflow NAO disparado");
}

// =====================================================================
// C10: reentrega do MESMO webhook ja processado -- a 2a entrega cai em
//      marcarCobrancaComoPaga -> null e nao envia a mensagem de novo.
//      Confirma tambem que o unico texto que o webhook manda ao cliente
//      e' o intermediario (a mensagem final de sucesso e' de outro
//      componente, renovacao-sigma-resultado).
// =====================================================================
{
  resetar();
  fCob.configurarRetornoPaga({ grupo_id: null });

  await dispararWebhook("op-c10"); // 1a entrega: processa
  const apos1a = fWa.enviadasFeitas().length;
  ok(apos1a === 1, "C10: 1a entrega envia a mensagem intermediaria 1x");
  ok(fWa.enviadasFeitas()[0].texto === MENSAGEM_RENOVACAO_EM_ANDAMENTO, "C10: e' exatamente o texto intermediario (nao a mensagem final)");

  fCob.configurarRetornoPaga(null); // linha ja 'pago' -> 2a entrega e' no-op
  await dispararWebhook("op-c10"); // 2a entrega: reenvio
  ok(fWa.enviadasFeitas().length === apos1a, "C10: 2a entrega (reenvio) NAO envia a mensagem de novo");
  ok(fDisp.chamadasFeitas().length === 1, "C10: workflow disparado so' uma vez no total");
}

// =====================================================================
// C11: falha do dispatch nao e' problema desta mudanca -- mensagem
//      intermediaria continua indo 1x, webhook continua 200.
// =====================================================================
{
  resetar();
  fCob.configurarRetornoPaga({ grupo_id: null });
  fDisp.configurar({ outcome: "falha", detalhe: "HTTP 500" });

  const resp = await dispararWebhook("op-c11");
  ok(resp.status === 200, "C11: webhook responde 200 mesmo com dispatch falhando");
  ok(fWa.enviadasFeitas().length === 1, "C11: mensagem intermediaria enviada 1x");
  ok(fDisp.chamadasFeitas().length === 1, "C11: dispatch foi tentado");
}

// =====================================================================
// C12: evento nao-CHARGE_COMPLETED -- ignorado, nada roda.
// =====================================================================
{
  resetar();
  const resp = await dispararWebhook("op-c12", "OPENPIX:CHARGE_EXPIRED");
  ok(resp.status === 200, "C12: webhook responde 200");
  ok(fWa.enviadasFeitas().length === 0 && fDisp.chamadasFeitas().length === 0, "C12: nada processado");
}

// =====================================================================
// OBS-1 (Camada 1, 2026-08-29): evento != CHARGE_COMPLETED agora deixa
// RASTRO em log -- antes era descarte 100% silencioso. Comportamento
// inalterado (200, nada processado).
// =====================================================================
{
  resetar(); resetarLogs();
  const resp = await handler(reqRaw({
    event: "OPENPIX:TRANSACTION_RECEIVED",
    pixTransaction: { endToEndId: "Ecd190030d05b45aaa3d9197e21deebc0", transactionID: "bc036e5d1f15454e8f63af8b8ac805ac" },
    charge: { correlationID: "d5241cc0-3a46-401a-bbed-4a00ce3dd8c2", status: "ACTIVE" },
  }));
  await Promise.allSettled(pendentes); pendentes = [];

  ok(resp.status === 200, "OBS-1: 200 (comportamento inalterado)");
  ok(fCob.chamadasFeitas().length === 0 && fWa.enviadasFeitas().length === 0 && fDisp.chamadasFeitas().length === 0, "OBS-1: NADA processado");
  const l = logsDoWebhook();
  ok(l.some((x) => x.includes("evento ignorado") && x.includes("OPENPIX:TRANSACTION_RECEIVED")), "OBS-1: loga o evento ignorado com o tipo");
  ok(l.some((x) => x.includes("d5241cc0-3a46-401a-bbed-4a00ce3dd8c2")), "OBS-1: loga o correlationID (id nao sensivel)");
  ok(l.some((x) => x.includes("Ecd190030d05b45aaa3d9197e21deebc0")), "OBS-1: loga o endToEndId (id nao sensivel)");
}

// =====================================================================
// OBS-2 (Camada 1): payload de evento ignorado com dados do PAGADOR
// (nome / CPF / chave Pix) -- os identificadores nao-sensiveis sao
// logados, os dados do pagador NUNCA.
// =====================================================================
{
  resetar(); resetarLogs();
  const resp = await handler(reqRaw({
    event: "OPENPIX:TRANSACTION_RECEIVED",
    pixTransaction: {
      endToEndId: "E00000000TESTE",
      payer: { name: "FULANO DE TAL DA SILVA", taxID: { taxID: "12345678900", type: "BR:CPF" } },
    },
    charge: { correlationID: "op-obs2", customer: { name: "FULANO DE TAL DA SILVA", taxID: "12345678900" } },
  }));
  await Promise.allSettled(pendentes); pendentes = [];

  ok(resp.status === 200, "OBS-2: 200");
  const blob = logsDoWebhook().join(" || ");
  ok(blob.includes("op-obs2") && blob.includes("E00000000TESTE"), "OBS-2: loga correlationID + endToEndId");
  ok(!/FULANO DE TAL|12345678900/i.test(blob), "OBS-2: NUNCA loga nome / CPF do pagador");
}

// =====================================================================
// OBS-3 (Camada 1): CHARGE_COMPLETED sem correlationID -- rastro + 200.
// =====================================================================
{
  resetar(); resetarLogs();
  const resp = await handler(reqRaw({ event: "OPENPIX:CHARGE_COMPLETED", charge: {} }));
  await Promise.allSettled(pendentes); pendentes = [];

  ok(resp.status === 200, "OBS-3: 200");
  ok(fCob.chamadasFeitas().length === 0, "OBS-3: nada processado (sem correlationID)");
  ok(logsDoWebhook().some((x) => x.includes("sem correlationID")), "OBS-3: loga 'sem correlationID'");
}

// =====================================================================
// OBS-4 (Camada 1): caminho feliz continua funcionando + agora deixa
// rastro "recebido -- reconsultando". REGRESSAO de comportamento.
// =====================================================================
{
  resetar(); resetarLogs();
  fCob.configurarRetornoPaga({ grupo_id: null });
  fTok.configurar({ telefone: "5517981625486", conversation_id: "conv-1" });

  const resp = await dispararWebhook("op-obs4");
  ok(resp.status === 200, "OBS-4: 200");
  ok(fWa.enviadasFeitas().length === 1 && fDisp.chamadasFeitas().length === 1, "OBS-4: caminho feliz INTACTO (msg + dispatch)");
  ok(logsDoWebhook().some((x) => x.includes("recebido -- reconsultando") && x.includes("op-obs4")), "OBS-4: rastro do CHARGE_COMPLETED recebido");
}

// =====================================================================
// OBS-5 (Camada 1): reenvio de webhook (cobranca ja processada) --
// rastro 'ja processada (reenvio)', nada disparado de novo.
// =====================================================================
{
  resetar(); resetarLogs();
  fCob.configurarRetornoPaga(null); // marcarCobrancaComoPaga -> null (ja processada)
  fTok.configurar({ telefone: "5517981625486", conversation_id: "conv-1" });

  const resp = await dispararWebhook("op-obs5");
  ok(resp.status === 200, "OBS-5: 200");
  ok(fDisp.chamadasFeitas().length === 0 && fWa.enviadasFeitas().length === 0, "OBS-5: reenvio -> nada disparado");
  ok(logsDoWebhook().some((x) => x.includes("ja processada (reenvio)")), "OBS-5: rastro do reenvio");
}

// =====================================================================
console.log("");
if (falhas === 0) {
  console.log("TODOS OS TESTES PASSARAM (renovacao_em_andamento)");
} else {
  console.error(`${falhas} FALHA(S) (renovacao_em_andamento)`);
  process.exit(1);
}
