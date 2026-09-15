// Painel de Monitoramento de Renovacoes (2026-09-14) -- Tela 2 (detalhe/
// diagnostico de UMA tentativa). So' leitura. Mesma disciplina de auth
// de todo o Painel (verificarOperador + service_role so' depois do JWT
// do operador validado).
//
// Recebe token_id (avulsa) OU grupo_id (lote) via query string -- nunca
// os dois, nunca nenhum. Devolve o resumo (pra reconstruir o card do
// topo + veredito, calculado no FRONTEND a partir do estado e dos
// eventos -- este endpoint so' entrega dado, nunca decide o texto do
// veredito) e a timeline completa de renovacao_eventos, ja correlacionada
// por token_id/grupo_id/sessao_id/operacao_id (ver buscarEventosPorCorrelacao)
// e ja' com uma camada extra de sanitizacao defensiva em `detalhe`
// (mesma sanitizarDetalhe da escrita, reaplicada na leitura).
//
// Para lote, tambem devolve `filhos` (1 por acesso) -- e' o que permite
// o frontend agrupar os eventos de processamento por acesso (cada
// evento de processamento/vencimento/resultado de um filho carrega o
// token_id DELE, nao o grupo_id sozinho -- ver Fase 3, correlacao).

import { verificarOperador, respostaNaoAutorizado } from "../_shared/auth_painel.ts";
import { jsonResponse, errorResponse, corsResponse, conversationIdValido } from "../_shared/http.ts";
import type { TokenRenovacao, EstadoTokenRenovacao } from "../_shared/tokens_renovacao.ts";
import { getServiceClient } from "../_shared/supabase_client.ts";
import { buscarFilhosDoLote, type RenovacaoLote, type EstadoRenovacaoLote } from "../_shared/renovacoes_lote.ts";
import { buscarEventosPorCorrelacao } from "../_shared/renovacao_eventos.ts";

type Resultado = "ok" | "falha" | "parcial" | "cancel" | "espera";

const MAPA_RESULTADO_TOKEN: Record<EstadoTokenRenovacao, Resultado> = {
  aguardando_confirmacao: "espera",
  autorizada: "espera",
  renovacao_em_andamento: "espera",
  renovacao_concluida: "ok",
  renovacao_falhou: "falha",
  renovacao_indeterminada: "falha",
  cancelada: "cancel",
  expirada: "cancel",
};

const MAPA_RESULTADO_LOTE: Record<EstadoRenovacaoLote, Resultado> = {
  aguardando_confirmacao: "espera",
  autorizada: "espera",
  renovacao_em_andamento: "espera",
  concluida: "ok",
  parcial: "parcial",
  falhou: "falha",
  cancelada: "cancel",
  expirada: "cancel",
};

const FUSO = "America/Sao_Paulo";
function formatarDataHoraBr(iso: string): string {
  const partes = new Intl.DateTimeFormat("pt-BR", {
    timeZone: FUSO,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const parte = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "";
  return `${parte("day")}/${parte("month")}/${parte("year")} às ${parte("hour")}:${parte("minute")}`;
}

function formatarValorBRL(centavos: number): string {
  return "R$ " + (centavos / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// buscarTokenPorHash/buscarLotePorTokenHash (ja existentes) resolvem
// por token_hash, nunca por id -- este endpoint recebe id direto (o
// operador chega aqui a partir da lista, que ja devolve o id real, nao
// um token bruto de cliente). Leitura direta por id, sem duplicar
// helper novo em tokens_renovacao.ts/renovacoes_lote.ts so' por causa
// disto.
async function buscarTokenPorId(id: string): Promise<TokenRenovacao | null> {
  const client = getServiceClient();
  const { data, error } = await client.from("tokens_renovacao").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as TokenRenovacao) ?? null;
}

async function buscarLotePorId(grupoId: string): Promise<RenovacaoLote | null> {
  const client = getServiceClient();
  const { data, error } = await client.from("renovacoes_lote").select("*").eq("grupo_id", grupoId).maybeSingle();
  if (error) throw error;
  return (data as RenovacaoLote) ?? null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsResponse();
  if (req.method !== "GET") return errorResponse("Metodo nao suportado, use GET", 405);

  const auth = await verificarOperador(req);
  if (!auth.autorizado) return respostaNaoAutorizado(auth.motivo);

  const url = new URL(req.url);
  const tokenId = url.searchParams.get("token_id");
  const grupoId = url.searchParams.get("grupo_id");

  if ((!tokenId && !grupoId) || (tokenId && grupoId)) {
    return errorResponse("Informe exatamente um dos dois: token_id OU grupo_id", 400);
  }
  if (tokenId && !conversationIdValido(tokenId)) return errorResponse("token_id invalido", 400);
  if (grupoId && !conversationIdValido(grupoId)) return errorResponse("grupo_id invalido", 400);

  try {
    if (grupoId) {
      const lote = await buscarLotePorId(grupoId);
      if (!lote) return jsonResponse({ outcome: "nao_encontrado" }, 404);

      const filhosRaw = await buscarFilhosDoLote(grupoId);
      const resultado = MAPA_RESULTADO_LOTE[lote.estado];
      const eventos = await buscarEventosPorCorrelacao({ grupoId, sessaoId: lote.sessao_id, operacaoId: lote.operacao_id });

      return jsonResponse({
        outcome: "success",
        tipo: "lote",
        resumo: {
          clienteNome: filhosRaw[0]?.cliente_nome ?? "—",
          telefone: lote.telefone,
          qtdAcessos: filhosRaw.length,
          valorFormatado: formatarValorBRL(lote.valor_total_centavos),
          resultado,
          estadoBruto: lote.estado,
          criadoEm: lote.criado_em,
          quandoFormatado: formatarDataHoraBr(lote.criado_em),
        },
        ids: { tokenId: null, grupoId: lote.grupo_id, operacaoId: lote.operacao_id },
        filhos: filhosRaw.map((f) => ({
          tokenId: f.id,
          servidorNome: f.servidor_nome,
          planoNome: f.plano_nome,
          tipo: f.tipo,
          estado: f.estado,
          resultado: MAPA_RESULTADO_TOKEN[f.estado],
          vencimentoFormatado: f.vencimento_confirmado ? formatarDataHoraBr(f.vencimento_confirmado) : null,
          motivoFalha: f.motivo_falha,
        })),
        eventos,
      });
    }

    const token = await buscarTokenPorId(tokenId!);
    if (!token) return jsonResponse({ outcome: "nao_encontrado" }, 404);

    const resultado = MAPA_RESULTADO_TOKEN[token.estado];
    const eventos = await buscarEventosPorCorrelacao({ tokenId: token.id, sessaoId: token.sessao_id, operacaoId: token.operacao_id });

    return jsonResponse({
      outcome: "success",
      tipo: "avulsa",
      resumo: {
        clienteNome: token.cliente_nome,
        telefone: token.telefone,
        servidor: token.servidor_nome,
        plano: token.plano_nome,
        qtdAcessos: 1,
        valorFormatado: formatarValorBRL(token.valor_esperado_centavos),
        resultado,
        estadoBruto: token.estado,
        criadoEm: token.criado_em,
        quandoFormatado: formatarDataHoraBr(token.criado_em),
        vencimentoFormatado: token.vencimento_confirmado ? formatarDataHoraBr(token.vencimento_confirmado) : null,
        motivoFalha: token.motivo_falha,
      },
      ids: { tokenId: token.id, grupoId: null, operacaoId: token.operacao_id },
      filhos: null,
      eventos,
    });
  } catch (erro) {
    console.error("[renovacao-eventos-detalhe] falha ao buscar detalhe", erro instanceof Error ? erro.message : erro);
    return jsonResponse({ outcome: "unavailable" }, 503);
  }
});
