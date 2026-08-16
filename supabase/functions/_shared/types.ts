// Tipos compartilhados pelo codigo novo (Orquestrador e o que vier
// depois). Nao usado por match/status/export-clientes -- elas nao
// foram tocadas (docs/IMPLEMENTATION.md).

export type EstadoConversa = "normal" | "aguardando_humano";

export interface ConversaEstado {
  conversation_id: string;
  telefone: string;
  estado: EstadoConversa;
  motivo: string | null;
  entrou_em_espera: string | null;
  assumido_por: string | null;
  assumido_em: string | null;
  atualizado_em: string;
}

export type OrigemMensagem = "cliente" | "ia" | "humano";

export interface MensagemAtendimento {
  id: string;
  conversation_id: string;
  origem: OrigemMensagem;
  texto: string;
  criado_em: string;
}

// Saida estruturada do Gemini 3.6 (Componente 1 §12, inovatv_central).
// Ainda nao usado nesta etapa -- gemini_client.ts chega na etapa 5.
export interface GeminiOutput {
  tipo: "responder" | "transferir";
  texto: string;
}
