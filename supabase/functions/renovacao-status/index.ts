// Espelho de leitura do estado de uma renovacao (individual ou lote) --
// Portal de Renovacao Tope TV (topetv.com.br/renovacao), Checkpoint 2.
// NUNCA escreve nada -- so' le tokens_renovacao/renovacoes_lote, os
// mesmos helpers ja usados pelo resto do fluxo de renovacao (nenhuma
// logica de pagamento/renovacao nova ou duplicada aqui).
//
// Autenticacao: posse do proprio tokenBruto da renovacao (o mesmo criado
// por criarTokenRenovacao/criarRenovacaoLote, o mesmo que o navegador ja
// tem na tela apos o ACEITO) -- MESMO principio ja aceito em producao por
// confirmacao-renovacao?token=..., nunca operacaoId (nunca chega ao
// navegador) nem JWT/OTP novo (ver revisao de seguranca do Checkpoint
// "acompanhamento do pagamento").
//
// Resposta deliberadamente generica quando o token nao resolve para nada
// (corpo ausente/invalido, hash sem correspondencia) -- nunca diferencia
// "nao existe" de "expirado" de "formato invalido", mesma disciplina
// anti-enumeracao ja usada no resto do fluxo.
//
// CORS: nenhum header definido de proposito. Quando este endpoint for
// chamado pela pagina que renovacao-iniciar renderiza, a chamada e'
// SAME-ORIGIN (ambas as functions vivem sob o mesmo host
// <project-ref>.supabase.co) -- CORS nao se aplica. Nao importa
// _shared/http.ts (que trava CORS num unico host, o do Painel).

import {
  hashToken,
  buscarTokenPorHash,
  type EstadoTokenRenovacao,
} from "../_shared/tokens_renovacao.ts";
import {
  buscarLotePorTokenHash,
  buscarFilhosDoLote,
  type EstadoRenovacaoLote,
} from "../_shared/renovacoes_lote.ts";

type EstadoPortal =
  | "aguardando_confirmacao"
  | "aguardando_pagamento"
  | "processando_renovacao"
  | "concluido"
  | "parcial"
  | "falhou"
  | "cancelado"
  | "expirado"
  | "nao_encontrado";

interface ItemStatus {
  servidor: string;
  resultado: "sucesso" | "falha" | null;
}

const MAPA_ESTADO_TOKEN: Record<EstadoTokenRenovacao, EstadoPortal> = {
  aguardando_confirmacao: "aguardando_confirmacao",
  cancelada: "cancelado",
  autorizada: "aguardando_pagamento",
  expirada: "expirado",
  renovacao_em_andamento: "processando_renovacao",
  renovacao_concluida: "concluido",
  renovacao_falhou: "falhou",
  renovacao_indeterminada: "falhou",
};

const MAPA_ESTADO_LOTE: Record<EstadoRenovacaoLote, EstadoPortal> = {
  aguardando_confirmacao: "aguardando_confirmacao",
  cancelada: "cancelado",
  autorizada: "aguardando_pagamento",
  expirada: "expirado",
  renovacao_em_andamento: "processando_renovacao",
  concluida: "concluido",
  parcial: "parcial",
  falhou: "falhou",
};

// Resultado por acesso, derivado do MESMO estado terminal ja gravado por
// marcarResultadoRenovacao/marcarResultadoFilhoLote -- nenhum calculo
// novo, so' traducao pra exibicao.
function resultadoDoToken(estado: EstadoTokenRenovacao): "sucesso" | "falha" | null {
  if (estado === "renovacao_concluida") return "sucesso";
  if (estado === "renovacao_falhou" || estado === "renovacao_indeterminada") return "falha";
  return null;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function respostaGenerica(): Response {
  return jsonResponse({ estado: "nao_encontrado" satisfies EstadoPortal });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return respostaGenerica();

  const body = (await req.json().catch(() => null)) as { token?: unknown } | null;
  const tokenBruto = body?.token;
  if (typeof tokenBruto !== "string" || tokenBruto.length === 0) return respostaGenerica();

  const tokenHash = await hashToken(tokenBruto);

  // Lote primeiro (mesma ordem de precedencia ja usada por
  // confirmarRenovacao() em _shared/renovacao_confirmacao.ts) -- um
  // token_hash so' pode corresponder a um dos dois.
  const lote = await buscarLotePorTokenHash(tokenHash);
  if (lote) {
    const filhos = await buscarFilhosDoLote(lote.grupo_id);
    const itens: ItemStatus[] = filhos.map((f) => ({
      servidor: f.servidor_nome,
      resultado: resultadoDoToken(f.estado),
    }));
    return jsonResponse({ estado: MAPA_ESTADO_LOTE[lote.estado], itens });
  }

  const token = await buscarTokenPorHash(tokenHash);
  if (token) {
    const itens: ItemStatus[] = [
      { servidor: token.servidor_nome, resultado: resultadoDoToken(token.estado) },
    ];
    return jsonResponse({ estado: MAPA_ESTADO_TOKEN[token.estado], itens });
  }

  return respostaGenerica();
});
