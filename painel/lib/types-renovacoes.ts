// Tipos do Painel de Monitoramento de Renovacoes (2026-09-14) -- espelham
// exatamente o que renovacao-eventos-listar/renovacao-eventos-detalhe
// devolvem. Arquivo isolado de lib/types.ts (que serve /conversas e
// /unitv-token) de proposito -- ver decisao de "preferir separado"
// registrada na auditoria desta frente.

export type ResultadoRenovacao = "ok" | "falha" | "parcial" | "cancel" | "espera";

export interface ItemListaRenovacao {
  tipo: "avulsa" | "lote";
  id: string;
  criadoEm: string;
  quandoFormatado: string;
  clienteNome: string;
  telefone: string;
  servidor: string;
  qtdAcessos: number;
  valorFormatado: string;
  resultado: ResultadoRenovacao;
  diagnostico: string;
  vencimentoFormatado: string | null;
}

export interface ListarRenovacoesResposta {
  outcome: string;
  pagina: number;
  total: number;
  totalGeral: number;
  contagens: Record<ResultadoRenovacao, number>;
  itens: ItemListaRenovacao[];
}

// Mesmo catalogo de etapas da Fase 3 (_shared/renovacao_eventos.ts) --
// nenhuma etapa nova inventada aqui, so' o tipo espelhado pro frontend.
export type EtapaRenovacao =
  | "entrada"
  | "identificacao"
  | "acessos"
  | "carrinho"
  | "confirmacao"
  | "cobranca_pix"
  | "pagamento"
  | "disparo_renovacao"
  | "processamento"
  | "vencimento"
  | "callback_resultado"
  | "mensagem_legado"
  | "consulta_portal";

export interface EventoRenovacao {
  id: string;
  criado_em: string;
  sessao_id: string | null;
  token_id: string | null;
  grupo_id: string | null;
  operacao_id: string | null;
  etapa: EtapaRenovacao;
  codigo: string;
  nivel: "info" | "erro";
  servidor: "sigma" | "unitv" | null;
  origem: string;
  detalhe: Record<string, unknown>;
}

export interface FilhoLoteDetalhe {
  tokenId: string;
  servidorNome: string;
  planoNome: string;
  tipo: "sigma" | "unitv";
  estado: string;
  resultado: ResultadoRenovacao;
  vencimentoFormatado: string | null;
  motivoFalha: string | null;
}

export interface ResumoAvulsa {
  clienteNome: string;
  telefone: string;
  servidor: string;
  plano: string;
  qtdAcessos: 1;
  valorFormatado: string;
  resultado: ResultadoRenovacao;
  estadoBruto: string;
  criadoEm: string;
  quandoFormatado: string;
  vencimentoFormatado: string | null;
  motivoFalha: string | null;
}

export interface ResumoLote {
  clienteNome: string;
  telefone: string;
  qtdAcessos: number;
  valorFormatado: string;
  resultado: ResultadoRenovacao;
  estadoBruto: string;
  criadoEm: string;
  quandoFormatado: string;
}

export type DetalheRenovacaoResposta =
  | {
      outcome: "success";
      tipo: "avulsa";
      resumo: ResumoAvulsa;
      ids: { tokenId: string; grupoId: null; operacaoId: string | null };
      filhos: null;
      eventos: EventoRenovacao[];
    }
  | {
      outcome: "success";
      tipo: "lote";
      resumo: ResumoLote;
      ids: { tokenId: null; grupoId: string; operacaoId: string | null };
      filhos: FilhoLoteDetalhe[];
      eventos: EventoRenovacao[];
    }
  | { outcome: "nao_encontrado" }
  | { outcome: "unavailable" };
