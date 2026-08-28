// Fake de _shared/openpix_client.ts -- comportamento configuravel de
// criarCobrancaOpenPix (usado pra forcar o Ponto A: falha ao criar
// cobranca apos ACEITO).
export const chamadas = [];

let comportamentoCriar = () => ({
  outcome: "success",
  transactionId: "fake-tx-" + Math.random().toString(16).slice(2),
  qrCodeTexto: "00020101-fake-qr",
  paymentLinkUrl: "https://openpix.com.br/pay/fake-link",
});

export function configurarCriar(fn) {
  comportamentoCriar = fn;
}

export function resetar() {
  chamadas.length = 0;
  comportamentoCriar = () => ({
    outcome: "success",
    transactionId: "fake-tx-" + Math.random().toString(16).slice(2),
    qrCodeTexto: "00020101-fake-qr",
    paymentLinkUrl: "https://openpix.com.br/pay/fake-link",
  });
}

export async function criarCobrancaOpenPix(operacaoId, valorCentavos, descricao) {
  chamadas.push({ operacaoId, valorCentavos, descricao });
  return comportamentoCriar();
}

export async function consultarCobrancaOpenPix() {
  return { outcome: "success", status: "COMPLETED", amountCentavos: 3500 };
}
