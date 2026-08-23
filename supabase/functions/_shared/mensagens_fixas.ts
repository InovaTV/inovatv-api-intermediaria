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

// Orientacao de pagamento apos renovacao confirmada (2026-08-23,
// fechamento do "buraco sem saida" apos intencao_atual+acesso_selecionado
// -- achado de teste real). Diferente das constantes acima, esta e'
// TEMPLATIZADA (parametros reais do cliente/acesso) -- nunca uma string
// fixa solta -- mas segue a MESMA disciplina: nunca gerada pelo Gemini,
// o valor vem sempre de dado real (Rocket, via /status), nunca inventado.
// Isolamento estrito preservado (Plano Mestre, Etapa 1b): NAO cria
// cobranca PagBank, NAO gera token, NAO chama Sigma/Rocket, NAO informa
// chave/QR Pix especifico -- so' orienta o cliente a pagar e mandar o
// comprovante NESTA conversa, cuja conferencia e' etapa futura separada
// (webhook de midia, ainda nao implementado).
//
// formatarValorBRL: o campo `valor` do Rocket chega em formato variavel
// (numero ou texto, com virgula ou ponto) -- normaliza pra um numero e
// formata como moeda brasileira. Retorna null (nunca "R$ 0,00" nem
// qualquer valor inventado) quando o dado nao e' um numero positivo
// valido -- o chamador (orchestrator/index.ts) trata null como "valor
// nao disponivel" e transfere pra humano, nunca envia uma orientacao de
// pagamento sem valor real.
export function formatarValorBRL(valorBruto: string | number | null | undefined): string | null {
  if (valorBruto === null || valorBruto === undefined) return null;
  const texto = String(valorBruto).trim().replace(",", ".");
  const numero = Number(texto);
  if (!Number.isFinite(numero) || numero <= 0) return null;
  return numero.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function montarMensagemOrientacaoPagamentoRenovacao(
  nomeAcesso: string,
  servidorNome: string,
  planoNome: string,
  valorFormatado: string,
): string {
  return [
    `Perfeito! Vamos renovar o acesso "${nomeAcesso}", do servidor ${servidorNome}, no plano ${planoNome}.`,
    "",
    `O valor da renovação é R$ ${valorFormatado}.`,
    "",
    "Para realizar a renovação, faça o pagamento via PIX e envie o comprovante aqui nesta conversa. Assim que recebermos o comprovante, faremos a conferência.",
  ].join("\n");
}
