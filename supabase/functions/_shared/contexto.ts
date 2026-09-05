// Monta o contexto minimo em texto enviado ao Gemini. Surface
// DELIBERADAMENTE apenas nome, plano, servidor, vencimento e telas
// (lista fixa em camposCliente abaixo) -- nunca senha nem device_key,
// que nunca existem na resposta real do /status (Componente 1 §7,
// inovatv_central). O /status hoje tambem devolve `valor` (2026-08-28)
// e `usuario` (Etapa 2, Bloco 2), mas nenhum dos dois entra no contexto
// do Gemini: sao usados so' pelo Orquestrador (lista de multiplos
// acessos / resolucao de conta UniTV), fora do prompt congelado.
// Telefone vem de quem chama (e' o identificador da propria conversa,
// nao um campo do /status).
//
// O bloco de um unico acesso reproduz literalmente o formato real
// testado no Componente 1 §12 (recuperado de
// scratchpad/teste_ia/case1_body.json): rotulo "[DADOS CONECTADOS -
// CLIENTE]", "Telefone:" em linha propria, demais campos separados
// por " · " numa linha. Os campos do teste original que nao existem
// na allowlist real (Usuario/Valor/App/Dispositivo) foram omitidos,
// nao inventados. O formato de multiplos acessos nunca foi testado
// com corpo literal salvo -- extensao deliberada, mais proxima
// possivel do estilo confirmado, nao uma reconstrucao livre.

import type { StatusResult } from "./rocket_intermediaria.ts";

function camposCliente(status: StatusResult): string {
  const c = status.cliente;
  if (status.outcome !== "success" || status.linkState !== "linked" || !c) {
    return "Nao foi possivel consultar os dados deste acesso agora.";
  }

  return [
    `Nome: ${c.nome ?? "nao informado"}`,
    `Plano: ${c.planoNome ?? "nao informado"}`,
    `Servidor: ${c.servidorNome ?? "nao informado"}`,
    `Vencimento: ${c.vencimento ?? "nao informado"}`,
    `Telas: ${c.telas ?? "nao informado"}`,
  ].join(" · ");
}

export function montarContextoCliente(
  telefone: string,
  statusResults: StatusResult[],
  opts: { matchIndisponivel?: boolean; acessoSelecionadoPublicId?: string | null } = {},
): string | null {
  if (opts.matchIndisponivel) {
    return [
      "[DADOS CONECTADOS - CLIENTE]",
      `Telefone: ${telefone}`,
      "Nao foi possivel consultar os dados do cliente agora (falha de comunicacao com o sistema de cadastro). Isso NAO significa que o cliente nao foi encontrado.",
    ].join("\n");
  }

  if (statusResults.length === 0) return null;

  // Selecao de acesso em conversa NORMAL (plano Selecao de acesso,
  // secao 4-C, inovatv-wasender-lab). Quando o cliente ja escolheu um
  // acesso (por numero na lista, ou nomeando o servidor) e esse acesso
  // existe no conjunto atual, o Gemini ve SO' esse acesso -- usando
  // EXATAMENTE o formato de 1 acesso ja testado (Componente 1 §12), sem
  // formato novo. Fora disso (nenhuma selecao, ou selecao ja invalida),
  // o comportamento de N acessos e' 100% inalterado.
  const acessoSelecionado =
    opts.acessoSelecionadoPublicId != null
      ? statusResults.find(
          (s) =>
            s.publicId === opts.acessoSelecionadoPublicId &&
            s.outcome === "success" &&
            !!s.cliente,
        )
      : undefined;

  const linhas = acessoSelecionado
    ? [camposCliente(acessoSelecionado)]
    : statusResults.length === 1
      ? [camposCliente(statusResults[0])]
      : statusResults.map(
          (s, i) => `Acesso ${i + 1}/${statusResults.length}: ${camposCliente(s)}`,
        );

  return ["[DADOS CONECTADOS - CLIENTE]", `Telefone: ${telefone}`, ...linhas].join("\n");
}

// Memoria de sessao (Camada 3, 2026-08-23) -- bloco SEPARADO de
// montarContextoCliente, nunca misturado com dados oficiais. Recebe
// so o NOME DO SERVIDOR ja resolvido (nunca o public_id -- o
// Validador nao conhece, e nao precisa conhecer, o public_id, mesmo
// principio ja documentado acima pra montarContextoCliente) e ja
// reconferido pelo chamador contra o conjunto FRESCO de statusResults
// da chamada atual. Omitido inteiramente quando null -- nunca um
// bloco vazio/placeholder. A instrucao de uso vive dentro do proprio
// bloco (reforco deliberado, alem de qualquer regra geral do
// SYSTEM_PROMPT): serve so pra resolver referencia indireta ("esse
// acesso"/"ele"/"esse plano"), nunca e' fato -- os dados reais
// continuam vindo exclusivamente de [DADOS CONECTADOS - CLIENTE].
//
// intencaoRenovacaoEstabelecida (2026-08-23, extensao da Camada 3):
// mesma disciplina -- so' um sinal de continuidade conversacional,
// nunca fato, nunca decide sozinho o "tipo" da resposta (isso
// continua sendo julgamento do proprio Gemini, dentro do que o
// SYSTEM_PROMPT ja permite). Existe pra cobrir exatamente o caso em
// que a intencao de renovar foi manifestada numa mensagem anterior
// (ex.: "quero renovar meu plano", com 2+ acessos, ainda sem saber
// qual) e a mensagem atual so' resolve QUAL acesso (ex.: "2"), sem
// repetir a intencao.
// assuntoEsclarecimentoPendente (2026-09-04, caso Elias): 3o sinal de
// continuidade, mesma disciplina dos outros dois -- nunca fonte de
// fato, so' ajuda a resolver referencia. Guarda a MENSAGEM LITERAL do
// cliente que gerou o ultimo pedido de esclarecimento (nunca uma
// interpretacao da IA) -- ver esclarecimento_pendente em types.ts/
// migration 20260904200000_esclarecimento_pendente.sql. One-shot: o
// chamador (Orquestrador) e' quem garante que isto so' chega aqui
// preenchido pra' EXATAMENTE a mensagem seguinte ao pedido.
export function montarContextoConversa(
  servidorMencionadoAnteriormente: string | null,
  intencaoRenovacaoEstabelecida: boolean,
  assuntoEsclarecimentoPendente: string | null,
): string | null {
  if (
    !servidorMencionadoAnteriormente &&
    !intencaoRenovacaoEstabelecida &&
    !assuntoEsclarecimentoPendente
  ) {
    return null;
  }

  const linhas = ["[CONTEXTO DA CONVERSA]"];

  if (intencaoRenovacaoEstabelecida) {
    linhas.push(
      "Nesta conversa, o cliente já demonstrou intenção de renovar um acesso, antes desta mensagem.",
    );
  }
  if (servidorMencionadoAnteriormente) {
    linhas.push(
      `Nesta conversa, o cliente mencionou anteriormente o acesso: Servidor ${servidorMencionadoAnteriormente}.`,
    );
  }
  if (assuntoEsclarecimentoPendente) {
    linhas.push(
      `Na mensagem anterior, você pediu esclarecimento sobre esta pergunta do cliente, ` +
        `que era ampla ou ambígua: "${assuntoEsclarecimentoPendente}". Se a mensagem atual ` +
        `do cliente parecer uma resposta a isso, use-a para entender melhor o que ele quer ` +
        `— mas só se fizer sentido; se a mensagem atual claramente não tiver relação, ` +
        `ignore isto e trate como uma pergunta nova.`,
    );
  }

  linhas.push(
    'Use estas informações apenas para entender a quem "esse acesso"/"ele"/"esse plano" se refere, ou para reconhecer que uma intenção já foi manifestada, se o cliente estiver dando continuidade ao mesmo assunto. NUNCA trate isto como um fato atual, nem como confirmação de valor, plano, vencimento ou cobrança — os dados reais e atualizados de qualquer acesso já estão no bloco [DADOS CONECTADOS - CLIENTE] acima, e qualquer etapa de pagamento é tratada em outro momento, nunca aqui. Se a mensagem atual não tiver relação com isto, ignore esta informação.',
  );

  return linhas.join("\n");
}
