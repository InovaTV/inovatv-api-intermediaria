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
