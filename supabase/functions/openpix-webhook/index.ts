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
//      status em cobrancas_pix. NAO envia mensagem ao cliente, NAO
//      gera token, NAO chama Sigma, NAO altera vencimento -- a
//      mensagem final de confirmacao (Message Template
//      "pagamento_confirmado", ja aprovado pela Meta) e' disparada
//      depois da renovacao real no Sigma, isso e' Bloco 2, ainda nao
//      implementado. Anunciar "pagamento confirmado" aqui, antes da
//      renovacao acontecer de verdade, seria uma afirmacao falsa.
//   5. Idempotencia contra reenvio de webhook: marcarCobrancaComoPaga/
//      marcarCobrancaComoDivergente so' atualizam uma linha que ainda
//      esteja 'pendente' (WHERE status='pendente') -- um segundo
//      webhook para a mesma cobranca (ja processada) vira no-op, sem
//      tabela de deduplicacao dedicada (diferente do Webhook do
//      WhatsApp, que precisa dedup por nao ter esse filtro de estado
//      natural).
//
// Evento OPENPIX:CHARGE_COMPLETED e' o unico tratado -- qualquer outro
// (ou payload sem correlationID reconhecivel) e' reconhecido com 200 e
// ignorado, mesma filosofia do Webhook do WhatsApp (nunca fazer a
// OpenPix reenviar por erro nosso quando o evento simplesmente nao e'
// relevante pra nos).

import { validarAssinaturaWebhookOpenPix } from "../_shared/openpix_webhook_signature.ts";
import { consultarCobrancaOpenPix } from "../_shared/openpix_client.ts";
import {
  buscarCobrancaPorOperacaoId,
  marcarCobrancaComoPaga,
  marcarCobrancaComoDivergente,
} from "../_shared/cobrancas_pix.ts";

interface OpenPixWebhookPayload {
  event?: string;
  charge?: { correlationID?: string };
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
    await marcarCobrancaComoPaga(correlationId);
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
    // Reconhece e descarta -- outros eventos (ex: futuros tipos que a
    // OpenPix venha a enviar) nao sao relevantes pro Bloco 1.
    return new Response("EVENT_RECEIVED", { status: 200 });
  }

  const correlationId = payload.charge?.correlationID;
  if (!correlationId) {
    console.log("[openpix-webhook] payload CHARGE_COMPLETED sem correlationID");
    return new Response("EVENT_RECEIVED", { status: 200 });
  }

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
