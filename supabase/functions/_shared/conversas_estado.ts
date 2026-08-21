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
  const conversas = (data ?? []) as ConversaEstado[];

  // Painel de Atendimento -- "Humano assumiu" x "Aguardando humano"
  // (correcao 2026-08-19). conversas_estado.estado nao distingue os
  // dois casos (os dois sao 'aguardando_humano') -- a distincao real
  // mora em conversas_episodios.assumido_por, so acessivel via
  // episodio_atual_id. Segunda consulta pequena, so os episodios em
  // aberto desta pagina (no maximo porPagina linhas) -- nunca N+1 por
  // linha, nunca RPC nova, nunca coluna nova em conversas_estado.
  const episodioIds = conversas
    .map((c) => c.episodio_atual_id)
    .filter((id): id is string => id !== null);

  if (episodioIds.length > 0) {
    const { data: episodiosAtuais, error: errorEpisodios } = await client
      .from("conversas_episodios")
      .select("id, assumido_por")
      .in("id", episodioIds);

    if (errorEpisodios) throw errorEpisodios;

    const assumidoPorPorEpisodio = new Map(
      (episodiosAtuais ?? []).map((e) => [e.id as string, e.assumido_por as string | null]),
    );

    for (const c of conversas) {
      c.episodio_atual_assumido_por = c.episodio_atual_id
        ? (assumidoPorPorEpisodio.get(c.episodio_atual_id) ?? null)
        : null;
    }
  }

  return { conversas, total: count ?? 0 };
}

// Componente 5 §9 -- RPC unificada, cobre os 2 casos (assumir a partir
// de 'normal', ou a partir de 'aguardando_humano' com episodio ja
// aberto pela IA e ninguem assumido ainda). "ja_assumida" cobre os 2
// jeitos de a RPC recusar por concorrencia (P0001): outro operador ja
// assumiu o mesmo episodio, ou tentativa duplicada -- esperado sob
// concorrencia, nao e' falha. Qualquer outro erro propaga (throw).
//
// Achado da bateria de testes negativos (2026-08-17): a RPC usa o
// mesmo errcode P0001 tambem para 'conversa_inexistente' -- essa
// camada so checava o codigo, nunca a mensagem, entao "conversa nao
// existe" e "ja assumida" ficavam indistinguiveis pro chamador.
// Corrigido lendo error.message (o texto literal do RAISE EXCEPTION
// da migration) antes de decidir o outcome.
export async function assumirAtendimento(
  conversationId: string,
  operador: string,
): Promise<
  | { outcome: "assumida"; conversa: ConversaEstado }
  | { outcome: "ja_assumida" }
  | { outcome: "nao_encontrada" }
> {
  const client = getServiceClient();

  const { data, error } = await client.rpc("assumir_atendimento", {
    p_conversation_id: conversationId,
    p_operador: operador,
  });

  if (error) {
    if (error.code === "P0001" && error.message === "conversa_inexistente") {
      return { outcome: "nao_encontrada" };
    }
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
//
// Mesma correcao de assumirAtendimento (achado da bateria de testes
// negativos, 2026-08-17): distingue 'conversa_inexistente' das outras
// causas de P0001 lendo error.message, nao so o codigo.
export async function encerrarAtendimento(
  conversationId: string,
  operador: string,
): Promise<
  | { outcome: "encerrada"; conversa: ConversaEstado }
  | { outcome: "nao_estava_aguardando_humano" }
  | { outcome: "nao_encontrada" }
> {
  const client = getServiceClient();

  const { data, error } = await client.rpc("encerrar_atendimento_humano", {
    p_conversation_id: conversationId,
    p_operador: operador,
  });

  if (error) {
    if (error.code === "P0001" && error.message === "conversa_inexistente") {
      return { outcome: "nao_encontrada" };
    }
    if (error.code === "P0001") {
      return { outcome: "nao_estava_aguardando_humano" };
    }
    throw error;
  }

  return { outcome: "encerrada", conversa: data as ConversaEstado };
}

// Painel de Atendimento -- Aviso de Novas Mensagens, Fatia 2 (decisao
// 3 do planejamento aprovado, inovatv_central: endpoint dedicado,
// nunca um efeito colateral de painel-atendimento-abrir). Marca
// conversas_estado.visto_em = now() para a conversa informada -- um
// UPDATE simples, sem RPC: diferente de assumir/encerrar, nao ha
// branching nem necessidade de atomicidade real (visto_em e' sempre
// idempotente, sem condicao de "ja marcado"). "nao_encontrada" cobre
// um conversation_id que nao existe (ex.: erro de digitacao/URL) --
// nao e' falha, so' nao ha' nada pra marcar.
export async function marcarVisto(
  conversationId: string,
): Promise<
  | { outcome: "marcada"; conversa: ConversaEstado }
  | { outcome: "nao_encontrada" }
> {
  const client = getServiceClient();

  const { data, error } = await client
    .from("conversas_estado")
    .update({ visto_em: new Date().toISOString() })
    .eq("conversation_id", conversationId)
    .select("*");

  if (error) throw error;
  if (!data || data.length === 0) {
    return { outcome: "nao_encontrada" };
  }

  return { outcome: "marcada", conversa: data[0] as ConversaEstado };
}

// Painel de Atendimento -- previa da lista, Fatia 1 (2026-08-18,
// Plano de Execucao "Proxima evolucao do Painel de Atendimento").
// Preenche nome_snapshot (coluna existente desde a migration
// 20260816140000, nunca escrita ate agora). Chamada em dois pontos,
// ambos best-effort (Orquestrador apos /status resolvido, e
// painel-atendimento-abrir como reforco) -- nenhum dos dois pode
// derrubar o fluxo principal se esta escrita falhar, por isso o
// chamador sempre envolve em .catch(() => {}) em vez de deixar o
// erro propagar. So' escreve quando ha' nome real (nunca sobrescreve
// um nome_snapshot ja populado com null vindo de uma consulta que
// falhou/nao encontrou).
export async function atualizarNomeSnapshot(
  conversationId: string,
  nome: string,
): Promise<void> {
  const client = getServiceClient();

  const { error } = await client
    .from("conversas_estado")
    .update({ nome_snapshot: nome })
    .eq("conversation_id", conversationId);

  if (error) throw error;
}
