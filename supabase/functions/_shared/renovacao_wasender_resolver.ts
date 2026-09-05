// Adaptador de confirmacao de renovacao para o canal WasenderAPI (LAB).
//
// Opcao C aprovada (inovatv_central CLAUDE.md, investigacao 2026-09-04):
// reaproveita DIRETAMENTE renovacoes_lote/tokens_renovacao como fonte de
// verdade -- nenhuma coluna nova, nenhuma tabela nova, nenhuma migration,
// nenhuma RPC nova. Este modulo so LE e traduz; NUNCA decide estado de
// negocio, NUNCA escreve, NUNCA chama confirmarRenovacao() diretamente --
// produz o MESMO contrato {telefone, buttonReplyId} que
// renovacao-confirmar/index.ts ja aceita hoje (identico ao que
// webhook/index.ts -- Meta -- ja monta a partir de interactive.button_reply),
// para ser encaminhado pelo MESMO caminho HTTP interno, sem duplicar
// nenhuma linha de _shared/renovacao_confirmacao.ts.
//
// Regra de resolucao de candidato (aprovada, nunca adivinha):
//   candidatos = (renovacoes_lote WHERE telefone=? AND estado='aguardando_confirmacao')
//              U (tokens_renovacao WHERE telefone=? AND estado='aguardando_confirmacao'
//                                   AND grupo_id IS NULL)
//   0 candidatos  -> nao roteia (webhook, no futuro, deixa seguir pro Orquestrador)
//   1 candidato   -> ver regra de digito/palavra abaixo
//   2+ candidatos -> NUNCA escolhe sozinho, NUNCA transfere pra humano
//                    (decisao de produto 2026-09-04: renovacao e' 100%
//                    automatica) -- apresenta as opcoes numeradas e exige
//                    RESPOSTA COMPOSTA (numero + ACEITO/CANCELAR) numa
//                    UNICA mensagem (ver "REGRA DEFINITIVA" abaixo).
//
// Um lote conta como UM UNICO candidato, independente da quantidade de
// filhos (tokens_renovacao.grupo_id != null) -- os filhos nunca aparecem
// na consulta de "individuais" por causa do filtro "grupo_id IS NULL", e
// a identidade da confirmacao do lote e' sempre o token_hash da propria
// linha-capa (renovacoes_lote.token_hash), nunca o de um filho (achado da
// investigacao: os token_hash dos filhos sao aleatorios e nunca usados
// para lookup -- ver _shared/renovacoes_lote.ts::criarRenovacaoLote).
//
// Deliberadamente NAO filtra por expira_em aqui -- a validade/expiracao
// de um token/lote e' responsabilidade exclusiva de
// _shared/renovacao_confirmacao.ts (expirarSeVencido/expirarLoteSeVencido),
// que ja roda downstream quando o buttonReplyId produzido aqui for
// encaminhado a renovacao-confirmar. Filtrar aqui duplicaria essa logica.
//
// ---------------------------------------------------------------------
// REGRA DEFINITIVA (decisao de produto, 2026-09-04) -- RESPOSTA COMPOSTA,
// SUPERA E SUBSTITUI a decisao anterior "selecionar posicao = ACEITO".
//
// Investigacao anterior mostrou que uma etapa intermediaria (identificar
// a renovacao numa mensagem, decidir ACEITO/CANCELAR na proxima) exige
// lembrar "qual foi escolhida" entre duas mensagens -- e nenhum mecanismo
// existente (acesso_selecionado, intencao_atual, mensagens_conversa/
// buscarUltimaMensagemIa) cobre isso com seguranca total pros dois tipos
// de candidato (individual + lote) sem efeito colateral ou risco de
// perda (mensagem de ruido no meio apaga a ancora).
//
// A resposta COMPOSTA elimina o problema inteiro: posicao E acao chegam
// na MESMA mensagem, resolvidos numa UNICA consulta, sem nenhum estado
// entre mensagens -- por isso NENHUM dos mecanismos acima (acesso_
// selecionado, intencao_atual, mensagens_conversa/buscarUltimaMensagemIa)
// e' usado nem necessario para o caso de 2+ candidatos.
//
// Formato estrito: <numero> <acao>, nesta ordem, separados por
// whitespace, vocabulario de acao restrito a EXATAMENTE "aceito"/
// "cancelar" (apos trim + lowercase) -- nunca "aceitar"/"cancelamento"/
// frases livres/"sim"/"nao". Protecao contra colisao com a selecao
// numerica do Orquestrador: uma resposta composta NUNCA e' uma string
// formada so' por digitos (sempre tem a palavra de acao junto), entao
// NUNCA bate no padrao /^\s*([1-9]\d*)\s*$/ que o Orquestrador usa pra
// reconhecer selecao de acesso -- protecao estrutural, nao uma checagem
// extra de intencao_atual (por isso este caminho NAO precisa consultar
// conversas_estado.intencao_atual, diferente do caso "candidato unico").
//
// Digito puro ("1", "2", ...) em contexto de 2+ candidatos: NAO
// intercepta (decisao explicita, "nao inventar comportamento novo") --
// cai como resposta_nao_reconhecida, deixando o Orquestrador livre pra
// interpretar (ou nao) do jeito que ja faz hoje, sem nenhuma interferencia
// deste modulo.
// ---------------------------------------------------------------------

import { getServiceClient } from "./supabase_client.ts";
import { normalizarTelefone } from "./telefone.ts";
import type { TokenRenovacao } from "./tokens_renovacao.ts";
import { buscarFilhosDoLote, type RenovacaoLote } from "./renovacoes_lote.ts";
import type { ConversaEstado } from "./types.ts";
import { formatarValorBRL, formatarVencimentoConsulta } from "./mensagens_fixas.ts";

// ---------------------------------------------------------------------
// Deteccao deterministica da resposta SIMPLES do cliente (usada so' no
// caso "candidato unico", regra 2 -- inalterada). SEM Gemini, SEM IA,
// SEM aproximacao -- so' os 4 literais exatos (apos trim + lowercase),
// mesma disciplina estrita ja usada em
// _shared/comando_atendimento.ts::detectarComandoAtendimento (#humano/#ia).
// Deliberadamente NAO remove pontuacao final -- "1." ou "ACEITO!" NAO
// casam. MANTIDA EXATAMENTE COMO ESTA (decisao explicita do usuario).
// ---------------------------------------------------------------------
export type AcaoConfirmacaoTexto = "aceitar" | "cancelar";

const RESPOSTAS_ACEITAR: ReadonlySet<string> = new Set(["1", "aceito"]);
const RESPOSTAS_CANCELAR: ReadonlySet<string> = new Set(["2", "cancelar"]);

export function detectarRespostaConfirmacaoRenovacao(
  texto: string | null | undefined,
): AcaoConfirmacaoTexto | null {
  if (typeof texto !== "string") return null;
  const normalizado = texto.trim().toLowerCase();
  if (RESPOSTAS_ACEITAR.has(normalizado)) return "aceitar";
  if (RESPOSTAS_CANCELAR.has(normalizado)) return "cancelar";
  return null;
}

// Verdadeiro so quando a resposta reconhecida veio de um DIGITO ("1"/"2"),
// nunca de uma palavra ("aceito"/"cancelar") -- usado so' para decidir
// quando a protecao extra de intencao_atual se aplica (regra 2 aprovada,
// caso "candidato unico"). Palavra nao precisa dessa checagem (nunca
// colide com o Orquestrador, que so reconhece digito puro).
function ehRespostaPorDigito(texto: string): boolean {
  const t = texto.trim().toLowerCase();
  return t === "1" || t === "2";
}

// ---------------------------------------------------------------------
// Deteccao de RESPOSTA COMPOSTA (2+ candidatos) -- formato estrito
// "<numero> <acao>". Vocabulario de acao EXATAMENTE "aceito"/"cancelar"
// (nunca "aceitar"/"cancelamento"/outras variacoes -- decisao explicita
// do usuario, nao ampliar por conta propria). Posicao: inteiro positivo
// sem zero a esquerda ([1-9]\d*, mesmo padrao ja usado em
// orchestrator/index.ts::numeroSecoSelecaoConsulta para o mesmo tipo de
// validacao -- reaproveita o PADRAO, nao a logica, este modulo continua
// sem nenhuma dependencia do Orquestrador). Separador: um ou mais
// espacos/whitespace ENTRE numero e acao -- nunca hifen, virgula, ou
// texto extra depois da acao (ancorado com $ apos trim).
//
// Rejeita corretamente, por construcao (nao por caso especial):
//   "0 aceito" / "-1 aceito"  -> [1-9] nunca casa 0 nem "-"
//   "1 aceitar" / "1 cancelamento" -> so' aceito|cancelar no vocabulario
//   "aceito 1" (ordem invertida) -> precisa comecar com o numero
//   "1 - ACEITO" / "1, ACEITO"    -> separador precisa ser so' whitespace
//   "1 ACEITO por favor"          -> ancorado no fim ($), nada depois
// ---------------------------------------------------------------------
export type ConfirmacaoComposta = { posicao: number; acao: AcaoConfirmacaoTexto };

const REGEX_CONFIRMACAO_COMPOSTA = /^([1-9]\d*)\s+(aceito|cancelar)$/;

export function detectarConfirmacaoComposta(
  texto: string | null | undefined,
): ConfirmacaoComposta | null {
  if (typeof texto !== "string") return null;
  const normalizado = texto.trim().toLowerCase();
  const m = REGEX_CONFIRMACAO_COMPOSTA.exec(normalizado);
  if (!m) return null;
  return {
    posicao: Number(m[1]),
    acao: m[2] === "aceito" ? "aceitar" : "cancelar",
  };
}

// ---------------------------------------------------------------------
// Candidato pendente -- inclui criadoEm (necessario para ordenacao
// deterministica, ver ordenarCandidatosPendentes abaixo).
// ---------------------------------------------------------------------
export type CandidatoPendente =
  | {
      tipo: "lote";
      grupoId: string;
      tokenHash: string;
      conversationId: string;
      criadoEm: string;
      valorTotalCentavos: number;
    }
  | {
      tipo: "individual";
      tokenHash: string;
      conversationId: string;
      publicId: string | null;
      criadoEm: string;
      clienteNome: string;
      servidorNome: string;
      planoNome: string;
      valorEsperadoCentavos: number;
      vencimentoAtual: string;
    };

// Busca CRUA dos candidatos (sem ordenar, sem aplicar a regra de
// contagem) -- extraida para ser reaproveitada tanto por
// resolverCandidatoPendente() (que so precisa contar/identificar) quanto
// pelo fluxo de apresentacao/resolucao de posicao (que precisa da lista
// ordenada completa). Nao duplica a consulta -- e' a MESMA consulta,
// reutilizada.
async function buscarCandidatosPendentes(telefone: string): Promise<CandidatoPendente[]> {
  const client = getServiceClient();

  const { data: lotesData, error: erroLotes } = await client
    .from("renovacoes_lote")
    .select("*")
    .eq("telefone", telefone)
    .eq("estado", "aguardando_confirmacao");
  if (erroLotes) throw erroLotes;

  const { data: individuaisData, error: erroIndividuais } = await client
    .from("tokens_renovacao")
    .select("*")
    .eq("telefone", telefone)
    .eq("estado", "aguardando_confirmacao")
    .is("grupo_id", null);
  if (erroIndividuais) throw erroIndividuais;

  const candidatosLote: CandidatoPendente[] = ((lotesData as RenovacaoLote[]) ?? []).map((l) => ({
    tipo: "lote" as const,
    grupoId: l.grupo_id,
    tokenHash: l.token_hash,
    conversationId: l.conversation_id,
    criadoEm: l.criado_em,
    valorTotalCentavos: l.valor_total_centavos,
  }));

  const candidatosIndividuais: CandidatoPendente[] = ((individuaisData as TokenRenovacao[]) ?? []).map(
    (t) => ({
      tipo: "individual" as const,
      tokenHash: t.token_hash,
      conversationId: t.conversation_id,
      publicId: t.public_id,
      criadoEm: t.criado_em,
      clienteNome: t.cliente_nome,
      servidorNome: t.servidor_nome,
      planoNome: t.plano_nome,
      valorEsperadoCentavos: t.valor_esperado_centavos,
      vencimentoAtual: t.vencimento_atual,
    }),
  );

  return [...candidatosLote, ...candidatosIndividuais];
}

// Ordenacao DETERMINISTICA -- criterio principal: criado_em, ascendente
// (o mais antigo primeiro vira "1"). Criterio de desempate: token_hash
// (asc) -- VERIFICADO no schema real (nao inventado): tokens_renovacao.
// token_hash e' "text not null unique" (migration 20260824130000) e
// renovacoes_lote.token_hash tambem e' "unique" (migration 20260829120000)
// -- ja' e' um campo unico e estavel disponivel nos dois tipos de
// candidato, sem precisar de nenhum campo novo. Funcao PURA (sem I/O),
// chamada identicamente tanto para montar a lista apresentada quanto
// para resolver a resposta composta -- garante que a posicao N signifique
// sempre o mesmo candidato, enquanto o CONJUNTO de candidatos nao mudar.
export function ordenarCandidatosPendentes(
  candidatos: CandidatoPendente[],
): CandidatoPendente[] {
  return [...candidatos].sort((a, b) => {
    const ta = new Date(a.criadoEm).getTime();
    const tb = new Date(b.criadoEm).getTime();
    if (ta !== tb) return ta - tb;
    return a.tokenHash.localeCompare(b.tokenHash);
  });
}

export type ResolucaoCandidato =
  | { outcome: "sem_pendencia" }
  | { outcome: "candidato_unico"; candidato: CandidatoPendente }
  | { outcome: "ambiguo"; quantidade: number; candidatos: CandidatoPendente[] };

export async function resolverCandidatoPendente(telefoneBruto: string): Promise<ResolucaoCandidato> {
  const telefone = normalizarTelefone(telefoneBruto);
  const candidatos = await buscarCandidatosPendentes(telefone);

  if (candidatos.length === 0) return { outcome: "sem_pendencia" };
  if (candidatos.length === 1) return { outcome: "candidato_unico", candidato: candidatos[0] };

  const ordenados = ordenarCandidatosPendentes(candidatos);
  return { outcome: "ambiguo", quantidade: ordenados.length, candidatos: ordenados };
}

// ---------------------------------------------------------------------
// Leitura de conversas_estado.intencao_atual -- protecao contra colisao
// com a selecao numerica do Orquestrador, usada SOMENTE no caso
// "candidato unico" + digito (regra 2, inalterada). O caminho de resposta
// composta (2+ candidatos) NAO usa esta funcao -- nao precisa, porque a
// resposta composta nunca e' uma string so' de digitos (protecao
// estrutural, ver comentario no topo do arquivo). So' LEITURA -- nunca
// escreve, nunca chama nenhuma RPC.
// ---------------------------------------------------------------------
async function intencaoAtualEhRenovacao(telefone: string): Promise<boolean> {
  const client = getServiceClient();
  const { data, error } = await client
    .from("conversas_estado")
    .select("*")
    .eq("telefone", telefone);
  if (error) throw error;
  const linha = ((data as ConversaEstado[]) ?? [])[0];
  return linha?.intencao_atual === "renovacao";
}

// ---------------------------------------------------------------------
// Apresentacao de multiplas renovacoes pendentes -- FUNCAO NOVA, isolada
// neste modulo (nao em _shared/mensagens_fixas.ts). Motivo, documentado
// conforme exigido:
//   - montarMensagemMultiplosAcessosRenovacao (mensagens_fixas.ts) exige
//     campo `usuario`, que NAO existe em tokens_renovacao -- reuso
//     literal e' impossivel sem inventar dado; alem disso, sua semantica
//     e' "qual acesso voce quer RENOVAR" (fase ANTES de existir token),
//     nao "qual das suas renovacoes JA PENDENTES e' essa" (fase DEPOIS).
//   - montarMensagemConfirmacaoLote e' uma confirmacao de UM UNICO lote
//     ("toque em ACEITO"/"CANCELAR" para ESTE lote) -- nao modela "este e'
//     um item de N, escolha um numero", nem mistura lote+individual na
//     mesma lista.
//   - Nenhuma das duas cobre o caso MISTO (candidatos individuais e de
//     lote juntos na mesma lista), que e' exatamente o que este modulo
//     precisa apresentar.
// Reaproveita, sim, os formatadores puros ja existentes
// (formatarValorBRL, formatarVencimentoConsulta) -- nada de logica de
// formatacao duplicada. Mensagens existentes em mensagens_fixas.ts NAO
// foram alteradas. Instrucao final orienta EXPLICITAMENTE o formato
// composto exigido (regra definitiva, 2026-09-04).
// ---------------------------------------------------------------------
async function descreverCandidato(candidato: CandidatoPendente): Promise<string> {
  if (candidato.tipo === "individual") {
    const valor = formatarValorBRL(candidato.valorEsperadoCentavos / 100) ?? "não informado";
    const vencimento = formatarVencimentoConsulta(candidato.vencimentoAtual);
    return [
      `🖥️ Servidor: ${candidato.servidorNome}`,
      `📦 Plano: ${candidato.planoNome}`,
      `📅 Vencimento: ${vencimento}`,
      `💰 Valor: R$ ${valor}`,
    ].join("\n");
  }

  // Lote: servidor/plano vivem nos filhos (buscarFilhosDoLote, ja
  // existente -- reaproveitado, nunca reimplementado).
  const filhos = await buscarFilhosDoLote(candidato.grupoId);
  const servidores = filhos.map((f) => f.servidor_nome).filter(Boolean).join(" + ");
  const valorTotal = formatarValorBRL(candidato.valorTotalCentavos / 100) ?? "não informado";
  return [
    `🖥️ Renovação em lote (${filhos.length} acessos): ${servidores || "detalhes indisponíveis"}`,
    `💰 Valor total: R$ ${valorTotal}`,
  ].join("\n");
}

export async function montarMensagemEscolhaRenovacoesPendentes(
  candidatosOrdenados: CandidatoPendente[],
): Promise<string> {
  const blocos = await Promise.all(
    candidatosOrdenados.map(async (c, indice) => {
      const descricao = await descreverCandidato(c);
      return [`*${indice + 1}.*`, descricao].join("\n");
    }),
  );
  return [
    "📋 *Você tem mais de uma renovação pendente*",
    "",
    blocos.join("\n\n"),
    "",
    "Responda numa única mensagem com o número da renovação seguido de ACEITO ou CANCELAR.",
    "",
    "Exemplo: *1 ACEITO* ou *2 CANCELAR*",
  ].join("\n");
}

// ---------------------------------------------------------------------
// Roteamento principal -- combina deteccao de texto + resolucao de
// candidato(s) -> {telefone, buttonReplyId} (contrato ja aceito por
// renovacao-confirmar/index.ts), OU sinaliza que e' preciso apresentar
// opcoes primeiro. NUNCA chama confirmarRenovacao() nem
// _shared/renovacao_confirmacao.ts -- so produz o payload; o
// encaminhamento HTTP fica para a integracao futura com
// webhook-wasender (fora de escopo desta etapa, NAO conectado aqui).
// ---------------------------------------------------------------------
const REGEX_TOKEN_HASH = /^[0-9a-f]{64}$/;

export type ResultadoRoteamentoConfirmacaoRenovacao =
  | { outcome: "roteado"; telefone: string; buttonReplyId: string }
  | { outcome: "sem_pendencia" }
  | { outcome: "apresentar_opcoes"; telefone: string; mensagem: string }
  | { outcome: "posicao_invalida"; telefone: string; quantidade: number }
  | { outcome: "resposta_nao_reconhecida" };

function montarButtonReplyId(acao: AcaoConfirmacaoTexto, tokenHash: string): string {
  if (!REGEX_TOKEN_HASH.test(tokenHash)) {
    // Defesa: nunca monta um buttonReplyId que a propria regex de
    // renovacao-confirmar/index.ts rejeitaria -- indica dado inesperado
    // no banco, nao uma condicao de negocio normal.
    throw new Error(
      "montarButtonReplyId: token_hash com formato inesperado (esperado 64 hex)",
    );
  }
  return `renovacao:${acao}:${tokenHash}`;
}

export async function resolverRoteamentoConfirmacaoRenovacao(
  telefoneBruto: string,
  texto: string | null | undefined,
): Promise<ResultadoRoteamentoConfirmacaoRenovacao> {
  // Deteccao de texto primeiro -- barata, sem I/O. Dois detectores
  // independentes: resposta simples (candidato unico) e resposta
  // composta (2+ candidatos). Nenhum dos dois bateu -> nunca consulta o
  // banco (mesma disciplina ja validada nas etapas anteriores).
  const acaoSimples = detectarRespostaConfirmacaoRenovacao(texto);
  const composta = detectarConfirmacaoComposta(texto);
  if (acaoSimples === null && composta === null) {
    return { outcome: "resposta_nao_reconhecida" };
  }

  const telefone = normalizarTelefone(telefoneBruto);
  const resolucao = await resolverCandidatoPendente(telefone);

  // ── 0 candidatos (regra 1) ──────────────────────────────────────────
  if (resolucao.outcome === "sem_pendencia") return { outcome: "sem_pendencia" };

  // ── exatamente 1 candidato (regra 2, inalterada) ────────────────────
  if (resolucao.outcome === "candidato_unico") {
    if (acaoSimples === null) {
      // So' a forma composta bateu (ex.: "1 ACEITO") -- nao faz sentido
      // com 1 unico candidato (nenhuma lista foi apresentada), nao
      // intercepta.
      return { outcome: "resposta_nao_reconhecida" };
    }
    if (ehRespostaPorDigito(texto as string)) {
      const confirmaIntencao = await intencaoAtualEhRenovacao(telefone);
      if (!confirmaIntencao) return { outcome: "resposta_nao_reconhecida" };
    }
    return {
      outcome: "roteado",
      telefone,
      buttonReplyId: montarButtonReplyId(acaoSimples, resolucao.candidato.tokenHash),
    };
  }

  // ── 2+ candidatos (regra 3) -- NUNCA escolhe sozinho, NUNCA transfere
  // para humano. So' resposta COMPOSTA resolve automaticamente; digito
  // puro NUNCA intercepta aqui (decisao explicita, "nao inventar
  // comportamento novo" para digito puro neste contexto). ───────────────
  const candidatos = resolucao.candidatos; // ja ordenados (ordenarCandidatosPendentes)

  if (composta !== null) {
    if (composta.posicao < 1 || composta.posicao > candidatos.length) {
      return { outcome: "posicao_invalida", telefone, quantidade: candidatos.length };
    }
    const escolhido = candidatos[composta.posicao - 1];
    return {
      outcome: "roteado",
      telefone,
      buttonReplyId: montarButtonReplyId(composta.acao, escolhido.tokenHash),
    };
  }

  // Chegou aqui: composta === null, entao so' pode ter sido acaoSimples
  // != null. Digito puro ("1"/"2") NUNCA intercepta com 2+ candidatos --
  // so' a PALAVRA ("aceito"/"cancelar") demonstra intencao clara (ainda
  // que ambigua sobre qual candidato) e aciona a apresentacao das opcoes.
  if (acaoSimples !== null && !ehRespostaPorDigito(texto as string)) {
    const mensagem = await montarMensagemEscolhaRenovacoesPendentes(candidatos);
    return { outcome: "apresentar_opcoes", telefone, mensagem };
  }

  // Digito puro solto com 2+ candidatos -- nao intercepta (mesmo
  // espirito de "nao inventar comportamento novo pra digito puro").
  return { outcome: "resposta_nao_reconhecida" };
}
