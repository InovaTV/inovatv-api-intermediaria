// Acesso a tabela cobrancas_pix (Bloco 1, 2026-08-23, migration
// 20260823170000_cobrancas_pix.sql; provedor trocado para OpenPix em
// 2026-08-24). So' executa, nunca decide QUANDO criar uma cobranca --
// isso e' do Orquestrador. marcarCobrancaComoPaga (2026-08-24, novo)
// nunca e' chamada a partir do payload do webhook isolado -- so'
// depois que o chamador ja' reconsultou a cobranca no provedor (mesma
// disciplina "webhook e' so' o gatilho" ja usada no fluxo).

import { getServiceClient } from "./supabase_client.ts";

export type StatusCobrancaPix = "pendente" | "pago" | "valor_divergente" | "expirada" | "cancelada";

export interface CobrancaPix {
  operacao_id: string;
  conversation_id: string;
  // Renovacao em lote (2026-08-29): public_id NULL = cobranca de um
  // lote (identificada por grupo_id). Cobranca avulsa continua com
  // public_id preenchido.
  public_id: string | null;
  grupo_id: string | null;
  servidor_nome: string | null;
  plano_nome: string | null;
  valor_esperado_centavos: number;
  transaction_id_provedor: string;
  qr_code_texto: string;
  status: StatusCobrancaPix;
  criado_em: string;
  atualizado_em: string;
}

// So' pode existir 1 pendente por public_id (garantido tambem por
// unique index parcial no banco, Lacuna 9 decisao 2) -- esta busca e'
// a checagem do lado da aplicacao, pra reaproveitar a cobranca em vez
// de tentar criar outra e esbarrar na constraint.
export async function buscarCobrancaPendente(publicId: string): Promise<CobrancaPix | null> {
  const client = getServiceClient();
  const { data, error } = await client
    .from("cobrancas_pix")
    .select("*")
    .eq("public_id", publicId)
    .eq("status", "pendente")
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data as CobrancaPix) ?? null;
}

export async function buscarCobrancaPorOperacaoId(
  operacaoId: string,
): Promise<CobrancaPix | null> {
  const client = getServiceClient();
  const { data, error } = await client
    .from("cobrancas_pix")
    .select("*")
    .eq("operacao_id", operacaoId)
    .maybeSingle();

  if (error) throw error;
  return (data as CobrancaPix) ?? null;
}

export async function criarCobrancaPixRegistro(params: {
  operacaoId: string;
  conversationId: string;
  publicId: string | null;
  grupoId?: string | null;
  servidorNome: string | null;
  planoNome: string | null;
  valorEsperadoCentavos: number;
  transactionIdProvedor: string;
  qrCodeTexto: string;
}): Promise<CobrancaPix> {
  const client = getServiceClient();
  const { data, error } = await client
    .from("cobrancas_pix")
    .insert({
      operacao_id: params.operacaoId,
      conversation_id: params.conversationId,
      public_id: params.publicId,
      grupo_id: params.grupoId ?? null,
      servidor_nome: params.servidorNome,
      plano_nome: params.planoNome,
      valor_esperado_centavos: params.valorEsperadoCentavos,
      transaction_id_provedor: params.transactionIdProvedor,
      qr_code_texto: params.qrCodeTexto,
      status: "pendente",
    })
    .select("*")
    .single();

  if (error) throw error;
  return data as CobrancaPix;
}

// So' atualiza operacao_id que ainda esteja 'pendente' -- o filtro
// duplo (operacao_id + status='pendente') evita sobrescrever um estado
// terminal ja gravado por outra chamada (idempotencia contra reenvio
// de webhook, que a propria OpenPix documenta como pratica comum).
// Retorna null se nao havia nenhuma linha pendente com esse id (ja
// processada antes, ou id desconhecido) -- o chamador decide o que
// fazer com isso, esta funcao nunca lanca por "nada pra atualizar".
export async function marcarCobrancaComoPaga(
  operacaoId: string,
): Promise<CobrancaPix | null> {
  const client = getServiceClient();
  const { data, error } = await client
    .from("cobrancas_pix")
    .update({ status: "pago", atualizado_em: new Date().toISOString() })
    .eq("operacao_id", operacaoId)
    .eq("status", "pendente")
    .select("*")
    .maybeSingle();

  if (error) throw error;
  return (data as CobrancaPix) ?? null;
}

export async function marcarCobrancaComoDivergente(
  operacaoId: string,
): Promise<CobrancaPix | null> {
  const client = getServiceClient();
  const { data, error } = await client
    .from("cobrancas_pix")
    .update({ status: "valor_divergente", atualizado_em: new Date().toISOString() })
    .eq("operacao_id", operacaoId)
    .eq("status", "pendente")
    .select("*")
    .maybeSingle();

  if (error) throw error;
  return (data as CobrancaPix) ?? null;
}

// Peca 3 (2026-08-29) -- CASO D, housekeeping. So' o watchdog chama,
// e SO' depois de: (a) o token/lote da operacao ja estar terminal, e
// (b) ter passado a carencia de expira_em + 24h sem a Woovi confirmar
// COMPLETED. Nunca marca 'expirada' uma cobranca que ainda pode virar
// 'pago' -- essa e' a garantia de "nunca perder um pagamento". CAS
// duplo (operacao_id + status='pendente'): idempotente, no-op se algo
// ja mexeu na linha.
export async function expirarCobrancaPendente(
  operacaoId: string,
): Promise<CobrancaPix | null> {
  const client = getServiceClient();
  const { data, error } = await client
    .from("cobrancas_pix")
    .update({ status: "expirada", atualizado_em: new Date().toISOString() })
    .eq("operacao_id", operacaoId)
    .eq("status", "pendente")
    .select("*")
    .maybeSingle();

  if (error) throw error;
  return (data as CobrancaPix) ?? null;
}
