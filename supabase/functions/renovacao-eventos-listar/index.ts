// Painel de Monitoramento de Renovacoes (2026-09-14) -- Tela 1 (lista
// historica de tentativas). So' leitura -- nunca escreve em
// tokens_renovacao/renovacoes_lote/renovacao_eventos. Mesma disciplina
// de auth de todo o Painel (verificarOperador + service_role so' depois
// do JWT do operador validado), mesmo padrao de esqueleto de
// painel-atendimento-listar/index.ts.
//
// Conceito aprovado pelo usuario (2026-09-14): historico/diagnostico de
// TENTATIVAS de renovacao, nunca "acompanhamento ao vivo" -- por isso
// resultado e' sempre um destes 5, nunca um "processando" com conotacao
// de tempo real: ok (concluida) | falha (nao concluida) | parcial (lote)
// | cancel (cancelada/expirada) | espera (aguardando confirmacao/
// pagamento, ou renovacao_em_andamento -- estado transiente, tratado
// como "espera" pra nunca virar um 6o rotulo vivo na tela).
//
// Une tokens_renovacao (avulsa, grupo_id IS NULL) e renovacoes_lote
// (capa do lote) num unico historico ordenado por criado_em desc. Sem
// UNION no banco (schemas diferentes) -- busca um lote recente de cada
// tabela (LIMITE_BUSCA) e faz o merge/paginacao em memoria; volume real
// e' baixo (uso interno, dezenas de operacoes), entao isso e' suficiente
// sem precisar de uma view/RPC nova no banco.

import { verificarOperador, respostaNaoAutorizado } from "../_shared/auth_painel.ts";
import { jsonResponse, errorResponse, corsResponse } from "../_shared/http.ts";
import {
  listarTokensAvulsosRecentes,
  type TokenRenovacao,
  type EstadoTokenRenovacao,
} from "../_shared/tokens_renovacao.ts";
import {
  listarLotesRecentes,
  buscarFilhosDoLote,
  type RenovacaoLote,
  type EstadoRenovacaoLote,
} from "../_shared/renovacoes_lote.ts";

const LIMITE_BUSCA = 200; // por tabela, antes do merge -- ver comentario acima
const POR_PAGINA = 20;

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

// Prefixos reais ja usados em motivo_falha pelo resto do projeto
// (renovacao_confirmacao.ts, renovacao-sigma-resultado/index.ts,
// renovacao-sigma-workflow.mjs) -- so' traducao pra leitura humana,
// nunca um catalogo novo. Motivo desconhecido cai no texto cru (nunca
// escondido).
const MOTIVOS_CONHECIDOS: Record<string, string> = {
  "sigma:sessao_expirada": "Sessão Sigma expirada",
  "renovacao_sigma:falha": "Falha no processamento Sigma",
  "renovacao_sigma:sessao_expirada": "Sessão Sigma expirada",
  "renovacao_sigma:resultado_ambiguo": "Resultado ambíguo no processamento",
  "renovacao:falha_criar_cobranca_apos_aceite": "Falha ao criar cobrança Pix",
  "renovacao:falha_vincular_operacao_token": "Falha ao vincular pagamento",
  "renovacao_lote:parcial": "Lote parcialmente concluído",
  "renovacao_lote:falha_criar_cobranca_apos_aceite": "Falha ao criar cobrança Pix (lote)",
  "renovacao_lote:falha_vincular_operacao": "Falha ao vincular pagamento (lote)",
};

function humanizarMotivo(motivo: string | null): string {
  if (!motivo) return "Falha não especificada";
  return MOTIVOS_CONHECIDOS[motivo] ?? motivo;
}

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

function formatarServidores(nomes: string[]): string {
  const contagem = new Map<string, number>();
  for (const n of nomes) contagem.set(n, (contagem.get(n) ?? 0) + 1);
  return [...contagem.entries()].map(([nome, qtd]) => (qtd > 1 ? `${nome} ×${qtd}` : nome)).join(" + ");
}

interface ItemLista {
  tipo: "avulsa" | "lote";
  id: string;
  criadoEm: string;
  quandoFormatado: string;
  clienteNome: string;
  telefone: string;
  servidor: string;
  qtdAcessos: number;
  valorFormatado: string;
  resultado: Resultado;
  diagnostico: string;
  vencimentoFormatado: string | null;
}

function itemDeAvulsa(t: TokenRenovacao): ItemLista {
  const resultado = MAPA_RESULTADO_TOKEN[t.estado];
  let diagnostico = "";
  let vencimentoFormatado: string | null = null;
  if (resultado === "ok") {
    vencimentoFormatado = t.vencimento_confirmado ? formatarDataHoraBr(t.vencimento_confirmado) : null;
    diagnostico = vencimentoFormatado ? `Novo vencimento: ${vencimentoFormatado}` : "Renovação concluída";
  } else if (resultado === "falha") {
    diagnostico = `Falha — ${humanizarMotivo(t.motivo_falha)}`;
  } else if (resultado === "cancel") {
    diagnostico = t.estado === "expirada" ? "Expirada — cliente não decidiu a tempo" : "Cancelada pelo cliente";
  } else {
    diagnostico = t.estado === "renovacao_em_andamento" ? "Processamento em andamento" : "Aguardando confirmação/pagamento";
  }

  return {
    tipo: "avulsa",
    id: t.id,
    criadoEm: t.criado_em,
    quandoFormatado: formatarDataHoraBr(t.criado_em),
    clienteNome: t.cliente_nome,
    telefone: t.telefone,
    servidor: t.servidor_nome,
    qtdAcessos: 1,
    valorFormatado: formatarValorBRL(t.valor_esperado_centavos),
    resultado,
    diagnostico,
    vencimentoFormatado,
  };
}

async function itemDeLote(l: RenovacaoLote): Promise<ItemLista> {
  const resultado = MAPA_RESULTADO_LOTE[l.estado];
  const filhos = await buscarFilhosDoLote(l.grupo_id);
  const qtd = filhos.length;
  const clienteNome = filhos[0]?.cliente_nome ?? "—";
  const servidor = qtd > 0 ? formatarServidores(filhos.map((f) => f.servidor_nome)) : "—";

  let diagnostico = "";
  if (resultado === "ok") {
    diagnostico = `Todos os ${qtd} acessos renovados`;
  } else if (resultado === "parcial") {
    const concluidos = filhos.filter((f) => f.estado === "renovacao_concluida").length;
    diagnostico = `${concluidos} de ${qtd} acessos concluídos`;
  } else if (resultado === "falha") {
    diagnostico = "Nenhum acesso do lote foi concluído";
  } else if (resultado === "cancel") {
    diagnostico = l.estado === "expirada" ? "Expirada — cliente não decidiu a tempo" : "Cancelada pelo cliente";
  } else {
    diagnostico = l.estado === "renovacao_em_andamento" ? "Processamento em andamento" : "Aguardando confirmação/pagamento";
  }

  return {
    tipo: "lote",
    id: l.grupo_id,
    criadoEm: l.criado_em,
    quandoFormatado: formatarDataHoraBr(l.criado_em),
    clienteNome,
    telefone: l.telefone,
    servidor,
    qtdAcessos: qtd,
    valorFormatado: formatarValorBRL(l.valor_total_centavos),
    resultado,
    diagnostico,
    vencimentoFormatado: null, // lote nao tem 1 vencimento unico -- ver diagnostico
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsResponse();
  if (req.method !== "GET") return errorResponse("Metodo nao suportado, use GET", 405);

  const auth = await verificarOperador(req);
  if (!auth.autorizado) return respostaNaoAutorizado(auth.motivo);

  const url = new URL(req.url);
  const paginaParam = url.searchParams.get("pagina") ?? "1";
  const pagina = Number(paginaParam);
  if (!Number.isInteger(pagina) || pagina < 1) {
    return errorResponse("Parametro 'pagina' invalido", 400);
  }
  const resultadoParam = url.searchParams.get("resultado");
  const RESULTADOS_VALIDOS: Resultado[] = ["ok", "falha", "parcial", "cancel", "espera"];
  if (resultadoParam && !RESULTADOS_VALIDOS.includes(resultadoParam as Resultado)) {
    return errorResponse(`Parametro 'resultado' invalido (use um de: ${RESULTADOS_VALIDOS.join(", ")})`, 400);
  }

  try {
    const [avulsas, lotes] = await Promise.all([
      listarTokensAvulsosRecentes(LIMITE_BUSCA),
      listarLotesRecentes(LIMITE_BUSCA),
    ]);

    // Merge leve so' com o necessario pra ordenar/filtrar/paginar -- os
    // campos ricos (servidor/diagnostico/filhos) so' sao calculados
    // DEPOIS de saber quais itens realmente entram na pagina pedida.
    // resultado ja' entra aqui (derivado so' do estado, sem query nova)
    // pra o filtro por resultado funcionar corretamente ATRAVES da
    // paginacao -- nunca so' dentro da pagina atual.
    type Leve = { criadoEm: string; tipo: "avulsa" | "lote"; resultado: Resultado; origem: TokenRenovacao | RenovacaoLote };
    const leves: Leve[] = [
      ...avulsas.map((t) => ({ criadoEm: t.criado_em, tipo: "avulsa" as const, resultado: MAPA_RESULTADO_TOKEN[t.estado], origem: t })),
      ...lotes.map((l) => ({ criadoEm: l.criado_em, tipo: "lote" as const, resultado: MAPA_RESULTADO_LOTE[l.estado], origem: l })),
    ];
    // Contagens por resultado -- SEMPRE sobre o conjunto inteiro (nunca
    // so' a pagina atual), pra alimentar os pills de filtro sem um
    // 2o fetch. Calculado antes do filtro por resultado ser aplicado.
    const contagens: Record<Resultado, number> = { ok: 0, falha: 0, parcial: 0, cancel: 0, espera: 0 };
    for (const l of leves) contagens[l.resultado]++;

    const filtrados = resultadoParam ? leves.filter((l) => l.resultado === resultadoParam) : leves;
    filtrados.sort((a, b) => (a.criadoEm < b.criadoEm ? 1 : a.criadoEm > b.criadoEm ? -1 : 0));

    const total = filtrados.length;
    const de = (pagina - 1) * POR_PAGINA;
    const fatia = filtrados.slice(de, de + POR_PAGINA);

    const itens = await Promise.all(
      fatia.map((l) => (l.tipo === "avulsa" ? itemDeAvulsa(l.origem as TokenRenovacao) : itemDeLote(l.origem as RenovacaoLote))),
    );

    return jsonResponse({ outcome: "success", pagina, total, totalGeral: leves.length, contagens, itens });
  } catch (erro) {
    console.error("[renovacao-eventos-listar] falha ao listar", erro instanceof Error ? erro.message : erro);
    return jsonResponse(
      { outcome: "unavailable", pagina, total: 0, totalGeral: 0, contagens: { ok: 0, falha: 0, parcial: 0, cancel: 0, espera: 0 }, itens: [] },
      503,
    );
  }
});
