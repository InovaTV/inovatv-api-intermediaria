// Watchdog do Bloco 2 (2026-08-24) -- ultima camada de seguranca do
// timeout/falha (desenho aprovado, inovatv_central/CLAUDE.md).
// Acionado pelo cron job "renovacao-sigma-watchdog" (pg_net, a cada
// 5min) -- ver migration 20260824130000_tokens_renovacao.sql.
//
// Garante que nenhuma solicitacao fica presa em
// 'renovacao_em_andamento' pra sempre, mesmo se o callback do job do
// GitHub Actions nunca chegar (job morto, GitHub fora do ar, excecao
// nao tratada que escapou do try/catch do proprio job). Janela: 15
// minutos (decisao aprovada) -- bem mais que o timeout do proprio job
// (5 minutos), entao so' pega casos genuinamente presos, nunca um job
// ainda rodando normalmente.
//
// Reaproveita EXATAMENTE o mesmo caminho de
// marcarResultadoRenovacao("resultado_ambiguo", ...) que o callback
// real usaria -- nao e' um mecanismo novo, so' um chamador diferente
// (tempo, nao HTTP) do mesmo codigo.

import { errorResponse, jsonResponse } from "../_shared/http.ts";
import {
  buscarRenovacoesEmAndamentoAntigas,
  marcarResultadoRenovacao,
  buscarAutorizacoesOrfasAntigas,
  marcarAutorizacaoComoFalha,
  // Peca 3 (2026-08-29) -- ciclo de vida dos estados presos por webhook perdido/atrasado
  buscarSolicitacoesAguardandoExpiradas,
  buscarAutorizacoesVinculadasExpiradas,
  expirarAutorizacaoVinculada,
  buscarTokensTerminaisComCobrancaSemRenovacao,
  marcarCicloRenovacaoEncerrado,
  expirarSeVencido,
  // Camada 3 (2026-08-29) -- reconciliacao ANTECIPADA (dentro da janela de 2h)
  buscarAutorizacoesVinculadasAindaNaJanela,
} from "../_shared/tokens_renovacao.ts";
import {
  buscarLotesEmAndamentoAntigos,
  buscarLotesAutorizadosOrfaosAntigos,
  buscarFilhosDoLote,
  marcarResultadoFilhoLote,
  marcarEstadoFinalLote,
  marcarLoteComoFalha,
  // Peca 3 (2026-08-29)
  buscarLotesAguardandoExpirados,
  buscarLotesAutorizadosVinculadosExpirados,
  expirarLoteAutorizado,
  buscarLotesTerminaisComCobrancaSemRenovacao,
  marcarLoteCicloRenovacaoEncerrado,
  expirarLoteSeVencido,
  // Camada 3 (2026-08-29) -- reconciliacao ANTECIPADA (dentro da janela de 2h)
  buscarLotesAutorizadosVinculadosAindaNaJanela,
} from "../_shared/renovacoes_lote.ts";
import { acionarTransferenciaHumana } from "../_shared/conversas_estado.ts";
import { notificarTransferenciaHumana } from "../_shared/notificacao_transferencia.ts";
import { inserirMensagem } from "../_shared/mensagens_atendimento.ts";
import { montarMensagemResultadoLote, MENSAGEM_RENOVACAO_EXPIRADA_SEM_PAGAMENTO } from "../_shared/mensagens_fixas.ts";
import { enviarMensagemWhatsApp } from "../_shared/whatsapp_client.ts";
// Peca 3 (2026-08-29) -- reconciliacao de pagamento (reusa as primitivas CAS do openpix-webhook)
import { reconciliarPagamentoRenovacao, reconciliarSePago } from "../_shared/reconciliacao_renovacao.ts";
import { buscarCobrancaPorOperacaoId, marcarCobrancaComoPaga, expirarCobrancaPendente } from "../_shared/cobrancas_pix.ts";
import { consultarCobrancaOpenPix } from "../_shared/openpix_client.ts";

const JANELA_MINUTOS = 15;

// CAMADA 3 (2026-08-29) -- piso de idade da cobranca antes da 1a reconsulta
// antecipada. 5min: acima da latencia real de um Pix (o cliente costuma pagar em
// segundos-a-minutos), entao uma cobranca ainda 'pendente' passados 5min ou o
// cliente nao pagou (reconsulta barata, no-op) ou o webhook se perdeu
// (recupera). Casado com a cadencia do cron (*/5) -> recuperacao em ~10min, no
// lugar das 2h do sweep de expira_em.
const JANELA_RECONCILIACAO_ANTECIPADA_MINUTOS = 5;

Deno.serve(async (req: Request) => {
  const tokenInterno = Deno.env.get("RENOVACAO_SIGMA_WATCHDOG_TOKEN");
  const tokenRecebido = req.headers.get("X-Internal-Token");
  if (!tokenInterno || !tokenRecebido || tokenRecebido !== tokenInterno) {
    return errorResponse("Nao autorizado", 401);
  }

  const presos = await buscarRenovacoesEmAndamentoAntigas(JANELA_MINUTOS);
  // Correcao de risco (2026-08-24, revisao do Bloco 2): backstop pro
  // caso raro (queda de processo/plataforma) em que um token fica
  // preso em 'autorizada' sem nunca ter chegado a ter uma cobranca
  // vinculada -- o caminho normal (falha ao criar cobranca na OpenPix)
  // ja se auto-recupera na hora, direto em confirmacao-renovacao/
  // index.ts; isto aqui so' cobre o que escapar daquele caminho.
  // NUNCA inclui tokens com operacao_id ja vinculado (aguardando
  // pagamento legitimamente, ver buscarAutorizacoesOrfasAntigas).
  const autorizacoesOrfas = await buscarAutorizacoesOrfasAntigas(JANELA_MINUTOS);

  // Renovacao em lote (Etapa 1, 2026-08-29): mesma janela, mesmo
  // principio -- um lote preso em 'renovacao_em_andamento' sem callback
  // vira 'falhou', filhos ainda em andamento viram
  // 'renovacao_indeterminada', e uma transferencia humana e' acionada
  // no nivel da conversa.
  const lotesPresos = await buscarLotesEmAndamentoAntigos(JANELA_MINUTOS);

  // Backstop lote (Etapa 1, 2026-08-29) -- equivalente de
  // autorizacoesOrfas: lote preso em 'autorizada' sem cobranca
  // vinculada apos a janela (queda entre criarCobrancaOpenPix e
  // vincularOperacaoAoLote). Sem pagamento -> NUNCA envia a mensagem
  // consolidada ("Pagamento confirmado" seria falso); usa o mesmo
  // caminho da autorizacao orfa individual (aviso de transferencia +
  // acesso liberado).
  const lotesOrfaos = await buscarLotesAutorizadosOrfaosAntigos(JANELA_MINUTOS);

  // ===================================================================
  // Peca 3 (2026-08-29) -- ciclo de vida garantido dos estados
  // NAO-terminais. Janela: o proprio expira_em (2h), NUNCA os 15min do
  // ciclo (que sao so' a cadencia de varredura). Fecha o buraco em que
  // um webhook OpenPix perdido/atrasado deixava um lote/token preso em
  // 'autorizada' PARA SEMPRE, bloqueando toda nova renovacao do acesso.
  // Criterio obrigatorio: nunca perder um pagamento COMPLETED na Woovi.
  // ===================================================================
  // CASO A -- 'aguardando_confirmacao' vencido (cliente nunca clicou).
  const aguardandoExpiradas = await buscarSolicitacoesAguardandoExpiradas();
  const lotesAguardandoExpirados = await buscarLotesAguardandoExpirados();
  // CAMADA 3 -- reconciliacao ANTECIPADA: 'autorizada' + cobranca vinculada,
  // AINDA dentro da janela de 2h, criada ha' >= 5min. So' recupera se a Woovi
  // disser COMPLETED + valor exato; qualquer outro resultado e' no-op absoluto
  // (a expiracao continua 100% nos CASOS B/C/E abaixo).
  const reconciliacaoAntecipada = await buscarAutorizacoesVinculadasAindaNaJanela(
    JANELA_RECONCILIACAO_ANTECIPADA_MINUTOS,
  );
  const lotesReconciliacaoAntecipada = await buscarLotesAutorizadosVinculadosAindaNaJanela(
    JANELA_RECONCILIACAO_ANTECIPADA_MINUTOS,
  );
  // CASOS B/C/E -- 'autorizada' COM cobranca vinculada, alem do expira_em.
  const autorizacoesVinculadas = await buscarAutorizacoesVinculadasExpiradas();
  const lotesVinculados = await buscarLotesAutorizadosVinculadosExpirados();
  // CASO D -- rede de seguranca de dinheiro: token/lote ja terminal com
  // cobranca vinculada sem renovacao concluida.
  const tokensConciliar = await buscarTokensTerminaisComCobrancaSemRenovacao();
  const lotesConciliar = await buscarLotesTerminaisComCobrancaSemRenovacao();

  if (
    presos.length === 0 &&
    autorizacoesOrfas.length === 0 &&
    lotesPresos.length === 0 &&
    lotesOrfaos.length === 0 &&
    aguardandoExpiradas.length === 0 &&
    lotesAguardandoExpirados.length === 0 &&
    reconciliacaoAntecipada.length === 0 &&
    lotesReconciliacaoAntecipada.length === 0 &&
    autorizacoesVinculadas.length === 0 &&
    lotesVinculados.length === 0 &&
    tokensConciliar.length === 0 &&
    lotesConciliar.length === 0
  ) {
    return jsonResponse({ outcome: "nenhuma_presa" });
  }

  const processados: string[] = [];
  for (const token of presos) {
    if (!token.operacao_id) continue; // nunca deveria acontecer (renovacao_em_andamento sempre tem operacao_id), defensivo

    const atualizado = await marcarResultadoRenovacao(token.operacao_id, "resultado_ambiguo", {
      motivo: `watchdog: sem callback apos ${JANELA_MINUTOS} minutos`,
    });
    if (!atualizado) continue; // ja processado por outro caminho enquanto o watchdog rodava -- idempotencia

    try {
      await inserirMensagem(
        atualizado.conversation_id,
        "sistema",
        `Watchdog: renovação Sigma sem resposta após ${JANELA_MINUTOS} minutos -- marcada como resultado_ambiguo.`,
        null,
      );
    } catch {
      // best-effort
    }

    const motivoTimeout = "renovacao_sigma:watchdog_timeout";
    let transferenciaAcionada = false;
    try {
      const transferencia = await acionarTransferenciaHumana(
        atualizado.conversation_id,
        motivoTimeout,
        "(renovacao Sigma pos-pagamento)",
        "",
      );
      transferenciaAcionada = transferencia.outcome === "acionada";
    } catch (erro) {
      console.log("[renovacao-sigma-watchdog] falha ao acionar transferencia humana", String(erro));
    }
    await notificarTransferenciaHumana(atualizado.telefone, motivoTimeout, transferenciaAcionada, atualizado.conversation_id);

    processados.push(token.operacao_id);
  }

  const autorizacoesProcessadas: string[] = [];
  for (const token of autorizacoesOrfas) {
    const atualizado = await marcarAutorizacaoComoFalha(
      token.id,
      `watchdog: autorizado sem cobranca vinculada apos ${JANELA_MINUTOS} minutos`,
    );
    if (!atualizado) continue; // ja resolvido por outro caminho enquanto o watchdog rodava -- idempotencia

    try {
      await inserirMensagem(
        atualizado.conversation_id,
        "sistema",
        `Watchdog: renovação autorizada sem cobrança criada após ${JANELA_MINUTOS} minutos -- marcada como falha, acesso liberado para nova solicitação.`,
        null,
      );
    } catch {
      // best-effort
    }

    const motivoOrfa = "renovacao:watchdog_autorizacao_orfa";
    let transferenciaAcionada = false;
    try {
      const transferencia = await acionarTransferenciaHumana(
        atualizado.conversation_id,
        motivoOrfa,
        "(renovacao Sigma -- ACEITO sem cobranca vinculada)",
        "",
      );
      transferenciaAcionada = transferencia.outcome === "acionada";
    } catch (erro) {
      console.log("[renovacao-sigma-watchdog] falha ao acionar transferencia humana (autorizacao orfa)", String(erro));
    }
    await notificarTransferenciaHumana(atualizado.telefone, motivoOrfa, transferenciaAcionada, atualizado.conversation_id);

    autorizacoesProcessadas.push(token.id);
  }

  const lotesProcessados: string[] = [];
  for (const lote of lotesPresos) {
    const loteFinalizado = await marcarEstadoFinalLote(lote.grupo_id, "falhou");
    if (!loteFinalizado) continue; // ja finalizado por outro caminho -- idempotencia

    const filhos = await buscarFilhosDoLote(lote.grupo_id);
    for (const filho of filhos) {
      if (filho.estado === "renovacao_em_andamento") {
        await marcarResultadoFilhoLote(filho.id, "renovacao_indeterminada", {
          motivo: `watchdog: sem callback apos ${JANELA_MINUTOS} minutos`,
        }).catch(() => {});
      }
    }

    try {
      await inserirMensagem(
        lote.conversation_id,
        "sistema",
        `Watchdog: renovação em lote sem resposta após ${JANELA_MINUTOS} minutos -- marcada como falha.`,
        null,
      );
    } catch {
      // best-effort
    }

    const textoCliente = montarMensagemResultadoLote(
      filhos.map((f) => ({
        nome: f.cliente_nome,
        servidorNome: f.servidor_nome,
        sucesso: f.estado === "renovacao_concluida",
        vencimentoFormatado: f.vencimento_confirmado
          ? new Date(f.vencimento_confirmado).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
          : null,
      })),
    );
    const envio = await enviarMensagemWhatsApp(lote.telefone, textoCliente);
    if (envio.outcome === "success") {
      await inserirMensagem(lote.conversation_id, "ia", textoCliente, null).catch(() => {});
    }

    const motivoLote = "renovacao_lote:watchdog_timeout";
    let transferenciaAcionada = false;
    try {
      const transferencia = await acionarTransferenciaHumana(
        lote.conversation_id,
        motivoLote,
        "(renovacao em lote pos-pagamento)",
        "",
      );
      transferenciaAcionada = transferencia.outcome === "acionada";
    } catch (erro) {
      console.log("[renovacao-sigma-watchdog] falha ao acionar transferencia humana (lote)", String(erro));
    }
    // avisarCliente: false -- a mensagem consolidada acima ja e' a
    // unica mensagem ao cliente (ela ja diz "um atendente vai
    // concluir"). Estado + aviso ao Jose continuam.
    await notificarTransferenciaHumana(lote.telefone, motivoLote, transferenciaAcionada, lote.conversation_id, {
      avisarCliente: false,
    });

    lotesProcessados.push(lote.grupo_id);
  }

  // Backstop lote orfao: lote preso em 'autorizada' sem cobranca
  // vinculada. Sem pagamento -> mesma disciplina da autorizacao orfa
  // individual (aviso de transferencia ao cliente + acesso liberado),
  // NUNCA a mensagem consolidada de "pagamento confirmado".
  const lotesOrfaosProcessados: string[] = [];
  for (const lote of lotesOrfaos) {
    const loteFinalizado = await marcarLoteComoFalha(
      lote.grupo_id,
      `watchdog: lote autorizado sem cobranca vinculada apos ${JANELA_MINUTOS} minutos`,
    );
    if (!loteFinalizado) continue; // ja resolvido por outro caminho -- idempotencia

    try {
      await inserirMensagem(
        lote.conversation_id,
        "sistema",
        `Watchdog: renovação em lote autorizada sem cobrança criada após ${JANELA_MINUTOS} minutos -- marcada como falha, acessos liberados para nova solicitação.`,
        null,
      );
    } catch {
      // best-effort
    }

    const motivoOrfaLote = "renovacao_lote:watchdog_autorizacao_orfa";
    let transferenciaAcionada = false;
    try {
      const transferencia = await acionarTransferenciaHumana(
        lote.conversation_id,
        motivoOrfaLote,
        "(renovacao em lote -- ACEITO sem cobranca vinculada)",
        "",
      );
      transferenciaAcionada = transferencia.outcome === "acionada";
    } catch (erro) {
      console.log("[renovacao-sigma-watchdog] falha ao acionar transferencia humana (lote orfao)", String(erro));
    }
    await notificarTransferenciaHumana(lote.telefone, motivoOrfaLote, transferenciaAcionada, lote.conversation_id);

    lotesOrfaosProcessados.push(lote.grupo_id);
  }

  // ===================================================================
  // Peca 3 (2026-08-29) -- ciclo de vida garantido dos estados presos.
  // Idempotencia: TODA transicao abaixo e' um CAS na coluna de origem
  // (estado / status / renovacao_concluida_em); duas execucoes
  // concorrentes do watchdog, ou uma corrida com o webhook real, tem
  // exatamente UM vencedor -- o(s) perdedor(es) recebem null/0-linhas e
  // fazem 'continue'. As proprias queries buscar*() sao a 1a barreira
  // (filtram por estado; apos a transicao o item nao volta).
  // ===================================================================

  // Helper local -- transferencia + aviso (Casos D/E). Casos A/B/C NAO
  // transferem: A/B nao tem nada pra um humano fazer; C transferir
  // colocaria a conversa em 'aguardando_humano' e bloquearia o proprio
  // "quero renovar" seguinte do cliente.
  const transferirEAvisar = async (
    conversationId: string,
    telefone: string,
    motivo: string,
  ): Promise<void> => {
    let acionada = false;
    try {
      const r = await acionarTransferenciaHumana(
        conversationId,
        motivo,
        "(watchdog -- ciclo de vida de estado preso)",
        "",
      );
      acionada = r.outcome === "acionada";
    } catch (erro) {
      console.log("[renovacao-sigma-watchdog] falha ao acionar transferencia (Peca 3)", String(erro));
    }
    // notificarTransferenciaHumana e' no-op quando acionada=false
    // (evita spam ao Jose se a conversa ja estava aguardando_humano).
    await notificarTransferenciaHumana(telefone, motivo, acionada, conversationId);
  };

  // ===== CASO A -- 'aguardando_confirmacao' vencido (sem cobranca) =====
  const aguardandoProcessadas: string[] = [];
  for (const token of aguardandoExpiradas) {
    const atualizado = await expirarSeVencido(token);
    if (atualizado.estado !== "expirada") continue;
    await inserirMensagem(
      token.conversation_id,
      "sistema",
      "Watchdog: solicitacao de renovacao sem confirmacao apos a janela de 2h -- expirada, acesso liberado.",
      null,
    ).catch(() => {});
    aguardandoProcessadas.push(token.id);
  }

  const lotesAguardandoProcessados: string[] = [];
  for (const lote of lotesAguardandoExpirados) {
    const atualizado = await expirarLoteSeVencido(lote);
    if (atualizado.estado !== "expirada") continue;
    // expirarLoteSeVencido nao mexe nos filhos -- expira os que ainda
    // estiverem 'aguardando_confirmacao' (mesmo expira_em do lote).
    const filhos = await buscarFilhosDoLote(lote.grupo_id);
    for (const filho of filhos) {
      if (filho.estado === "aguardando_confirmacao") {
        await expirarSeVencido(filho).catch(() => {});
      }
    }
    await inserirMensagem(
      lote.conversation_id,
      "sistema",
      "Watchdog: renovacao em lote sem confirmacao apos a janela de 2h -- expirada, acessos liberados.",
      null,
    ).catch(() => {});
    lotesAguardandoProcessados.push(lote.grupo_id);
  }

  // ===== CAMADA 3 -- reconciliacao ANTECIPADA (DENTRO da janela de 2h) =====
  // Corta a janela de silencio de ~2h para ~10min quando um webhook
  // OPENPIX:CHARGE_COMPLETED se perde. NUNCA expira / cancela / marca
  // divergencia: reconciliarSePago so' AGE em "COMPLETED + valor exato" e, nesse
  // caso, recupera pelo MESMO nucleo (executarRecuperacao) que o openpix-webhook
  // usa -- convergindo exatamente para o fluxo normal. Todo o resto
  // (ACTIVE / EXPIRED / Woovi indisponivel / sem registro / valor divergente) e'
  // no-op absoluto aqui; a expiracao e a conciliacao de divergencia seguem
  // exclusivas dos CASOS B/C/E abaixo. Idempotencia/concorrencia: mesmos CAS da
  // Peca 3 -- reivindicarInicio* e' o portao de vencedor unico; a query
  // buscar*AindaNaJanela ja nao devolve o item apos a recuperacao (saiu de
  // 'autorizada'); a nota de sistema so' e' inserida pelo vencedor da CAS.
  const reconciliadasAntecipadas: string[] = [];
  for (const token of reconciliacaoAntecipada) {
    if (!token.operacao_id) continue;
    const r = await reconciliarSePago({ operacaoId: token.operacao_id, tipo: "individual" });
    if (r.outcome === "recuperado_disparado" || r.outcome === "recuperado_dispatch_falhou") {
      await inserirMensagem(
        token.conversation_id,
        "sistema",
        "Watchdog: pagamento confirmado na Woovi antes da janela de 2h (webhook nao chegou) -- renovacao recuperada e disparada.",
        null,
      ).catch(() => {});
      reconciliadasAntecipadas.push(token.id);
    }
    // r.outcome === "ja_em_andamento" -> outro caminho (webhook real / sweep /
    //   outro watchdog) ja ganhou; nada a fazer, nem nota.
    // r.outcome === "nao_recuperado" (nao_pago / ACTIVE / EXPIRED /
    //   woovi_indisponivel / sem_registro / valor_divergente) -> NO-OP ABSOLUTO.
  }

  const lotesReconciliadosAntecipados: string[] = [];
  for (const lote of lotesReconciliacaoAntecipada) {
    if (!lote.operacao_id) continue;
    const r = await reconciliarSePago({ operacaoId: lote.operacao_id, tipo: "lote" });
    if (r.outcome === "recuperado_disparado" || r.outcome === "recuperado_dispatch_falhou") {
      await inserirMensagem(
        lote.conversation_id,
        "sistema",
        "Watchdog: pagamento do lote confirmado na Woovi antes da janela de 2h (webhook nao chegou) -- renovacao recuperada e disparada.",
        null,
      ).catch(() => {});
      lotesReconciliadosAntecipados.push(lote.grupo_id);
    }
  }

  // ===== CASOS B / C / E -- 'autorizada' + cobranca vinculada + venceu =====
  const vinculadasProcessadas: string[] = [];
  for (const token of autorizacoesVinculadas) {
    if (!token.operacao_id) continue;
    const recon = await reconciliarPagamentoRenovacao({
      operacaoId: token.operacao_id,
      tipo: "individual",
    });

    if (
      recon.outcome === "recuperado_disparado" ||
      recon.outcome === "recuperado_dispatch_falhou" ||
      recon.outcome === "ja_em_andamento"
    ) {
      // CASO B -- pagamento recuperado (ou ja em andamento por outro
      // caminho). NADA de terminal aqui: o fluxo normal de resultado
      // (callback do job / sweep de 15min ja existente) leva o token a
      // 'renovacao_concluida'/'falhou'/'indeterminada'. Um pagamento
      // COMPLETED sempre completa a renovacao.
      await inserirMensagem(
        token.conversation_id,
        "sistema",
        recon.outcome === "ja_em_andamento"
          ? "Watchdog: pagamento ja confirmado por outro caminho -- renovacao em andamento."
          : "Watchdog: pagamento confirmado na Woovi (webhook nao chegou) -- renovacao recuperada e disparada.",
        null,
      ).catch(() => {});
      vinculadasProcessadas.push(token.id);
      continue;
    }

    if (recon.outcome === "valor_divergente") {
      // CASO E -- reconciliarPagamento ja marcou a cobranca
      // 'valor_divergente'. Libera o acesso e transfere (ha' dinheiro
      // a conciliar).
      const liberado = await expirarAutorizacaoVinculada(
        token.id,
        "watchdog: reconsulta Woovi COMPLETED com valor divergente",
      );
      if (!liberado) continue; // corrida -> token ja avancou
      await inserirMensagem(
        token.conversation_id,
        "sistema",
        "Watchdog: cobranca paga com valor divergente do esperado -- acesso liberado, atendente precisa verificar o pagamento.",
        null,
      ).catch(() => {});
      await transferirEAvisar(token.conversation_id, token.telefone, "renovacao:valor_divergente_reconsulta");
      vinculadasProcessadas.push(token.id);
      continue;
    }

    if (recon.outcome === "nao_pago") {
      // CASO C -- Woovi confirma NAO pago. Expira o TOKEN (libera o
      // acesso). NAO expira a cobranca -- fica 'pendente' pro Caso D
      // conciliar (garantia de nunca perder um pagamento concluido de
      // verdade). NAO transfere.
      const expirado = await expirarAutorizacaoVinculada(
        token.id,
        `watchdog: autorizada sem pagamento apos expira_em (Woovi: ${recon.statusWoovi ?? "?"})`,
      );
      if (!expirado) continue; // corrida (webhook ganhou) -> ABORTA sem tocar em nada
      await inserirMensagem(
        token.conversation_id,
        "sistema",
        "Watchdog: solicitacao de renovacao expirou sem pagamento -- acesso liberado para nova solicitacao.",
        null,
      ).catch(() => {});
      await enviarMensagemWhatsApp(token.telefone, MENSAGEM_RENOVACAO_EXPIRADA_SEM_PAGAMENTO).catch(() => {});
      vinculadasProcessadas.push(token.id);
      continue;
    }
    // recon.outcome === "indefinido" -> nao deu pra decidir com seguranca; proximo ciclo tenta de novo.
  }

  const lotesVinculadosProcessados: string[] = [];
  for (const lote of lotesVinculados) {
    if (!lote.operacao_id) continue;
    const recon = await reconciliarPagamentoRenovacao({ operacaoId: lote.operacao_id, tipo: "lote" });

    if (
      recon.outcome === "recuperado_disparado" ||
      recon.outcome === "recuperado_dispatch_falhou" ||
      recon.outcome === "ja_em_andamento"
    ) {
      await inserirMensagem(
        lote.conversation_id,
        "sistema",
        recon.outcome === "ja_em_andamento"
          ? "Watchdog: pagamento do lote ja confirmado por outro caminho -- renovacao em andamento."
          : "Watchdog: pagamento do lote confirmado na Woovi (webhook nao chegou) -- renovacao recuperada e disparada.",
        null,
      ).catch(() => {});
      lotesVinculadosProcessados.push(lote.grupo_id);
      continue;
    }

    if (recon.outcome === "valor_divergente") {
      const liberado = await expirarLoteAutorizado(lote.operacao_id);
      if (!liberado) continue;
      await inserirMensagem(
        lote.conversation_id,
        "sistema",
        "Watchdog: cobranca do lote paga com valor divergente -- acessos liberados, atendente precisa verificar o pagamento.",
        null,
      ).catch(() => {});
      await transferirEAvisar(lote.conversation_id, lote.telefone, "renovacao_lote:valor_divergente_reconsulta");
      lotesVinculadosProcessados.push(lote.grupo_id);
      continue;
    }

    if (recon.outcome === "nao_pago") {
      const expirado = await expirarLoteAutorizado(lote.operacao_id);
      if (!expirado) continue; // corrida -> ABORTA sem tocar em nada
      await inserirMensagem(
        lote.conversation_id,
        "sistema",
        "Watchdog: renovacao em lote expirou sem pagamento -- acessos liberados para nova solicitacao.",
        null,
      ).catch(() => {});
      await enviarMensagemWhatsApp(lote.telefone, MENSAGEM_RENOVACAO_EXPIRADA_SEM_PAGAMENTO).catch(() => {});
      lotesVinculadosProcessados.push(lote.grupo_id);
      continue;
    }
  }

  // ===== CASO D -- rede de seguranca de dinheiro =====
  // Token/lote ja TERMINAL com cobranca vinculada e sem ciclo
  // encerrado. Cobre a janela de milissegundos entre a reconsulta do
  // Caso C e o write, e qualquer pagamento feito na Woovi depois da
  // expiracao. Criterio: NUNCA perder um pagamento COMPLETED.
  const CARENCIA_HOUSEKEEPING_MS = 24 * 60 * 60 * 1000; // expira_em + 24h
  const conciliadas: string[] = [];

  const itensConciliar: Array<{
    tipo: "individual" | "lote";
    chave: string; // token.id ou lote.grupo_id (para marcar ciclo encerrado)
    operacaoId: string;
    conversationId: string;
    telefone: string;
    expiraEm: string;
  }> = [
    ...tokensConciliar
      .filter((t) => t.operacao_id)
      .map((t) => ({
        tipo: "individual" as const,
        chave: t.id,
        operacaoId: t.operacao_id as string,
        conversationId: t.conversation_id,
        telefone: t.telefone,
        expiraEm: t.expira_em,
      })),
    ...lotesConciliar
      .filter((l) => l.operacao_id)
      .map((l) => ({
        tipo: "lote" as const,
        chave: l.grupo_id,
        operacaoId: l.operacao_id as string,
        conversationId: l.conversation_id,
        telefone: l.telefone,
        expiraEm: l.expira_em,
      })),
  ];

  const marcarCicloEncerrado = async (
    item: (typeof itensConciliar)[number],
    motivo: string,
  ): Promise<boolean> => {
    const r =
      item.tipo === "lote"
        ? await marcarLoteCicloRenovacaoEncerrado(item.chave)
        : await marcarCicloRenovacaoEncerrado(item.chave, motivo);
    return r !== null; // null = outro ciclo do watchdog ja tratou
  };

  for (const item of itensConciliar) {
    const cob = await buscarCobrancaPorOperacaoId(item.operacaoId);
    if (!cob) continue;

    if (cob.status === "pago") {
      // Pagamento orfao: pago, token/lote ja terminal, renovacao nunca
      // concluida. Registra + transfere pra um atendente aplicar.
      // Dinheiro NUNCA perdido.
      if (!(await marcarCicloEncerrado(item, "pago apos expiracao -- entregue a atendente"))) continue;
      await inserirMensagem(
        item.conversationId,
        "sistema",
        "Watchdog: pagamento confirmado APOS a expiracao da solicitacao -- renovacao NAO aplicada automaticamente, atendente precisa concluir.",
        null,
      ).catch(() => {});
      await transferirEAvisar(item.conversationId, item.telefone, "renovacao:pagamento_apos_expiracao");
      conciliadas.push(item.operacaoId);
      continue;
    }

    if (cob.status === "pendente") {
      const consulta = await consultarCobrancaOpenPix(item.operacaoId);
      if (consulta.outcome === "success" && consulta.status === "COMPLETED") {
        // Pagou depois da expiracao. Marca 'pago' (CAS status='pendente')
        // e trata como pagamento orfao.
        const pago = await marcarCobrancaComoPaga(item.operacaoId);
        if (!pago) continue; // webhook / outro watchdog marcou -> proximo ciclo pega no ramo 'pago'
        if (!(await marcarCicloEncerrado(item, "pago apos expiracao (reconsulta) -- entregue a atendente"))) continue;
        await inserirMensagem(
          item.conversationId,
          "sistema",
          "Watchdog: pagamento confirmado na Woovi APOS a expiracao -- registrado, atendente precisa concluir a renovacao.",
          null,
        ).catch(() => {});
        await transferirEAvisar(item.conversationId, item.telefone, "renovacao:pagamento_apos_expiracao");
        conciliadas.push(item.operacaoId);
        continue;
      }
      // Nao COMPLETED -> housekeeping so' apos expira_em + 24h.
      if (Date.now() > new Date(item.expiraEm).getTime() + CARENCIA_HOUSEKEEPING_MS) {
        const expirou = await expirarCobrancaPendente(item.operacaoId); // CAS status='pendente'
        if (expirou) {
          await marcarCicloEncerrado(item, "cobranca pendente expirada apos carencia de 24h -- sem pagamento");
          conciliadas.push(item.operacaoId);
        }
      }
      continue;
    }
    // valor_divergente / expirada / cancelada -> nada a fazer.
  }

  return jsonResponse({
    outcome: "processado",
    quantidade:
      processados.length +
      autorizacoesProcessadas.length +
      lotesProcessados.length +
      lotesOrfaosProcessados.length +
      aguardandoProcessadas.length +
      lotesAguardandoProcessados.length +
      reconciliadasAntecipadas.length +
      lotesReconciliadosAntecipados.length +
      vinculadasProcessadas.length +
      lotesVinculadosProcessados.length +
      conciliadas.length,
    operacoes: processados,
    autorizacoesOrfas: autorizacoesProcessadas,
    lotes: lotesProcessados,
    lotesOrfaos: lotesOrfaosProcessados,
    // Peca 3 (2026-08-29)
    aguardandoExpiradas: aguardandoProcessadas,
    lotesAguardandoExpirados: lotesAguardandoProcessados,
    autorizacoesVinculadasExpiradas: vinculadasProcessadas,
    lotesVinculadosExpirados: lotesVinculadosProcessados,
    conciliadas,
    // Camada 3 (2026-08-29) -- reconciliacao antecipada
    reconciliadasAntecipadas,
    lotesReconciliadosAntecipados,
  });
});
