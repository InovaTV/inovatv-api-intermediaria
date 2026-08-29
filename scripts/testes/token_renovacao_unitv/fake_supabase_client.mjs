// Fake minimo de supabase_client para a suite token_renovacao_unitv.
// criarTokenRenovacao so' faz: from(t).insert(obj).select("*").single().
// Registra o payload EXATO de cada insert pra o teste inspecionar.

let inserts = [];
export function insertsRegistrados() { return inserts; }
export function resetar() { inserts = []; }

export function getServiceClient() {
  return {
    from(table) {
      return {
        insert(obj) {
          const payload = Array.isArray(obj) ? obj[0] : obj;
          inserts.push({ table, payload });
          const row = { id: crypto.randomUUID(), ...payload };
          return {
            select() {
              return { async single() { return { data: row, error: null }; } };
            },
          };
        },
      };
    },
  };
}
