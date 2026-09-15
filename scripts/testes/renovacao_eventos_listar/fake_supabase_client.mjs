// Fake compacto de supabase-js para a suite renovacao_eventos_listar
// (Edge Function supabase/functions/renovacao-eventos-listar/index.ts).
// Cobre exatamente o que o handler REAL + os modulos _shared REAIS
// (auth_painel.ts, tokens_renovacao.ts, renovacoes_lote.ts) usam:
//   - auth.getUser(token)                                              (auth_painel.ts)
//   - from("tokens_renovacao").select("*").is("grupo_id", null)
//       .order("criado_em", {ascending:false}).limit(N)                 (listarTokensAvulsosRecentes)
//   - from("tokens_renovacao").select("*").eq("grupo_id", g)
//       .order("criado_em", {ascending:true})                           (buscarFilhosDoLote, so' pros
//                                                                        lotes que entram na pagina)
//   - from("renovacoes_lote").select("*")
//       .order("criado_em", {ascending:false}).limit(N)                 (listarLotesRecentes)
// Estado em memoria; suporta injetar erro por tabela pra exercitar o
// caminho 'unavailable' (503) do handler, e contar chamadas por tabela
// pra provar que nada e' consultado quando a auth barra antes.

let estado = { tokens_renovacao: [], renovacoes_lote: [] };
let usuarioParaGetUser = null; // { email } | null
let erroGetUser = null; // { message } | null
let chamadasGetUser = []; // tokens (ja' sem o prefixo "Bearer ")
let erroPorTabela = {}; // tabela -> { message } | null
let chamadasPorTabela = { tokens_renovacao: 0, renovacoes_lote: 0 };

export function resetar() {
  estado = { tokens_renovacao: [], renovacoes_lote: [] };
  usuarioParaGetUser = null;
  erroGetUser = null;
  chamadasGetUser = [];
  erroPorTabela = {};
  chamadasPorTabela = { tokens_renovacao: 0, renovacoes_lote: 0 };
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
    this.limite = null;
  }
  select() {
    return this;
  }
  eq(col, val) {
    this.filtros.push((r) => r[col] === val);
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
    chamadasPorTabela[this.t] = (chamadasPorTabela[this.t] ?? 0) + 1;
    if (erroPorTabela[this.t]) return { data: null, error: erroPorTabela[this.t] };
    let linhas = estado[this.t].filter((r) => this._match(r));
    if (this.ord) {
      linhas = [...linhas].sort((a, b) => {
        const x = a[this.ord.col], y = b[this.ord.col];
        return (x < y ? -1 : x > y ? 1 : 0) * (this.ord.ascending ? 1 : -1);
      });
    }
    if (this.limite != null) linhas = linhas.slice(0, this.limite);
    return { data: linhas.map((l) => ({ ...l })), error: null };
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
