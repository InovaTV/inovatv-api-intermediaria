// Fake de supabase-js para a suite de notificacao de transferencia
// humana. Cobre duas coisas:
// 1) tabelas tokens_renovacao/cobrancas_pix (mesmo padrao/FK real da
//    suite scripts/testes/vinculo_operacao_renovacao/), reaproveitado
//    aqui porque _shared/renovacao_confirmacao.ts continua real.
// 2) .rpc("acionar_transferencia_humana", ...) -- reproduz o
//    comportamento REAL confirmado por leitura direta da migration
//    20260823160000_sessao_ia_intencao_atual_invalidada_por_atendimento_humano.sql:
//    idempotente por conversation_id (so' transiciona normal ->
//    aguardando_humano uma vez; uma segunda tentativa retorna erro
//    code P0001, exatamente como a funcao real faz via RAISE
//    EXCEPTION ... USING ERRCODE = 'P0001'). Isso permite testar
//    _shared/conversas_estado.ts REAL (nao fakeado) -- inclusive o
//    proprio mapeamento de erro P0001 -> "ja_transferida".

function novoEstado() {
  return {
    tokens_renovacao: new Map(),
    cobrancas_pix: new Map(),
    conversas_rpc: new Map(), // conversation_id -> "normal" | "aguardando_humano"
  };
}

let estadoAtual = novoEstado();
let falharProximoInsertCobranca = false;

export function resetarEstado() {
  estadoAtual = novoEstado();
  falharProximoInsertCobranca = false;
}

// Forca uma falha real de banco (nao relacionada a FK) na proxima
// insercao em cobrancas_pix -- usado pra chegar no Ponto B (falha de
// vinculo) sem precisar reintroduzir o bug de ordem original.
export function forcarFalhaProximoInsertCobrancasPix() {
  falharProximoInsertCobranca = true;
}

export function lerTabela(nome) {
  return [...estadoAtual[nome].values()];
}

export function inserirDireto(tabela, linha) {
  const chave = tabela === "cobrancas_pix" ? linha.operacao_id : linha.id;
  estadoAtual[tabela].set(chave, { ...linha });
}

export function estadoConversaRpc(conversationId) {
  return estadoAtual.conversas_rpc.get(conversationId) ?? "normal";
}

export function marcarConversaComoAguardandoHumano(conversationId) {
  estadoAtual.conversas_rpc.set(conversationId, "aguardando_humano");
}

class QueryBuilder {
  constructor(tabela) {
    this.tabela = tabela;
    this.filtros = [];
    this.operacao = null;
    this.limite = null;
  }
  eq(coluna, valor) {
    this.filtros.push({ tipo: "eq", coluna, valor });
    return this;
  }
  is(coluna, valor) {
    this.filtros.push({ tipo: "eq", coluna, valor });
    return this;
  }
  in(coluna, valores) {
    this.filtros.push({ tipo: "in", coluna, valores });
    return this;
  }
  lt(coluna, valor) {
    this.filtros.push({ tipo: "lt", coluna, valor });
    return this;
  }
  order() {
    return this;
  }
  limit(n) {
    this.limite = n;
    return this;
  }
  select() {
    return this;
  }
  insert(payload) {
    this.operacao = { tipo: "insert", payload };
    return this;
  }
  update(payload) {
    this.operacao = { tipo: "update", payload };
    return this;
  }

  _linhasQueBatem() {
    return [...estadoAtual[this.tabela].values()].filter((linha) =>
      this.filtros.every((f) => {
        if (f.tipo === "eq") return linha[f.coluna] === f.valor;
        if (f.tipo === "in") return f.valores.includes(linha[f.coluna]);
        if (f.tipo === "lt") return linha[f.coluna] < f.valor;
        return true;
      }),
    );
  }

  _violaFkTokensRenovacao(payload) {
    if (this.tabela !== "tokens_renovacao") return false;
    if (!("operacao_id" in payload) || payload.operacao_id == null) return false;
    return !estadoAtual.cobrancas_pix.has(payload.operacao_id);
  }

  _executar() {
    if (!this.operacao) {
      let linhas = this._linhasQueBatem();
      if (this.limite != null) linhas = linhas.slice(0, this.limite);
      return { data: linhas, error: null };
    }

    if (this.operacao.tipo === "insert") {
      if (this.tabela === "cobrancas_pix" && falharProximoInsertCobranca) {
        falharProximoInsertCobranca = false;
        return { data: null, error: { message: "falha simulada de insercao (nao relacionada a FK)", code: "XX000" } };
      }
      const linha = { ...this.operacao.payload };
      if (this._violaFkTokensRenovacao(linha)) {
        return { data: null, error: { message: "violates foreign key constraint", code: "23503" } };
      }
      const chave = this.tabela === "cobrancas_pix" ? linha.operacao_id : linha.id;
      estadoAtual[this.tabela].set(chave, linha);
      return { data: [linha], error: null };
    }

    if (this.operacao.tipo === "update") {
      if (this._violaFkTokensRenovacao(this.operacao.payload)) {
        return { data: null, error: { message: "violates foreign key constraint", code: "23503" } };
      }
      const alvos = this._linhasQueBatem();
      const atualizadas = [];
      for (const linhaAtual of alvos) {
        const nova = { ...linhaAtual, ...this.operacao.payload };
        const chave = this.tabela === "cobrancas_pix" ? nova.operacao_id : nova.id;
        estadoAtual[this.tabela].set(chave, nova);
        atualizadas.push(nova);
      }
      return { data: atualizadas, error: null };
    }

    return { data: null, error: { message: "operacao desconhecida no fake" } };
  }

  maybeSingle() {
    const { data, error } = this._executar();
    if (error) return Promise.resolve({ data: null, error });
    const linha = Array.isArray(data) ? (data[0] ?? null) : data;
    return Promise.resolve({ data: linha, error: null });
  }

  single() {
    const { data, error } = this._executar();
    if (error) return Promise.resolve({ data: null, error });
    const linha = Array.isArray(data) ? data[0] : data;
    if (!linha) return Promise.resolve({ data: null, error: { message: "no rows returned" } });
    return Promise.resolve({ data: linha, error: null });
  }

  then(resolve, reject) {
    try {
      resolve(this._executar());
    } catch (erro) {
      reject(erro);
    }
  }
}

export function getServiceClient() {
  return {
    from(tabela) {
      return new QueryBuilder(tabela);
    },
    async rpc(nome, params) {
      if (nome === "acionar_transferencia_humana") {
        const conversationId = params.p_conversation_id;
        const estadoConversa = estadoAtual.conversas_rpc.get(conversationId) ?? "normal";
        if (estadoConversa !== "normal") {
          return {
            data: null,
            error: { code: "P0001", message: "conversa_ja_aguardando_humano_ou_inexistente" },
          };
        }
        estadoAtual.conversas_rpc.set(conversationId, "aguardando_humano");
        return {
          data: { conversation_id: conversationId, estado: "aguardando_humano" },
          error: null,
        };
      }
      return { data: null, error: { message: `RPC desconhecida no fake: ${nome}` } };
    },
  };
}
