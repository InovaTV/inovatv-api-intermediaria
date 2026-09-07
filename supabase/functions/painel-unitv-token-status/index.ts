// painel-unitv-token-status (decisao aprovada 2026-09-07,
// inovatv_central/CLAUDE.md "Frente -- Fluxo de Renovacao Automatica").
//
// STATUS PERSISTENTE do UNITV_DEALER_TOKEN para o operador -- so'
// LEITURA, sem nenhuma chamada externa:
//   * unitv_dealer_token_estado  -> "ultima atualizacao manual"
//     (origem / atualizado_em / atualizado_por)
//   * ultima linha de unitv_token_diagnostico -> "ultima validacao"
//     (veredito / criado_em / motivo_origem) -- alimentada tanto pelo
//     monitor proativo (*/15) quanto pelas acoes do proprio Painel
//   * badge 🟢 / 🔴 / ⚠️ derivada do veredito
//
// A verificacao AO VIVO (sonda /api/account) e' o painel-unitv-token-validar
// (acao separada, botao "Validar agora"). Este endpoint nunca sonda.
//
// NUNCA retorna o valor do token (nao ha' coluna que o guarde de todo
// jeito -- unitv_dealer_token_estado so' tem metadados).

import { verificarOperador, respostaNaoAutorizado } from "../_shared/auth_painel.ts";
import { jsonResponse, errorResponse, corsResponse } from "../_shared/http.ts";
import { getServiceClient } from "../_shared/supabase_client.ts";
import { derivarBadge, type Veredicto } from "../_shared/unitv_token_painel.ts";

const VEREDITOS_VALIDOS: readonly Veredicto[] = [
  "token_vivo",
  "token_morto",
  "indeterminado_outage",
  "indeterminado",
];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsResponse();
  if (req.method !== "GET") {
    return errorResponse("Metodo nao suportado, use GET", 405);
  }

  const auth = await verificarOperador(req);
  if (!auth.autorizado) return respostaNaoAutorizado(auth.motivo);

  const supa = getServiceClient();

  let estado: {
    origem: string;
    atualizado_em: string;
    atualizado_por: string | null;
  } | null = null;
  let ultimaValidacao: {
    veredito: string;
    criado_em: string;
    motivo_origem: string;
    origem_return_code: number | null;
  } | null = null;

  try {
    const [estadoRes, diagRes] = await Promise.all([
      supa
        .from("unitv_dealer_token_estado")
        .select("origem, atualizado_em, atualizado_por")
        .eq("id", 1)
        .maybeSingle(),
      supa
        .from("unitv_token_diagnostico")
        .select("veredito, criado_em, motivo_origem, origem_return_code")
        .order("criado_em", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (estadoRes.error) throw estadoRes.error;
    if (diagRes.error) throw diagRes.error;
    estado = (estadoRes.data as typeof estado) ?? null;
    ultimaValidacao = (diagRes.data as typeof ultimaValidacao) ?? null;
  } catch (e) {
    console.log(
      "[painel-unitv-token-status] falha ao ler estado",
      JSON.stringify({ erro: String((e as { message?: string })?.message ?? e) }),
    );
    return jsonResponse({ outcome: "unavailable" }, 503);
  }

  const veredito =
    ultimaValidacao &&
    (VEREDITOS_VALIDOS as readonly string[]).includes(ultimaValidacao.veredito)
      ? (ultimaValidacao.veredito as Veredicto)
      : null;

  return jsonResponse({
    outcome: "success",
    resumo: derivarBadge(veredito),
    ultimaValidacao,
    ultimaAtualizacaoManual: estado,
  });
});
