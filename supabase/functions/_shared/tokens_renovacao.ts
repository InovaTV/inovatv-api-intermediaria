// Acesso a tabela tokens_renovacao (Bloco 2, 2026-08-24, migration
// 20260824130000_tokens_renovacao.sql). So' executa, nunca decide
// QUANDO criar/reivindicar um token -- isso e' do Orquestrador/
// confirmacao-renovacao/renovacao-sigma-resultado.
//
// Token bruto NUNCA e' persistido -- so' o hash SHA-256 (hex). O
// bruto e' devolvido uma unica vez, na criacao, pro chamador montar a
// URL enviada ao cliente.

import { getServiceClient } from "./supabase_client.ts";

export type EstadoTokenRenovacao =
  | "aguardando_confirmacao"
  | "cancelada"
  | "autorizada"
  | "expirada"
  | "renovacao_em_andamento"
  | "renovacao_concluida"
  | "renovacao_falhou"
  | "renovacao_indeterminada";

export interface TokenRenovacao {
  id: string;
  token_hash: string;
  conversation_id: string;
  public_id: string;
  telefone: string;
  operacao_id: string | null;
  cliente_nome: string;
  servidor_nome: string;
  plano_nome: string;
  valor_esperado_centavos: number;
  vencimento_atual: string;
  estado: EstadoTokenRenovacao;
  criado_em: string;
  expira_em: string;
  decidido_em: string | null;
  renovacao_iniciada_em: string | null;
  renovacao_concluida_em: string | null;
  vencimento_confirmado: string | null;
  motivo_falha: string | null;
}

const JANELA_EXPIRACAO_MS = 2 * 60 * 60 * 1000; // 2h, decisao aprovada

export async function hashToken(tokenBruto: string): Promise<string> {
  const dados = new TextEncoder().encode(tokenBruto);
  const digest = await crypto.subtle.digest("SHA-256", dados);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function criarTokenRenovacao(params: {
  conversationId: string;
  publicId: string;
  telefone: string;
  clienteNome: string;
  servidorNome: string;
  planoNome: string;
  valorEsperadoCentavos: number;
  vencimentoAtual: string;
}): Promise<{ tokenBruto: string; registro: TokenRenovacao }> {
  const tokenBruto = crypto.randomUUID();
  const tokenHash = await hashToken(tokenBruto);
  const expiraEm = new Date(Date.now() + JANELA_EXPIRACAO_MS).toISOString();

  const client = getServiceClient();
  const { data, error } = await client
    .from("tokens_renovacao")
    .insert({
      token_hash: tokenHash,
      conversation_id: params.conversationId,
      public_id: params.publicId,
      telefone: params.telefone,
      cliente_nome: params.clienteNome,
      servidor_nome: params.servidorNome,
      plano_nome: params.planoNome,
      valor_esperado_centavos: params.valorEsperadoCentavos,
      vencimento_atual: params.vencimentoAtual,
      expira_em: expiraEm,
      estado: "aguardando_confirmacao",
    })
    .select("*")
    .single();

  if (error) throw error;
  return { tokenBruto, registro: data as TokenRenovacao };
}

// So' pode existir 1 solicitacao ativa por public_id (garantido tambem
// pelo indice unico parcial no banco) -- checagem do lado da
// aplicacao, pra reaproveitar em vez de tentar criar outra e esbarrar
// na constraint.
export async function buscarTokenAtivoPorPublicId(publicId: string): Promise<TokenRenovacao | null> {
  const client = getServiceClient();
  const { data, error } = await client
    .from("tokens_renovacao")
    .select("*")
    .eq("public_id", publicId)
    .in("estado", ["aguardando_confirmacao", "autorizada", "renovacao_em_andamento"])
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data as TokenRenovacao) ?? null;
}

export async function buscarTokenPorHash(tokenHash: string): Promise<TokenRenovacao | null> {
  const client = getServiceClient();
  const { data, error } = await client
    .from("tokens_renovacao")
    .select("*")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error) throw error;
  return (data as TokenRenovacao) ?? null;
}

export async function buscarTokenPorOperacaoId(operacaoId: string): Promise<TokenRenovacao | null> {
  const client = getServiceClient();
  const { data, error } = await client
    .from("tokens_renovacao")
    .select("*")
    .eq("operacao_id", operacaoId)
    .maybeSingle();

  if (error) throw error;
  return (data as TokenRenovacao) ?? null;
}

// Expiracao preguicosa -- checada no momento do GET/POST da tela de
// confirmacao, nunca por varredura ativa (YAGNI, mesmo padrao ja
// usado na sessao de 1h da IA). So' transiciona se ainda estiver
// 'aguardando_confirmacao' -- nunca sobrescreve um estado ja decidido.
export async function expirarSeVencido(registro: TokenRenovacao): Promise<TokenRenovacao> {
  if (registro.estado !== "aguardando_confirmacao") return registro;
  if (new Date(registro.expira_em).getTime() > Date.now()) return registro;

  const client = getServiceClient();
  const { data, error } = await client
    .from("tokens_renovacao")
    .update({ estado: "expirada" })
    .eq("id", registro.id)
    .eq("estado", "aguardando_confirmacao")
    .select("*")
    .maybeSingle();

  if (error) throw error;
  return (data as TokenRenovacao) ?? { ...registro, estado: "expirada" };
}

// Reivindicacao atomica do ACEITO -- mesmo mecanismo ja comprovado sob
// concorrencia real em producao (assumir_atendimento).
export async function reivindicarAceite(tokenHash: string): Promise<TokenRenovacao | null> {
  const client = getServiceClient();
  const { data, error } = await client
    .from("tokens_renovacao")
    .update({ estado: "autorizada", decidido_em: new Date().toISOString() })
    .eq("token_hash", tokenHash)
    .eq("estado", "aguardando_confirmacao")
    .select("*")
    .maybeSingle();

  if (error) throw error;
  return (data as TokenRenovacao) ?? null;
}

export async function reivindicarCancelamento(tokenHash: string): Promise<TokenRenovacao | null> {
  const client = getServiceClient();
  const { data, error } = await client
    .from("tokens_renovacao")
    .update({ estado: "cancelada", decidido_em: new Date().toISOString() })
    .eq("token_hash", tokenHash)
    .eq("estado", "aguardando_confirmacao")
    .select("*")
    .maybeSingle();

  if (error) throw error;
  return (data as TokenRenovacao) ?? null;
}

// Vincula a cobranca OpenPix criada logo apos o ACEITO -- so' grava se
// o token ainda estiver 'autorizada' (defesa contra corrida com um
// cancelamento tardio improvavel).
export async function vincularOperacaoAoToken(id: string, operacaoId: string): Promise<void> {
  const client = getServiceClient();
  const { error } = await client
    .from("tokens_renovacao")
    .update({ operacao_id: operacaoId })
    .eq("id", id)
    .eq("estado", "autorizada");

  if (error) throw error;
}

// Reivindicacao atomica do INICIO da renovacao -- disparada pelo
// openpix-webhook so' quando marcarCobrancaComoPaga afetou uma linha
// de verdade (nunca em reenvio de webhook). Primeira e principal
// camada de prevencao de disparo duplicado do GitHub Actions.
export async function reivindicarInicioRenovacao(operacaoId: string): Promise<TokenRenovacao | null> {
  const client = getServiceClient();
  const { data, error } = await client
    .from("tokens_renovacao")
    .update({ estado: "renovacao_em_andamento", renovacao_iniciada_em: new Date().toISOString() })
    .eq("operacao_id", operacaoId)
    .eq("estado", "autorizada")
    .select("*")
    .maybeSingle();

  if (error) throw error;
  return (data as TokenRenovacao) ?? null;
}

export type ResultadoRenovacaoSigma = "sucesso" | "falha" | "sessao_expirada" | "resultado_ambiguo";

const MAPA_ESTADO_TERMINAL: Record<ResultadoRenovacaoSigma, EstadoTokenRenovacao> = {
  sucesso: "renovacao_concluida",
  falha: "renovacao_falhou",
  sessao_expirada: "renovacao_indeterminada",
  resultado_ambiguo: "renovacao_indeterminada",
};

// So' atualiza operacao_id que ainda esteja 'renovacao_em_andamento' --
// idempotencia contra callback duplicado do GitHub Actions (retry,
// reentrega). Retorna null se nao havia nada pra atualizar (ja
// processado antes, ou operacao_id desconhecido) -- o chamador decide
// o que fazer, esta funcao nunca lanca por "nada pra atualizar".
export async function marcarResultadoRenovacao(
  operacaoId: string,
  resultado: ResultadoRenovacaoSigma,
  detalhe: { vencimentoConfirmado?: string; motivo?: string },
): Promise<TokenRenovacao | null> {
  const client = getServiceClient();
  const payload: Record<string, unknown> = {
    estado: MAPA_ESTADO_TERMINAL[resultado],
    renovacao_concluida_em: new Date().toISOString(),
  };
  if (resultado === "sucesso" && detalhe.vencimentoConfirmado) {
    payload.vencimento_confirmado = detalhe.vencimentoConfirmado;
  }
  if (detalhe.motivo) payload.motivo_falha = detalhe.motivo;

  const { data, error } = await client
    .from("tokens_renovacao")
    .update(payload)
    .eq("operacao_id", operacaoId)
    .eq("estado", "renovacao_em_andamento")
    .select("*")
    .maybeSingle();

  if (error) throw error;
  return (data as TokenRenovacao) ?? null;
}

// Watchdog (renovacao-sigma-watchdog, pg_cron a cada 5min) -- busca
// tokens presos em 'renovacao_em_andamento' ha mais que a janela
// aprovada (15min). So' leitura -- quem decide/marca e' o chamador,
// reaproveitando marcarResultadoRenovacao com resultado_ambiguo.
export async function buscarRenovacoesEmAndamentoAntigas(minutosLimite: number): Promise<TokenRenovacao[]> {
  const client = getServiceClient();
  const limite = new Date(Date.now() - minutosLimite * 60 * 1000).toISOString();
  const { data, error } = await client
    .from("tokens_renovacao")
    .select("*")
    .eq("estado", "renovacao_em_andamento")
    .lt("renovacao_iniciada_em", limite);

  if (error) throw error;
  return (data as TokenRenovacao[]) ?? [];
}

// Correcao de risco (2026-08-24, revisao do Bloco 2): reivindicacao
// atomica de FALHA a partir de 'autorizada' -- usada quando o ACEITO
// foi confirmado mas a cobranca nunca chegou a ser criada/vinculada
// (falha ao criar na OpenPix, ou o processo caiu no meio do caminho).
// Sem isso, o token ficaria preso para sempre em 'autorizada' -- e o
// indice unico parcial bloquearia qualquer nova solicitacao pro mesmo
// acesso ate' uma correcao manual no banco. So' atualiza se ainda
// estiver 'autorizada' (nunca sobrescreve um estado mais avancado --
// ex: se operacao_id ja foi vinculado e o cliente ja pagou nesse
// meio-tempo, essa chamada vira no-op, retorna null).
export async function marcarAutorizacaoComoFalha(
  id: string,
  motivo: string,
): Promise<TokenRenovacao | null> {
  const client = getServiceClient();
  const { data, error } = await client
    .from("tokens_renovacao")
    .update({ estado: "renovacao_falhou", motivo_falha: motivo })
    .eq("id", id)
    .eq("estado", "autorizada")
    .select("*")
    .maybeSingle();

  if (error) throw error;
  return (data as TokenRenovacao) ?? null;
}

// Backstop do watchdog (mesma janela de 15min ja aprovada pro
// renovacao-sigma-watchdog) -- autorizacoes que nunca chegaram a ter
// uma cobranca vinculada (operacao_id IS NULL). NUNCA inclui tokens
// com operacao_id ja vinculado -- esses estao legitimamente aguardando
// o cliente pagar o Pix (pode levar minutos, horas ou dias); tocar
// neles aqui seria um bug, nao uma correcao.
export async function buscarAutorizacoesOrfasAntigas(minutosLimite: number): Promise<TokenRenovacao[]> {
  const client = getServiceClient();
  const limite = new Date(Date.now() - minutosLimite * 60 * 1000).toISOString();
  const { data, error } = await client
    .from("tokens_renovacao")
    .select("*")
    .eq("estado", "autorizada")
    .is("operacao_id", null)
    .lt("decidido_em", limite);

  if (error) throw error;
  return (data as TokenRenovacao[]) ?? [];
}
