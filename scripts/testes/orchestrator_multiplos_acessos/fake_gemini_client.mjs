// Fake de _shared/gemini_client.ts -- so' esta peca e' fakeada; a
// resposta configurada aqui passa pelo _shared/validador.ts REAL logo
// em seguida dentro do orchestrator, que e' quem decide de verdade se
// aprova/rejeita e por qual motivo (nunca decidido por este fake).

let proximaResposta = { outcome: "success", data: { tipo: "responder", texto: "ok" } };

export function definirProximaRespostaGemini(resposta) {
  proximaResposta = resposta;
}
export function resetarGemini() {
  proximaResposta = { outcome: "success", data: { tipo: "responder", texto: "ok" } };
}

export async function chamarGemini() {
  return proximaResposta;
}
