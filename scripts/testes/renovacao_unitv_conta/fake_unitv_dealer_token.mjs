// Fase 2A: fake de _shared/unitv_dealer_token.ts para a suite da EF
// renovacao-unitv-conta. Devolve um token configuravel e registra as
// chamadas -- prova que a EF resolve o token e o injeta em
// resolverContaUnitv. Nunca puxa supabase-js.
let proximo = "tkn-vault-fake";
let chamadas = 0;

export function definirDealerToken(v) { proximo = v; }
export function chamadasObterToken() { return chamadas; }
export function resetarDealerToken() { proximo = "tkn-vault-fake"; chamadas = 0; }

export async function obterDealerToken() { chamadas++; return proximo; }
export function limparCacheDealerToken() {}
