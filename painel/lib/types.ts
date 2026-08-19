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
  // Aviso de Novas Mensagens (Fatia 1, migration 20260818000000):
  // visto_em = ultima vez que um operador abriu esta conversa;
  // ultima_mensagem_cliente_em = mantido por trigger, so' origem='cliente'.
  visto_em: string | null;
  ultima_mensagem_cliente_em: string | null;
  // Previa da lista (Fatia 2, migration 20260818020000): mantido por
  // trigger, nunca escrito por codigo TypeScript. Ignora
  // origem='sistema' desde a correcao 2026-08-19 (migration
  // 20260819000000_painel_previa_ignora_sistema.sql).
  ultima_mensagem_texto: string | null;
  // "Humano assumiu" x "Aguardando humano" (correcao 2026-08-19). NAO
  // e' coluna de conversas_estado -- e' assumido_por do episodio
  // atual, computado so' por painel-atendimento-listar. Ausente fora
  // da listagem (ex.: painel-atendimento-abrir). Null quando nao ha
  // episodio atual, ou quando ninguem assumiu ainda.
  episodio_atual_assumido_por?: string | null;
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
