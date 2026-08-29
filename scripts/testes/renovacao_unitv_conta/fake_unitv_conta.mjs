// Fake de _shared/unitv_conta.ts para a suite da Edge Function
// renovacao-unitv-conta. So' resolverContaUnitv e' usada pela funcao
// real. Devolve um resultado configuravel e registra as chamadas
// (pra provar que a EF NAO chama o resolvedor quando a validacao falha).

let proximo = { ok: true, id: 3433363, sn: "gcnv6v", expireTimeRaw: "2026-11-03 02:31:01", customer: "UniTV", packageName: "Plano Basico" };
let chamadas = [];

export function definirResultado(r) { proximo = r; }
export function chamadasRegistradas() { return chamadas; }
export function resetarFake() {
  proximo = { ok: true, id: 3433363, sn: "gcnv6v", expireTimeRaw: "2026-11-03 02:31:01", customer: "UniTV", packageName: "Plano Basico" };
  chamadas = [];
}

export async function resolverContaUnitv(sn, opts) {
  chamadas.push({ sn, opts });
  return proximo;
}
