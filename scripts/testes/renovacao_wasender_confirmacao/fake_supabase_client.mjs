// "Banco" em memoria para a suite renovacao_wasender_confirmacao.
// Suporta exatamente o que o resolver usa em buscarCandidatosPendentes:
//   client.from(tabela).select("*").eq(col,val).eq(col,val).is(col,val)
// -- awaitable, resolve para { data, error }.
let db = { renovacoes_lote: [], tokens_renovacao: [], conversas_estado: [] };

export function _seed(next) {
  db = { renovacoes_lote: [], tokens_renovacao: [], conversas_estado: [], ...next };
}
export function resetar() {
  db = { renovacoes_lote: [], tokens_renovacao: [], conversas_estado: [] };
}

function makeBuilder(rows) {
  const preds = [];
  const b = {
    select() {
      return b;
    },
    eq(col, val) {
      preds.push((r) => r[col] === val);
      return b;
    },
    is(col, val) {
      preds.push((r) => (val === null ? r[col] == null : r[col] === val));
      return b;
    },
    then(resolve, reject) {
      try {
        resolve({ data: rows.filter((r) => preds.every((p) => p(r))), error: null });
      } catch (e) {
        (reject ?? resolve)({ data: null, error: e });
      }
    },
  };
  return b;
}

export function getServiceClient() {
  return {
    from(tabela) {
      return makeBuilder(db[tabela] ?? []);
    },
  };
}
