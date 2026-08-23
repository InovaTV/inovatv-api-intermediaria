// Extracao/checagem pura de menções a plano/servidor num texto --
// nenhuma regra de negocio, nenhuma decisao de aprovar/reprovar/
// resolver. Compartilhado por:
//   - _shared/validador.ts    -> decide se o acesso esta determinado
//                                 (checagem factual existente + nova
//                                 checagem de propor_renovacao)
//   - orchestrator/index.ts   -> resolve qual StatusResult/public_id
//                                 corresponde, para o diagnostico da
//                                 Etapa 1
// Cada um chama as funcoes deste modulo de forma INDEPENDENTE e faz
// sua propria correlacao contra o proprio array de acessos -- nunca
// um reaproveitando o resultado interno do outro (Componente 4 §5: o
// Validador nunca decide dado de negocio, so' aprova/reprova).
//
// DUAS funcoes, dois propositos DIFERENTES -- nao confundir:
//
// 1. extrairRotulosAcesso(texto) -- reconhece SO' o formato rotulado
//    "Plano: X"/"Servidor: X", com dois-pontos literais. Usada pela
//    checagem PRE-EXISTENTE validarPlanoServidorRotulado (conferir se
//    uma resposta que ECOA dados estruturados, no mesmo vocabulario
//    de contexto.ts, bate com o contexto real) -- nao relacionada a
//    propor_renovacao, comportamento inalterado por este arquivo.
//
// 2. nomeApareceComoPalavra(texto, nome) -- achado real do Caso 1
//    (execucao no numero de teste, 23/08/2026,
//    docs/propor_renovacao/ACHADO_CASO1_RESOLUCAO_ACESSO.md, secao 6,
//    contrato aprovado pelo usuario): quando o Gemini CONFIRMA a
//    intencao de renovar em linguagem natural ("no servidor NewOne",
//    "meu NewOne"), ele nao ecoa um rotulo -- narra. Reaproveitar
//    extrairRotulosAcesso() para essa checagem reprovava casos onde a
//    intencao foi corretamente reconhecida, so' porque o texto nao
//    tinha o formato "Servidor: X" literal. Usada exclusivamente pela
//    determinacao de acesso do propor_renovacao (Validador:
//    validarPropostaRenovacao; Orquestrador: resolverAcessoRenovacao)
//    -- contrato fechado: SO' o nome do SERVIDOR, como palavra/token
//    inteiro (nunca substring), determina o acesso -- em qualquer
//    forma de mencao (rotulado, com ou sem a palavra "servidor", com
//    ou sem dois-pontos). Nome de PLANO isolado nunca determina
//    sozinho (protege deliberadamente o Caso 9 -- "Quero trocar meu
//    Mensal pelo anual" nao pode ser lido como identificacao de
//    acesso so' por conter "Mensal").

export interface RotulosExtraidos {
  // Normalizados (minusculo), sem duplicatas, ordem de aparicao no
  // texto. Vazio (nao null) quando nenhum rotulo daquele tipo foi
  // encontrado -- nunca inventa um valor.
  planos: string[];
  servidores: string[];
}

const REGEX_PLANO_ROTULADO = /(?:^|\s)plano\s*:\s*([A-Za-zÀ-ÿ0-9]+)/gi;
const REGEX_SERVIDOR_ROTULADO = /(?:^|\s)servidor\s*:\s*([A-Za-zÀ-ÿ0-9]+)/gi;

function extrairValoresUnicos(texto: string, regex: RegExp): string[] {
  const vistos = new Set<string>();
  for (const m of texto.matchAll(regex)) {
    vistos.add(m[1].toLowerCase());
  }
  return [...vistos];
}

// Usada so' por validarPlanoServidorRotulado (checagem pre-existente,
// nao relacionada a propor_renovacao) -- ver nota acima.
export function extrairRotulosAcesso(texto: string): RotulosExtraidos {
  return {
    planos: extrairValoresUnicos(texto, REGEX_PLANO_ROTULADO),
    servidores: extrairValoresUnicos(texto, REGEX_SERVIDOR_ROTULADO),
  };
}

function escaparRegex(valor: string): string {
  return valor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Confirma se `nome` aparece em `texto` como palavra/token inteiro --
// delimitado por \b nos dois lados, NUNCA como substring de outra
// palavra (mesmo tipo de bug ja corrigido antes neste projeto no
// Componente 2, "correspondencia por token, nao por substring" --
// "trava" batendo dentro de "travando"). Case-insensitive. `nome`
// vazio/undefined nunca "aparece" (nunca inventa correspondencia).
export function nomeApareceComoPalavra(texto: string, nome: string): boolean {
  if (!nome) return false;
  const regex = new RegExp(`\\b${escaparRegex(nome)}\\b`, "i");
  return regex.test(texto);
}
