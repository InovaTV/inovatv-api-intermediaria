// Intervalo minimo de seguranca entre 2 envios de WhatsApp em sequencia
// rapida para o MESMO destinatario.
//
// Achado real (homologacao 2026-09-05, com dinheiro de verdade,
// NEXT_SESSION.md): com a opcao "Account Protection" da sessao Wasender
// ativa, o 2o envio rapido (menos de ~5s depois do 1o) para o mesmo
// cliente foi bloqueado -- na ocasiao, a correcao foi desabilitar a
// protecao. Este helper existe para permitir manter a protecao ATIVA:
// da uma folga deliberada, acima do limiar conhecido, exatamente nos
// pontos do codigo que enviam 2 mensagens em sequencia pro mesmo
// cliente (hoje: orchestrator/index.ts, antes da proposta interativa
// ACEITO/CANCELAR; _shared/renovacao_confirmacao.ts, antes do link de
// pagamento Pix -- individual e em lote).
//
// Nao e' usado em nenhum outro envio -- os demais pontos do codigo so
// mandam 1 mensagem por vez pro mesmo cliente na mesma execucao, sem
// esse risco especifico.
export const INTERVALO_SEGURO_ENTRE_ENVIOS_MS = 15000;

export async function aguardarIntervaloSeguroEntreEnvios(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, INTERVALO_SEGURO_ENTRE_ENVIOS_MS));
}
