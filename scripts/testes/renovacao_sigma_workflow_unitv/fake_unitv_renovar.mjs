// Fake de scripts/lib/unitv-renovar.mjs para a suite do workflow.
// O workflow so' importa renovarUmAcessoUniTV -- este fake registra
// os argumentos e devolve o resultado configurado. (A mecanica real
// da lib e' congelada e testada na suite unitv_renovar.)

let proximo = { resultado: "sucesso", vencimentoConfirmado: "2026-12-03T02:31:01-03:00" };
let chamadas = [];

export function definirRenovarUmAcessoUniTV(r) { proximo = r; }
export function chamadasRenovarUniTV() { return chamadas; }
export function resetarFakeUnitvRenovar() {
  proximo = { resultado: "sucesso", vencimentoConfirmado: "2026-12-03T02:31:01-03:00" };
  chamadas = [];
}

export async function renovarUmAcessoUniTV(args) {
  chamadas.push(args);
  return proximo;
}
