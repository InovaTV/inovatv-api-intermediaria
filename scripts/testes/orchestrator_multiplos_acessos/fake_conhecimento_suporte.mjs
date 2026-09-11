// Fake de _shared/conhecimento_suporte.ts (Fase 3, Checkpoint 2 --
// integracao em modo sombra, 2026-09-11). So existe pra esta suite
// provar, no orchestrator REAL, que: a chamada sombra acontece; recebe
// SOMENTE servidor como contexto (aplicativo/dispositivo nunca
// inventados); erros dela nunca interrompem o atendimento; e o
// resultado dela nunca entra na resposta ao cliente/Gemini. O
// algoritmo real (filtro de contexto, status='ativo', scoring) e' da
// suite ISOLADA scripts/testes/conhecimento_suporte/ -- nao duplicado
// aqui.

let proximoResultado = { outcome: "nada_encontrado" };
let erroForcado = null;
let chamadas = [];

export function definirProximoResultadoConhecimentoSuporte(resultado) {
  proximoResultado = resultado;
}

export function forcarErroConhecimentoSuporte(erro) {
  erroForcado = erro;
}

export function resetarConhecimentoSuporteFake() {
  proximoResultado = { outcome: "nada_encontrado" };
  erroForcado = null;
  chamadas = [];
}

export function chamadasConhecimentoSuporte() {
  return chamadas;
}

export async function buscarConhecimentoSuporte(pergunta, contexto = {}) {
  chamadas.push({ pergunta, contexto });
  if (erroForcado) {
    const erro = erroForcado;
    erroForcado = null;
    throw erro;
  }
  return proximoResultado;
}
