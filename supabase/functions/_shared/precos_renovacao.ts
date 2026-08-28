// Regras COMERCIAIS INTERNAS de precificacao de renovacao em lote
// (Etapa 1, 2026-08-29). NUNCA aparecem para o cliente -- ele ve so' o
// valor final por acesso e o total. Nenhuma mensagem cita "promocao",
// "desconto" ou a regra.
//
// Cada regra descreve uma combinacao de acessos e o valor resultante.
// Adicionar uma regra nova = adicionar uma entrada aqui, sem refatorar
// o fluxo. `resolverPrecoLote` retorna null quando nenhuma regra casa
// -- nesse caso o lote nao e' oferecido (o Orquestrador cai no fluxo
// avulso / pede pra escolher 1 acesso).
//
// O valor da renovacao AVULSA (1 acesso) continua vindo do cadastro
// (Rocket `valor`) -- este modulo so' cuida do lote.

export interface AcessoLote {
  tipo: "sigma" | "unitv";
  servidorNome: string | null;
  planoNome: string | null;
}

export interface PrecoLoteResolvido {
  // Um valor por acesso, na MESMA ordem de `acessos`. Permite valores
  // diferentes por acesso numa regra futura.
  valorPorAcessoCentavos: number[];
  totalCentavos: number;
  // Rotulo interno de auditoria/log -- NUNCA enviado ao cliente.
  regraAplicada: string;
}

export function resolverPrecoLote(acessos: AcessoLote[]): PrecoLoteResolvido | null {
  const n = acessos.length;

  // Regra 1 (2026-08-29): exatamente 2 acessos -> R$ 30,00 cada.
  if (n === 2) {
    return {
      valorPorAcessoCentavos: [3000, 3000],
      totalCentavos: 6000,
      regraAplicada: "lote_2_acessos_30",
    };
  }

  // (regras futuras -- outras combinacoes / N / servidores / valores
  //  por acesso diferentes -- entram aqui)

  return null;
}
