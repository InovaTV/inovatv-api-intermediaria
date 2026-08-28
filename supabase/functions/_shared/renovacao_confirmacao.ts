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
import {
  buscarLotePorTokenHash,
  expirarLoteSeVencido,
  reivindicarAceiteLote,
  reivindicarCancelamentoLote,
  vincularOperacaoAoLote,
  marcarLoteComoFalha,
  buscarFilhosDoLote,
  type RenovacaoLote,
} from "./renovacoes_lote.ts";
import { criarCobrancaOpenPix } from "./openpix_client.ts";
import { criarCobrancaPixRegistro } from "./cobrancas_pix.ts";
import { enviarMensagemWhatsApp } from "./whatsapp_client.ts";
import { acionarTransferenciaHumana } from "./conversas_estado.ts";
import { notificarTransferenciaHumana } from "./notificacao_transferencia.ts";
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
  // Renovacao em lote (Etapa 1, 2026-08-29): o tokenHash pode ser de um
  // renovacoes_lote (1 botao para N acessos) em vez de um token
  // individual. Todo o resto do fluxo individual abaixo segue
  // exatamente como estava.
  const lote = await buscarLotePorTokenHash(params.tokenHash);
  if (lote) return await confirmarRenovacaoLote(lote, params);

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
    const motivoFalha = "renovacao:falha_criar_cobranca_apos_aceite";
    let transferenciaAcionada = false;
    try {
      const resultado = await acionarTransferenciaHumana(autorizado.conversation_id, motivoFalha, "(cliente confirmou ACEITO)", "");
      transferenciaAcionada = resultado.outcome === "acionada";
    } catch (erro) {
      console.log("[renovacao_confirmacao] falha ao registrar transferencia (falha de cobranca)", JSON.stringify({ erro: String(erro) }));
    }
    await notificarTransferenciaHumana(autorizado.telefone, motivoFalha, transferenciaAcionada, autorizado.conversation_id);
    await marcarAutorizacaoComoFalha(autorizado.id, motivoFalha).catch((erro) => {
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
    const motivoFalha = "renovacao:falha_vincular_operacao_token";
    let transferenciaAcionada = false;
    try {
      const resultado = await acionarTransferenciaHumana(autorizado.conversation_id, motivoFalha, "(cliente confirmou ACEITO)", "");
      transferenciaAcionada = resultado.outcome === "acionada";
    } catch (erro2) {
      console.log("[renovacao_confirmacao] falha ao registrar transferencia (falha de vinculo)", JSON.stringify({ erro: String(erro2) }));
    }
    await notificarTransferenciaHumana(autorizado.telefone, motivoFalha, transferenciaAcionada, autorizado.conversation_id);
    await marcarAutorizacaoComoFalha(autorizado.id, motivoFalha).catch((erro3) => {
      console.log(
        "[renovacao_confirmacao] falha ao liberar token apos falha de vinculo",
        JSON.stringify({ tokenId: autorizado.id, erro: String(erro3) }),
      );
    });
    return { outcome: "falha_cobranca" };
  }

  const valor = formatarValorBRL(autorizado.valor_esperado_centavos / 100) ?? "0,00";
  // UX de renovacao (2026-08-28): a mensagem do Pix passa a levar o
  // LINK da pagina de pagamento hospedada pela Woovi -- nunca mais o BR
  // Code no corpo. O BR Code (cobranca.qrCodeTexto) continua sendo
  // gravado em cobrancas_pix acima, so' nao vai ao WhatsApp. plano_nome
  // ja esta no token (reivindicarAceite), sem consulta nova.
  const textoPix = montarMensagemPixRenovacao(valor, `Plano: ${autorizado.plano_nome}`, cobranca.paymentLinkUrl);
  const envioPix = await enviarMensagemWhatsApp(autorizado.telefone, textoPix);
  if (envioPix.outcome === "success") {
    await inserirMensagem(autorizado.conversation_id, "ia", textoPix, null).catch(() => {});
  }
  return { outcome: "confirmada" };
}

// ---------------------------------------------------------------------
// Renovacao em lote (Etapa 1, 2026-08-29). Mesma disciplina do
// individual: ACEITO atomico (RPC) -> 1 cobranca pelo TOTAL -> mensagem
// Pix com o link. A execucao Sigma/UniTV de cada acesso acontece
// depois, disparada pelo openpix-webhook. Cada filho (tokens_renovacao)
// tem seu proprio estado; aqui so' levamos ate o Pix.
// ---------------------------------------------------------------------
async function confirmarRenovacaoLote(
  loteInicial: RenovacaoLote,
  params: {
    tokenHash: string;
    acao: AcaoConfirmacaoRenovacao;
    telefoneOrigem?: string;
    origem: "link" | "whatsapp";
  },
): Promise<ResultadoConfirmacaoRenovacao> {
  const lote = await expirarLoteSeVencido(loteInicial);
  if (lote.estado === "expirada") return { outcome: "token_expirado" };
  if (lote.estado !== "aguardando_confirmacao") return { outcome: "ja_decidido" };
  if (params.telefoneOrigem && lote.telefone !== params.telefoneOrigem) {
    return { outcome: "telefone_nao_confere" };
  }

  const sufixoOrigem = params.origem === "whatsapp" ? "pelo botao do WhatsApp" : "pelo link";

  if (params.acao === "cancelar") {
    const cancelado = await reivindicarCancelamentoLote(params.tokenHash);
    if (!cancelado) return { outcome: "ja_decidido" };
    await inserirMensagem(cancelado.conversation_id, "sistema", `Cliente cancelou a renovacao em lote ${sufixoOrigem}.`, null).catch(() => {});
    const envio = await enviarMensagemWhatsApp(cancelado.telefone, MENSAGEM_CANCELAMENTO_RENOVACAO);
    if (envio.outcome === "success") {
      await inserirMensagem(cancelado.conversation_id, "ia", MENSAGEM_CANCELAMENTO_RENOVACAO, null).catch(() => {});
    }
    return { outcome: "cancelada" };
  }

  const autorizado = await reivindicarAceiteLote(params.tokenHash);
  if (!autorizado) return { outcome: "ja_decidido" };
  await inserirMensagem(autorizado.conversation_id, "sistema", `Cliente confirmou (ACEITO) a renovacao em lote ${sufixoOrigem}.`, null).catch(() => {});

  const preparando = await enviarMensagemWhatsApp(autorizado.telefone, MENSAGEM_PREPARANDO_PAGAMENTO_RENOVACAO);
  if (preparando.outcome === "success") {
    await inserirMensagem(autorizado.conversation_id, "ia", MENSAGEM_PREPARANDO_PAGAMENTO_RENOVACAO, null).catch(() => {});
  }

  const filhos = await buscarFilhosDoLote(autorizado.grupo_id);
  const qtd = filhos.length;

  const operacaoId = crypto.randomUUID();
  const descricaoItem = `Renovacao InovaTV - ${qtd} acessos`;
  const cobranca = await criarCobrancaOpenPix(operacaoId, autorizado.valor_total_centavos, descricaoItem);
  if (cobranca.outcome !== "success") {
    await tratarFalhaLote(autorizado.grupo_id, autorizado.conversation_id, autorizado.telefone, "renovacao_lote:falha_criar_cobranca_apos_aceite");
    return { outcome: "falha_cobranca" };
  }

  // Mesma ordem do individual: linha em cobrancas_pix ANTES do vinculo
  // (FK renovacoes_lote.operacao_id -> cobrancas_pix.operacao_id).
  await criarCobrancaPixRegistro({
    operacaoId,
    conversationId: autorizado.conversation_id,
    publicId: null,
    grupoId: autorizado.grupo_id,
    servidorNome: null,
    planoNome: null,
    valorEsperadoCentavos: autorizado.valor_total_centavos,
    transactionIdProvedor: cobranca.transactionId,
    qrCodeTexto: cobranca.qrCodeTexto,
  }).catch((erro) => {
    console.log("[renovacao_confirmacao] falha ao persistir cobranca_pix (lote)", JSON.stringify({ operacaoId, erro: String(erro) }));
  });

  try {
    await vincularOperacaoAoLote(autorizado.grupo_id, operacaoId);
  } catch (erro) {
    console.log("[renovacao_confirmacao] falha fatal ao vincular operacao ao lote", JSON.stringify({ grupoId: autorizado.grupo_id, operacaoId, erro: String(erro) }));
    await tratarFalhaLote(autorizado.grupo_id, autorizado.conversation_id, autorizado.telefone, "renovacao_lote:falha_vincular_operacao");
    return { outcome: "falha_cobranca" };
  }

  const valorTotal = formatarValorBRL(autorizado.valor_total_centavos / 100) ?? "0,00";
  const textoPix = montarMensagemPixRenovacao(valorTotal, `${qtd} acessos`, cobranca.paymentLinkUrl);
  const envioPix = await enviarMensagemWhatsApp(autorizado.telefone, textoPix);
  if (envioPix.outcome === "success") {
    await inserirMensagem(autorizado.conversation_id, "ia", textoPix, null).catch(() => {});
  }
  return { outcome: "confirmada" };
}

async function tratarFalhaLote(
  grupoId: string,
  conversationId: string,
  telefone: string,
  motivo: string,
): Promise<void> {
  let transferenciaAcionada = false;
  try {
    const r = await acionarTransferenciaHumana(conversationId, motivo, "(cliente confirmou ACEITO em lote)", "");
    transferenciaAcionada = r.outcome === "acionada";
  } catch (erro) {
    console.log("[renovacao_confirmacao] falha ao registrar transferencia (lote)", JSON.stringify({ erro: String(erro) }));
  }
  await notificarTransferenciaHumana(telefone, motivo, transferenciaAcionada, conversationId);
  await marcarLoteComoFalha(grupoId, motivo).catch((erro) => {
    console.log("[renovacao_confirmacao] falha ao liberar lote apos falha", JSON.stringify({ grupoId, erro: String(erro) }));
  });
}
