// Acesso a tabela conversas_estado (Componente 5 §7, inovatv_central).
//
// Revisao Painel de Atendimento (Fatia 1, 2026-08-16): assumirAtendimento()/
// encerrarAtendimento() chamam as RPCs novas (assumir_atendimento/
// encerrar_atendimento_humano, migration 20260816140000). conversas_estado
// deixou de guardar motivo/entrou_em_espera/assumido_por/assumido_em --
// esses dados agora vivem em conversas_episodios (ver types.ts,
// ConversaEpisodio), a RPC e' quem decide onde gravar cada coisa. Esta
// camada TypeScript so executa, nunca decide QUANDO transferir/assumir/
// encerrar -- isso continua sendo do Orquestrador (Componente 1 §9) ou
// do operador via Painel (Componente 5 §5).

import { getServiceClient } from "./supabase_client.ts";
import type { ConversaEstado } from "./types.ts";

// Etapa 6, terceira fatia (correcao de atomicidade, Componente 1 §16 /
// Componente 5 §12). Chama a RPC acionar_transferencia_humana
// (migration 20260816120000, ainda NAO aplicada) -- UPDATE em
// conversas_estado + 2 INSERTs em mensagens_atendimento_humano numa
// unica transacao Postgres. Envio de WhatsApp/aviso ao Jose ficam
// para uma fatia futura. Nao decide QUANDO transferir -- isso e' do
// orquestrador (validador reprovado ou Gemini tipo==="transferir");
// esta funcao so' executa.
//
// Distingue dois desfechos deliberadamente (nao apenas sucesso/erro):
// "ja_transferida" -- outra requisicao concorrente ja transicionou
// essa conversa (guarda "and estado = 'normal'" da RPC nao encontrou
// linha) -- esperado sob concorrencia, NAO e' falha de atomicidade.
// Qualquer outro erro da RPC propaga (throw) -- transferencia NAO
// confirmada, tratado como falha real pelo chamador.
export async function acionarTransferenciaHumana(
  conversationId: string,
  motivo: string,
  conteudoCliente: string,
  textoIa: string,
): Promise<
  | { outcome: "acionada"; conversa: ConversaEstado }
  | { outcome: "ja_transferida" }
> {
  const client = getServiceClient();

  const { data, error } = await client.rpc("acionar_transferencia_humana", {
    p_conversation_id: conversationId,
    p_motivo: motivo,
    p_conteudo_cliente: conteudoCliente,
    p_texto_ia: textoIa,
  });

  if (error) {
    if (error.code === "P0001") {
      return { outcome: "ja_transferida" };
    }
    throw error;
  }

  return { outcome: "acionada", conversa: data as ConversaEstado };
}

// Busca a conversa pelo telefone. Se nao existir ainda, cria uma nova
// linha em estado 'normal' -- "estabelecer a conversa" (decisao do
// usuario sobre conversation_id, 2026-08-15: gerado pelo Postgres no
// insert, nunca derivado do telefone).
export async function buscarOuCriarConversa(
  telefone: string,
): Promise<ConversaEstado> {
  const client = getServiceClient();

  const { data: existente, error: erroSelect } = await client
    .from("conversas_estado")
    .select("*")
    .eq("telefone", telefone)
    .maybeSingle();

  if (erroSelect) throw erroSelect;
  if (existente) return existente as ConversaEstado;

  const { data: criada, error: erroInsert } = await client
    .from("conversas_estado")
    .insert({ telefone, estado: "normal" })
    .select("*")
    .single();

  if (erroInsert) throw erroInsert;
  return criada as ConversaEstado;
}

// Busca uma conversa por conversation_id (nunca cria) -- usado pelo
// Painel (Componente 5 §8), diferente de buscarOuCriarConversa() que
// e' por telefone e sempre cria se faltar (uso do Orquestrador).
// Retorna null se nao existir, nunca lanca so por isso.
export async function buscarConversaPorId(
  conversationId: string,
): Promise<ConversaEstado | null> {
  const client = getServiceClient();

  const { data, error } = await client
    .from("conversas_estado")
    .select("*")
    .eq("conversation_id", conversationId)
    .maybeSingle();

  if (error) throw error;
  return (data as ConversaEstado) ?? null;
}

// Lista todas as conversas, paginada, mais recente primeiro
// (Componente 5 §8) -- qualquer estado, nao so aguardando_humano.
export async function listarConversas(
  pagina: number,
  porPagina = 20,
): Promise<{ conversas: ConversaEstado[]; total: number }> {
  const client = getServiceClient();
  const inicio = (pagina - 1) * porPagina;
  const fim = inicio + porPagina - 1;

  const { data, error, count } = await client
    .from("conversas_estado")
    .select("*", { count: "exact" })
    .order("atualizado_em", { ascending: false })
    .range(inicio, fim);

  if (error) throw error;
  return { conversas: (data ?? []) as ConversaEstado[], total: count ?? 0 };
}

// Componente 5 §9 -- RPC unificada, cobre os 2 casos (assumir a partir
// de 'normal', ou a partir de 'aguardando_humano' com episodio ja
// aberto pela IA e ninguem assumido ainda). "ja_assumida" cobre os 2
// jeitos de a RPC recusar por concorrencia (P0001): outro operador ja
// assumiu o mesmo episodio, ou tentativa duplicada -- esperado sob
// concorrencia, nao e' falha. Qualquer outro erro propaga (throw).
export async function assumirAtendimento(
  conversationId: string,
  operador: string,
): Promise<
  | { outcome: "assumida"; conversa: ConversaEstado }
  | { outcome: "ja_assumida" }
> {
  const client = getServiceClient();

  const { data, error } = await client.rpc("assumir_atendimento", {
    p_conversation_id: conversationId,
    p_operador: operador,
  });

  if (error) {
    if (error.code === "P0001") {
      return { outcome: "ja_assumida" };
    }
    throw error;
  }

  return { outcome: "assumida", conversa: data as ConversaEstado };
}

// Componente 5 §11 -- fecha o episodio em aberto (nunca apaga a
// linha), devolve a conversa a 'normal'. "nao_estava_aguardando_humano"
// cobre tentar encerrar uma conversa que ja nao tem episodio aberto
// (ex.: dois cliques de "Encerrar" no Painel) -- esperado, nao e'
// falha. Qualquer outro erro propaga (throw).
export async function encerrarAtendimento(
  conversationId: string,
  operador: string,
): Promise<
  | { outcome: "encerrada"; conversa: ConversaEstado }
  | { outcome: "nao_estava_aguardando_humano" }
> {
  const client = getServiceClient();

  const { data, error } = await client.rpc("encerrar_atendimento_humano", {
    p_conversation_id: conversationId,
    p_operador: operador,
  });

  if (error) {
    if (error.code === "P0001") {
      return { outcome: "nao_estava_aguardando_humano" };
    }
    throw error;
  }

  return { outcome: "encerrada", conversa: data as ConversaEstado };
}
