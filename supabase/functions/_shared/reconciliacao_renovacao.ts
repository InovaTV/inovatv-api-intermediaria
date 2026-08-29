// Peca 3 do gerenciamento de estado conversacional (2026-08-29).
// Recuperacao de pagamento a partir do watchdog (por TEMPO), reusando
// EXATAMENTE as primitivas CAS que o openpix-webhook ja usa (por
// HTTP) -- nenhum caminho de negocio novo, so' um chamador diferente.
//
// Criterio obrigatorio: NUNCA perder um pagamento que a Woovi tenha
// efetivamente concluido (status COMPLETED). Idempotente e seguro sob
// concorrencia com: o webhook real, multiplas execucoes do watchdog,
// a expiracao (Caso C) e outra recuperacao simultanea. Cada passo e'
// um CAS na coluna de origem -> exatamente um vencedor por transicao;
// disparo duplo do GitHub Actions e' impossivel (exigiria dois
// vencedores do passo 3).

import { consultarCobrancaOpenPix } from "./openpix_client.ts";
import {
  buscarCobrancaPorOperacaoId,
  marcarCobrancaComoPaga,
  marcarCobrancaComoDivergente,
} from "./cobrancas_pix.ts";
import { reivindicarInicioRenovacao } from "./tokens_renovacao.ts";
import { reivindicarInicioRenovacaoLote } from "./renovacoes_lote.ts";
import { dispararWorkflowRenovacaoSigma } from "./github_actions_dispatch.ts";

export type ResultadoReconciliacao =
  // Woovi confirmou COMPLETED e este chamador reivindicou o inicio da
  // renovacao com sucesso -> workflow disparado (ou tentado).
  | { outcome: "recuperado_disparado" }
  | { outcome: "recuperado_dispatch_falhou" }
  // Woovi confirmou COMPLETED, mas o token/lote ja passou de
  // 'autorizada' (webhook real / outro watchdog ganhou a corrida). A
  // renovacao ja esta' em andamento -> nada a fazer, pagamento NAO
  // perdido.
  | { outcome: "ja_em_andamento" }
  // Woovi diz que a cobranca ainda NAO foi paga (ACTIVE/EXPIRED/...).
  // O chamador deve seguir com a expiracao (Caso C).
  | { outcome: "nao_pago"; statusWoovi: string | null }
  // Woovi confirmou COMPLETED com valor divergente do esperado. A
  // cobranca foi marcada 'valor_divergente'; o chamador transfere pra
  // humano e libera o acesso (Caso E). NUNCA marca 'pago' por
  // aproximacao.
  | { outcome: "valor_divergente" }
  // Nao deu pra falar com a Woovi, ou nao ha' registro local da
  // cobranca. Nao faz nada -- tenta de novo no proximo ciclo do
  // watchdog.
  | { outcome: "indefinido" };

export async function reconciliarPagamentoRenovacao(params: {
  operacaoId: string;
  tipo: "individual" | "lote";
}): Promise<ResultadoReconciliacao> {
  // 1) Fonte da verdade: a Woovi, nunca o payload de um webhook (que
  //    aqui nem existe -- e' o watchdog chamando).
  const consulta = await consultarCobrancaOpenPix(params.operacaoId);
  if (consulta.outcome !== "success") return { outcome: "indefinido" };

  if (consulta.status !== "COMPLETED") {
    return { outcome: "nao_pago", statusWoovi: consulta.status };
  }

  const registro = await buscarCobrancaPorOperacaoId(params.operacaoId);
  if (!registro) return { outcome: "indefinido" };

  const valorBate =
    typeof consulta.amountCentavos === "number" &&
    consulta.amountCentavos === registro.valor_esperado_centavos;
  if (!valorBate) {
    // CAS status='pendente': se ja foi tratado, vira no-op.
    await marcarCobrancaComoDivergente(params.operacaoId).catch(() => {});
    return { outcome: "valor_divergente" };
  }

  // 2) Marca paga -- CAS status='pendente'. null = webhook real / outro
  //    watchdog ja marcou 'pago'; seguimos mesmo assim pra tentar
  //    terminar o passo 3 (o pagamento nao pode ficar sem renovacao).
  await marcarCobrancaComoPaga(params.operacaoId).catch(() => {});

  // 3) Portao de vencedor unico: 'autorizada' -> 'renovacao_em_andamento'.
  //    null -> ja esta' em andamento (outro caminho ganhou) -> FIM.
  const reivindicado =
    params.tipo === "lote"
      ? await reivindicarInicioRenovacaoLote(params.operacaoId)
      : await reivindicarInicioRenovacao(params.operacaoId);
  if (!reivindicado) return { outcome: "ja_em_andamento" };

  // 4) Dispara o workflow. Se falhar, o token/lote fica
  //    'renovacao_em_andamento' e o sweep de 15min ja existente
  //    (buscarRenovacoesEmAndamentoAntigos / buscarLotesEmAndamentoAntigos)
  //    o pega -> 'resultado_ambiguo' + transferencia. Mesma rede de
  //    seguranca que o webhook real ja usa.
  const disparo = await dispararWorkflowRenovacaoSigma(params.operacaoId);
  return disparo.outcome === "disparado"
    ? { outcome: "recuperado_disparado" }
    : { outcome: "recuperado_dispatch_falhou" };
}
