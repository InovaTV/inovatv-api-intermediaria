// Comandos de atendimento humano pelo proprio numero (WhatsApp Business
// do 2415), recebidos pelo webhook-wasender no evento messages.upsert
// com key.fromMe === true (confirmado por teste real 2026-09-04).
//
// #humano  -> assume o atendimento humano daquela conversa (a IA para
//             de responder as mensagens do cliente).
// #ia      -> encerra o atendimento humano e devolve o controle a IA.
//
// Este modulo NAO conhece o payload do Wasender: recebe texto ja
// extraido e telefone ja normalizado. Nao chama Orquestrador nem
// Gemini -- so' as RPCs de estado ja existentes (assumir_atendimento /
// encerrar_atendimento_humano), via a camada _shared/conversas_estado.ts.
//
// LOOP: as strings de confirmacao abaixo NUNCA batem com
// detectarComandoAtendimento (que exige igualdade EXATA de "#humano" /
// "#ia"), entao o eco delas como messages.upsert e' tratado como
// "mensagem fromMe normal" e ignorado -- sem loop.

import {
  buscarConversaPorTelefone,
  assumirAtendimento,
  encerrarAtendimento,
} from "./conversas_estado.ts";

export type ComandoAtendimento = "assumir" | "encerrar" | null;

// Registrado em conversas_episodios.assumido_por / encerrado_por, para
// o Painel distinguir uma acao pelo WhatsApp de uma acao pelo Painel.
export const OPERADOR_COMANDO_WHATSAPP = "whatsapp-2415";

export const MENSAGEM_CMD_HUMANO_OK =
  "✅ Atendimento humano ativado nesta conversa. A IA está pausada. Envie #ia para reativá-la.";
export const MENSAGEM_CMD_HUMANO_JA =
  "ℹ️ Esta conversa já está em atendimento humano. Envie #ia quando quiser reativar a IA.";
export const MENSAGEM_CMD_IA_OK =
  "✅ IA reativada nesta conversa. As próximas mensagens do cliente voltam a ser respondidas automaticamente.";
export const MENSAGEM_CMD_IA_JA =
  "ℹ️ Esta conversa já está com a IA ativa. Nenhuma ação foi necessária.";
export const MENSAGEM_CMD_SEM_CONVERSA =
  "⚠️ Não encontrei uma conversa registrada para este número. Nenhuma ação foi feita.";
export const MENSAGEM_CMD_ERRO =
  "⚠️ Não consegui processar o comando agora. Tente novamente em instantes.";

// Deteccao ESTRITA: a mensagem inteira, sem espacos nas pontas, sem
// pontuacao final (.,!?), em minusculas, tem que ser exatamente
// "#humano" ou "#ia". "#humano agora", "#humanos", "bla #ia", "##ia"
// -> NAO sao comando (retornam null e seguem o fluxo de "mensagem
// fromMe normal" no webhook, que e' ignorada).
export function detectarComandoAtendimento(
  texto: string | null | undefined,
): ComandoAtendimento {
  if (typeof texto !== "string") return null;
  const t = texto.trim().toLowerCase().replace(/[.,!?;\s]+$/u, "");
  if (t === "#humano") return "assumir";
  if (t === "#ia") return "encerrar";
  return null;
}

export type ResultadoComando = {
  outcome:
    | "assumido"
    | "encerrado"
    | "ja_em_humano"
    | "ja_normal"
    | "sem_conversa"
    | "erro";
  // Texto curto para enviar de volta na propria conversa (atendente e
  // cliente veem). Sempre preenchido -- o atendente precisa saber o que
  // aconteceu.
  confirmacao: string;
};

export async function executarComandoAtendimento(
  comando: "assumir" | "encerrar",
  telefoneCanonico: string,
): Promise<ResultadoComando> {
  let conversa;
  try {
    conversa = await buscarConversaPorTelefone(telefoneCanonico);
  } catch (_erro) {
    return { outcome: "erro", confirmacao: MENSAGEM_CMD_ERRO };
  }
  if (!conversa) {
    return { outcome: "sem_conversa", confirmacao: MENSAGEM_CMD_SEM_CONVERSA };
  }

  if (comando === "assumir") {
    try {
      const r = await assumirAtendimento(conversa.conversation_id, OPERADOR_COMANDO_WHATSAPP);
      if (r.outcome === "assumida") {
        return { outcome: "assumido", confirmacao: MENSAGEM_CMD_HUMANO_OK };
      }
      if (r.outcome === "ja_assumida") {
        return { outcome: "ja_em_humano", confirmacao: MENSAGEM_CMD_HUMANO_JA };
      }
      // nao_encontrada (corrida: conversa sumiu entre o SELECT e a RPC)
      return { outcome: "sem_conversa", confirmacao: MENSAGEM_CMD_SEM_CONVERSA };
    } catch (_erro) {
      return { outcome: "erro", confirmacao: MENSAGEM_CMD_ERRO };
    }
  }

  // comando === "encerrar"
  try {
    const r = await encerrarAtendimento(conversa.conversation_id, OPERADOR_COMANDO_WHATSAPP);
    if (r.outcome === "encerrada") {
      return { outcome: "encerrado", confirmacao: MENSAGEM_CMD_IA_OK };
    }
    if (r.outcome === "nao_estava_aguardando_humano") {
      return { outcome: "ja_normal", confirmacao: MENSAGEM_CMD_IA_JA };
    }
    return { outcome: "sem_conversa", confirmacao: MENSAGEM_CMD_SEM_CONVERSA };
  } catch (_erro) {
    return { outcome: "erro", confirmacao: MENSAGEM_CMD_ERRO };
  }
}
