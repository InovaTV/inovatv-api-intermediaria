// Fake de _shared/renovacao_confirmacao.ts -- usado SO' pelos testes da
// etapa=confirmar (Checkpoint 4C). confirmarRenovacao() ja e' testada a
// fundo em scripts/testes/vinculo_operacao_renovacao/ e
// scripts/testes/notificacao_transferencia_humana/ (97+24 testes,
// cobrindo aceite/cancelamento/falha de cobranca/lote/etc contra fakes
// reais de OpenPix/WhatsApp/Supabase) -- nao faz sentido duplicar aquela
// bateria aqui. Este teste cobre so' a fronteira: renovacao-iniciar
// chama confirmarRenovacao() com os parametros certos e traduz cada
// outcome pro HTML certo.
export const chamadas = [];

let resposta = {
  outcome: "confirmada",
  operacaoId: "op-fake-1",
  brCode: "00020101-brcode-fake",
  paymentLinkUrl: "https://openpix.com.br/pay/fake-link",
};

export function configurar(nova) {
  resposta = nova;
}
export function resetar() {
  chamadas.length = 0;
  resposta = {
    outcome: "confirmada",
    operacaoId: "op-fake-1",
    brCode: "00020101-brcode-fake",
    paymentLinkUrl: "https://openpix.com.br/pay/fake-link",
  };
}

export async function confirmarRenovacao(params) {
  chamadas.push(params);
  return resposta;
}
