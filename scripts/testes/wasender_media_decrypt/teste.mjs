// Fase 4, Checkpoint B (aprovado 2026-09-11) -- prova isolada de que
// _shared/wasender_media.ts transforma um objeto de midia do Wasender
// em bytes de imagem validos via /api/decrypt-media, SEM tocar nenhum
// fluxo de atendimento (este modulo nao e importado por
// webhook-wasender/index.ts nem por nada mais em producao ainda).
//
// Todas as chamadas de rede (fetch) sao MOCKADAS aqui -- nao existe
// WASENDER_API_TOKEN real neste ambiente de desenvolvimento, e testar
// contra o /api/decrypt-media real exigiria uma midia de cliente
// verdadeira (url+mediaKey de um blob real do WhatsApp), que nao temos
// e nao devemos fabricar nem usar sem uma sessao de teste controlada
// dedicada -- ver observacao no relatorio final sobre a lacuna entre
// "provado por mock" e "provado ao vivo contra o Wasender real".
//
// Como rodar: npx tsx scripts/testes/wasender_media_decrypt/teste.mjs

const TOKEN_TESTE = "TOKEN-WASENDER-DE-TESTE-NUNCA-DEVE-VAZAR";
const URL_ORIGINAL_SENSIVEL =
  "https://mmg.whatsapp.net/o1/v/t62.7161-24/BLOB_ORIGINAL_NUNCA_DEVE_VAZAR";
const MEDIA_KEY_SENSIVEL = "mediaKeyBase64SuperSecreta_NUNCA_DEVE_VAZAR==";
const PUBLIC_URL_SENSIVEL =
  "https://www.wasenderapi.com/api/decrypted-media/PUBLIC_URL_NUNCA_DEVE_VAZAR";
const MESSAGE_ID_TESTE = "MSGID-TESTE-1";

process.env.WASENDER_API_TOKEN = TOKEN_TESTE;

globalThis.Deno = { env: { get: (nome) => process.env[nome] } };

// ---------------------------------------------------------------------
// Fixtures de bytes REAIS (assinaturas/magic bytes genuinas de cada
// formato) -- nao sao imagens completas/decodificaveis, mas os
// primeiros bytes sao EXATAMENTE os que um JPEG/PNG/WebP real teria,
// entao a logica de validacao de magic_bytes e' exercitada com dados
// estruturalmente corretos, nao com uma string arbitraria fingindo ser
// bytes.
// ---------------------------------------------------------------------
function bytesJPEG() {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
}
function bytesPNG() {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);
}
function bytesWEBP() {
  return new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0, 0, 0, 0]);
}
function bytesInvalidos() {
  return new Uint8Array(16).fill(0x41); // "AAAA..." -- nao bate com nenhuma assinatura conhecida
}

function arrayBufferDe(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

// ---------------------------------------------------------------------
// Mock de fetch -- diferencia a chamada de decrypt (URL contem
// "/api/decrypt-media") da chamada de download (qualquer outra URL,
// que na pratica sera' o publicUrl retornado pelo decrypt).
// ---------------------------------------------------------------------
let fetchChamadas = [];
let comportamentoDecrypt = { ok: true, status: 200, publicUrl: PUBLIC_URL_SENSIVEL };
let comportamentoDownload = { ok: true, status: 200, bytes: bytesJPEG() };

function resetarMocks() {
  fetchChamadas = [];
  comportamentoDecrypt = { ok: true, status: 200, publicUrl: PUBLIC_URL_SENSIVEL };
  comportamentoDownload = { ok: true, status: 200, bytes: bytesJPEG() };
}

globalThis.fetch = async (url, opts) => {
  const urlStr = String(url);
  fetchChamadas.push({ url: urlStr, method: opts?.method, headers: opts?.headers, body: opts?.body });

  if (urlStr.includes("/api/decrypt-media")) {
    const { ok, status, publicUrl } = comportamentoDecrypt;
    return {
      ok,
      status,
      json: async () => (ok ? { success: true, publicUrl } : {}),
    };
  }

  const { ok, status, bytes } = comportamentoDownload;
  return {
    ok,
    status,
    arrayBuffer: async () => arrayBufferDe(bytes),
  };
};

const { processarMidiaWasender } = await import(
  "../../../supabase/functions/_shared/wasender_media.ts"
);

let falhas = 0;
function ok(condicao, mensagem) {
  if (!condicao) {
    falhas++;
    console.error(`FALHA: ${mensagem}`);
  } else {
    console.log(`ok: ${mensagem}`);
  }
}

function midiaPadrao(overrides = {}) {
  return {
    url: URL_ORIGINAL_SENSIVEL,
    mediaKey: MEDIA_KEY_SENSIVEL,
    mimetype: "image/jpeg",
    ...overrides,
  };
}

async function capturarLogs(fn) {
  const logs = [];
  const logOriginal = console.log;
  console.log = (...args) => {
    logs.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  };
  let resultado;
  try {
    resultado = await fn();
  } finally {
    console.log = logOriginal;
  }
  return { resultado, logCompleto: logs.join("\n") };
}

// =====================================================================
// 1. decrypt bem-sucedido
// =====================================================================
async function teste1_decryptBemSucedido() {
  resetarMocks();
  const r = await processarMidiaWasender(midiaPadrao(), MESSAGE_ID_TESTE);
  ok(r.outcome === "success", "1: decrypt bem-sucedido -> outcome success");
  ok(fetchChamadas.length >= 1, "1: pelo menos 1 chamada de rede feita");
  const chamadaDecrypt = fetchChamadas[0];
  ok(chamadaDecrypt.url.endsWith("/api/decrypt-media"), "1: primeira chamada foi ao endpoint de decrypt");
  ok(chamadaDecrypt.method === "POST", "1: decrypt chamado via POST");
  ok(
    chamadaDecrypt.headers?.Authorization === `Bearer ${TOKEN_TESTE}`,
    "1: header Authorization Bearer presente e correto",
  );
  const corpoEnviado = JSON.parse(chamadaDecrypt.body);
  ok(
    corpoEnviado.data.messages.message.imageMessage.url === URL_ORIGINAL_SENSIVEL &&
      corpoEnviado.data.messages.message.imageMessage.mediaKey === MEDIA_KEY_SENSIVEL,
    "1: payload de decrypt contem url/mediaKey originais (formato da doc oficial)",
  );
}

// =====================================================================
// 2. download bem-sucedido
// =====================================================================
async function teste2_downloadBemSucedido() {
  resetarMocks();
  const r = await processarMidiaWasender(midiaPadrao(), MESSAGE_ID_TESTE);
  ok(r.outcome === "success", "2: pipeline completo ate' download -> success");
  ok(fetchChamadas.length === 2, "2: exatamente 2 chamadas de rede (decrypt + download)");
  ok(fetchChamadas[1].url === PUBLIC_URL_SENSIVEL, "2: segunda chamada foi ao publicUrl retornado pelo decrypt");
  ok(fetchChamadas[1].method === undefined, "2: download e' um GET simples (sem method explicito)");
}

// =====================================================================
// 3-5. formatos validos
// =====================================================================
async function teste3a5_formatosValidos() {
  const casos = [
    { nome: "JPEG", mimetype: "image/jpeg", bytes: bytesJPEG() },
    { nome: "PNG", mimetype: "image/png", bytes: bytesPNG() },
    { nome: "WebP", mimetype: "image/webp", bytes: bytesWEBP() },
  ];
  for (const caso of casos) {
    resetarMocks();
    comportamentoDownload.bytes = caso.bytes;
    const r = await processarMidiaWasender(midiaPadrao({ mimetype: caso.mimetype }), MESSAGE_ID_TESTE);
    ok(r.outcome === "success", `3-5: ${caso.nome} valido -> outcome success`);
    ok(r.mimeType === caso.mimetype, `3-5: ${caso.nome} -> mimeType correto no resultado`);
    ok(r.tamanhoBytes === caso.bytes.length, `3-5: ${caso.nome} -> tamanhoBytes bate com os bytes baixados`);
    ok(typeof r.dadosBase64 === "string" && r.dadosBase64.length > 0, `3-5: ${caso.nome} -> dadosBase64 presente`);
  }
}

// =====================================================================
// 6. HTTP decriptacao com erro
// =====================================================================
async function teste6_httpDecryptComErro() {
  resetarMocks();
  comportamentoDecrypt = { ok: false, status: 401, publicUrl: PUBLIC_URL_SENSIVEL };
  const r = await processarMidiaWasender(midiaPadrao(), MESSAGE_ID_TESTE);
  ok(r.outcome === "decrypt_falhou", "6: HTTP de erro no decrypt -> outcome decrypt_falhou");
  ok(fetchChamadas.length === 1, "6: download NUNCA e' tentado se o decrypt falhou");
}

// =====================================================================
// 7. download com erro
// =====================================================================
async function teste7_downloadComErro() {
  resetarMocks();
  comportamentoDownload = { ok: false, status: 404, bytes: bytesJPEG() };
  const r = await processarMidiaWasender(midiaPadrao(), MESSAGE_ID_TESTE);
  ok(r.outcome === "download_falhou", "7: HTTP de erro no download -> outcome download_falhou");
  ok(fetchChamadas.length === 2, "7: decrypt foi tentado antes (chegou ate' o download)");
}

// =====================================================================
// 8. MIME nao permitido
// =====================================================================
async function teste8_mimeNaoPermitido() {
  resetarMocks();
  const r = await processarMidiaWasender(midiaPadrao({ mimetype: "application/pdf" }), MESSAGE_ID_TESTE);
  ok(r.outcome === "mime_nao_permitido", "8: MIME fora da allowlist -> outcome mime_nao_permitido");
  ok(fetchChamadas.length === 0, "8: NENHUMA chamada de rede acontece para MIME nao permitido");
}

// =====================================================================
// 9. magic bytes incompativeis com o MIME declarado
// =====================================================================
async function teste9_magicBytesIncompativeis() {
  resetarMocks();
  comportamentoDownload.bytes = bytesInvalidos(); // declarado image/jpeg, bytes nao sao JPEG
  const r = await processarMidiaWasender(midiaPadrao({ mimetype: "image/jpeg" }), MESSAGE_ID_TESTE);
  ok(r.outcome === "magic_bytes_invalidos", "9: bytes nao batem com o mimetype declarado -> magic_bytes_invalidos");

  resetarMocks();
  comportamentoDownload.bytes = bytesPNG(); // declarado JPEG, mas bytes sao de PNG real
  const r2 = await processarMidiaWasender(midiaPadrao({ mimetype: "image/jpeg" }), MESSAGE_ID_TESTE);
  ok(
    r2.outcome === "magic_bytes_invalidos",
    "9: bytes de um formato real diferente do declarado tambem sao rejeitados",
  );
}

// =====================================================================
// 10. tamanho acima do limite
// =====================================================================
async function teste10_tamanhoAcimaDoLimite() {
  resetarMocks();
  const grande = new Uint8Array(5 * 1024 * 1024 + 1);
  grande.set(bytesJPEG(), 0); // magic bytes validos -- prova que E' o tamanho que barra, nao o formato
  comportamentoDownload.bytes = grande;
  const r = await processarMidiaWasender(midiaPadrao(), MESSAGE_ID_TESTE);
  ok(r.outcome === "tamanho_excedido", "10: bytes acima de 5MB -> outcome tamanho_excedido");
}

// =====================================================================
// 11. nenhuma URL/token/mediaKey/Base64 aparece no log
// =====================================================================
async function teste11_nadaSensivelNoLog() {
  resetarMocks();
  const { resultado, logCompleto } = await capturarLogs(() =>
    processarMidiaWasender(midiaPadrao(), MESSAGE_ID_TESTE),
  );
  ok(resultado.outcome === "success", "11: pipeline de sucesso rodou (para ter algo relevante no log)");
  ok(logCompleto.length > 0, "11: pelo menos 1 linha de log foi capturada");
  ok(!logCompleto.includes(URL_ORIGINAL_SENSIVEL), "11: URL original nunca aparece no log");
  ok(!logCompleto.includes(MEDIA_KEY_SENSIVEL), "11: mediaKey nunca aparece no log");
  ok(!logCompleto.includes(TOKEN_TESTE), "11: token nunca aparece no log");
  ok(!logCompleto.includes(PUBLIC_URL_SENSIVEL), "11: publicUrl nunca aparece no log");
  ok(!logCompleto.includes(resultado.dadosBase64), "11: base64 do resultado nunca aparece no log");
  ok(!logCompleto.toLowerCase().includes("dadosbase64"), "11: nem o NOME do campo base64 aparece no log");

  // Repete para o caminho de falha (decrypt com erro) -- garante que o
  // log de erro tambem nao vaza nada.
  resetarMocks();
  comportamentoDecrypt = { ok: false, status: 401, publicUrl: PUBLIC_URL_SENSIVEL };
  const { logCompleto: logErro } = await capturarLogs(() =>
    processarMidiaWasender(midiaPadrao(), MESSAGE_ID_TESTE),
  );
  ok(!logErro.includes(URL_ORIGINAL_SENSIVEL), "11: (erro) URL original nunca aparece no log");
  ok(!logErro.includes(MEDIA_KEY_SENSIVEL), "11: (erro) mediaKey nunca aparece no log");
  ok(!logErro.includes(TOKEN_TESTE), "11: (erro) token nunca aparece no log");
}

await teste1_decryptBemSucedido();
await teste2_downloadBemSucedido();
await teste3a5_formatosValidos();
await teste6_httpDecryptComErro();
await teste7_downloadComErro();
await teste8_mimeNaoPermitido();
await teste9_magicBytesIncompativeis();
await teste10_tamanhoAcimaDoLimite();
await teste11_nadaSensivelNoLog();

console.log("");
if (falhas === 0) {
  console.log("TODOS OS TESTES PASSARAM (wasender_media_decrypt)");
} else {
  console.error(`${falhas} FALHA(S) (wasender_media_decrypt)`);
  process.exit(1);
}
