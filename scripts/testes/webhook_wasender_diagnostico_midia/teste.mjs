// Fase 4, Checkpoint A (aprovado 2026-09-11) -- prova que o diagnostico
// de midia adicionado a webhook-wasender/index.ts:
//   1) reporta tipo/mimetype/presenca de campos como esperado;
//   2-6) NUNCA vaza url, mediaKey, token, telefone ou conteudo/base64;
//   7) caption, quando presente, so' aparece como PRESENCA, nunca o texto;
//   8) midia continua terminando exatamente no mesmo `return` de sempre
//      (nunca chega a chamar o Orquestrador);
//   9) texto continua chamando o Orquestrador exatamente como antes.
//
// Roda o handler REAL de supabase/functions/webhook-wasender/index.ts.
// Unica dependencia fakeada: _shared/webhook_dedup.ts (unico I/O
// incondicional do fluxo -- ver mock-loader.mjs). telefone.ts,
// wasender_client.ts, comando_atendimento.ts e
// renovacao_wasender_resolver.ts ficam REAIS: os textos usados nos
// testes de texto sao deliberadamente textos "normais" (nao "1"/"2"/
// "aceito"/"cancelar" nem "<numero> aceito|cancelar"), que fazem
// resolverRoteamentoConfirmacaoRenovacao retornar "resposta_nao_
// reconhecida" SEM nenhuma consulta ao banco (deteccao de texto e'
// puramente sincrona, ve-se em _shared/renovacao_wasender_resolver.ts).
//
// Como rodar: npx tsx scripts/testes/webhook_wasender_diagnostico_midia/teste.mjs

import { register } from "node:module";

register("./mock-loader.mjs", import.meta.url);

const { resetarWebhookDedup, chamadasDedupRegistradas } = await import(
  "./fake_webhook_dedup.mjs"
);
const {
  resetarWasenderMediaFake,
  definirResultadoWasenderMedia,
  forcarErroWasenderMedia,
  chamadasWasenderMediaRegistradas,
} = await import("./fake_wasender_media.mjs");
const {
  resetarGeminiClientFake,
  definirResultadoGemini,
  forcarErroGemini,
  chamadasGeminiRegistradas,
} = await import("./fake_gemini_client.mjs");

// ---------------------------------------------------------------------
// Fixtures "sensiveis" -- valores deliberadamente distintivos, para que
// uma busca literal por eles no log capturado seja uma prova real de
// vazamento (nao um falso-negativo por coincidencia de substring curta).
// ---------------------------------------------------------------------
const SEGREDO_WEBHOOK = "segredo-teste-wasender-fase4";
const TOKEN_ORCHESTRATOR = "TOKEN-INTERNO-ORCHESTRATOR-NUNCA-DEVE-VAZAR-NO-LOG";
const TELEFONE_TESTE = "5511999998888";
const URL_MIDIA_SENSIVEL =
  "https://mmg.whatsapp.net/o1/v/t62.7161-24/ENCRYPTED_BLOB_NUNCA_DEVE_VAZAR_NO_LOG";
const MEDIA_KEY_SENSIVEL = "chaveDeMidiaBase64SuperSecreta_NUNCA_DEVE_VAZAR==";
const CAPTION_SENSIVEL = "PlaySim nao carrega, veja o print, meu numero e 11999998888";

process.env.WASENDER_WEBHOOK_SECRET = SEGREDO_WEBHOOK;
process.env.ORCHESTRATOR_INTERNAL_TOKEN = TOKEN_ORCHESTRATOR;
process.env.SUPABASE_URL = "https://exemplo-teste.supabase.co";
// Deliberadamente AUSENTE: WASENDER_API_TOKEN -- garante que qualquer
// tentativa acidental de enviarMensagemWhatsApp() vira {outcome:
// "unavailable"} sem nenhuma rede real, mesmo se algum teste futuro
// disparar esse caminho por engano.

let handler;
let pendentes = [];
globalThis.Deno = {
  serve: (fn) => {
    handler = fn;
  },
  env: { get: (nome) => process.env[nome] },
};
globalThis.EdgeRuntime = {
  waitUntil: (p) => {
    pendentes.push(p);
  },
};

let fetchChamadas = [];
globalThis.fetch = async (url, opts) => {
  fetchChamadas.push({ url: String(url), method: opts?.method, body: opts?.body });
  return { ok: true, status: 200, json: async () => ({}), text: async () => "" };
};

await import("../../../supabase/functions/webhook-wasender/index.ts");

let falhas = 0;
function ok(condicao, mensagem) {
  if (!condicao) {
    falhas++;
    console.error(`FALHA: ${mensagem}`);
  } else {
    console.log(`ok: ${mensagem}`);
  }
}

function resetarTudo() {
  resetarWebhookDedup();
  resetarWasenderMediaFake();
  resetarGeminiClientFake();
  fetchChamadas = [];
  pendentes = [];
}

function requestWebhook(payload) {
  return new Request("https://exemplo-teste.local/webhook-wasender", {
    method: "POST",
    headers: { "X-Webhook-Signature": SEGREDO_WEBHOOK, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function chaveMensagem(id, telefone) {
  return {
    id,
    fromMe: false,
    remoteJid: `${telefone}@s.whatsapp.net`,
    senderPn: `${telefone}@s.whatsapp.net`,
  };
}

function mensagemMidia({
  id,
  telefone,
  campoMidia,
  mimetype = "image/jpeg",
  fileName,
  url = URL_MIDIA_SENSIVEL,
  mediaKey = MEDIA_KEY_SENSIVEL,
  caption,
  messageBody,
}) {
  const objetoMidia = { url, mediaKey, mimetype };
  if (fileName !== undefined) objetoMidia.fileName = fileName;
  if (caption !== undefined) objetoMidia.caption = caption; // campo nao tipado -- testamos runtime real
  const msg = {
    key: chaveMensagem(id, telefone),
    message: { [campoMidia]: objetoMidia },
  };
  // messageBody (top-level) e' a legenda REAL que extrairTexto() le --
  // distinto do campo "caption" nao tipado dentro do proprio objeto de
  // midia (usado so' pelo diagnostico do Checkpoint A).
  if (messageBody !== undefined) msg.messageBody = messageBody;
  return msg;
}

function mensagemTexto({ id, telefone, texto }) {
  return {
    key: chaveMensagem(id, telefone),
    message: { conversation: texto },
  };
}

async function processar(mensagens) {
  const logsCapturados = [];
  const logOriginal = console.log;
  console.log = (...args) => {
    logsCapturados.push(
      args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "),
    );
  };
  let resp;
  try {
    resp = await handler(
      requestWebhook({ event: "messages.received", data: { messages: mensagens } }),
    );
    await Promise.allSettled(pendentes);
  } finally {
    console.log = logOriginal;
    pendentes = [];
  }
  return { resp, logsCapturados, logCompleto: logsCapturados.join("\n") };
}

function extrairDiagnostico(logsCapturados) {
  const linha = logsCapturados.find((l) => l.includes("mensagem de midia"));
  if (!linha) return null;
  // A linha e' `"[webhook-wasender] mensagem de midia..." {"id":...,"diagnostico":{...}}`
  // -- o segundo argumento do console.log foi serializado com
  // JSON.stringify separadamente; localiza o primeiro "{" e faz parse.
  const inicio = linha.indexOf("{");
  if (inicio === -1) return null;
  const objeto = JSON.parse(linha.slice(inicio));
  return objeto.diagnostico;
}

// =====================================================================
// Teste 1 + item 1 da lista: imagem gera o diagnostico esperado.
// =====================================================================
async function teste1_diagnosticoImagem() {
  resetarTudo();
  const { logsCapturados } = await processar([
    mensagemMidia({ id: "IMG-1", telefone: TELEFONE_TESTE, campoMidia: "imageMessage" }),
  ]);
  const diag = extrairDiagnostico(logsCapturados);
  ok(diag !== null, "Teste 1: log de diagnostico de midia foi emitido");
  ok(diag?.tipo === "imageMessage", "Teste 1: tipo === imageMessage");
  ok(diag?.mimetype === "image/jpeg", "Teste 1: mimetype reportado corretamente");
  ok(diag?.urlPresente === true, "Teste 1: urlPresente === true");
  ok(diag?.mediaKeyPresente === true, "Teste 1: mediaKeyPresente === true");
  ok(diag?.fileName === null, "Teste 1: fileName === null quando ausente na mensagem");
  ok(diag?.textoAssociadoPresente === false, "Teste 1: sem legenda/texto associado");
  ok(
    Array.isArray(diag?.camposMidia) && diag.camposMidia.includes("mediaKey"),
    "Teste 1: camposMidia reporta os NOMES dos campos (estrutura)",
  );
}

// =====================================================================
// Itens 2-6 da lista: nada sensivel aparece em NENHUMA linha de log.
// =====================================================================
async function teste2a6_nadaSensivelNoLog() {
  resetarTudo();
  const { logsCapturados, logCompleto } = await processar([
    mensagemMidia({
      id: "IMG-2",
      telefone: TELEFONE_TESTE,
      campoMidia: "imageMessage",
      fileName: "IMG-20260911-WA0007.jpg",
    }),
  ]);
  ok(logsCapturados.length > 0, "Itens 2-6: pelo menos 1 linha de log foi capturada");
  ok(!logCompleto.includes(URL_MIDIA_SENSIVEL), "Item 2: URL completa nunca aparece no log");
  ok(!logCompleto.includes(MEDIA_KEY_SENSIVEL), "Item 3: mediaKey nunca aparece no log");
  ok(!logCompleto.includes(TOKEN_ORCHESTRATOR), "Item 4: token interno nunca aparece no log");
  ok(!logCompleto.includes(SEGREDO_WEBHOOK), "Item 4: segredo do webhook nunca aparece no log");
  ok(!logCompleto.includes(TELEFONE_TESTE), "Item 5: telefone nunca aparece no log (midia)");
  ok(!/[A-Za-z0-9+/]{40,}={0,2}/.test(logCompleto), "Item 6: nenhum bloco parecido com base64 no log");
  ok(
    !logCompleto.toLowerCase().includes("dadosbase64"),
    "Item 6: campo dadosBase64 (conteudo) nunca aparece no log",
  );
}

// =====================================================================
// Item 7: caption, quando presente, so' vira PRESENCA -- nunca o texto.
// =====================================================================
async function teste7_captionSoPresenca() {
  resetarTudo();
  const { logsCapturados, logCompleto } = await processar([
    mensagemMidia({
      id: "IMG-3",
      telefone: TELEFONE_TESTE,
      campoMidia: "imageMessage",
      caption: CAPTION_SENSIVEL,
    }),
  ]);
  const diag = extrairDiagnostico(logsCapturados);
  ok(diag?.textoAssociadoPresente === true, "Item 7: textoAssociadoPresente === true com caption");
  ok(!logCompleto.includes(CAPTION_SENSIVEL), "Item 7: o TEXTO da caption nunca aparece no log");
  ok(!logCompleto.includes("meu numero e"), "Item 7: nenhum fragmento do texto da caption vaza");
}

// =====================================================================
// Item 8: midia continua terminando no mesmo return de sempre -- nunca
// chega a chamar o Orquestrador (nem qualquer outra rede).
// =====================================================================
async function teste8_midiaNuncaChegaAoOrquestrador() {
  resetarTudo();
  await processar([
    mensagemMidia({ id: "IMG-4", telefone: TELEFONE_TESTE, campoMidia: "imageMessage" }),
  ]);
  ok(fetchChamadas.length === 0, "Item 8: nenhuma chamada de rede (fetch) para midia");
  ok(
    chamadasDedupRegistradas().includes("IMG-4"),
    "Item 8: dedup ainda roda normalmente para midia (comportamento pre-existente)",
  );
}

// =====================================================================
// Item 9: texto continua funcionando EXATAMENTE como antes -- chega ao
// Orquestrador com o mesmo contrato {telefone, conteudo}.
// =====================================================================
async function teste9_textoContinuaChamandoOrquestrador() {
  resetarTudo();
  const textoNormal = "Preciso de ajuda com meu acesso, ele parou de funcionar";
  await processar([
    mensagemTexto({ id: "TXT-1", telefone: TELEFONE_TESTE, texto: textoNormal }),
  ]);
  ok(fetchChamadas.length === 1, "Item 9: exatamente 1 chamada de rede para texto puro");
  const chamada = fetchChamadas[0];
  ok(
    chamada?.url?.endsWith("/functions/v1/orchestrator"),
    "Item 9: a chamada foi para o endpoint do Orquestrador",
  );
  const corpo = JSON.parse(chamada?.body ?? "{}");
  ok(corpo.telefone === TELEFONE_TESTE, "Item 9: telefone repassado identico ao de antes");
  ok(corpo.conteudo === textoNormal, "Item 9: conteudo repassado identico ao de antes (sem alteracao)");
}

// =====================================================================
// Bonus (cobre o item 1 da investigacao original -- "todos os caminhos
// de imageMessage/videoMessage/documentMessage/audioMessage"): confirma
// que o diagnostico identifica corretamente os 4 tipos, e que nenhum
// deles chega ao Orquestrador.
// =====================================================================
async function testeBonus_todosOsTiposDeMidia() {
  for (const campo of ["imageMessage", "videoMessage", "audioMessage", "documentMessage"]) {
    resetarTudo();
    const { logsCapturados } = await processar([
      mensagemMidia({ id: `BONUS-${campo}`, telefone: TELEFONE_TESTE, campoMidia: campo, mimetype: "application/octet-stream" }),
    ]);
    const diag = extrairDiagnostico(logsCapturados);
    ok(diag?.tipo === campo, `Bonus: tipo detectado corretamente para ${campo}`);
    ok(fetchChamadas.length === 0, `Bonus: ${campo} tambem nunca chega ao Orquestrador`);
  }
}

// =====================================================================
// Fase 4, Checkpoint C (shadow mode) -- integracao real de
// processarMidiaShadow() dentro de webhook-wasender/index.ts. O modulo
// _shared/wasender_media.ts em si (decrypt/download/validacao) ja tem
// suite propria (scripts/testes/wasender_media_decrypt/) -- aqui so'
// provamos que o WEBHOOK chama ele certo, trata o resultado certo, e
// que nada disso muda o comportamento ja provado nos testes acima.
// =====================================================================

// Checkpoint C.1: shadow chama processarMidiaWasender com os campos
// REAIS (url/mediaKey/mimetype/messageId), extraidos corretamente.
async function testeC1_shadowChamaComCamposCorretos() {
  resetarTudo();
  await processar([
    mensagemMidia({ id: "IMGC-1", telefone: TELEFONE_TESTE, campoMidia: "imageMessage" }),
  ]);
  const chamadas = chamadasWasenderMediaRegistradas();
  ok(chamadas.length === 1, "Checkpoint C.1: processarMidiaWasender chamado exatamente 1 vez");
  ok(chamadas[0]?.midia.url === URL_MIDIA_SENSIVEL, "Checkpoint C.1: url repassada identica ao helper");
  ok(
    chamadas[0]?.midia.mediaKey === MEDIA_KEY_SENSIVEL,
    "Checkpoint C.1: mediaKey repassada identica ao helper",
  );
  ok(chamadas[0]?.midia.mimetype === "image/jpeg", "Checkpoint C.1: mimetype repassado corretamente");
  ok(chamadas[0]?.messageId === "IMGC-1", "Checkpoint C.1: messageId repassado corretamente");
}

// Checkpoint C.2: o log do webhook so' mostra o outcome -- nunca o
// base64/conteudo devolvido pelo helper, nem url/mediaKey (reafirma
// itens 2-6 agora com a integracao real ligada).
async function testeC2_logSoMostraOutcome() {
  resetarTudo();
  const { logCompleto } = await processar([
    mensagemMidia({ id: "IMGC-2", telefone: TELEFONE_TESTE, campoMidia: "imageMessage" }),
  ]);
  ok(logCompleto.includes('"outcome":"success"'), "Checkpoint C.2: log shadow reporta o outcome");
  ok(
    !logCompleto.includes("FAKE_BASE64_NUNCA_DEVE_APARECER_NO_LOG"),
    "Checkpoint C.2: base64 devolvido pelo helper nunca aparece no log do webhook",
  );
  ok(!logCompleto.includes(URL_MIDIA_SENSIVEL), "Checkpoint C.2: URL ainda nunca aparece no log (integrado)");
  ok(
    !logCompleto.includes(MEDIA_KEY_SENSIVEL),
    "Checkpoint C.2: mediaKey ainda nunca aparece no log (integrado)",
  );
}

// Checkpoint C.3: mesmo com a integracao ligada, midia AINDA nunca
// chega ao Orquestrador -- reafirma o item 8 original.
async function testeC3_aindaNuncaChegaAoOrquestrador() {
  resetarTudo();
  await processar([
    mensagemMidia({ id: "IMGC-3", telefone: TELEFONE_TESTE, campoMidia: "imageMessage" }),
  ]);
  ok(
    fetchChamadas.length === 0,
    "Checkpoint C.3: midia ainda nunca gera nenhuma chamada real de rede (fetch) para o Orquestrador",
  );
}

// Checkpoint C.4: uma excecao dentro do helper shadow nunca derruba o
// processamento -- try/catch isolado.
async function testeC4_erroNoHelperNaoDerruba() {
  resetarTudo();
  forcarErroWasenderMedia(new Error("falha simulada do helper de midia"));
  const { resp, logCompleto } = await processar([
    mensagemMidia({ id: "IMGC-4", telefone: TELEFONE_TESTE, campoMidia: "imageMessage" }),
  ]);
  ok(resp.status === 200, "Checkpoint C.4: erro no helper shadow nao muda a resposta HTTP (200)");
  ok(
    logCompleto.includes("[shadow:wasender_media] erro (ignorado"),
    "Checkpoint C.4: erro do helper e' logado como ignorado",
  );
  ok(
    fetchChamadas.length === 0,
    "Checkpoint C.4: mesmo com erro no shadow, midia continua nunca chegando ao Orquestrador",
  );
}

// Checkpoint C.4b: outcome de FALHA do helper (ex.: decrypt_falhou) e'
// logado normalmente, sem tratamento especial e sem vazar nada extra.
async function testeC4b_outcomeDeFalhaTambemSoLogaOutcome() {
  resetarTudo();
  definirResultadoWasenderMedia({ outcome: "decrypt_falhou" });
  const { resp, logCompleto } = await processar([
    mensagemMidia({ id: "IMGC-4B", telefone: TELEFONE_TESTE, campoMidia: "imageMessage" }),
  ]);
  ok(resp.status === 200, "Checkpoint C.4b: outcome de falha nao muda a resposta HTTP (200)");
  ok(
    logCompleto.includes('"outcome":"decrypt_falhou"'),
    "Checkpoint C.4b: outcome de falha e' logado normalmente",
  );
  ok(fetchChamadas.length === 0, "Checkpoint C.4b: ainda nunca chega ao Orquestrador");
}

// Checkpoint C.5: campos insuficientes (mediaKey ausente) -- fail-safe,
// nunca chama o helper com dado incompleto/inventado.
async function testeC5_camposInsuficientesNaoChamaHelper() {
  resetarTudo();
  await processar([
    {
      key: chaveMensagem("IMGC-5", TELEFONE_TESTE),
      message: { imageMessage: { url: URL_MIDIA_SENSIVEL, mimetype: "image/jpeg" } }, // sem mediaKey
    },
  ]);
  ok(
    chamadasWasenderMediaRegistradas().length === 0,
    "Checkpoint C.5: sem mediaKey, o helper NUNCA e' chamado (fail-safe, nada inventado)",
  );
}

// =====================================================================
// Fase 4, Checkpoint D1 (shadow mode) -- Gemini multimodal chamado
// DIRETO do webhook (nunca via Orchestrator), so' quando o decrypt/
// validacao da midia (Checkpoint B/C) teve sucesso. Contrato Webhook->
// Orchestrator continua intocado (D2 fora de escopo).
// =====================================================================

// D1.1: Gemini chamado com a midia certa e contextoCliente=null.
async function testeD1_1_geminiChamadoComMidiaCorreta() {
  resetarTudo();
  await processar([
    mensagemMidia({ id: "IMGD1-1", telefone: TELEFONE_TESTE, campoMidia: "imageMessage" }),
  ]);
  const chamadas = chamadasGeminiRegistradas();
  ok(chamadas.length === 1, "D1.1: chamarGemini chamado exatamente 1 vez quando o decrypt teve sucesso");
  ok(chamadas[0]?.contextoCliente === null, "D1.1: contextoCliente e' sempre null neste caminho");
  ok(
    Array.isArray(chamadas[0]?.midias) && chamadas[0].midias.length === 1,
    "D1.1: exatamente 1 midia repassada ao Gemini",
  );
  ok(chamadas[0]?.midias[0]?.mimeType === "image/jpeg", "D1.1: mimeType repassado do resultado do decrypt");
  ok(
    chamadas[0]?.midias[0]?.dadosBase64 === "FAKE_BASE64_NUNCA_DEVE_APARECER_NO_LOG",
    "D1.1: dadosBase64 repassado do resultado do decrypt",
  );
  ok(
    chamadas[0]?.mensagemCliente === "(sem texto associado a esta midia)",
    "D1.1: placeholder usado quando nao ha legenda/texto associado",
  );
}

// D1.2: legenda real (messageBody) e' repassada como mensagem ao Gemini.
async function testeD1_2_legendaUsadaComoMensagem() {
  resetarTudo();
  const LEGENDA = "PlaySim nao carrega os canais, olha o print";
  await processar([
    mensagemMidia({
      id: "IMGD1-2",
      telefone: TELEFONE_TESTE,
      campoMidia: "imageMessage",
      messageBody: LEGENDA,
    }),
  ]);
  ok(
    chamadasGeminiRegistradas()[0]?.mensagemCliente === LEGENDA,
    "D1.2: legenda (messageBody) repassada como mensagem ao Gemini",
  );
}

// D1.3: log so' mostra metadados seguros -- NUNCA o texto completo da
// resposta do Gemini (que pode conter qualquer dado, ate' um telefone).
async function testeD1_3_logSoMetadadosSeguros() {
  resetarTudo();
  const TEXTO_RESPOSTA_SENSIVEL =
    `Resposta completa do Gemini que NUNCA deve vazar inteira, telefone: ${TELEFONE_TESTE}`;
  definirResultadoGemini({
    outcome: "success",
    data: { tipo: "responder", texto: TEXTO_RESPOSTA_SENSIVEL, esclarecimento: false },
  });
  const { logCompleto } = await processar([
    mensagemMidia({ id: "IMGD1-3", telefone: TELEFONE_TESTE, campoMidia: "imageMessage" }),
  ]);
  ok(logCompleto.includes('"outcome":"success"'), "D1.3: log reporta o outcome");
  ok(logCompleto.includes('"tipo":"responder"'), "D1.3: log reporta o tipo da resposta estruturada");
  ok(logCompleto.includes('"tamanhoTextoResposta"'), "D1.3: log reporta o TAMANHO do texto, nunca o texto");
  ok(
    !logCompleto.includes(TEXTO_RESPOSTA_SENSIVEL),
    "D1.3: texto completo da resposta do Gemini nunca aparece no log",
  );
  ok(
    !logCompleto.includes("Resposta completa do Gemini"),
    "D1.3: nenhum fragmento do texto do Gemini vaza no log",
  );
  ok(
    !logCompleto.includes(TELEFONE_TESTE),
    "D1.3: telefone (mesmo escondido dentro do texto do Gemini) nunca aparece no log",
  );
  ok(!logCompleto.includes(URL_MIDIA_SENSIVEL), "D1.3: URL ainda nunca aparece no log");
  ok(!logCompleto.includes(MEDIA_KEY_SENSIVEL), "D1.3: mediaKey ainda nunca aparece no log");
  ok(
    !logCompleto.includes("FAKE_BASE64_NUNCA_DEVE_APARECER_NO_LOG"),
    "D1.3: base64 da midia nunca aparece no log",
  );
}

// D1.4: Gemini NUNCA e' chamado se o decrypt/validacao da midia falhou.
async function testeD1_4_geminiNaoChamadoSeDecryptFalhou() {
  resetarTudo();
  definirResultadoWasenderMedia({ outcome: "decrypt_falhou" });
  await processar([
    mensagemMidia({ id: "IMGD1-4", telefone: TELEFONE_TESTE, campoMidia: "imageMessage" }),
  ]);
  ok(
    chamadasGeminiRegistradas().length === 0,
    "D1.4: Gemini nunca e' chamado se o decrypt/validacao da midia falhou",
  );
}

// D1.5: erro no Gemini shadow nunca derruba o atendimento.
async function testeD1_5_erroNoGeminiNaoDerruba() {
  resetarTudo();
  forcarErroGemini(new Error("falha simulada do Gemini multimodal"));
  const { resp, logCompleto } = await processar([
    mensagemMidia({ id: "IMGD1-5", telefone: TELEFONE_TESTE, campoMidia: "imageMessage" }),
  ]);
  ok(resp.status === 200, "D1.5: erro no Gemini shadow nao muda a resposta HTTP (200)");
  ok(
    logCompleto.includes("[shadow:gemini_multimodal] erro (ignorado"),
    "D1.5: erro do Gemini shadow e' logado como ignorado",
  );
  ok(fetchChamadas.length === 0, "D1.5: mesmo com erro no Gemini shadow, nunca chega ao Orquestrador");
}

// D1.6: reafirma que a integracao completa (decrypt + Gemini) ainda
// nunca gera nenhuma chamada real ao Orquestrador nem muda a resposta
// ao cliente.
async function testeD1_6_aindaNuncaChegaAoOrquestrador() {
  resetarTudo();
  await processar([
    mensagemMidia({ id: "IMGD1-6", telefone: TELEFONE_TESTE, campoMidia: "imageMessage" }),
  ]);
  ok(
    fetchChamadas.length === 0,
    "D1.6: midia com Gemini multimodal shadow AINDA nunca gera chamada real ao Orquestrador",
  );
}

// D1.7: outcome "unavailable" do Gemini tambem so' loga outcome/tempo.
async function testeD1_7_outcomeUnavailable() {
  resetarTudo();
  definirResultadoGemini({ outcome: "unavailable" });
  const { logCompleto } = await processar([
    mensagemMidia({ id: "IMGD1-7", telefone: TELEFONE_TESTE, campoMidia: "imageMessage" }),
  ]);
  ok(
    logCompleto.includes('"outcome":"unavailable"') && logCompleto.includes("gemini_multimodal"),
    "D1.7: outcome unavailable do Gemini e' logado normalmente",
  );
}

await teste1_diagnosticoImagem();
await teste2a6_nadaSensivelNoLog();
await teste7_captionSoPresenca();
await teste8_midiaNuncaChegaAoOrquestrador();
await teste9_textoContinuaChamandoOrquestrador();
await testeBonus_todosOsTiposDeMidia();
await testeC1_shadowChamaComCamposCorretos();
await testeC2_logSoMostraOutcome();
await testeC3_aindaNuncaChegaAoOrquestrador();
await testeC4_erroNoHelperNaoDerruba();
await testeC4b_outcomeDeFalhaTambemSoLogaOutcome();
await testeC5_camposInsuficientesNaoChamaHelper();
await testeD1_1_geminiChamadoComMidiaCorreta();
await testeD1_2_legendaUsadaComoMensagem();
await testeD1_3_logSoMetadadosSeguros();
await testeD1_4_geminiNaoChamadoSeDecryptFalhou();
await testeD1_5_erroNoGeminiNaoDerruba();
await testeD1_6_aindaNuncaChegaAoOrquestrador();
await testeD1_7_outcomeUnavailable();

console.log("");
if (falhas === 0) {
  console.log("TODOS OS TESTES PASSARAM (webhook_wasender_diagnostico_midia)");
} else {
  console.error(`${falhas} FALHA(S) (webhook_wasender_diagnostico_midia)`);
  process.exit(1);
}
