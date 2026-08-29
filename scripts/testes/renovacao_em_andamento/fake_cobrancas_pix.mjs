import { registrar } from "./_seq.mjs";

const BASE_REGISTRO = {
  operacao_id: "op",
  conversation_id: "conv-1",
  public_id: "pub-1",
  grupo_id: null,
  servidor_nome: "Sigma",
  plano_nome: "Mensal",
  valor_esperado_centavos: 7000,
  transaction_id_provedor: "tx-1",
  qr_code_texto: "qr",
  status: "pendente",
  criado_em: "2026-08-29T00:00:00Z",
  atualizado_em: "2026-08-29T00:00:00Z",
};

let registro = { ...BASE_REGISTRO };
let retornoPaga = { ...BASE_REGISTRO, status: "pago", grupo_id: null };
let retornoDivergente = { ...BASE_REGISTRO, status: "valor_divergente" };
let chamadas = [];

export function configurarRegistro(patch) { registro = patch === null ? null : { ...BASE_REGISTRO, ...patch }; }
export function configurarRetornoPaga(v) { retornoPaga = v; }
export function configurarRetornoDivergente(v) { retornoDivergente = v; }
export function chamadasFeitas() { return chamadas; }
export function resetar() {
  registro = { ...BASE_REGISTRO };
  retornoPaga = { ...BASE_REGISTRO, status: "pago", grupo_id: null };
  retornoDivergente = { ...BASE_REGISTRO, status: "valor_divergente" };
  chamadas = [];
}

export async function buscarCobrancaPorOperacaoId(operacaoId) {
  chamadas.push({ fn: "buscar", operacaoId });
  return registro;
}
export async function marcarCobrancaComoPaga(operacaoId) {
  chamadas.push({ fn: "marcarPaga", operacaoId });
  registrar("marcarCobrancaComoPaga");
  return retornoPaga;
}
export async function marcarCobrancaComoDivergente(operacaoId) {
  chamadas.push({ fn: "marcarDivergente", operacaoId });
  registrar("marcarCobrancaComoDivergente");
  return retornoDivergente;
}
