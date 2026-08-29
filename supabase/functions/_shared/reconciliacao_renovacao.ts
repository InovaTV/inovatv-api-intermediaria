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

  // 2/3/4) Pagamento COMPLETED e valor confere -> nucleo de recuperacao
  //         (portao de vencedor unico), compartilhado com reconciliarSePago.
  return executarRecuperacao(params.operacaoId, params.tipo);
}

export type ResultadoReconciliacaoSePago =
  // Woovi confirmou COMPLETED + valor exato E este chamador reivindicou o
  // inicio da renovacao -> workflow disparado (ou tentado).
  | { outcome: "recuperado_disparado" }
  | { outcome: "recuperado_dispatch_falhou" }
  // Woovi confirmou COMPLETED + valor exato, mas o token/lote ja passou de
  // 'autorizada' (webhook real / outro watchdog ganhou a corrida). Pagamento
  // NAO perdido -- a renovacao ja esta' em andamento.
  | { outcome: "ja_em_andamento" }
  // Qualquer coisa que NAO seja "COMPLETED + valor exato". ZERO escrita: nao
  // marca 'pago', nao marca 'valor_divergente', nao expira, nao cancela, nao
  // transfere. A expiracao (Caso C) e a conciliacao de divergencia (Caso E)
  // continuam 100% no sweep de expira_em (Peca 3).
  | {
      outcome: "nao_recuperado";
      motivo: "woovi_indisponivel" | "nao_pago" | "sem_registro" | "valor_divergente";
      statusWoovi?: string | null;
    };

// CAMADA 3 (2026-08-29) -- reconciliacao ANTECIPADA, chamada pelo watchdog para
// uma cobranca 'autorizada' + vinculada AINDA DENTRO da janela de 2h (criada ha'
// >= 5min). Objetivo unico: se o webhook OPENPIX:CHARGE_COMPLETED se perdeu,
// recuperar em ~minutos em vez de esperar as 2h do sweep de expira_em.
//
// REGRA ESTRITA: COMPLETED + valor exato -> recupera pelo MESMO nucleo do fluxo
// normal (executarRecuperacao, identico ao openpix-webhook). QUALQUER outro
// resultado (ACTIVE / EXPIRED / Woovi indisponivel / sem registro local / valor
// divergente) -> no-op absoluto, nenhuma escrita. Esta camada NUNCA expira,
// cancela ou marca divergencia -- essa responsabilidade e' exclusiva do sweep
// de expira_em.
export async function reconciliarSePago(params: {
  operacaoId: string;
  tipo: "individual" | "lote";
}): Promise<ResultadoReconciliacaoSePago> {
  const consulta = await consultarCobrancaOpenPix(params.operacaoId);
  if (consulta.outcome !== "success") {
    return { outcome: "nao_recuperado", motivo: "woovi_indisponivel" };
  }
  if (consulta.status !== "COMPLETED") {
    return { outcome: "nao_recuperado", motivo: "nao_pago", statusWoovi: consulta.status };
  }

  const registro = await buscarCobrancaPorOperacaoId(params.operacaoId);
  if (!registro) return { outcome: "nao_recuperado", motivo: "sem_registro" };

  const valorBate =
    typeof consulta.amountCentavos === "number" &&
    consulta.amountCentavos === registro.valor_esperado_centavos;
  if (!valorBate) {
    // Deliberadamente NAO chama marcarCobrancaComoDivergente -- Camada 3 nao
    // escreve nada fora do caminho de recuperacao confirmada. O sweep de
    // expira_em (Caso E) marca a divergencia e transfere quando a hora chegar.
    return { outcome: "nao_recuperado", motivo: "valor_divergente" };
  }

  return executarRecuperacao(params.operacaoId, params.tipo);
}

// Nucleo de recuperacao -- 100% do "portao de vencedor unico"
// (marcarCobrancaComoPaga -> reivindicarInicio -> dispatch). Chamado tanto por
// reconciliarPagamentoRenovacao (sweep de expira_em) quanto por
// reconciliarSePago (Camada 3): um unico caminho de recuperacao, um CAS por
// passo -> exatamente um vencedor por transicao; disparo duplo do GitHub
// Actions e' impossivel (exigiria dois vencedores do passo 3).
//
// PRE-CONDICAO do chamador: a Woovi ja confirmou COMPLETED e o valor ja bateu
// com o registro local.
async function executarRecuperacao(
  operacaoId: string,
  tipo: "individual" | "lote",
): Promise<{ outcome: "recuperado_disparado" | "recuperado_dispatch_falhou" | "ja_em_andamento" }> {
  // 2) Marca paga -- CAS status='pendente'. null = webhook real / outro
  //    watchdog ja marcou 'pago'; seguimos mesmo assim pra tentar terminar o
  //    passo 3 (o pagamento nao pode ficar sem renovacao).
  await marcarCobrancaComoPaga(operacaoId).catch(() => {});

  // 3) Portao de vencedor unico: 'autorizada' -> 'renovacao_em_andamento'.
  //    null -> ja esta' em andamento (outro caminho ganhou) -> FIM.
  const reivindicado =
    tipo === "lote"
      ? await reivindicarInicioRenovacaoLote(operacaoId)
      : await reivindicarInicioRenovacao(operacaoId);
  if (!reivindicado) return { outcome: "ja_em_andamento" };

  // 4) Dispara o workflow. Se falhar, o token/lote fica
  //    'renovacao_em_andamento' e o sweep de 15min ja existente
  //    (buscarRenovacoesEmAndamentoAntigos / buscarLotesEmAndamentoAntigos) o
  //    pega -> 'resultado_ambiguo' + transferencia. Mesma rede de seguranca
  //    que o webhook real ja usa.
  const disparo = await dispararWorkflowRenovacaoSigma(operacaoId);
  return disparo.outcome === "disparado"
    ? { outcome: "recuperado_disparado" }
    : { outcome: "recuperado_dispatch_falhou" };
}
