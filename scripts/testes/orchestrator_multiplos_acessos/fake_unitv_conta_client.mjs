// Fake de _shared/unitv_conta_client.ts para a suite
// orchestrator_multiplos_acessos (Etapa 2, Bloco 4). O orchestrator so'
// importa chamarResolverContaUnitv -- registra os `sn` recebidos e
// devolve o resultado configurado (default: resolvido).

let proximo = { outcome: "resolvido", id: 3433363 };
let snsRecebidos = [];

export function definirResolucaoContaUnitv(r) { proximo = r; }
export function snsResolverContaUnitv() { return snsRecebidos; }
export function resetarUnitvContaClient() {
  proximo = { outcome: "resolvido", id: 3433363 };
  snsRecebidos = [];
}

export async function chamarResolverContaUnitv(sn) {
  snsRecebidos.push(sn);
  return proximo;
}
