// Fake de _shared/rocket_intermediaria.ts. Controlavel por teste --
// nunca reconsulta nada de verdade, so devolve o que foi configurado.
// StatusResult/MatchCandidate reproduzem exatamente o shape real
// (mesmos nomes de campo) para que _shared/contexto.ts (real) monte o
// contexto no formato que _shared/validador.ts (real) sabe parsear.

let matchConfigurado = { outcome: "no_match", candidates: [] };
let statusPorPublicId = new Map();

export function configurarMatch(resultado) {
  matchConfigurado = resultado;
}
export function configurarStatus(publicId, resultado) {
  statusPorPublicId.set(publicId, resultado);
}
export function resetarRocketIntermediaria() {
  matchConfigurado = { outcome: "no_match", candidates: [] };
  statusPorPublicId = new Map();
}

export async function chamarMatch() {
  return matchConfigurado;
}

export async function chamarStatus(publicId) {
  return (
    statusPorPublicId.get(publicId) ?? {
      outcome: "unavailable",
      linkState: "unlinked",
      publicId: null,
      syncedAt: null,
    }
  );
}
