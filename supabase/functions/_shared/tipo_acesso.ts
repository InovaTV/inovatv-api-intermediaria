// Classificacao Sigma x UniTV de um acesso, a partir do nome do
// servidor do cadastro (Rocket) -- Etapa 1.5 (2026-08-28,
// inovatv_central/CLAUDE.md, "Lacuna A").
//
// Ate a Etapa 2 da UniTV NAO existe um campo de "tipo" real no
// /status/ do Rocket -- o unico sinal disponivel e' o servidorNome.
// Esta heuristica e' deliberadamente CONSERVADORA:
//   - so' classifica como 'unitv' quando o servidor e' reconhecidamente
//     UniTV (nome do servidor == "UNITV", tolerando espaco/hifen/ponto);
//   - qualquer outro servidor (ou ausente) e' 'sigma' -- o fluxo Sigma
//     ja existe e e' o caminho seguro/testado.
// Motivo da assimetria: um UniTV classificado como 'sigma' por engano
// levaria a cobranca + tentativa de renovacao Sigma numa conta que nao
// e' Sigma (erro grave). Um Sigma classificado como 'unitv' por engano
// so' bloqueia uma renovacao valida (chato, nunca perigoso).
//
// SERVIDORES_UNITV e' o ponto de extensao: se surgirem outras grafias
// de servidor UniTV no cadastro, adicionar aqui (comparadas ja
// normalizadas -- maiuscula, sem acento, sem espaco/hifen/ponto/_).

export type TipoAcesso = "sigma" | "unitv";

const SERVIDORES_UNITV = new Set(["UNITV"]);

function normalizarServidor(servidorNome: string | null | undefined): string {
  return (servidorNome ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remove acentos (marcas diacriticas combinantes)
    .toUpperCase()
    .replace(/[\s.\-_]+/g, "");
}

export function classificarTipoAcesso(servidorNome: string | null | undefined): TipoAcesso {
  return SERVIDORES_UNITV.has(normalizarServidor(servidorNome)) ? "unitv" : "sigma";
}
