// Webhook OpenPix/Woovi (Bloco 1, 2026-08-24) -- peca nova, nunca
// existiu no desenho PagBank (que travou antes de chegar aqui).
//
// Disciplina de seguranca, decisoes preservadas explicitamente pelo
// usuario ao aprovar a troca de provedor (inovatv_central CLAUDE.md):
//   1. Webhook nunca aceito cegamente -- valida x-webhook-signature
//      (RSA-SHA256) sobre o CORPO BRUTO antes de interpretar qualquer
//      campo do payload. Assinatura invalida/ausente -> 401, nunca
//      processa.
//   2. O webhook e' so' o GATILHO -- a decisao real (pago ou nao) vem
//      de reconsultar consultarCobrancaOpenPix(correlationID), nunca
//      dos campos do proprio payload recebido (que poderia ser um
//      reenvio antigo, ou -- mesmo com assinatura valida -- nao e'
//      motivo pra pular a fonte de verdade determinística).
//   3. Confere valor pago contra valor_esperado_centavos ja persistido
//      -- bate: marca 'pago'; diverge: marca 'valor_divergente' (nunca
//      'pago' por aproximacao).
//   4. Isolamento estrito, igual ao resto do Bloco 1: SO' atualiza o
//      status em cobrancas_pix -- e, a partir do Bloco 2 (2026-08-24),
//      dispara o gatilho da renovacao real (workflow_dispatch, GitHub
//      Actions). NAO executa a renovacao aqui, NAO envia a mensagem
//      final de confirmacao aqui -- isso acontece so' depois da
//      reconsulta real de Rocket/Sigma dentro do job, reportada via
//      renovacao-sigma-resultado. Anunciar "pagamento confirmado"
//      aqui, antes da renovacao acontecer de verdade, seria uma
//      afirmacao falsa.
//   5. Idempotencia contra reenvio de webhook: marcarCobrancaComoPaga/
//      marcarCobrancaComoDivergente so' atualizam uma linha que ainda
//      esteja 'pendente' (WHERE status='pendente') -- um segundo
//      webhook para a mesma cobranca (ja processada) vira no-op, sem
//      tabela de deduplicacao dedicada (diferente do Webhook do
//      WhatsApp, que precisa dedup por nao ter esse filtro de estado
//      natural). O disparo do Bloco 2 (abaixo) so' acontece quando
//      marcarCobrancaComoPaga afeta uma linha de verdade -- reenvio
//      nunca dispara o workflow duas vezes.
//
// Bloco 2 (2026-08-24, inovatv_central/CLAUDE.md, desenho aprovado):
// logo apos marcar a cobranca como paga de verdade, reivindica
// atomicamente o inicio da renovacao (tokens_renovacao: autorizada ->
// renovacao_em_andamento) e dispara o workflow renovacao-sigma.yml
// via EdgeRuntime.waitUntil (nao bloqueia o 200 pra OpenPix). Essa
// reivindicacao atomica e' a PRIMEIRA camada de prevencao de disparo
// duplicado (ver desenho completo, seção "Prevencao de execucao
// duplicada").
//
// Evento OPENPIX:CHARGE_COMPLETED e' o unico tratado -- qualquer outro
// (ou payload sem correlationID reconhecivel) e' reconhecido com 200 e
// ignorado, mesma filosofia do Webhook do WhatsApp (nunca fazer a
// OpenPix reenviar por erro nosso quando o evento simplesmente nao e'
// relevante pra nos).

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

import { validarAssinaturaWebhookOpenPix } from "../_shared/openpix_webhook_signature.ts";
import { consultarCobrancaOpenPix } from "../_shared/openpix_client.ts";
import {
  buscarCobrancaPorOperacaoId,
  marcarCobrancaComoPaga,
  marcarCobrancaComoDivergente,
} from "../_shared/cobrancas_pix.ts";
import { reivindicarInicioRenovacao } from "../_shared/tokens_renovacao.ts";
import { reivindicarInicioRenovacaoLote } from "../_shared/renovacoes_lote.ts";
import { dispararWorkflowRenovacaoSigma } from "../_shared/github_actions_dispatch.ts";
import { enviarMensagemWhatsApp } from "../_shared/whatsapp_client.ts";
import { inserirMensagem } from "../_shared/mensagens_atendimento.ts";
import { MENSAGEM_RENOVACAO_EM_ANDAMENTO } from "../_shared/mensagens_fixas.ts";

interface OpenPixWebhookPayload {
  event?: string;
  // Camada 1 de observabilidade (2026-08-29): campos opcionais e
  // DEFENSIVOS -- so' pra LOGAR identificadores de cobranca/transacao
  // quando o evento NAO e' CHARGE_COMPLETED (payload de estrutura
  // diferente). Nenhum deles altera comportamento; o unico campo lido
  // pra decidir algo continua sendo `charge.correlationID` no caminho
  // CHARGE_COMPLETED.
  charge?: { correlationID?: string; globalID?: string; status?: string };
  pixQrCode?: { correlationID?: string };
  pixTransaction?: { endToEndId?: string; transactionID?: string };
  pix?: { endToEndId?: string; transactionID?: string };
}

// Observabilidade (Camada 1) -- extrai SO' identificadores de
// cobranca/transacao do payload. NUNCA nome, CPF/CNPJ, chave Pix ou
// qualquer dado do pagador. Tudo opcional/defensivo.
function idsNaoSensiveis(p: OpenPixWebhookPayload): Record<string, string> {
  const ids: Record<string, string> = {};
  const cc = p.charge?.correlationID ?? p.pixQrCode?.correlationID;
  if (cc) ids.correlationID = cc;
  if (p.charge?.globalID) ids.chargeGlobalID = p.charge.globalID;
  if (p.charge?.status) ids.chargeStatus = p.charge.status;
  const e2e = p.pixTransaction?.endToEndId ?? p.pix?.endToEndId;
  if (e2e) ids.endToEndId = e2e;
  const txid = p.pixTransaction?.transactionID ?? p.pix?.transactionID;
  if (txid) ids.transactionID = txid;
  return ids;
}

async function processarCobrancaCompleted(correlationId: string): Promise<void> {
  // Reconsulta -- nunca confia so' no payload do webhook, mesmo com
  // assinatura valida (decisao 2, acima).
  const consulta = await consultarCobrancaOpenPix(correlationId);
  if (consulta.outcome !== "success") {
    console.log(
      "[openpix-webhook] falha ao reconsultar cobranca -- nada atualizado",
      JSON.stringify({ correlationId, outcome: consulta.outcome }),
    );
    return;
  }

  if (consulta.status !== "COMPLETED") {
    // Webhook chegou, mas a reconsulta nao confirma pagamento --
    // nunca marca como pago so' porque o webhook disparou.
    console.log(
      "[openpix-webhook] reconsulta nao confirma COMPLETED, nada atualizado",
      JSON.stringify({ correlationId, statusReal: consulta.status }),
    );
    return;
  }

  const registro = await buscarCobrancaPorOperacaoId(correlationId);
  if (!registro) {
    console.log(
      "[openpix-webhook] correlationID sem registro local -- nada atualizado",
      JSON.stringify({ correlationId }),
    );
    return;
  }

  const valorBate =
    typeof consulta.amountCentavos === "number" &&
    consulta.amountCentavos === registro.valor_esperado_centavos;

  if (valorBate) {
    const registroPago = await marcarCobrancaComoPaga(correlationId);
    if (!registroPago) {
      // Camada 1 de observabilidade: reenvio de webhook de uma cobranca
      // ja processada (status != 'pendente'). Comportamento inalterado
      // (nao dispara nada) -- so' deixa rastro.
      console.log(
        "[openpix-webhook] cobranca ja processada (reenvio) -- nada a fazer",
        JSON.stringify({ correlationId }),
      );
    }
    if (registroPago) {
      // So' dispara se marcarCobrancaComoPaga afetou uma linha DE
      // VERDADE (nunca em reenvio de webhook ja processado). Async,
      // fora do ciclo de resposta -- ver Deno.serve abaixo.
      // Renovacao em lote (Etapa 1, 2026-08-29): registro.grupo_id
      // preenchido = cobranca de um lote -- reivindica o inicio pela
      // RPC de lote (lote + todos os filhos autorizada ->
      // renovacao_em_andamento numa transacao). O workflow disparado e'
      // o MESMO (renovacao-sigma.yml, input {operacao_id}); e' o
      // scripts/renovacao-sigma-workflow.mjs que, ao ler o token,
      // detecta grupo_id e processa os N filhos.
      EdgeRuntime.waitUntil(
        iniciarRenovacaoSigma(correlationId, registroPago.grupo_id ?? null),
      );
    }
  } else {
    console.log(
      "[openpix-webhook] valor pago diverge do esperado",
      JSON.stringify({
        correlationId,
        esperado: registro.valor_esperado_centavos,
        pago: consulta.amountCentavos,
      }),
    );
    await marcarCobrancaComoDivergente(correlationId);
  }
}

// Bloco 2 -- reivindica atomicamente o inicio da renovacao (primeira
// camada de prevencao de duplicidade) e dispara o workflow. Falha
// aqui e' logada, nunca propagada pra fora do waitUntil -- ja
// respondemos 200 pra OpenPix antes disso rodar. Se
// dispararWorkflowRenovacaoSigma falhar DEPOIS da reivindicacao ter
// sucesso, o token fica em 'renovacao_em_andamento' sem nenhum job
// real rodando -- e' exatamente o estado que o watchdog
// (renovacao-sigma-watchdog, janela de 15min) existe pra pegar,
// marcando resultado_ambiguo + transferencia humana. Nao precisa de
// tratamento especial aqui alem do log.
async function iniciarRenovacaoSigma(
  operacaoId: string,
  grupoId: string | null,
): Promise<void> {
  try {
    const reivindicado = grupoId
      ? await reivindicarInicioRenovacaoLote(operacaoId)
      : await reivindicarInicioRenovacao(operacaoId);
    if (!reivindicado) {
      console.log(
        "[openpix-webhook] token/lote nao estava 'autorizada' no momento do disparo -- nao disparado",
        JSON.stringify({ operacaoId, lote: !!grupoId }),
      );
      return;
    }

    // Mensagem intermediaria "renovacao em andamento" (2026-08-29).
    // Enviada UMA vez -- so' se a reivindicacao acima teve sucesso (a
    // reentrega de webhook cai no `!reivindicado` acima e nunca chega
    // aqui). Caminho UNICO para individual e lote: `reivindicado` e'
    // TokenRenovacao OU RenovacaoLote, os dois carregam telefone +
    // conversation_id. Sem branch por tipo (Sigma/UniTV e' decidido
    // dentro do workflow). BEST-EFFORT: uma falha aqui (WhatsApp ou
    // historico) NUNCA pode impedir o dispatch abaixo.
    try {
      const envio = await enviarMensagemWhatsApp(reivindicado.telefone, MENSAGEM_RENOVACAO_EM_ANDAMENTO);
      if (envio.outcome === "success") {
        await inserirMensagem(
          reivindicado.conversation_id,
          "ia",
          MENSAGEM_RENOVACAO_EM_ANDAMENTO,
          null,
        ).catch(() => {});
      }
    } catch (erro) {
      console.log(
        "[openpix-webhook] falha ao enviar a mensagem intermediaria 'renovacao em andamento' -- segue o dispatch normalmente",
        JSON.stringify({ operacaoId, erro: String(erro) }),
      );
    }

    const disparo = await dispararWorkflowRenovacaoSigma(operacaoId);
    if (disparo.outcome !== "disparado") {
      console.log(
        "[openpix-webhook] falha ao disparar workflow renovacao-sigma -- token ficara em renovacao_em_andamento ate o watchdog agir",
        JSON.stringify({ operacaoId, detalhe: disparo.detalhe }),
      );
    }
  } catch (erro) {
    console.log("[openpix-webhook] excecao ao iniciar renovacao Sigma", JSON.stringify({ operacaoId, erro: String(erro) }));
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Metodo nao suportado", { status: 405 });
  }

  const corpoBruto = await req.text();
  const assinatura = req.headers.get("x-webhook-signature");

  const validacao = await validarAssinaturaWebhookOpenPix(corpoBruto, assinatura);
  if (validacao.outcome !== "valida") {
    console.log(
      "[openpix-webhook] assinatura invalida/ausente -- descartado sem processar",
      JSON.stringify({ outcome: validacao.outcome }),
    );
    return new Response("Assinatura invalida", { status: 401 });
  }

  let payload: OpenPixWebhookPayload;
  try {
    payload = JSON.parse(corpoBruto);
  } catch {
    return new Response("Corpo nao e JSON valido", { status: 400 });
  }

  if (payload.event !== "OPENPIX:CHARGE_COMPLETED") {
    // Reconhece e descarta -- outros eventos (transacao recebida,
    // cobranca expirada, futuros tipos) nao sao tratados pelo Bloco 1.
    // Camada 1 de observabilidade (2026-08-29): ANTES isso era um
    // `return 200` SEM NENHUM rastro -- foi por isso que o diagnostico
    // do d5241cc0 (pagamento que virou uma transacao nao associada a
    // cobranca) precisou do dashboard da Woovi. Comportamento
    // INALTERADO: continua reconhecido com 200 e ignorado; so' passa a
    // ser visivel em `functions logs`.
    console.log(
      "[openpix-webhook] evento ignorado (nao e OPENPIX:CHARGE_COMPLETED)",
      JSON.stringify({ event: payload.event ?? null, ...idsNaoSensiveis(payload) }),
    );
    return new Response("EVENT_RECEIVED", { status: 200 });
  }

  const correlationId = payload.charge?.correlationID;
  if (!correlationId) {
    console.log(
      "[openpix-webhook] CHARGE_COMPLETED sem correlationID -- nada a processar",
      JSON.stringify({ event: payload.event, ...idsNaoSensiveis(payload) }),
    );
    return new Response("EVENT_RECEIVED", { status: 200 });
  }

  console.log(
    "[openpix-webhook] CHARGE_COMPLETED recebido -- reconsultando",
    JSON.stringify({ correlationId }),
  );

  try {
    await processarCobrancaCompleted(correlationId);
  } catch (erro) {
    console.log("[openpix-webhook] excecao ao processar", String(erro));
    // Erro real (banco indisponivel, etc.) -- responde 500 pra que a
    // OpenPix reenvie naturalmente, mesma filosofia do dedup do
    // Webhook do WhatsApp (nunca confirma 200 se o processamento pode
    // nao ter acontecido de verdade).
    return new Response("Erro interno ao processar", { status: 500 });
  }

  return new Response("EVENT_RECEIVED", { status: 200 });
});
