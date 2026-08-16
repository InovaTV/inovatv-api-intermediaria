// Espelha os tipos do backend (inovatv-api-intermediaria/supabase/functions/_shared/types.ts)
// -- sem pacote compartilhado entre os dois lados ainda, duplicacao
// deliberada e pequena (V1 funcional).

export type EstadoConversa = "normal" | "aguardando_humano";

export interface ConversaEstado {
  conversation_id: string;
  telefone: string;
  nome_snapshot: string | null;
  estado: EstadoConversa;
  episodio_atual_id: string | null;
  atualizado_em: string;
}

export type OrigemEpisodio = "ia" | "operador";

export interface ConversaEpisodio {
  id: string;
  conversation_id: string;
  origem: OrigemEpisodio;
  motivo: string | null;
  iniciado_em: string;
  assumido_por: string | null;
  assumido_em: string | null;
  encerrado_em: string | null;
  encerrado_por: string | null;
}

export type OrigemMensagem = "cliente" | "ia" | "humano" | "sistema";

export interface MensagemConversa {
  id: string;
  conversation_id: string;
  episodio_id: string | null;
  origem: OrigemMensagem;
  texto: string;
  criado_em: string;
}

export interface ClienteAoVivo {
  outcome: string;
  linkState: string;
  cliente: {
    nome: string | null;
    vencimento: string | null;
    planoNome: string | null;
    servidorNome: string | null;
    telas: number | null;
  } | null;
}
