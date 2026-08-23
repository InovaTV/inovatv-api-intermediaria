// Tipos compartilhados pelo codigo novo (Orquestrador e o que vier
// depois). Nao usado por match/status/export-clientes -- elas nao
// foram tocadas (docs/IMPLEMENTATION.md).

export type EstadoConversa = "normal" | "aguardando_humano";

// Revisao Painel de Atendimento (Componente 5 SS7, inovatv_central,
// 2026-08-16): motivo/entrou_em_espera/assumido_por/assumido_em
// deixaram de morar aqui -- viraram uma linha em ConversaEpisodio.
// conversas_estado agora e' so o ponteiro pro estado atual.
export interface ConversaEstado {
  conversation_id: string;
  telefone: string;
  nome_snapshot: string | null;
  estado: EstadoConversa;
  episodio_atual_id: string | null;
  atualizado_em: string;
  // Memoria de sessao (Camada 3, 2026-08-23) -- ponteiro de contexto
  // conversacional de curto prazo, NUNCA fonte de fato (sempre
  // reconferido contra /match+/status frescos antes de valer pra
  // qualquer coisa). acesso_selecionado guarda so o public_id do
  // Rocket. sessao_atividade_em e' o timestamp UNICO de atividade da
  // sessao inteira -- renovado a cada mensagem real do cliente,
  // expira apos 1h de inatividade (checagem em leitura, sem cron).
  acesso_selecionado: string | null;
  sessao_atividade_em: string | null;
  // Memoria de sessao (extensao 2026-08-23) -- mesma disciplina de
  // acesso_selecionado: nunca fonte de fato, so' contexto
  // conversacional de curto prazo, sujeito ao mesmo TTL/invalidacao
  // (sessao_atividade_em). Unico valor usado hoje: "renovacao".
  intencao_atual: string | null;
  // Painel de Atendimento -- previa da lista, Fatia 1 (2026-08-18).
  // Mantido por trigger (mensagens_conversa), nunca escrito por
  // codigo TypeScript -- ver atualizar_conversa_ao_inserir_mensagem.
  ultima_mensagem_texto: string | null;
  // Painel de Atendimento -- "Humano assumiu" x "Aguardando humano"
  // (correcao 2026-08-19). NAO e' coluna de conversas_estado -- e'
  // assumido_por do episodio atual (conversas_episodios), computado
  // por listarConversas() so' na listagem. Ausente/undefined fora da
  // listagem (ex.: resposta de painel-atendimento-abrir). Null quando
  // nao ha episodio atual, ou quando ninguem assumiu ainda.
  episodio_atual_assumido_por?: string | null;
}

// Log permanente de cada periodo de atendimento humano (Componente 5
// SS7-B). Nunca sobrescrito/apagado -- um telefone pode ter N linhas
// ao longo do tempo.
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

// 'sistema' e' novo (Componente 5 SS12, 2026-08-16) -- eventos como
// "operador assumiu"/"atendimento encerrado", nunca gerado pelo Gemini
// nem pelo cliente.
export type OrigemMensagem = "cliente" | "ia" | "humano" | "sistema";

export interface MensagemAtendimento {
  id: string;
  conversation_id: string;
  episodio_id: string | null;
  origem: OrigemMensagem;
  texto: string;
  criado_em: string;
}

// Saida estruturada do Gemini 3.6 (Componente 1 §12, inovatv_central).
// "propor_renovacao" adicionado na Etapa 1 do fluxo de renovacao
// automatica (docs/propor_renovacao/LEVANTAMENTO_ETAPA1.md, secao 2.1
// -- Lacuna 2, Opcao A: terceiro valor de tipo, sem campo booleano
// oculto). Nesta etapa e' so' diagnostico -- ver orchestrator/index.ts.
export interface GeminiOutput {
  tipo: "responder" | "transferir" | "propor_renovacao";
  texto: string;
}
