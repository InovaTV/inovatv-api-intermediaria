// Fake minimo de _shared/supabase_client.ts para a suite
// atualizar_sessao_rocket_auth.
//
// Cobre exatamente o que o handler REAL de
// supabase/functions/atualizar-sessao-rocket/index.ts e o
// verificarOperador() REAL de _shared/auth_painel.ts usam:
//   - .auth.getUser(token)                                   (auth_painel.ts)
//   - .rpc("rocket_sessao_definir", { p_sessionid, p_csrftoken })
//   - .from("rocket_session_estado").update(payload).eq("id", 1)
//
// Nenhuma rede, nenhum npm:@supabase/supabase-js. Tudo configuravel e
// registrado para o teste inspecionar exatamente o que o handler fez.

let usuarioParaGetUser = null; // { email } | null
let erroGetUser = null; // { message } | null
let erroRpc = null; // { message } | null
let erroUpdate = null; // { message } | null

let chamadasGetUser = []; // tokens (ja' sem o prefixo "Bearer ")
let chamadasRpc = []; // { nome, params }
let chamadasUpdate = []; // { tabela, payload, filtros }

export function definirUsuarioAutenticado(email) {
  usuarioParaGetUser = email ? { email } : null;
  erroGetUser = null;
}
export function definirGetUserComErro(mensagem = "invalid token") {
  usuarioParaGetUser = null;
  erroGetUser = { message: mensagem };
}
export function definirErroRpc(mensagem) {
  erroRpc = mensagem ? { message: mensagem } : null;
}
export function definirErroUpdate(mensagem) {
  erroUpdate = mensagem ? { message: mensagem } : null;
}

export function chamadasDeGetUser() {
  return chamadasGetUser;
}
export function chamadasDeRpc() {
  return chamadasRpc;
}
export function chamadasDeUpdate() {
  return chamadasUpdate;
}

export function resetarFake() {
  usuarioParaGetUser = null;
  erroGetUser = null;
  erroRpc = null;
  erroUpdate = null;
  chamadasGetUser = [];
  chamadasRpc = [];
  chamadasUpdate = [];
}

class UpdateBuilder {
  constructor(tabela, payload) {
    this.registro = { tabela, payload, filtros: {} };
  }
  eq(coluna, valor) {
    this.registro.filtros[coluna] = valor;
    chamadasUpdate.push(this.registro);
    return Promise.resolve({ error: erroUpdate });
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
    async rpc(nome, params) {
      chamadasRpc.push({ nome, params });
      return { error: erroRpc };
    },
    from(tabela) {
      return {
        update(payload) {
          return new UpdateBuilder(tabela, payload);
        },
      };
    },
  };
}
