// Fake de _shared/gemini_client.ts -- usado so' pela suite de
// integracao shadow do Checkpoint D1. Nao repete os testes do modulo
// real (gemini_client.ts nao tem suite propria porque so' faz uma
// chamada HTTP direta ao Google -- o contrato dele e' o que testamos
// aqui: como o webhook usa o resultado).
let chamadas = [];
let resultadoFixo = {
  outcome: "success",
  data: {
    tipo: "responder",
    texto: "Resposta de teste do Gemini multimodal (nunca deve aparecer completa no log)",
    esclarecimento: false,
  },
};
let erroForcado = null;

export function resetarGeminiClientFake() {
  chamadas = [];
  resultadoFixo = {
    outcome: "success",
    data: {
      tipo: "responder",
      texto: "Resposta de teste do Gemini multimodal (nunca deve aparecer completa no log)",
      esclarecimento: false,
    },
  };
  erroForcado = null;
}

export function definirResultadoGemini(resultado) {
  resultadoFixo = resultado;
}

export function forcarErroGemini(erro) {
  erroForcado = erro;
}

export function chamadasGeminiRegistradas() {
  return chamadas;
}

export async function chamarGemini(mensagemCliente, contextoCliente, midias = []) {
  chamadas.push({ mensagemCliente, contextoCliente, midias });
  if (erroForcado) throw erroForcado;
  return resultadoFixo;
}
