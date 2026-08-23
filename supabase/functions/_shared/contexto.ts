// Monta o contexto minimo em texto enviado ao Gemini. So entra o que
// /status realmente devolve (nome, vencimento, planoNome,
// servidorNome, telas) -- nunca senha nem device_key, que nunca
// existem na resposta real do /status (Componente 1 §7,
// inovatv_central). Telefone vem de quem chama (e' o identificador da
// propria conversa, nao um campo do /status).
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
  opts: { matchIndisponivel?: boolean } = {},
): string | null {
  if (opts.matchIndisponivel) {
    return [
      "[DADOS CONECTADOS - CLIENTE]",
      `Telefone: ${telefone}`,
      "Nao foi possivel consultar os dados do cliente agora (falha de comunicacao com o sistema de cadastro). Isso NAO significa que o cliente nao foi encontrado.",
    ].join("\n");
  }

  if (statusResults.length === 0) return null;

  const linhas =
    statusResults.length === 1
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
export function montarContextoConversa(
  servidorMencionadoAnteriormente: string | null,
): string | null {
  if (!servidorMencionadoAnteriormente) return null;

  return [
    "[CONTEXTO DA CONVERSA]",
    `Nesta conversa, o cliente mencionou anteriormente o acesso: Servidor ${servidorMencionadoAnteriormente}.`,
    'Use esta informação apenas para entender a quem "esse acesso"/"ele"/"esse plano" se refere, se o cliente usar uma referência indireta. NUNCA trate isto como um fato atual — os dados reais e atualizados deste acesso já estão no bloco [DADOS CONECTADOS - CLIENTE] acima.',
  ].join("\n");
}
