// Textos/config fixos enviados pelo Orquestrador -- nunca gerados
// pelo Gemini nesse momento (Componente 1 §16/§16-A, inovatv_central
// CLAUDE.md, aprovado 2026-08-16).
export const MENSAGEM_TRANSFERENCIA_CLIENTE =
  "🔔 Vou encaminhar seu atendimento para um de nossos atendentes. Em breve, alguém continuará o atendimento por aqui.";

// Aviso ao José (Componente 1 §16-A) -- Message Template submetido a'
// Meta em 2026-08-16, ainda "Em analise" no momento desta escrita.
// Corpo aprovado: "🔔 Nova transferência\nMotivo: {{1}}\nAcesse a
// Interface de Atendimento para assumir a conversa."
export const NOME_TEMPLATE_NOVA_TRANSFERENCIA = "nova_transferencia_humana";
export const IDIOMA_TEMPLATE_NOVA_TRANSFERENCIA = "pt_BR";

// Confirmacao de pagamento/renovacao -- Message Template aprovado pela
// Meta em 2026-08-22 (segunda POC da substituicao do RocketZap, ver
// docs/renovacao_automatica/levantamentos/2026-08-22_desenho_substituicao_rocketzap.md
// deste repositorio -- migrado de inovatv_meta_business_agent em 2026-08-23).
// Corpo aprovado (4 variaveis, sem {VALOR} -- deixado de fora
// deliberadamente desta rodada, nao reenviar/alterar o template por
// causa disso):
// "✅ Pagamento confirmado!\n\nOlá,{{1}}! Sua renovação foi registrada
// com sucesso.\n\n📋 Plano:{{2}}\n🖥️ Servidor:{{3}}\n📅 Novo
// vencimento:{{4}}\n\nQualquer dúvida, estamos à disposição.\nInovaTV
// — Sempre pensando em você! 📺"
export const NOME_TEMPLATE_PAGAMENTO_CONFIRMADO = "pagamento_confirmado";
export const IDIOMA_TEMPLATE_PAGAMENTO_CONFIRMADO = "pt_BR";

// Memoria de sessao (Camada 3, 2026-08-23) -- mensagem fixa, nunca
// gerada pelo Gemini, enviada quando o cliente volta depois de mais
// de 1h de inatividade e a sessao anterior e' encerrada/reiniciada.
// Texto aprovado pelo usuario como referencia de UX, reproduzido aqui
// sem alteracao.
export const MENSAGEM_SESSAO_EXPIRADA =
  "Vi que você ficou um tempo ausente. Como nossa sessão ficou inativa por mais de 1 hora, o contexto anterior foi encerrado para começarmos novamente com segurança. Pode me dizer como posso ajudá-lo?";

// Valor real do plano -- parsing centralizado aqui (2026-08-23, Bloco 1
// do fluxo de renovacao com PagBank real). O campo `valor` do Rocket
// chega em formato variavel (numero ou texto, com virgula ou ponto) --
// parseValorReais normaliza pra um numero em reais; retorna null
// (nunca 0/inventado) quando o dado nao e' um numero positivo valido.
// formatarValorBRL (exibicao) e paraCentavos (payload do PagBank, que
// exige o valor em centavos/inteiro) reaproveitam o mesmo parsing --
// nunca duas logicas de conversao divergentes.
export function parseValorReais(valorBruto: string | number | null | undefined): number | null {
  if (valorBruto === null || valorBruto === undefined) return null;
  const texto = String(valorBruto).trim().replace(",", ".");
  const numero = Number(texto);
  if (!Number.isFinite(numero) || numero <= 0) return null;
  return numero;
}

export function formatarValorBRL(valorBruto: string | number | null | undefined): string | null {
  const numero = parseValorReais(valorBruto);
  if (numero === null) return null;
  return numero.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function paraCentavos(valorBruto: string | number | null | undefined): number | null {
  const numero = parseValorReais(valorBruto);
  if (numero === null) return null;
  return Math.round(numero * 100);
}

// Bloco 1 do fluxo de renovacao com PagBank real (2026-08-23,
// docs/renovacao_automatica/PLANO_MESTRE_IMPLEMENTACAO.md, Lacuna 8).
// Duas mensagens fixas, nunca geradas pelo Gemini -- substituem
// integralmente a orientacao GENERICA de Pix implementada em 23/08
// ("faca um Pix pra nossa chave e envie o comprovante"), que nunca
// vinculava o pagamento a uma cobranca real.
//
// Mensagem 1 -- confirmacao neutra, enviada ANTES de qualquer chamada
// externa (Rocket/PagBank) -- nunca afirma que a cobranca ja existe.
export const MENSAGEM_PREPARANDO_PAGAMENTO_RENOVACAO =
  "Certo! Vou preparar seu pagamento via Pix. Só um momento...";

// Mensagem 2 -- so' enviada DEPOIS que a cobranca real existe (valor e
// codigo Pix vem sempre de dado real: valorFormatado do Rocket,
// codigoPix do PagBank -- nunca inventados). Reforca que a renovacao
// so' e' confirmada depois que o PagBank reconhecer o pagamento (duas
// confirmacoes, nunca uma so).
export function montarMensagemPixRenovacao(
  valorFormatado: string,
  codigoPix: string,
): string {
  return [
    `Pronto! Aqui está o Pix para renovar seu plano: R$ ${valorFormatado}`,
    "",
    codigoPix,
    "",
    "Assim que o pagamento for confirmado, vou te avisar por aqui.",
  ].join("\n");
}

// Bloco 2 (2026-08-24, inovatv_central/CLAUDE.md) -- ACEITO passa a
// acontecer ANTES da cobranca existir (inversao de ordem aprovada
// explicitamente). Mensagem 1 do fluxo novo: buscar os dados reais no
// Rocket pra apresentar (nome/servidor/plano/valor/vencimento), antes
// de qualquer cobranca ser criada. Substitui, NESTE ponto do fluxo, a
// antiga MENSAGEM_PREPARANDO_PAGAMENTO_RENOVACAO -- que continua
// existindo e sendo usada, sem alteracao, no ponto em que sempre foi
// usada (logo apos o ACEITO, antes de criar a cobranca OpenPix).
export const MENSAGEM_BUSCANDO_DADOS_RENOVACAO =
  "Só um momento, vou buscar os dados da sua renovação...";

// Mensagem 2 do fluxo novo -- so' enviada depois que o token existe de
// verdade (dados reais do Rocket, nunca inventados). Apresenta os
// dados pro cliente conferir e o link de confirmacao (ACEITO/CANCELAR).
// Nunca afirma que a cobranca ja existe -- ela so' e' criada DEPOIS do
// clique em ACEITO.
export function montarMensagemLinkConfirmacaoRenovacao(dados: {
  clienteNome: string;
  servidorNome: string;
  planoNome: string;
  valorFormatado: string;
  vencimentoFormatado: string;
  urlConfirmacao: string;
}): string {
  return [
    "Aqui estão os dados da sua renovação, confira antes de confirmar:",
    "",
    `👤 Cliente: ${dados.clienteNome}`,
    `🖥️ Servidor: ${dados.servidorNome}`,
    `📋 Plano: ${dados.planoNome}`,
    `💰 Valor: R$ ${dados.valorFormatado}`,
    `📅 Vencimento atual: ${dados.vencimentoFormatado}`,
    "",
    "Pra confirmar ou cancelar, acesse o link abaixo:",
    dados.urlConfirmacao,
  ].join("\n");
}

export const MENSAGEM_CANCELAMENTO_RENOVACAO =
  "Ok, cancelado! Se quiser renovar depois, é só me chamar novamente.";

// Reaproveitada quando ja existe uma solicitacao ATIVA pro mesmo
// acesso (tokens_renovacao_ativo_unico_por_acesso_idx) -- nunca cria
// uma segunda, so' lembra o cliente do que ja esta em andamento.
export const MENSAGEM_JA_EXISTE_SOLICITACAO_RENOVACAO =
  "Você já tem uma renovação em andamento para este acesso. Se ainda não confirmou, procure o link que te mandei há pouco -- se precisar, é só pedir de novo que eu reenvio.";
