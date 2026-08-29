import { registrar } from "./_seq.mjs";

let deveFalhar = false;
let inseridas = [];

export function configurarFalha(v) { deveFalhar = v; }
export function inseridasFeitas() { return inseridas; }
export function resetar() { deveFalhar = false; inseridas = []; }

export async function inserirMensagem(conversationId, origem, texto, episodioId) {
  registrar("inserirMensagem");
  if (deveFalhar) throw new Error("falha simulada ao gravar no historico");
  inseridas.push({ conversationId, origem, texto, episodioId });
}
