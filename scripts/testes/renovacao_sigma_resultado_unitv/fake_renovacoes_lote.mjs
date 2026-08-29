let lote = null, filhos = [];
let finalizado = { grupo_id: "grp", estado: "concluida" };
export function configurarLote(l) { lote = l; }
export function configurarFilhos(f) { filhos = f; }
export function configurarFinalizado(x) { finalizado = x; }
export function resetar() { lote = null; filhos = []; finalizado = { grupo_id: "grp", estado: "concluida" }; }
export async function buscarLotePorOperacaoId() { return lote; }
export async function buscarFilhosDoLote() { return filhos; }
export async function marcarResultadoFilhoLote(id) { return { id, estado: "renovacao_concluida" }; }
export async function marcarEstadoFinalLote(g, estado) { return { ...finalizado, estado }; }
