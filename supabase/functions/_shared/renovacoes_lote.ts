// Acesso a tabela renovacoes_lote + tokens_renovacao filhos (Etapa 1,
// 2026-08-29, migration 20260829120000_renovacoes_lote.sql). So'
// executa -- QUANDO criar/reivindicar e' do Orquestrador /
// renovacao_confirmacao / openpix-webhook / renovacao-sigma-resultado.
//
// Token bruto do lote NUNCA persistido -- so' o hash SHA-256. O bruto
// e' devolvido uma unica vez, na criacao, pro chamador montar o id do
// botao ACEITO/CANCELAR.

import { getServiceClient } from "./supabase_client.ts";
import {
  hashToken,
  ESTADOS_TOKEN_NAO_TERMINAIS,
  type EstadoTokenRenovacao,
  type TokenRenovacao,
} from "./tokens_renovacao.ts";

export type EstadoRenovacaoLote =
  | "aguardando_confirmacao"
  | "cancelada"
  | "autorizada"
  | "expirada"
  | "renovacao_em_andamento"
  | "concluida"
  | "parcial"
  | "falhou";

// Estados NAO-terminais de um lote (mesmo principio do token: o ciclo
// da renovacao ainda esta' vivo). Qualquer outro e' terminal. Usado
// pela Peca 2 e pela Peca 3 (2026-08-29).
export const ESTADOS_LOTE_NAO_TERMINAIS: readonly EstadoRenovacaoLote[] = [
  "aguardando_confirmacao",
  "autorizada",
  "renovacao_em_andamento",
];

export interface RenovacaoLote {
  grupo_id: string;
  conversation_id: string;
  telefone: string;
  token_hash: string;
  estado: EstadoRenovacaoLote;
  valor_total_centavos: number;
  regra_aplicada: string;
  operacao_id: string | null;
  criado_em: string;
  expira_em: string;
  decidido_em: string | null;
  renovacao_iniciada_em: string | null;
  renovacao_concluida_em: string | null;
}

// Cada filho: um acesso do lote. Snapshot dos dados apresentados na
// confirmacao -- nunca reconsultado so' pra exibir.
export interface FilhoLote {
  tipo: "sigma" | "unitv";
  publicId: string | null;
  unitvSn: string | null;
  unitvId: number | null;
  clienteNome: string;
  servidorNome: string;
  planoNome: string;
  valorEsperadoCentavos: number;
  vencimentoAtual: string;
}

const JANELA_EXPIRACAO_MS = 2 * 60 * 60 * 1000; // 2h, mesma do token individual

// Cria a "capa" do lote + os N filhos em tokens_renovacao, numa
// sequencia (nao ha transacao no client REST -- a atomicidade que
// importa e' a do ACEITO/inicio, coberta pelas RPCs). Se a insercao
// dos filhos falhar, o lote fica 'aguardando_confirmacao' orfao e
// expira em 2h (expirarLoteSeVencido) -- aceitavel, nenhuma cobranca
// foi criada ainda.
export async function criarRenovacaoLote(params: {
  conversationId: string;
  telefone: string;
  valorTotalCentavos: number;
  regraAplicada: string;
  filhos: FilhoLote[];
}): Promise<{ tokenBruto: string; lote: RenovacaoLote }> {
  const client = getServiceClient();
  const tokenBruto = crypto.randomUUID();
  const tokenHash = await hashToken(tokenBruto);
  const expiraEm = new Date(Date.now() + JANELA_EXPIRACAO_MS).toISOString();

  const { data: loteData, error: loteErr } = await client
    .from("renovacoes_lote")
    .insert({
      conversation_id: params.conversationId,
      telefone: params.telefone,
      token_hash: tokenHash,
      valor_total_centavos: params.valorTotalCentavos,
      regra_aplicada: params.regraAplicada,
      expira_em: expiraEm,
      estado: "aguardando_confirmacao",
    })
    .select("*")
    .single();
  if (loteErr) throw loteErr;
  const lote = loteData as RenovacaoLote;

  // Cada filho ganha um token_hash proprio (aleatorio, NUNCA usado pra
  // lookup nem enviado -- o lookup dos filhos e' sempre por grupo_id).
  const linhasFilhos = await Promise.all(
    params.filhos.map(async (f) => ({
      token_hash: await hashToken(crypto.randomUUID()),
      conversation_id: params.conversationId,
      grupo_id: lote.grupo_id,
      tipo: f.tipo,
      public_id: f.publicId,
      unitv_sn: f.unitvSn,
      unitv_id: f.unitvId,
      telefone: params.telefone,
      cliente_nome: f.clienteNome,
      servidor_nome: f.servidorNome,
      plano_nome: f.planoNome,
      valor_esperado_centavos: f.valorEsperadoCentavos,
      vencimento_atual: f.vencimentoAtual,
      expira_em: expiraEm,
      estado: "aguardando_confirmacao",
    })),
  );
  const { error: filhosErr } = await client.from("tokens_renovacao").insert(linhasFilhos);
  if (filhosErr) throw filhosErr;

  return { tokenBruto, lote };
}

// Existe um LOTE ativo (aguardando confirmacao / autorizado / em
// andamento) que inclui este public_id? Usado pelo fluxo INDIVIDUAL
// (Orquestrador -> processarCobrancaRenovacao) so' pra reconhecer "ja
// ha' uma renovacao em andamento" e parar -- o fluxo individual NUNCA
// cria nem opera token pra um acesso que ja esta num lote.
//
// Reaproveita a MESMA forma de query de buscarTokenAtivoPorPublicId
// (eq public_id + in estado + limit 1); como o indice unico parcial do
// banco garante no maximo 1 token ativo por public_id, basta olhar o
// grupo_id desse unico token. Sem .not/.is NOT NULL -- checagem em JS,
// pra manter compativel com os fakes de teste.
export async function existeLoteAtivoParaPublicId(publicId: string): Promise<boolean> {
  const client = getServiceClient();
  const { data, error } = await client
    .from("tokens_renovacao")
    .select("grupo_id")
    .eq("public_id", publicId)
    .in("estado", ["aguardando_confirmacao", "autorizada", "renovacao_em_andamento"])
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return !!(data && (data as { grupo_id: string | null }).grupo_id != null);
}

export async function buscarLotePorTokenHash(tokenHash: string): Promise<RenovacaoLote | null> {
  const client = getServiceClient();
  const { data, error } = await client
    .from("renovacoes_lote")
    .select("*")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (error) throw error;
  return (data as RenovacaoLote) ?? null;
}

export async function buscarLotePorOperacaoId(operacaoId: string): Promise<RenovacaoLote | null> {
  const client = getServiceClient();
  const { data, error } = await client
    .from("renovacoes_lote")
    .select("*")
    .eq("operacao_id", operacaoId)
    .maybeSingle();
  if (error) throw error;
  return (data as RenovacaoLote) ?? null;
}

export async function buscarFilhosDoLote(grupoId: string): Promise<TokenRenovacao[]> {
  const client = getServiceClient();
  const { data, error } = await client
    .from("tokens_renovacao")
    .select("*")
    .eq("grupo_id", grupoId)
    .order("criado_em", { ascending: true });
  if (error) throw error;
  return (data as TokenRenovacao[]) ?? [];
}

export async function expirarLoteSeVencido(lote: RenovacaoLote): Promise<RenovacaoLote> {
  if (lote.estado !== "aguardando_confirmacao") return lote;
  if (new Date(lote.expira_em).getTime() > Date.now()) return lote;

  const client = getServiceClient();
  const { data, error } = await client
    .from("renovacoes_lote")
    .update({ estado: "expirada" })
    .eq("grupo_id", lote.grupo_id)
    .eq("estado", "aguardando_confirmacao")
    .select("*")
    .maybeSingle();
  if (error) throw error;
  // filhos: deixa o expirarSeVencido individual / watchdog cuidarem --
  // sem cobranca, sem risco.
  return (data as RenovacaoLote) ?? { ...lote, estado: "expirada" };
}

export async function reivindicarAceiteLote(tokenHash: string): Promise<RenovacaoLote | null> {
  const client = getServiceClient();
  const { data, error } = await client.rpc("reivindicar_aceite_lote", { p_token_hash: tokenHash });
  if (error) throw error;
  return (data as RenovacaoLote) ?? null;
}

export async function reivindicarCancelamentoLote(tokenHash: string): Promise<RenovacaoLote | null> {
  const client = getServiceClient();
  const { data, error } = await client.rpc("reivindicar_cancelamento_lote", { p_token_hash: tokenHash });
  if (error) throw error;
  return (data as RenovacaoLote) ?? null;
}

export async function reivindicarInicioRenovacaoLote(operacaoId: string): Promise<RenovacaoLote | null> {
  const client = getServiceClient();
  const { data, error } = await client.rpc("reivindicar_inicio_renovacao_lote", { p_operacao_id: operacaoId });
  if (error) throw error;
  return (data as RenovacaoLote) ?? null;
}

export async function marcarLoteComoFalha(grupoId: string, motivo: string): Promise<RenovacaoLote | null> {
  const client = getServiceClient();
  const { data, error } = await client.rpc("marcar_lote_como_falha", { p_grupo_id: grupoId, p_motivo: motivo });
  if (error) throw error;
  return (data as RenovacaoLote) ?? null;
}

export async function vincularOperacaoAoLote(grupoId: string, operacaoId: string): Promise<void> {
  const client = getServiceClient();
  const { data, error } = await client
    .from("renovacoes_lote")
    .update({ operacao_id: operacaoId })
    .eq("grupo_id", grupoId)
    .eq("estado", "autorizada")
    .select("grupo_id")
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new Error(
      `vincularOperacaoAoLote: nenhuma linha afetada (grupoId=${grupoId}) -- lote pode nao estar mais 'autorizada' ou a cobranca ainda nao existe`,
    );
  }
}

// Estado derivado do lote a partir dos filhos ja terminais. So'
// atualiza se o lote ainda estiver 'renovacao_em_andamento'
// (idempotencia contra callback duplicado). Retorna a linha atualizada
// ou null (ja processado / nada a fazer).
export async function marcarEstadoFinalLote(
  grupoId: string,
  estadoFinal: "concluida" | "parcial" | "falhou",
): Promise<RenovacaoLote | null> {
  const client = getServiceClient();
  const { data, error } = await client
    .from("renovacoes_lote")
    .update({ estado: estadoFinal, renovacao_concluida_em: new Date().toISOString() })
    .eq("grupo_id", grupoId)
    .eq("estado", "renovacao_em_andamento")
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (data as RenovacaoLote) ?? null;
}

export async function buscarLotesEmAndamentoAntigos(minutosLimite: number): Promise<RenovacaoLote[]> {
  const client = getServiceClient();
  const limite = new Date(Date.now() - minutosLimite * 60 * 1000).toISOString();
  const { data, error } = await client
    .from("renovacoes_lote")
    .select("*")
    .eq("estado", "renovacao_em_andamento")
    .lt("renovacao_iniciada_em", limite);
  if (error) throw error;
  return (data as RenovacaoLote[]) ?? [];
}

// Backstop do watchdog (Etapa 1, 2026-08-29) -- equivalente lote de
// buscarAutorizacoesOrfasAntigas (tokens_renovacao). Um lote preso em
// 'autorizada' sem operacao_id vinculado apos a janela = ACEITO
// aconteceu, mas a cobranca nunca chegou a ser criada/vinculada (queda
// de processo entre criarCobrancaOpenPix e vincularOperacaoAoLote). O
// caminho normal (falha de cobranca) ja se auto-recupera via
// tratarFalhaLote em renovacao_confirmacao.ts; isto so' cobre o que
// escapar daquele caminho. NUNCA inclui lote com operacao_id ja
// vinculado (aguardando pagamento legitimamente).
export async function buscarLotesAutorizadosOrfaosAntigos(minutosLimite: number): Promise<RenovacaoLote[]> {
  const client = getServiceClient();
  const limite = new Date(Date.now() - minutosLimite * 60 * 1000).toISOString();
  const { data, error } = await client
    .from("renovacoes_lote")
    .select("*")
    .eq("estado", "autorizada")
    .is("operacao_id", null)
    .lt("decidido_em", limite);
  if (error) throw error;
  return (data as RenovacaoLote[]) ?? [];
}

// Marca UM filho terminal por id (o lote compartilha 1 operacao_id,
// entao marcarResultadoRenovacao por operacao_id nao serve -- cada
// filho e' identificado pelo proprio id). Idempotente: so' se ainda
// 'renovacao_em_andamento'.
export async function marcarResultadoFilhoLote(
  tokenId: string,
  estadoFinal: EstadoTokenRenovacao,
  detalhe: { vencimentoConfirmado?: string | null; motivo?: string | null },
): Promise<TokenRenovacao | null> {
  const client = getServiceClient();
  const payload: Record<string, unknown> = {
    estado: estadoFinal,
    renovacao_concluida_em: new Date().toISOString(),
  };
  if (detalhe.vencimentoConfirmado) payload.vencimento_confirmado = detalhe.vencimentoConfirmado;
  if (detalhe.motivo) payload.motivo_falha = detalhe.motivo;

  const { data, error } = await client
    .from("tokens_renovacao")
    .update(payload)
    .eq("id", tokenId)
    .eq("estado", "renovacao_em_andamento")
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (data as TokenRenovacao) ?? null;
}

// ---------------------------------------------------------------------
// Peca 2 (2026-08-29): validade read-side do estado de sessao. O
// Orquestrador so' honra conversas_estado.acesso_selecionado se ele
// for consistente com o estado AUTORITATIVO da operacao de renovacao.
// Consulta a ULTIMA operacao (token individual OU lote) para
// (conversation_id, public_id):
//   - terminal            -> obsoleto (ciclo de renovacao ja acabou)
//   - nao-terminal          -> vivo, honra
//   - nenhuma operacao       -> anafora conversacional pura, honra
// Escopo por public_id (nunca por conversa inteira): uma renovacao
// concluida de UM acesso nao invalida uma intencao nova para OUTRO,
// nem a intencao gravada quando a lista foi reapresentada.
export async function ultimaOperacaoRenovacaoEhTerminal(
  conversationId: string,
  publicId: string,
): Promise<boolean> {
  const client = getServiceClient();

  const { data, error } = await client
    .from("tokens_renovacao")
    .select("estado, grupo_id")
    .eq("conversation_id", conversationId)
    .eq("public_id", publicId)
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return false; // nenhuma operacao -> anafora, nao e' obsoleto

  const row = data as { estado: EstadoTokenRenovacao; grupo_id: string | null };

  if (row.grupo_id === null) {
    return !ESTADOS_TOKEN_NAO_TERMINAIS.includes(row.estado);
  }

  // Filho de lote: a autoridade e' o estado do LOTE, nao o do filho.
  const { data: lote, error: erroLote } = await client
    .from("renovacoes_lote")
    .select("estado")
    .eq("grupo_id", row.grupo_id)
    .maybeSingle();
  if (erroLote) throw erroLote;
  if (!lote) return false;

  return !ESTADOS_LOTE_NAO_TERMINAIS.includes((lote as { estado: EstadoRenovacaoLote }).estado);
}

// ---------------------------------------------------------------------
// Peca 3 (2026-08-29) -- ciclo de vida garantido dos lotes presos.
// Espelho lote das funcoes em tokens_renovacao.ts. Janela: expira_em.
// ---------------------------------------------------------------------

// CASO A -- lote 'aguardando_confirmacao' vencido (cliente nunca
// clicou). Sem cobranca.
export async function buscarLotesAguardandoExpirados(): Promise<RenovacaoLote[]> {
  const client = getServiceClient();
  const { data, error } = await client
    .from("renovacoes_lote")
    .select("*")
    .eq("estado", "aguardando_confirmacao")
    .lt("expira_em", new Date().toISOString());
  if (error) throw error;
  return (data as RenovacaoLote[]) ?? [];
}

// CASOS B/C -- lote 'autorizada' COM cobranca vinculada, alem do
// expira_em. Complemento de buscarLotesAutorizadosOrfaosAntigos (que
// so' pega operacao_id IS NULL).
export async function buscarLotesAutorizadosVinculadosExpirados(): Promise<RenovacaoLote[]> {
  const client = getServiceClient();
  const { data, error } = await client
    .from("renovacoes_lote")
    .select("*")
    .eq("estado", "autorizada")
    .not("operacao_id", "is", null)
    .lt("expira_em", new Date().toISOString());
  if (error) throw error;
  return (data as RenovacaoLote[]) ?? [];
}

// CAMADA 3 (2026-08-29) -- espelho lote de
// buscarAutorizacoesVinculadasAindaNaJanela (tokens_renovacao.ts). Lote
// 'autorizada' + cobranca vinculada, AINDA dentro da janela de 2h, criado ha'
// pelo menos `minutosMinimos`. So' recupera se a Woovi confirmar COMPLETED +
// valor exato -- NUNCA expira o lote aqui (sweep de expira_em e' o dono).
export async function buscarLotesAutorizadosVinculadosAindaNaJanela(
  minutosMinimos: number,
): Promise<RenovacaoLote[]> {
  const client = getServiceClient();
  const agora = Date.now();
  const tetoCriadoEm = new Date(agora - minutosMinimos * 60 * 1000).toISOString();
  const { data, error } = await client
    .from("renovacoes_lote")
    .select("*")
    .eq("estado", "autorizada")
    .not("operacao_id", "is", null)
    .gte("expira_em", new Date(agora).toISOString())
    .lt("criado_em", tetoCriadoEm);
  if (error) throw error;
  return (data as RenovacaoLote[]) ?? [];
}

// CASO C -- expira um lote 'autorizada' + filhos 'autorizada' via RPC
// atomica expirar_lote_autorizado (migration
// 20260829140000_expirar_lote_autorizado.sql). 'expirada' (janela
// fechou sem pagamento) e' semanticamente distinto de 'falhou'
// (tentamos e deu erro) -- por isso RPC propria, nao reuso de
// marcar_lote_como_falha. CAS interno WHERE estado='autorizada':
// null = o lote ja avancou -> chamador aborta o item. NAO toca a
// cobranca (Caso D concilia).
export async function expirarLoteAutorizado(operacaoId: string): Promise<RenovacaoLote | null> {
  const client = getServiceClient();
  const { data, error } = await client.rpc("expirar_lote_autorizado", { p_operacao_id: operacaoId });
  if (error) throw error;
  return (data as RenovacaoLote) ?? null;
}

// CASO D -- lotes ja TERMINAIS (expirada/falhou/cancelada) com
// cobranca vinculada mas sem renovacao concluida no nivel do lote.
// Rede de seguranca de dinheiro para lote. 'parcial'/'concluida' NAO
// entram: essas transicoes (marcarEstadoFinalLote) ja preenchem
// renovacao_concluida_em -> filtradas pelo IS NULL abaixo.
export async function buscarLotesTerminaisComCobrancaSemRenovacao(): Promise<RenovacaoLote[]> {
  const client = getServiceClient();
  const { data, error } = await client
    .from("renovacoes_lote")
    .select("*")
    .in("estado", ["expirada", "falhou", "cancelada"])
    .not("operacao_id", "is", null)
    .is("renovacao_concluida_em", null);
  if (error) throw error;
  return (data as RenovacaoLote[]) ?? [];
}

// CASO D -- marca o ciclo do lote como ENCERRADO
// (renovacao_concluida_em) para nao reprocessar. CAS
// renovacao_concluida_em IS NULL -> idempotente. NAO altera 'estado'.
export async function marcarLoteCicloRenovacaoEncerrado(grupoId: string): Promise<RenovacaoLote | null> {
  const client = getServiceClient();
  const { data, error } = await client
    .from("renovacoes_lote")
    .update({ renovacao_concluida_em: new Date().toISOString() })
    .eq("grupo_id", grupoId)
    .is("renovacao_concluida_em", null)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (data as RenovacaoLote) ?? null;
}
