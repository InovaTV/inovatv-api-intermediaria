// Fake de _shared/conhecimento.ts (conhecimento institucional). Default
// inalterado (nao_encontrado, mesmo comportamento de sempre nesta
// suite). Configurabilidade + rastreio de chamadas adicionados no
// Checkpoint 2 (shadow mode) SOMENTE pra provar que este caminho
// continua sendo consultado normalmente, sem nenhuma mudanca em quem
// ja usava o default.

let proximoResultado = { outcome: "nao_encontrado" };
let chamadas = [];

export function definirProximoResultadoConhecimentoInstitucional(resultado) {
  proximoResultado = resultado;
}

export function resetarConhecimentoInstitucionalFake() {
  proximoResultado = { outcome: "nao_encontrado" };
  chamadas = [];
}

export function chamadasConhecimentoInstitucional() {
  return chamadas;
}

export async function buscarConhecimentoRelevante(pergunta) {
  chamadas.push({ pergunta });
  return proximoResultado;
}
