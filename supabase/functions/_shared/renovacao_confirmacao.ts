// Regra de negocio compartilhada da confirmacao de renovacao. As bordas
// HTTP (pagina HTML legada e webhook WhatsApp) so validam sua entrada e
// traduzem o resultado; a transicao atomica e os efeitos ficam aqui.
import {
  buscarTokenPorHash,
  expirarSeVencido,
  reivindicarAceite,
  reivindicarCancelamento,
  vincularOperacaoAoToken,
  marcarAutorizacaoComoFalha,
} from "./tokens_renovacao.ts";
import { criarCobrancaOpenPix } from "./openpix_client.ts";
import { criarCobrancaPixRegistro } from "./cobrancas_pix.ts";
import { enviarMensagemWhatsApp } from "./whatsapp_client.ts";
import { acionarTransferenciaHumana } from "./conversas_estado.ts";
import { inserirMensagem } from "./mensagens_atendimento.ts";
import {
  formatarValorBRL,
  montarMensagemPixRenovacao,
  MENSAGEM_CANCELAMENTO_RENOVACAO,
  MENSAGEM_PREPARANDO_PAGAMENTO_RENOVACAO,
} from "./mensagens_fixas.ts";

export type AcaoConfirmacaoRenovacao = "aceitar" | "cancelar";
export type ResultadoConfirmacaoRenovacao =
  | { outcome: "confirmada" }
  | { outcome: "cancelada" }
  | { outcome: "token_inexistente" | "token_expirado" | "ja_decidido" | "telefone_nao_confere" }
  | { outcome: "falha_cobranca" };

export async function confirmarRenovacao(params: {
  tokenHash: string;
  acao: AcaoConfirmacaoRenovacao;
  telefoneOrigem?: string;
  origem: "link" | "whatsapp";
}): Promise<ResultadoConfirmacaoRenovacao> {
  let token = await buscarTokenPorHash(params.tokenHash);
  if (!token) return { outcome: "token_inexistente" };

  token = await expirarSeVencido(token);
  if (token.estado === "expirada") return { outcome: "token_expirado" };
  if (token.estado !== "aguardando_confirmacao") return { outcome: "ja_decidido" };
  if (params.telefoneOrigem && token.telefone !== params.telefoneOrigem) {
    return { outcome: "telefone_nao_confere" };
  }

  const sufixoOrigem = params.origem === "whatsapp" ? "pelo botao do WhatsApp" : "pelo link";
  if (params.acao === "cancelar") {
    const cancelado = await reivindicarCancelamento(params.tokenHash);
    if (!cancelado) return { outcome: "ja_decidido" };
    await inserirMensagem(cancelado.conversation_id, "sistema", `Cliente cancelou a renovacao ${sufixoOrigem}.`, null).catch(() => {});
    const envio = await enviarMensagemWhatsApp(cancelado.telefone, MENSAGEM_CANCELAMENTO_RENOVACAO);
    if (envio.outcome === "success") {
      await inserirMensagem(cancelado.conversation_id, "ia", MENSAGEM_CANCELAMENTO_RENOVACAO, null).catch(() => {});
    }
    return { outcome: "cancelada" };
  }

  const autorizado = await reivindicarAceite(params.tokenHash);
  if (!autorizado) return { outcome: "ja_decidido" };
  await inserirMensagem(autorizado.conversation_id, "sistema", `Cliente confirmou (ACEITO) a renovacao ${sufixoOrigem}.`, null).catch(() => {});

  const preparando = await enviarMensagemWhatsApp(autorizado.telefone, MENSAGEM_PREPARANDO_PAGAMENTO_RENOVACAO);
  if (preparando.outcome === "success") {
    await inserirMensagem(autorizado.conversation_id, "ia", MENSAGEM_PREPARANDO_PAGAMENTO_RENOVACAO, null).catch(() => {});
  }

  const operacaoId = crypto.randomUUID();
  const descricaoItem = `Renovacao InovaTV - Plano ${autorizado.plano_nome}`.trim();
  const cobranca = await criarCobrancaOpenPix(operacaoId, autorizado.valor_esperado_centavos, descricaoItem);
  if (cobranca.outcome !== "success") {
    await acionarTransferenciaHumana(autorizado.conversation_id, "renovacao:falha_criar_cobranca_apos_aceite", "(cliente confirmou ACEITO)", "").catch(() => {});
    await marcarAutorizacaoComoFalha(autorizado.id, "renovacao:falha_criar_cobranca_apos_aceite").catch((erro) => {
      console.log("[renovacao_confirmacao] falha ao liberar token apos falha de cobranca", JSON.stringify({ tokenId: autorizado.id, erro: String(erro) }));
    });
    return { outcome: "falha_cobranca" };
  }

  // Ordem corrigida (achado real, homologacao 27/08/2026):
  // tokens_renovacao.operacao_id referencia cobrancas_pix(operacao_id)
  // via foreign key -- a linha em cobrancas_pix precisa existir ANTES
  // do vinculo, nunca depois. A ordem antiga (vincular primeiro) violava
  // essa FK sempre, sem excecao, e a falha ficava engolida por um
  // .catch() best-effort -- o cliente recebia o Pix normalmente, mas
  // o pagamento nunca conseguia avancar sozinho (openpix-webhook nunca
  // encontrava o token, porque operacao_id nunca era gravado).
  await criarCobrancaPixRegistro({
    operacaoId,
    conversationId: autorizado.conversation_id,
    publicId: autorizado.public_id,
    servidorNome: autorizado.servidor_nome,
    planoNome: autorizado.plano_nome,
    valorEsperadoCentavos: autorizado.valor_esperado_centavos,
    transactionIdProvedor: cobranca.transactionId,
    qrCodeTexto: cobranca.qrCodeTexto,
  }).catch((erro) => {
    console.log("[renovacao_confirmacao] falha ao persistir cobranca_pix", JSON.stringify({ operacaoId, transactionId: cobranca.transactionId, erro: String(erro) }));
  });

  // Vinculo tratado como condicao FATAL, nunca best-effort -- sem ele,
  // o pagamento fica orfao (openpix-webhook nunca encontra o token pra
  // avancar a renovacao), e isso so seria descoberto manualmente. Se
  // criarCobrancaPixRegistro falhou acima, esta chamada tambem falha
  // (a FK segue sem satisfazer) -- mesmo caminho de falha cobre os
  // dois casos, sem duplicar tratamento.
  try {
    await vincularOperacaoAoToken(autorizado.id, operacaoId);
  } catch (erro) {
    console.log(
      "[renovacao_confirmacao] falha fatal ao vincular operacao ao token -- pagamento ficaria orfao sem esta transferencia",
      JSON.stringify({ tokenId: autorizado.id, operacaoId, erro: String(erro) }),
    );
    await acionarTransferenciaHumana(
      autorizado.conversation_id,
      "renovacao:falha_vincular_operacao_token",
      "(cliente confirmou ACEITO)",
      "",
    ).catch(() => {});
    await marcarAutorizacaoComoFalha(autorizado.id, "renovacao:falha_vincular_operacao_token").catch((erro2) => {
      console.log(
        "[renovacao_confirmacao] falha ao liberar token apos falha de vinculo",
        JSON.stringify({ tokenId: autorizado.id, erro: String(erro2) }),
      );
    });
    return { outcome: "falha_cobranca" };
  }

  const valor = formatarValorBRL(autorizado.valor_esperado_centavos / 100) ?? "0,00";
  const textoPix = montarMensagemPixRenovacao(valor, cobranca.qrCodeTexto);
  const envioPix = await enviarMensagemWhatsApp(autorizado.telefone, textoPix);
  if (envioPix.outcome === "success") {
    await inserirMensagem(autorizado.conversation_id, "ia", textoPix, null).catch(() => {});
  }
  return { outcome: "confirmada" };
}
