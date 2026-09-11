// Fake minimalista de supabase-js -- so' o suficiente para a UNICA
// consulta que _shared/conhecimento_suporte.ts faz:
//   client.from("conhecimento_suporte").select(...).eq("status", "ativo")
// Sem QueryBuilder generico (nao precisa aqui) -- se a funcao real um
// dia passar a encadear mais filtros, este fake precisa acompanhar.

let linhas = [];
let falhar = false;

export function resetarConhecimentoSuporte() {
  linhas = [];
  falhar = false;
}

export function seedConhecimentoSuporte(novasLinhas) {
  linhas = novasLinhas;
}

export function forcarFalhaConsulta() {
  falhar = true;
}

export function getServiceClient() {
  return {
    from(tabela) {
      if (tabela !== "conhecimento_suporte") {
        throw new Error(`fake_supabase_client (conhecimento_suporte): tabela inesperada "${tabela}"`);
      }
      return {
        select() {
          return {
            eq(coluna, valor) {
              if (falhar) {
                return Promise.resolve({ data: null, error: { message: "falha simulada" } });
              }
              const filtradas = linhas.filter((linha) => linha[coluna] === valor);
              return Promise.resolve({ data: filtradas, error: null });
            },
          };
        },
      };
    },
  };
}
