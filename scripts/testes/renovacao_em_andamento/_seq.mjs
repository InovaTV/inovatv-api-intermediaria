// Registro de ordem de chamadas -- prova que a mensagem intermediaria
// e' enviada ANTES do dispatch do workflow.
let seq = [];
export function registrar(label) { seq.push(label); }
export function sequencia() { return seq.slice(); }
export function resetarSeq() { seq = []; }
