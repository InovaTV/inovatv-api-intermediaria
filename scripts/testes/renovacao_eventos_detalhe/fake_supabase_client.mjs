// Fake compacto de supabase-js para a suite renovacao_eventos_detalhe
// (Edge Function supabase/functions/renovacao-eventos-detalhe/index.ts).
// Cobre exatamente o que o handler REAL + os modulos _shared REAIS
// (auth_painel.ts, renovacoes_lote.ts, renovacao_eventos.ts) usam:
//   - auth.getUser(token)                                              (auth_painel.ts)
//   - from("tokens_renovacao").select("*").eq("id", id).maybeSingle()  (buscarTokenPorId, local no index.ts)
//   - from("tokens_renovacao").select("*").eq("grupo_id", g)
//       .order("criado_em", {ascending:true})                          (buscarFilhosDoLote)
//   - from("renovacoes_lote").select("*").eq("grupo_id", g).maybeSingle() (buscarLotePorId, local no index.ts)
//   - from("renovacao_eventos").select("*").or("token_id.eq.X,...")
//       .order("criado_em", {ascending:true})                          (buscarEventosPorCorrelacao)
// Estado em memoria; suporta injetar erro por tabela pra exercitar o
// caminho 'unavailable' (503), e contar chamadas por tabela pra provar
// que nada e' consultado quando a auth barra antes.

let estado = { tokens_renovacao: [], renovacoes_lote: [], renovacao_eventos: [] };
let usuarioParaGetUser = null; // { email } | null
let erroGetUser = null; // { message } | null
let chamadasGetUser = []; // tokens (ja' sem o prefixo "Bearer ")
let erroPorTabela = {}; // tabela -> { message } | null
let chamadasPorTabela = { tokens_renovacao: 0, renovacoes_lote: 0, renovacao_eventos: 0 };

export function resetar() {
  estado = { tokens_renovacao: [], renovacoes_lote: [], renovacao_eventos: [] };
  usuarioParaGetUser = null;
  erroGetUser = null;
  chamadasGetUser = [];
  erroPorTabela = {};
  chamadasPorTabela = { tokens_renovacao: 0, renovacoes_lote: 0, renovacao_eventos: 0 };
}
export function seed(tabela, linhas) {
  estado[tabela].push(...linhas.map((l) => ({ ...l })));
}
export function definirUsuarioAutenticado(email) {
  usuarioParaGetUser = email ? { email } : null;
  erroGetUser = null;
}
export function definirGetUserComErro(mensagem = "invalid token") {
  usuarioParaGetUser = null;
  erroGetUser = { message: mensagem };
}
export function chamadasDeGetUser() {
  return chamadasGetUser;
}
export function definirErroTabela(tabela, mensagem) {
  erroPorTabela[tabela] = mensagem ? { message: mensagem } : null;
}
export function chamadasNaTabela(tabela) {
  return chamadasPorTabela[tabela] ?? 0;
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
  // Formato REAL emitido por buscarEventosPorCorrelacao: clausulas
  // "col.eq.valor" unidas por virgula, semantica OR entre elas -- so'
  // precisamos suportar esse formato exato (o unico usado em producao).
  or(expr) {
    const clausulas = expr.split(",").map((parte) => {
      const [col, op, ...resto] = parte.split(".");
      const valor = resto.join(".");
      if (op !== "eq") throw new Error(`fake QB.or: operador nao suportado '${op}' (expr=${expr})`);
      return (r) => String(r[col]) === valor;
    });
    this.filtros.push((r) => clausulas.some((c) => c(r)));
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
    chamadasPorTabela[this.t] = (chamadasPorTabela[this.t] ?? 0) + 1;
    if (erroPorTabela[this.t]) return { data: null, error: erroPorTabela[this.t] };
    let linhas = estado[this.t].filter((r) => this._match(r));
    if (this.ord) {
      linhas = [...linhas].sort((a, b) => {
        const x = a[this.ord.col], y = b[this.ord.col];
        return (x < y ? -1 : x > y ? 1 : 0) * (this.ord.ascending ? 1 : -1);
      });
    }
    return { data: linhas.map((l) => ({ ...l })), error: null };
  }
  async maybeSingle() {
    const r = this._run();
    if (r.error) return r;
    return { data: r.data[0] ?? null, error: null };
  }
  then(resolve, reject) {
    Promise.resolve(this._run()).then(resolve, reject);
  }
}

export function getServiceClient() {
  return {
    auth: {
      async getUser(token) {
        chamadasGetUser.push(token);
        if (erroGetUser) return { data: { user: null }, error: erroGetUser };
        return { data: { user: usuarioParaGetUser }, error: null };
      },
    },
    from: (t) => new QB(t),
  };
}
