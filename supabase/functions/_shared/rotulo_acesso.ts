// Extracao pura de rotulos de plano/servidor citados num texto --
// nenhuma regra de negocio, nenhuma decisao de aprovar/reprovar/
// resolver (docs/propor_renovacao/LEVANTAMENTO_ETAPA1.md, secao 3,
// aprovado pelo usuario). Compartilhado por:
//   - _shared/validador.ts    -> decide se o acesso esta determinado
//                                 (checagem factual existente + nova
//                                 checagem de propor_renovacao)
//   - orchestrator/index.ts   -> resolve qual StatusResult/public_id
//                                 corresponde, para o diagnostico da
//                                 Etapa 1
// Cada um chama esta funcao de forma INDEPENDENTE e faz sua propria
// correlacao contra o proprio array de acessos -- nunca um
// reaproveitando o resultado interno do outro (Componente 4 §5: o
// Validador nunca decide dado de negocio, so' aprova/reprova).
//
// Mesmas regexes que ja existiam, privadas, dentro de validador.ts
// (usadas por validarPlanoServidorRotulado) -- movidas pra ca pra
// nao duplicar a definicao em dois arquivos (risco real de
// divergencia silenciosa, mesmo tipo de achado ja registrado antes
// neste projeto para CORS duplicado). Formato reconhecido ("Plano:
// X"/"Servidor: X") e' o mesmo vocabulario que o proprio contexto usa
// (contexto.ts, camposCliente) e ja observado em producao
// (inovatv_central/CLAUDE.md, "MARCO -- Componente 3...", resposta
// real: "1) Servidor: ChannelTV, Plano: Mensal...").

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

export function extrairRotulosAcesso(texto: string): RotulosExtraidos {
  return {
    planos: extrairValoresUnicos(texto, REGEX_PLANO_ROTULADO),
    servidores: extrairValoresUnicos(texto, REGEX_SERVIDOR_ROTULADO),
  };
}
