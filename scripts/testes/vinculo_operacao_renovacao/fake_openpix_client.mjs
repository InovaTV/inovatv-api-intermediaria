// Fake de _shared/openpix_client.ts -- registra chamadas, comportamento
// configuravel por teste (sempre sucesso por padrao).
export const chamadas = { criarCobrancaOpenPix: [], consultarCobrancaOpenPix: [] };

let comportamento = {
  criar: () => ({
    outcome: "success",
    transactionId: "fake-tx-" + Math.random().toString(16).slice(2),
    qrCodeTexto: "00020101-fake-qr",
  }),
  consultar: () => ({ outcome: "success", status: "COMPLETED", amountCentavos: 3500 }),
};

export function configurar(novo) {
  comportamento = { ...comportamento, ...novo };
}

export function resetarConfiguracao() {
  comportamento = {
    criar: () => ({
      outcome: "success",
      transactionId: "fake-tx-" + Math.random().toString(16).slice(2),
      qrCodeTexto: "00020101-fake-qr",
    }),
    consultar: () => ({ outcome: "success", status: "COMPLETED", amountCentavos: 3500 }),
  };
  chamadas.criarCobrancaOpenPix.length = 0;
  chamadas.consultarCobrancaOpenPix.length = 0;
}

export async function criarCobrancaOpenPix(operacaoId, valorCentavos, descricao) {
  chamadas.criarCobrancaOpenPix.push({ operacaoId, valorCentavos, descricao });
  return comportamento.criar(operacaoId, valorCentavos, descricao);
}

export async function consultarCobrancaOpenPix(correlationId) {
  chamadas.consultarCobrancaOpenPix.push({ correlationId });
  return comportamento.consultar(correlationId);
}
