// Fake de _shared/gemini_client.ts -- so' esta peca e' fakeada; a
// resposta configurada aqui passa pelo _shared/validador.ts REAL logo
// em seguida dentro do orchestrator, que e' quem decide de verdade se
// aprova/rejeita e por qual motivo (nunca decidido por este fake).

let proximaResposta = { outcome: "success", data: { tipo: "responder", texto: "ok" } };
// Rastreio dos args recebidos, adicionado no Checkpoint 2 (shadow mode)
// SOMENTE pra provar que contextoCompleto passado ao Gemini nunca
// carrega nada da Base Evolutiva de Suporte -- nao usado por nenhum
// teste anterior a isso.
let chamadas = [];

export function definirProximaRespostaGemini(resposta) {
  proximaResposta = resposta;
}
export function resetarGemini() {
  proximaResposta = { outcome: "success", data: { tipo: "responder", texto: "ok" } };
  chamadas = [];
}
export function chamadasGemini() {
  return chamadas;
}

export async function chamarGemini(pergunta, contexto) {
  chamadas.push({ pergunta, contexto });
  return proximaResposta;
}
