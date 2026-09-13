// Fake compacto de supabase-js para a suite renovacao_status. Cobre so'
// o que _shared/tokens_renovacao.ts (buscarTokenPorHash) e
// _shared/renovacoes_lote.ts (buscarLotePorTokenHash, buscarFilhosDoLote)
// usam nesta suite: from().select().eq()/order()/maybeSingle()/then().
// Mesmo formato do fake ja usado em scripts/testes/renovacoes_lote/.

let estado = { renovacoes_lote: [], tokens_renovacao: [] };

export function resetar() {
  estado = { renovacoes_lote: [], tokens_renovacao: [] };
}
export function seed(tabela, linhas) {
  estado[tabela].push(...linhas.map((l) => ({ ...l })));
}

class QB {
  constructor(t) {
    this.t = t;
    this.filtros = [];
    this.ord = null;
  }
  select() {
    return this;
  }
  eq(col, val) {
    this.filtros.push((r) => r[col] === val);
    return this;
  }
  order(col, { ascending = true } = {}) {
    this.ord = { col, ascending };
    return this;
  }
  _match(r) {
    return this.filtros.every((f) => f(r));
  }
  _run() {
    let linhas = estado[this.t].filter((r) => this._match(r));
    if (this.ord) {
      linhas = [...linhas].sort((a, b) => {
        const x = a[this.ord.col], y = b[this.ord.col];
        return (x < y ? -1 : x > y ? 1 : 0) * (this.ord.ascending ? 1 : -1);
      });
    }
    return linhas.map((l) => ({ ...l }));
  }
  async maybeSingle() {
    const r = this._run();
    return { data: r[0] ?? null, error: null };
  }
  then(resolve) {
    resolve({ data: this._run(), error: null });
  }
}

export function getServiceClient() {
  return {
    from: (t) => new QB(t),
  };
}
