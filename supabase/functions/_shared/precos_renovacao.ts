// Precificacao da renovacao em lote.
//
// NAO existe regra comercial de lote: nao ha' valor fixo, nao ha'
// desconto, nao ha' constante. O valor de cada acesso incluido no lote
// e' EXATAMENTE o valor real daquele acesso no Rocket (campo `valor`,
// aqui ja convertido para centavos pelo chamador). O total e' a SOMA
// dos valores dos acessos -- nada e' recalculado.
//
//   30 + 30 -> 60      35 + 35 -> 70      30 + 50 -> 80
//
// Isso vale para 2 acessos e para qualquer quantidade futura: a funcao
// nao conhece N, so' soma o que recebe. IMPORTANTE: o resolvedor
// generalizar N>=2 NAO significa que o lote e' oferecido para 3+
// acessos -- a operacao de lote continua limitada a EXATAMENTE 2
// acessos por um gate no Orquestrador (`acessosLote.length !== 2`),
// nao aqui.
//
// `resolverPrecoLote` retorna null apenas quando NAO da' pra montar um
// total confiavel -- menos de 2 acessos, ou algum acesso sem valor
// real (Rocket devolveu vazio/invalido). Nesse caso o Orquestrador cai
// no fallback de pedir 1 acesso; nunca inventa um valor.
//
// O valor da renovacao AVULSA (1 acesso) continua vindo do cadastro
// (Rocket `valor`) por outro caminho -- este modulo so' cuida do lote.

export interface AcessoLote {
  tipo: "sigma" | "unitv";
  servidorNome: string | null;
  planoNome: string | null;
  // Valor real do acesso no Rocket, em centavos (parseValorReais +
  // paraCentavos no chamador). null/<=0 quando o Rocket nao devolveu
  // um valor utilizavel para esse acesso.
  valorCentavos: number | null;
}

export interface PrecoLoteResolvido {
  // Valor real de cada acesso, na MESMA ordem de `acessos`.
  valorPorAcessoCentavos: number[];
  // Soma exata dos valores acima -- nunca recalculada.
  totalCentavos: number;
  // Rotulo interno de auditoria/log -- NUNCA enviado ao cliente.
  regraAplicada: string;
}

function valorUtilizavel(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}

export function resolverPrecoLote(acessos: AcessoLote[]): PrecoLoteResolvido | null {
  if (acessos.length < 2) return null;

  const valorPorAcessoCentavos: number[] = [];
  for (const acesso of acessos) {
    if (!valorUtilizavel(acesso.valorCentavos)) return null;
    valorPorAcessoCentavos.push(acesso.valorCentavos);
  }

  const totalCentavos = valorPorAcessoCentavos.reduce((soma, v) => soma + v, 0);

  return {
    valorPorAcessoCentavos,
    totalCentavos,
    regraAplicada: "soma_valores_rocket",
  };
}
