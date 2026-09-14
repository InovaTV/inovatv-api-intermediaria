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
import { enviarMensagemWhatsApp } from "./wasender_client.ts";
import { aguardarIntervaloSeguroEntreEnvios } from "./envio_seguro.ts";
import { acionarTransferenciaHumana } from "./conversas_estado.ts";
import { notificarTransferenciaHumana } from "./notificacao_transferencia.ts";
import { inserirMensagem } from "./mensagens_atendimento.ts";
import {
  formatarValorBRL,
  montarMensagemPixRenovacao,
  MENSAGEM_CANCELAMENTO_RENOVACAO,
  MENSAGEM_PREPARANDO_PAGAMENTO_RENOVACAO,
} from "./mensagens_fixas.ts";
import { registrarEvento } from "./renovacao_eventos.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

// Trilha de auditoria (Fase 3, 2026-09-14): pequeno helper local para os
// 6 pontos de enviarMensagemWhatsApp deste arquivo (cancelamento,
// preparando pagamento, Pix -- x2, individual e lote). Wasender esta
// desativado (premissa fixada 2026-09-14) -- por isso
// whatsapp_legado_falhou e' nivel 'info' no catalogo (ver
// _shared/renovacao_eventos.ts): uma falha aqui NUNCA e' tratada como
// falha da renovacao, so' um ponto historico/legado.
function registrarEnvioWhatsappLegado(params: {
  sucesso: boolean;
  contexto: string;
  tokenId?: string | null;
  grupoId?: string | null;
}): void {
  EdgeRuntime.waitUntil(
    registrarEvento({
      codigo: params.sucesso ? "whatsapp_legado_enviado" : "whatsapp_legado_falhou",
      origem: "renovacao_confirmacao",
      tokenId: params.tokenId,
      grupoId: params.grupoId,
      detalhe: { contexto: params.contexto },
    }),
  );
}

export type AcaoConfirmacaoRenovacao = "aceitar" | "cancelar";
export type ResultadoConfirmacaoRenovacao =
  // Campos aditivos (Portal de Renovacao, Checkpoint 3): mesmos dados ja
  // devolvidos por criarCobrancaOpenPix() nesta mesma chamada -- nenhuma
  // cobranca nova, nenhum segundo operacaoId. Callers existentes (o
  // caminho WhatsApp, via renovacao-confirmar) simplesmente ignoram.
  | { outcome: "confirmada"; operacaoId: string; brCode: string; paymentLinkUrl: string }
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
  // confirmacao_token_inexistente NAO tem sensor: nesta ramificacao nao
  // existe NENHUM identificador de correlacao (nem token_id -- o token
  // nao existe -- nem sessao_id, que este fluxo nunca recebe). Ver
  // relatorio de instrumentacao da Fase 3 -- ponto ciente, nao esquecido.
  if (!token) return { outcome: "token_inexistente" };

  token = await expirarSeVencido(token);
  if (token.estado === "expirada") {
    EdgeRuntime.waitUntil(
      registrarEvento({ codigo: "confirmacao_expirada", origem: "renovacao_confirmacao", tokenId: token.id }),
    );
    return { outcome: "token_expirado" };
  }
  if (token.estado !== "aguardando_confirmacao") {
    EdgeRuntime.waitUntil(
      registrarEvento({ codigo: "confirmacao_ja_decidida", origem: "renovacao_confirmacao", tokenId: token.id }),
    );
    return { outcome: "ja_decidido" };
  }
  if (params.telefoneOrigem && token.telefone !== params.telefoneOrigem) {
    EdgeRuntime.waitUntil(
      registrarEvento({ codigo: "confirmacao_telefone_nao_confere", origem: "renovacao_confirmacao", tokenId: token.id }),
    );
    return { outcome: "telefone_nao_confere" };
  }

  const sufixoOrigem = params.origem === "whatsapp" ? "pelo botao do WhatsApp" : "pelo link";
  if (params.acao === "cancelar") {
    const cancelado = await reivindicarCancelamento(params.tokenHash);
    if (!cancelado) {
      EdgeRuntime.waitUntil(
        registrarEvento({ codigo: "confirmacao_ja_decidida", origem: "renovacao_confirmacao", tokenId: token.id }),
      );
      return { outcome: "ja_decidido" };
    }
    EdgeRuntime.waitUntil(
      registrarEvento({ codigo: "confirmacao_cancelada", origem: "renovacao_confirmacao", tokenId: cancelado.id }),
    );
    await inserirMensagem(cancelado.conversation_id, "sistema", `Cliente cancelou a renovacao ${sufixoOrigem}.`, null).catch(() => {});
    const envio = await enviarMensagemWhatsApp(cancelado.telefone, MENSAGEM_CANCELAMENTO_RENOVACAO);
    registrarEnvioWhatsappLegado({ sucesso: envio.outcome === "success", contexto: "cancelamento", tokenId: cancelado.id });
    if (envio.outcome === "success") {
      await inserirMensagem(cancelado.conversation_id, "ia", MENSAGEM_CANCELAMENTO_RENOVACAO, null).catch(() => {});
    }
    return { outcome: "cancelada" };
  }

  const autorizado = await reivindicarAceite(params.tokenHash);
  if (!autorizado) {
    EdgeRuntime.waitUntil(
      registrarEvento({ codigo: "confirmacao_ja_decidida", origem: "renovacao_confirmacao", tokenId: token.id }),
    );
    return { outcome: "ja_decidido" };
  }
  EdgeRuntime.waitUntil(
    registrarEvento({
      codigo: "confirmacao_aceita",
      origem: "renovacao_confirmacao",
      tokenId: autorizado.id,
      detalhe: { valor_esperado_centavos: autorizado.valor_esperado_centavos },
    }),
  );
  await inserirMensagem(autorizado.conversation_id, "sistema", `Cliente confirmou (ACEITO) a renovacao ${sufixoOrigem}.`, null).catch(() => {});

  const preparando = await enviarMensagemWhatsApp(autorizado.telefone, MENSAGEM_PREPARANDO_PAGAMENTO_RENOVACAO);
  registrarEnvioWhatsappLegado({ sucesso: preparando.outcome === "success", contexto: "preparando_pagamento", tokenId: autorizado.id });
  if (preparando.outcome === "success") {
    await inserirMensagem(autorizado.conversation_id, "ia", MENSAGEM_PREPARANDO_PAGAMENTO_RENOVACAO, null).catch(() => {});
  }

  const operacaoId = crypto.randomUUID();
  const descricaoItem = `Renovacao Tope TV - Plano ${autorizado.plano_nome}`.trim();
  const cobranca = await criarCobrancaOpenPix(operacaoId, autorizado.valor_esperado_centavos, descricaoItem);
  if (cobranca.outcome !== "success") {
    EdgeRuntime.waitUntil(
      registrarEvento({
        codigo: "cobranca_pix_falhou",
        origem: "renovacao_confirmacao",
        tokenId: autorizado.id,
        operacaoId,
        detalhe: { motivo: "criacao_openpix_falhou" },
      }),
    );
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
  EdgeRuntime.waitUntil(
    registrarEvento({
      codigo: "cobranca_pix_criada",
      origem: "renovacao_confirmacao",
      tokenId: autorizado.id,
      operacaoId,
      detalhe: { transaction_id_provedor: cobranca.transactionId },
    }),
  );

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
    EdgeRuntime.waitUntil(
      registrarEvento({ codigo: "cobranca_pix_registro_falhou", origem: "renovacao_confirmacao", tokenId: autorizado.id, operacaoId }),
    );
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
    // Reaproveita cobranca_pix_falhou (catalogo fechado na Fase 2) --
    // do ponto de vista da operacao, a sequencia de cobranca nao
    // terminou com sucesso, mesmo a OpenPix tendo aceitado a criacao;
    // detalhe.motivo distingue este caso do de criacao_openpix_falhou.
    EdgeRuntime.waitUntil(
      registrarEvento({
        codigo: "cobranca_pix_falhou",
        origem: "renovacao_confirmacao",
        tokenId: autorizado.id,
        operacaoId,
        detalhe: { motivo: "falha_vincular_operacao" },
      }),
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
  // MENSAGEM_PREPARANDO_PAGAMENTO_RENOVACAO (acima) e o Pix abaixo vao
  // pro mesmo cliente em sequencia -- folga deliberada aqui pra manter
  // a "Account Protection" do Wasender ativa sem bloquear o 2o envio
  // (ver _shared/envio_seguro.ts).
  await aguardarIntervaloSeguroEntreEnvios();
  const envioPix = await enviarMensagemWhatsApp(autorizado.telefone, textoPix);
  registrarEnvioWhatsappLegado({ sucesso: envioPix.outcome === "success", contexto: "pix", tokenId: autorizado.id });
  if (envioPix.outcome === "success") {
    await inserirMensagem(autorizado.conversation_id, "ia", textoPix, null).catch(() => {});
  }
  // Aditivo (Checkpoint 3): mesmos operacaoId/brCode/paymentLinkUrl ja
  // calculados acima, sem chamada nova -- ver comentario no tipo.
  return { outcome: "confirmada", operacaoId, brCode: cobranca.qrCodeTexto, paymentLinkUrl: cobranca.paymentLinkUrl };
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
  if (lote.estado === "expirada") {
    EdgeRuntime.waitUntil(
      registrarEvento({ codigo: "confirmacao_expirada", origem: "renovacao_confirmacao", grupoId: lote.grupo_id }),
    );
    return { outcome: "token_expirado" };
  }
  if (lote.estado !== "aguardando_confirmacao") {
    EdgeRuntime.waitUntil(
      registrarEvento({ codigo: "confirmacao_ja_decidida", origem: "renovacao_confirmacao", grupoId: lote.grupo_id }),
    );
    return { outcome: "ja_decidido" };
  }
  if (params.telefoneOrigem && lote.telefone !== params.telefoneOrigem) {
    EdgeRuntime.waitUntil(
      registrarEvento({ codigo: "confirmacao_telefone_nao_confere", origem: "renovacao_confirmacao", grupoId: lote.grupo_id }),
    );
    return { outcome: "telefone_nao_confere" };
  }

  const sufixoOrigem = params.origem === "whatsapp" ? "pelo botao do WhatsApp" : "pelo link";

  if (params.acao === "cancelar") {
    const cancelado = await reivindicarCancelamentoLote(params.tokenHash);
    if (!cancelado) {
      EdgeRuntime.waitUntil(
        registrarEvento({ codigo: "confirmacao_ja_decidida", origem: "renovacao_confirmacao", grupoId: lote.grupo_id }),
      );
      return { outcome: "ja_decidido" };
    }
    EdgeRuntime.waitUntil(
      registrarEvento({ codigo: "confirmacao_cancelada", origem: "renovacao_confirmacao", grupoId: cancelado.grupo_id }),
    );
    await inserirMensagem(cancelado.conversation_id, "sistema", `Cliente cancelou a renovacao em lote ${sufixoOrigem}.`, null).catch(() => {});
    const envio = await enviarMensagemWhatsApp(cancelado.telefone, MENSAGEM_CANCELAMENTO_RENOVACAO);
    registrarEnvioWhatsappLegado({ sucesso: envio.outcome === "success", contexto: "cancelamento_lote", grupoId: cancelado.grupo_id });
    if (envio.outcome === "success") {
      await inserirMensagem(cancelado.conversation_id, "ia", MENSAGEM_CANCELAMENTO_RENOVACAO, null).catch(() => {});
    }
    return { outcome: "cancelada" };
  }

  const autorizado = await reivindicarAceiteLote(params.tokenHash);
  if (!autorizado) {
    EdgeRuntime.waitUntil(
      registrarEvento({ codigo: "confirmacao_ja_decidida", origem: "renovacao_confirmacao", grupoId: lote.grupo_id }),
    );
    return { outcome: "ja_decidido" };
  }

  const filhos = await buscarFilhosDoLote(autorizado.grupo_id);
  const qtd = filhos.length;

  EdgeRuntime.waitUntil(
    registrarEvento({
      codigo: "confirmacao_aceita",
      origem: "renovacao_confirmacao",
      grupoId: autorizado.grupo_id,
      detalhe: { valor_total_centavos: autorizado.valor_total_centavos, qtd_itens: qtd },
    }),
  );
  await inserirMensagem(autorizado.conversation_id, "sistema", `Cliente confirmou (ACEITO) a renovacao em lote ${sufixoOrigem}.`, null).catch(() => {});

  const preparando = await enviarMensagemWhatsApp(autorizado.telefone, MENSAGEM_PREPARANDO_PAGAMENTO_RENOVACAO);
  registrarEnvioWhatsappLegado({ sucesso: preparando.outcome === "success", contexto: "preparando_pagamento_lote", grupoId: autorizado.grupo_id });
  if (preparando.outcome === "success") {
    await inserirMensagem(autorizado.conversation_id, "ia", MENSAGEM_PREPARANDO_PAGAMENTO_RENOVACAO, null).catch(() => {});
  }

  const operacaoId = crypto.randomUUID();
  const descricaoItem = `Renovacao Tope TV - ${qtd} acessos`;
  const cobranca = await criarCobrancaOpenPix(operacaoId, autorizado.valor_total_centavos, descricaoItem);
  if (cobranca.outcome !== "success") {
    EdgeRuntime.waitUntil(
      registrarEvento({
        codigo: "cobranca_pix_falhou",
        origem: "renovacao_confirmacao",
        grupoId: autorizado.grupo_id,
        operacaoId,
        detalhe: { motivo: "criacao_openpix_falhou" },
      }),
    );
    await tratarFalhaLote(autorizado.grupo_id, autorizado.conversation_id, autorizado.telefone, "renovacao_lote:falha_criar_cobranca_apos_aceite");
    return { outcome: "falha_cobranca" };
  }
  EdgeRuntime.waitUntil(
    registrarEvento({
      codigo: "cobranca_pix_criada",
      origem: "renovacao_confirmacao",
      grupoId: autorizado.grupo_id,
      operacaoId,
      detalhe: { transaction_id_provedor: cobranca.transactionId, qtd_itens: qtd },
    }),
  );

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
    EdgeRuntime.waitUntil(
      registrarEvento({ codigo: "cobranca_pix_registro_falhou", origem: "renovacao_confirmacao", grupoId: autorizado.grupo_id, operacaoId }),
    );
  });

  try {
    await vincularOperacaoAoLote(autorizado.grupo_id, operacaoId);
  } catch (erro) {
    console.log("[renovacao_confirmacao] falha fatal ao vincular operacao ao lote", JSON.stringify({ grupoId: autorizado.grupo_id, operacaoId, erro: String(erro) }));
    EdgeRuntime.waitUntil(
      registrarEvento({
        codigo: "cobranca_pix_falhou",
        origem: "renovacao_confirmacao",
        grupoId: autorizado.grupo_id,
        operacaoId,
        detalhe: { motivo: "falha_vincular_operacao" },
      }),
    );
    await tratarFalhaLote(autorizado.grupo_id, autorizado.conversation_id, autorizado.telefone, "renovacao_lote:falha_vincular_operacao");
    return { outcome: "falha_cobranca" };
  }

  const valorTotal = formatarValorBRL(autorizado.valor_total_centavos / 100) ?? "0,00";
  const textoPix = montarMensagemPixRenovacao(valorTotal, `${qtd} acessos`, cobranca.paymentLinkUrl);
  // Mesma folga do caminho individual acima, mesmo motivo (ver
  // _shared/envio_seguro.ts).
  await aguardarIntervaloSeguroEntreEnvios();
  const envioPix = await enviarMensagemWhatsApp(autorizado.telefone, textoPix);
  registrarEnvioWhatsappLegado({ sucesso: envioPix.outcome === "success", contexto: "pix_lote", grupoId: autorizado.grupo_id });
  if (envioPix.outcome === "success") {
    await inserirMensagem(autorizado.conversation_id, "ia", textoPix, null).catch(() => {});
  }
  // Aditivo (Checkpoint 3): mesmos operacaoId/brCode/paymentLinkUrl ja
  // calculados acima, sem chamada nova -- ver comentario no tipo.
  return { outcome: "confirmada", operacaoId, brCode: cobranca.qrCodeTexto, paymentLinkUrl: cobranca.paymentLinkUrl };
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
