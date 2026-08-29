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
const { MENSAGEM_RENOVACAO_INSTABILIDADE } = await import("../../../supabase/functions/_shared/mensagens_fixas.ts");

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

// =====================================================================
// GAP 3 -- resultados[] de tipos MISTOS (1 Sigma + 1 UniTV) chegando
// a processarResultadoLote. Complementa C4/C5 (que eram 2xUniTV).
// =====================================================================

// helper: acha o bloco de um servidor dentro da mensagem consolidada
function blocoDoServidor(texto, servidor) {
  return texto.split("\n\n").find((b) => b.includes(`🖥️ ${servidor}`));
}

// =====================================================================
// C6: LOTE MISTO, Sigma sucesso + UniTV sucesso -> lote_concluida,
//     mensagem consolidada com os DOIS vencimentos, sem transferencia,
//     sem nota de dessincronia.
// =====================================================================
{
  resetar();
  fLote.configurarLote({ grupo_id: "grp-6", conversation_id: "conv-misto-6", telefone: "5517000000006" });
  fLote.configurarFilhos([{ id: "h1" }, { id: "h2" }]);
  const resp = await handler(req({
    operacao_id: "op-6", grupo_id: "grp-6",
    resultados: [
      { token_id: "h1", tipo: "sigma", servidor_nome: "BLAZE", cliente_nome: "A", resultado: "sucesso", vencimentoConfirmado: "2026-12-03T02:31:01-03:00" },
      { token_id: "h2", tipo: "unitv", servidor_nome: "UNITV", cliente_nome: "B", resultado: "sucesso", vencimentoConfirmado: "2026-12-10T02:31:01-03:00" },
    ],
  }));
  const body = await resp.json();
  ok(body.outcome === "lote_concluida", "C6: misto ambos sucesso -> lote_concluida");
  ok(fConv.acionamentos().length === 0, "C6: concluida -> NENHUMA transferencia");
  ok(fNotif.notificacoes().length === 0, "C6: concluida -> notificarTransferenciaHumana nao chamado");
  ok(fWa.mensagensEnviadas().length === 1, "C6: 1 mensagem consolidada ao cliente");
  const texto6 = fWa.mensagensEnviadas()[0].texto;
  const bSigma6 = blocoDoServidor(texto6, "BLAZE");
  const bUnitv6 = blocoDoServidor(texto6, "UNITV");
  ok(bSigma6 && /📅 Novo vencimento:/.test(bSigma6), "C6: bloco Sigma (BLAZE) mostra novo vencimento");
  ok(bUnitv6 && /📅 Novo vencimento:/.test(bUnitv6), "C6: bloco UniTV (UNITV) mostra novo vencimento");
  ok(!/⚠️ Um atendente/.test(texto6), "C6: nenhum bloco com aviso de 'um atendente vai concluir'");
  ok(!fWa.templatesEnviados().some((t) => t.nome === "nova_transferencia_humana"), "C6: nenhum aviso ao Jose (sem falha, sem desync)");
  ok(!fMsg.mensagens().some((m) => m.origem === "sistema" && /Rocket/.test(m.texto) && /NÃO sincronizou/.test(m.texto)), "C6: nenhuma nota de dessincronia");
}

// =====================================================================
// C7: LOTE MISTO parcial -- o filho que FALHA e' o Sigma, o UniTV tem
//     sucesso (o inverso de C5). -> lote_parcial, transferencia
//     'renovacao_lote:parcial' com avisarCliente:false, bloco Sigma com
//     aviso de atendente e bloco UniTV com vencimento.
// =====================================================================
{
  resetar();
  fLote.configurarLote({ grupo_id: "grp-7", conversation_id: "conv-misto-7", telefone: "5517000000007" });
  fLote.configurarFilhos([{ id: "h1" }, { id: "h2" }]);
  const resp = await handler(req({
    operacao_id: "op-7", grupo_id: "grp-7",
    resultados: [
      { token_id: "h1", tipo: "sigma", servidor_nome: "BLAZE", cliente_nome: "A", resultado: "falha", detalhe: "vencimento nao mudou em nenhum dos dois sistemas apos o clique" },
      { token_id: "h2", tipo: "unitv", servidor_nome: "UNITV", cliente_nome: "B", resultado: "sucesso", vencimentoConfirmado: "2026-12-10T02:31:01-03:00" },
    ],
  }));
  const body = await resp.json();
  ok(body.outcome === "lote_parcial", "C7: Sigma falha + UniTV sucesso -> lote_parcial");
  const acion7 = fConv.acionamentos();
  ok(acion7.length === 1 && acion7[0].motivo === "renovacao_lote:parcial", "C7: transferencia com motivo 'renovacao_lote:parcial' (nao unitv_pendente_integracao)");
  ok(fNotif.notificacoes().length === 1 && fNotif.notificacoes()[0].opcoes?.avisarCliente === false, "C7: notificarTransferenciaHumana com avisarCliente:false");
  const texto7 = fWa.mensagensEnviadas()[0]?.texto ?? "";
  const bSigma7 = blocoDoServidor(texto7, "BLAZE");
  const bUnitv7 = blocoDoServidor(texto7, "UNITV");
  ok(bSigma7 && /⚠️ Um atendente/.test(bSigma7) && !/📅 Novo vencimento:/.test(bSigma7), "C7: bloco Sigma (falhou) -> aviso de atendente, sem vencimento");
  ok(bUnitv7 && /📅 Novo vencimento:/.test(bUnitv7), "C7: bloco UniTV (sucesso) -> novo vencimento");
  ok(!fWa.templatesEnviados().some((t) => t.nome === "nova_transferencia_humana"), "C7: sem rocketDesync -> nenhum aviso 'renovacao_unitv:rocket_desync'");
  ok(!fMsg.mensagens().some((m) => m.origem === "sistema" && /NÃO sincronizou no Rocket/.test(m.texto)), "C7: sem nota de dessincronia");
}

// =====================================================================
// C8: LOTE MISTO -- Sigma FALHA + UniTV SUCESSO com rocketDesync.
//     Exercita os DOIS ramos juntos: transferencia por 'parcial' E
//     avisarRocketDesync (nota de sistema + aviso ao Jose).
// =====================================================================
{
  resetar();
  fLote.configurarLote({ grupo_id: "grp-8", conversation_id: "conv-misto-8", telefone: "5517000000008" });
  fLote.configurarFilhos([{ id: "h1" }, { id: "h2" }]);
  const resp = await handler(req({
    operacao_id: "op-8", grupo_id: "grp-8",
    resultados: [
      { token_id: "h1", tipo: "sigma", servidor_nome: "BLAZE", cliente_nome: "A", resultado: "falha", detalhe: "veredito 'falha'" },
      { token_id: "h2", tipo: "unitv", servidor_nome: "UNITV", cliente_nome: "B", resultado: "sucesso", vencimentoConfirmado: "2026-12-10T02:31:01-03:00", rocketDesync: true },
    ],
  }));
  const body = await resp.json();
  ok(body.outcome === "lote_parcial", "C8: parcial (Sigma falha)");

  // ramo 1: transferencia por parcial
  const acion8 = fConv.acionamentos();
  ok(acion8.length === 1 && acion8[0].motivo === "renovacao_lote:parcial", "C8: transferencia 'renovacao_lote:parcial'");
  ok(fNotif.notificacoes().length === 1 && fNotif.notificacoes()[0].opcoes?.avisarCliente === false, "C8: notificarTransferenciaHumana avisarCliente:false");

  // ramo 2: avisarRocketDesync (independente do estadoFinal)
  ok(fMsg.mensagens().some((m) => m.origem === "sistema" && /NÃO sincronizou no Rocket/.test(m.texto)), "C8: nota de sistema da dessincronia (ramo rocketDesync)");
  const avisos8 = fWa.templatesEnviados().filter((t) => t.nome === "nova_transferencia_humana");
  ok(avisos8.length === 1 && avisos8[0].parametros[0] === "renovacao_unitv:rocket_desync", "C8: aviso ao Jose 'renovacao_unitv:rocket_desync' (exatamente 1, do avisarRocketDesync)");

  // cliente continua recebendo APENAS a mensagem consolidada (1)
  ok(fWa.mensagensEnviadas().length === 1, "C8: 1 unica mensagem ao cliente (a consolidada), nunca 2a por dessincronia");
}

// =====================================================================
// ITERACAO 1 (2026-08-29) -- Sigma indisponivel (auth) apos a Camada A:
// individual -> mensagem de INSTABILIDADE TEMPORARIA ao cliente +
// transferencia com avisarCliente:false; estado/aviso ao Jose inalterados.
// =====================================================================
const TOKEN_SIGMA = {
  conversation_id: "conv-sig",
  cliente_nome: "Js Informatica Rp",
  plano_nome: "Mensal",
  servidor_nome: "ChannelTV",
  telefone: "5517981625486",
};

// spec-instab: individual Sigma resultado_ambiguo + sigmaIndisponivel:true
{
  resetar();
  fTok.configurarToken(TOKEN_SIGMA);
  const resp = await handler(req({
    operacao_id: "op-si-1",
    resultado: "resultado_ambiguo",
    detalhe: "painel Sigma indisponivel (auth) na leitura de contexto -- sigma_info_auth, 4 tentativas",
    sigmaIndisponivel: true,
  }));
  const body = await resp.json();
  ok(body.outcome === "resultado_ambiguo_processado", "spec-instab: outcome = resultado_ambiguo_processado (estado inalterado)");
  ok(
    fWa.mensagensEnviadas().length === 1 && fWa.mensagensEnviadas()[0].texto === MENSAGEM_RENOVACAO_INSTABILIDADE,
    "spec-instab: cliente recebe a mensagem de INSTABILIDADE TEMPORARIA (neutra), 1x",
  );
  ok(
    !/não está disponível|nao esta disponivel|não existe|nao existe/i.test(fWa.mensagensEnviadas()[0].texto),
    "spec-instab: a mensagem NUNCA diz que a renovacao 'nao esta disponivel'/'nao existe'",
  );
  ok(fMsg.mensagens().some((m) => m.origem === "ia" && m.texto === MENSAGEM_RENOVACAO_INSTABILIDADE), "spec-instab: a mensagem e' gravada no historico do Painel (origem ia)");
  const acion = fConv.acionamentos();
  ok(acion.length === 1 && acion[0].motivo === "renovacao_sigma:resultado_ambiguo", "spec-instab: transferencia com o MESMO motivo generico de sempre (estado inalterado)");
  ok(
    fNotif.notificacoes().length === 1 && fNotif.notificacoes()[0].opcoes?.avisarCliente === false,
    "spec-instab: notificarTransferenciaHumana com avisarCliente:false (nao duplica com a frase generica)",
  );
  ok(!fWa.templatesEnviados().some((t) => t.nome === "pagamento_confirmado"), "spec-instab: nenhum template de sucesso");
}

// spec-reg: resultado_ambiguo SEM sigmaIndisponivel -> comportamento
// generico INALTERADO (EF nao envia mensagem de instabilidade; a
// transferencia avisa o cliente com a frase generica de sempre).
{
  resetar();
  fTok.configurarToken({ ...TOKEN_SIGMA, servidor_nome: "NewOne" });
  const resp = await handler(req({ operacao_id: "op-amb-1", resultado: "resultado_ambiguo", detalhe: "divergencia entre sistemas: rocketMudou=true, sigmaMudou=false" }));
  const body = await resp.json();
  ok(body.outcome === "resultado_ambiguo_processado", "spec-reg: outcome resultado_ambiguo_processado");
  ok(fWa.mensagensEnviadas().length === 0, "spec-reg: resultado_ambiguo comum -> EF NAO envia mensagem de instabilidade");
  ok(
    fNotif.notificacoes().length === 1 && fNotif.notificacoes()[0].opcoes === undefined,
    "spec-reg: transferencia com opcoes default (frase generica ao cliente) -- inalterado",
  );
}

// spec 18: 'falha' e 'sessao_expirada' NAO viram instabilidade mesmo se
// sigmaIndisponivel vier no corpo (so' 'resultado_ambiguo' + a flag).
// E o motivo/estado da transferencia continua o generico -- Camada 3 /
// watchdog / Peca 3 nao dependem de nada disto, seguem intocados.
{
  resetar();
  fTok.configurarToken(TOKEN_SIGMA);
  const resp = await handler(req({ operacao_id: "op-f-1", resultado: "falha", detalhe: "x", sigmaIndisponivel: true }));
  await resp.json();
  ok(fWa.mensagensEnviadas().length === 0, "spec18: resultado 'falha' + sigmaIndisponivel -> NUNCA mensagem de instabilidade");
  ok(
    fConv.acionamentos().length === 1 && fConv.acionamentos()[0].motivo === "renovacao_sigma:falha",
    "spec18: 'falha' -> motivo generico 'renovacao_sigma:falha' (estado/transferencia inalterados)",
  );
  ok(fNotif.notificacoes()[0].opcoes === undefined, "spec18: 'falha' -> avisarCliente default (nao suprime a frase generica)");
}

console.log(`\n${falhas === 0 ? "TODOS OS TESTES PASSARAM" : `${falhas} FALHA(S)`}`);
process.exit(falhas === 0 ? 0 : 1);
