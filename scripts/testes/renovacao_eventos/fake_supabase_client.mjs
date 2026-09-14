// Fake compacto de supabase-js pra suite renovacao_eventos -- cobre so'
// from("renovacao_eventos").insert(...) (sem select/eq -- registrarEvento
// nunca le de volta). Mesmo formato ja usado em
// scripts/testes/renovacao_iniciar/fake_supabase_client.mjs.

let linhas = [];
let modoFalha = null; // null | "erro_banco" | "trava" (nunca resolve, pra testar timeout)

export function resetar() {
  linhas = [];
  modoFalha = null;
}
export function configurarFalha(modo) {
  modoFalha = modo;
}
export function lerLinhas() {
  return linhas.map((l) => ({ ...l }));
}

class QB {
  constructor(t) {
    this.t = t;
    this.payload = null;
  }
  insert(linha) {
    this.payload = linha;
    return this;
  }
  then(resolve, reject) {
    this._exec().then(resolve, reject);
  }
  async _exec() {
    if (modoFalha === "trava") {
      // Nunca resolve -- exercita o timeout de registrarEvento.
      await new Promise(() => {});
    }
    if (modoFalha === "erro_banco") {
      return { data: null, error: { message: "erro simulado de banco" } };
    }
    linhas.push({ ...this.payload, id: linhas.length + 1, criado_em: new Date().toISOString() });
    return { data: null, error: null };
  }
}

export function getServiceClient() {
  return {
    from: (t) => new QB(t),
  };
}
