// Fake minimalista de supabase-js, com estado em memoria. Reproduz de
// verdade a foreign key real de producao
// (tokens_renovacao.operacao_id -> cobrancas_pix.operacao_id,
// migration 20260824130000_tokens_renovacao.sql) -- e' isso que faz
// este teste pegar o bug de ordem encontrado na homologacao de
// 27/08/2026, em vez de um fake que "sempre funciona".

function novoEstado() {
  return {
    tokens_renovacao: new Map(), // chave: id
    cobrancas_pix: new Map(), // chave: operacao_id
    // Renovacao em lote (Etapa 1, 2026-08-29): confirmarRenovacao agora
    // consulta renovacoes_lote antes do caminho individual. Neste teste
    // a tabela fica sempre vazia (todos os casos sao renovacao avulsa)
    // -- buscarLotePorTokenHash retorna null e o fluxo individual segue
    // exatamente como antes.
    renovacoes_lote: new Map(), // chave: grupo_id
  };
}

let estadoAtual = novoEstado();
let falharProximoInsertCobranca = false;

export function resetarEstado() {
  estadoAtual = novoEstado();
  falharProximoInsertCobranca = false;
}

export function lerTabela(nome) {
  return [...estadoAtual[nome].values()];
}

// So' pra seedar precondicoes de teste -- ignora a FK de proposito
// (setup, nao comportamento sob teste).
export function inserirDireto(tabela, linha) {
  const chave = tabela === "cobrancas_pix" ? linha.operacao_id : linha.id;
  estadoAtual[tabela].set(chave, { ...linha });
}

// Simula uma falha real de banco (nao relacionada a FK) na proxima
// insercao em cobrancas_pix -- usado pra provar que uma falha ali
// tambem impede o vinculo depois (mesma FK), exercitando o caminho
// fatal de verdade.
export function forcarFalhaProximoInsertCobrancasPix() {
  falharProximoInsertCobranca = true;
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
        return {
          data: null,
          error: {
            message:
              'insert or update on table "tokens_renovacao" violates foreign key constraint "tokens_renovacao_operacao_id_fkey"',
            code: "23503",
          },
        };
      }
      const chave = this.tabela === "cobrancas_pix" ? linha.operacao_id : linha.id;
      estadoAtual[this.tabela].set(chave, linha);
      return { data: [linha], error: null };
    }

    if (this.operacao.tipo === "update") {
      if (this._violaFkTokensRenovacao(this.operacao.payload)) {
        return {
          data: null,
          error: {
            message:
              'insert or update on table "tokens_renovacao" violates foreign key constraint "tokens_renovacao_operacao_id_fkey"',
            code: "23503",
          },
        };
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
  };
}
