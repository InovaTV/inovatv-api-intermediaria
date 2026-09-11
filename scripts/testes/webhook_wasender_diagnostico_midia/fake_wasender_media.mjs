// Fake de _shared/wasender_media.ts -- usado so' pela suite de
// integracao shadow do Checkpoint C. O modulo REAL (decrypt/download/
// validacao) ja tem suite propria e dedicada em
// scripts/testes/wasender_media_decrypt/ -- aqui so' precisamos provar
// que webhook-wasender/index.ts CHAMA com os campos certos e trata o
// resultado (e erros) da forma esperada, sem repetir aquela suite.
let chamadas = [];
let resultadoFixo = {
  outcome: "success",
  mimeType: "image/jpeg",
  dadosBase64: "FAKE_BASE64_NUNCA_DEVE_APARECER_NO_LOG",
  tamanhoBytes: 12345,
};
let erroForcado = null;

export function resetarWasenderMediaFake() {
  chamadas = [];
  resultadoFixo = {
    outcome: "success",
    mimeType: "image/jpeg",
    dadosBase64: "FAKE_BASE64_NUNCA_DEVE_APARECER_NO_LOG",
    tamanhoBytes: 12345,
  };
  erroForcado = null;
}

export function definirResultadoWasenderMedia(resultado) {
  resultadoFixo = resultado;
}

export function forcarErroWasenderMedia(erro) {
  erroForcado = erro;
}

export function chamadasWasenderMediaRegistradas() {
  return chamadas;
}

export async function processarMidiaWasender(midia, messageId) {
  chamadas.push({ midia, messageId });
  if (erroForcado) throw erroForcado;
  return resultadoFixo;
}
