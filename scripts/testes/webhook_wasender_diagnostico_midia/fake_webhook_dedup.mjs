// Fake de _shared/webhook_dedup.ts -- evita tocar
// webhook_mensagens_processadas real. registrarMensagemSeNova roda
// SINCRONO, incondicional, para toda mensagem (midia ou texto) -- sem
// este fake, a suite faria I/O real de banco a cada teste.
let chamadas = [];
let resultadoFixo = "nova";

export function resetarWebhookDedup() {
  chamadas = [];
  resultadoFixo = "nova";
}

export function definirResultadoDedup(resultado) {
  resultadoFixo = resultado;
}

export function chamadasDedupRegistradas() {
  return chamadas;
}

export async function registrarMensagemSeNova(messageId) {
  chamadas.push(messageId);
  return resultadoFixo;
}
