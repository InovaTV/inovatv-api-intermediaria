// Fake compacto de supabase-js para a suite renovacoes_lote (Etapa 1).
// Cobre so' o que _shared/renovacoes_lote.ts usa: from().insert/select/
// update com eq/in/order/maybeSingle/single, e rpc(nome, params).
// Estado em memoria; nenhuma FK/constraint simulada (as RPCs reais e a
// FK sao SQL, testadas so' em producao).

let estado = { renovacoes_lote: [], tokens_renovacao: [] };
let rpcChamadas = [];
let rpcResposta = {}; // nome -> valor a retornar

export function resetar() {
  estado = { renovacoes_lote: [], tokens_renovacao: [] };
  rpcChamadas = [];
  rpcResposta = {};
}
export function seed(tabela, linhas) {
  estado[tabela].push(...linhas.map((l) => ({ ...l })));
}
export function tabela(nome) {
  return estado[nome].map((l) => ({ ...l }));
}
export function chamadasRpc() {
  return rpcChamadas;
}
export function definirRespostaRpc(nome, valor) {
  rpcResposta[nome] = valor;
}

class QB {
  constructor(t) {
    this.t = t;
    this.filtros = [];
    this.op = null;
    this.payload = null;
    this.ord = null;
    this.limite = null;
  }
  insert(linhas) {
    this.op = "insert";
    this.payload = Array.isArray(linhas) ? linhas : [linhas];
    return this;
  }
  update(patch) {
    this.op = "update";
    this.payload = patch;
    return this;
  }
  select() {
    return this;
  }
  eq(col, val) {
    this.filtros.push((r) => r[col] === val);
    return this;
  }
  in(col, vals) {
    this.filtros.push((r) => vals.includes(r[col]));
    return this;
  }
  is(col, val) {
    // so' usamos .is(col, null) -- checagem de NULL/undefined
    this.filtros.push((r) => (val === null ? r[col] == null : r[col] === val));
    return this;
  }
  lt(col, val) {
    this.filtros.push((r) => r[col] != null && r[col] < val);
    return this;
  }
  order(col, { ascending = true } = {}) {
    this.ord = { col, ascending };
    return this;
  }
  limit(n) {
    this.limite = n;
    return this;
  }
  _match(r) {
    return this.filtros.every((f) => f(r));
  }
  _run() {
    if (this.op === "insert") {
      const criados = this.payload.map((l) => ({
        grupo_id: l.grupo_id ?? cryptoId(),
        id: l.id ?? cryptoId(),
        criado_em: new Date().toISOString(),
        ...l,
      }));
      estado[this.t].push(...criados);
      return criados;
    }
    let linhas = estado[this.t].filter((r) => this._match(r));
    if (this.op === "update") {
      for (const r of linhas) Object.assign(r, this.payload);
    }
    if (this.ord) {
      linhas = [...linhas].sort((a, b) => {
        const x = a[this.ord.col], y = b[this.ord.col];
        return (x < y ? -1 : x > y ? 1 : 0) * (this.ord.ascending ? 1 : -1);
      });
    }
    if (this.limite != null) linhas = linhas.slice(0, this.limite);
    return linhas.map((l) => ({ ...l }));
  }
  async single() {
    const r = this._run();
    return { data: r[0] ?? null, error: r[0] ? null : { message: "no rows" } };
  }
  async maybeSingle() {
    const r = this._run();
    return { data: r[0] ?? null, error: null };
  }
  then(resolve) {
    // await direto no builder (usado em buscarFilhosDoLote / inserts sem single)
    resolve({ data: this._run(), error: null });
  }
}

function cryptoId() {
  return crypto.randomUUID();
}

export function getServiceClient() {
  return {
    from: (t) => new QB(t),
    rpc: async (nome, params) => {
      rpcChamadas.push({ nome, params });
      return { data: rpcResposta[nome] ?? null, error: null };
    },
  };
}
