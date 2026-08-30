// Resolucao interna da conta UniTV (id numerico do painel de revenda)
// a partir do `sn` (== `usuario` do cadastro Rocket) -- Etapa 2
// (Renovacao UniTV, Bloco 3). Chamada pelo Orquestrador ANTES de criar
// token/cobranca UniTV (Opcao A): sem token, sem cobranca, quando a
// conta nao resolve para EXATAMENTE 1.
//
// NUNCA chama /api/account/renew -- so' resolucao. A renovacao real
// continua exclusiva do runner (scripts/lib/unitv-renovar.mjs).
//
// Irmao direto de renovacao-sigma-cliente / renovacao-sigma-contexto:
// contrato minimo, X-Internal-Token obrigatorio checado antes de tudo,
// so' POST, so' `sn` por corpo JSON.
//
// AUTENTICACAO: X-Internal-Token == RENOVACAO_SIGMA_CALLBACK_TOKEN --
// o MESMO secret ja compartilhado na familia de chamadas internas de
// renovacao (runner <-> renovacao-sigma-* / renovacao-rocket-vencimento).
// O Orquestrador entra como chamador (le o secret do projeto em
// runtime). NENHUM secret novo.
//
// SEGURANCA: a resposta so' contem outcome/id/sn. `dealer_token`/
// `dealer_name` (UNITV_DEALER_*) NUNCA sao lidos aqui diretamente,
// nunca logados, nunca devolvidos -- resolverContaUnitv os usa
// internamente e devolve so' o resultado.

import { errorResponse, jsonResponse } from "../_shared/http.ts";
import { resolverContaUnitv } from "../_shared/unitv_conta.ts";
import { diagnosticarTokenUnitv } from "../_shared/unitv_token_diag.ts";

// Runtime da plataforma (Deno Deploy / Supabase Edge) -- mesma
// declaracao usada em webhook/index.ts e openpix-webhook/index.ts.
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

// `sn`/`usuario` observados no cadastro sao alfanumericos curtos
// (ex.: "gcnv6v", "828667229") -- limite generoso, so' pra barrar
// entrada claramente invalida antes de tocar o painel.
const SN_MAX = 64;

Deno.serve(async (req: Request) => {
  const tokenInterno = Deno.env.get("RENOVACAO_SIGMA_CALLBACK_TOKEN");
  const tokenRecebido = req.headers.get("X-Internal-Token");
  if (!tokenInterno || !tokenRecebido || tokenRecebido !== tokenInterno) {
    return errorResponse("Nao autorizado", 401);
  }

  if (req.method !== "POST") {
    return errorResponse("Metodo nao suportado, use POST", 405);
  }

  let body: { sn?: unknown };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Corpo da requisicao precisa ser JSON valido");
  }

  const sn = typeof body.sn === "string" ? body.sn.trim() : "";
  if (!sn || sn.length > SN_MAX) {
    return errorResponse("Campo obrigatorio: sn (string nao vazia)");
  }

  const r = await resolverContaUnitv(sn);

  if (r.ok) {
    return jsonResponse({ outcome: "resolvido", id: r.id, sn: r.sn });
  }

  // Mapeamento -> o Orquestrador so' precisa distinguir:
  //   resolvido | nao_encontrado | ambiguo | indisponivel
  // (todos os casos != "resolvido" => NAO cria token/cobranca; mensagem
  //  fixa + transferencia -- decisao 2 da Etapa 2)
  if (r.reason === "nao_encontrado" || r.reason === "customer_inesperado") {
    return jsonResponse({ outcome: "nao_encontrado" });
  }
  if (r.reason === "ambiguo") {
    return jsonResponse({ outcome: "ambiguo" });
  }

  // Fase 1 da autocura do UNITV_DEALER_TOKEN (2026-08-29, inovatv_central/
  // CLAUDE.md): SO' quando o resultado e' 'unavailable' (token rejeitado
  // OU painel fora) dispara um diagnostico FORA DA BANDA -- read-only,
  // sem login, sem tocar secret, sem alterar renovacao.
  // 'credenciais_ausentes'/'sn_invalido' seguem SEPARADOS (nao ha' o que
  // sondar). A resposta abaixo (e o tempo dela) NAO muda: o diagnostico
  // roda depois do return via EdgeRuntime.waitUntil e uma excecao dele
  // jamais propaga.
  if (r.reason === "unavailable") {
    try {
      EdgeRuntime.waitUntil(
        diagnosticarTokenUnitv({
          motivoOrigem: "renovacao-unitv-conta:indisponivel",
          origemErro: { returnCode: r.returnCode, httpStatus: r.httpStatus, painelMsg: r.painelMsg },
        }).catch((e) => console.log("[unitv-token-diag] falha ao agendar diagnostico", String(e))),
      );
    } catch (e) {
      console.log("[unitv-token-diag] EdgeRuntime.waitUntil indisponivel", String(e));
    }
  }

  // unavailable / credenciais_ausentes / sn_invalido (nao deveria chegar)
  return jsonResponse({ outcome: "indisponivel" });
});
