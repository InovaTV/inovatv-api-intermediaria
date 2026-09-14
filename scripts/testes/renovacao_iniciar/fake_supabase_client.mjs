// Fake generico de supabase-js, estado em memoria por tabela (cria a
// lista sob demanda -- suite usa conversas_estado, tokens_renovacao e
// renovacoes_lote). Mesmo formato ja usado em
// scripts/testes/renovacoes_lote/fake_supabase_client.mjs -- cobre
// from().insert()/select()/update() com eq/in/is/order/limit/maybeSingle/
// single/then. Sem RPC (nao usado por nenhum caminho exercitado aqui).

let estado = {};
// Checkpoint 5 -- rate limiting da etapa=telefone. Default: sempre
// permite (todos os testes de 4A/4B/4C ja existentes dependem disso
// implicitamente e continuam passando sem alteracao). Um teste
// especifico usa configurarRateLimit(false) pra exercitar o bloqueio.
let permitirRateLimit = true;
// Trilha de auditoria (Fase 3, 2026-09-14) -- simula a corrida real
// documentada em processarEtapaCarrinho (indice unico parcial do banco
// estourando num insert concorrente), pra exercitar carrinho_erro_corrida
// sem precisar de concorrencia de verdade.
let falhaInsertTabela = null;

function tabelaDe(nome) {
  if (!estado[nome]) estado[nome] = [];
  return estado[nome];
}

export function resetar() {
  estado = {};
  permitirRateLimit = true;
  falhaInsertTabela = null;
}
export function configurarRateLimit(permitir) {
  permitirRateLimit = permitir;
}
export function configurarFalhaInsert(tabela) {
  falhaInsertTabela = tabela;
}
export function seed(tabela, linhas) {
  tabelaDe(tabela).push(...linhas.map((l) => ({ ...l })));
}
export function lerTabela(nome) {
  return tabelaDe(nome).map((l) => ({ ...l }));
}

function cryptoId() {
  return crypto.randomUUID();
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
    this.filtros.push((r) => (val === null ? r[col] == null : r[col] === val));
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
    const linhasTabela = tabelaDe(this.t);
    if (this.op === "insert" && this.t === falhaInsertTabela) {
      throw new Error(`insert simulado falhou (corrida) -- tabela=${this.t}`);
    }
    if (this.op === "insert") {
      const criados = this.payload.map((l) => ({
        id: l.id ?? cryptoId(),
        grupo_id: l.grupo_id ?? (this.t === "renovacoes_lote" ? cryptoId() : (l.grupo_id ?? null)),
        conversation_id: l.conversation_id ?? cryptoId(),
        criado_em: new Date().toISOString(),
        estado: l.estado ?? "normal",
        ...l,
      }));
      linhasTabela.push(...criados);
      return criados;
    }
    let linhas = linhasTabela.filter((r) => this._match(r));
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
    resolve({ data: this._run(), error: null });
  }
}

export function getServiceClient() {
  return {
    from: (t) => new QB(t),
    rpc: async (nome) => {
      if (nome === "registrar_tentativa_portal_renovacao") {
        return { data: permitirRateLimit, error: null };
      }
      return { data: null, error: { message: "rpc desconhecida no fake: " + nome } };
    },
  };
}
