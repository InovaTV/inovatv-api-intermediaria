// Trilha de auditoria (Fase 3, 2026-09-14) -- fake minimo so' pra
// registrarEvento() (_shared/renovacao_eventos.ts) ter um
// getServiceClient() funcional nesta suite (que fakeia tokens_renovacao.ts/
// renovacoes_lote.ts/cobrancas_pix.ts inteiros). Catalogo de eventos ja
// coberto em scripts/testes/renovacao_iniciar/teste.mjs; aqui so'
// precisa nao lancar e permitir inspecionar o que foi gravado.

let linhas = [];

export function resetarEventos() {
  linhas = [];
}
export function lerEventos() {
  return linhas.map((l) => ({ ...l }));
}

class QB {
  constructor(t) {
    this.t = t;
  }
  insert(linha) {
    this.payload = linha;
    return this;
  }
  then(resolve) {
    if (this.t === "renovacao_eventos") linhas.push({ ...this.payload });
    resolve({ data: null, error: null });
  }
}

export function getServiceClient() {
  return { from: (t) => new QB(t) };
}
