// Fake de _shared/supabase_client.ts para a suite portal_rate_limit.
// So' precisa de .rpc() -- este modulo nunca usa .from() diretamente.

let comportamento = { modo: "fixo", valor: true };
export const chamadasRpc = [];

// modo "fixo": toda chamada devolve `valor` (ou lanca, se `erro` setado).
// modo "atomico": simula de verdade a mesma semantica da funcao SQL
// registrar_tentativa_portal_renovacao (janela + limite por chave) --
// usado so' no teste de concorrencia, pra provar que o wrapper JS nao
// introduz nenhuma corrida propria (so' emite 1 chamada por tentativa).
const estadoAtomico = new Map(); // chave -> { janelaInicioMs, tentativas }

export function configurarFixo(valor, erro = null) {
  comportamento = { modo: "fixo", valor, erro };
}
export function configurarAtomico() {
  comportamento = { modo: "atomico" };
  estadoAtomico.clear();
}
export function configurarExcecao() {
  comportamento = { modo: "excecao" };
}
export function resetar() {
  comportamento = { modo: "fixo", valor: true, erro: null };
  chamadasRpc.length = 0;
  estadoAtomico.clear();
}

export function getServiceClient() {
  return {
    rpc: async (nome, params) => {
      chamadasRpc.push({ nome, params });

      if (comportamento.modo === "excecao") {
        throw new Error("falha de rede simulada");
      }
      if (comportamento.modo === "fixo") {
        if (comportamento.erro) return { data: null, error: comportamento.erro };
        return { data: comportamento.valor, error: null };
      }
      if (comportamento.modo === "atomico") {
        const { p_chave, p_janela_segundos, p_limite } = params;
        const agora = Date.now();
        let estado = estadoAtomico.get(p_chave);
        if (!estado || estado.janelaInicioMs <= agora - p_janela_segundos * 1000) {
          estado = { janelaInicioMs: agora, tentativas: 1 };
        } else {
          estado.tentativas += 1;
        }
        estadoAtomico.set(p_chave, estado);
        return { data: estado.tentativas <= p_limite, error: null };
      }
      throw new Error("modo de fake desconhecido");
    },
  };
}
