// F3-A -- LOGICA do callback do runner de calibracao de OCR. A EF
// autocura-unitv-resultado/index.ts e' um wrapper fino.
//
// Recebe { ciclo_id, outcome, failure_class?, metrics } do runner
// (scripts/autocura-unitv-ocr.mjs). Em F3-A so' trata tipo='calibracao'.
// Em F4 esta EF sera ESTENDIDA para tratar tipo='disparo' (healer) --
// nao agora.
//
//   * outcome='calibracao' -> registrar_fim(ciclo_id,'calibracao',null,
//     {captcha_refreshes, captcha_confianca_bucket}) + INSERT em
//     autocura_unitv_ocr_metricas (SO' agregados).
//   * outcome='indeterminado'/'falhou' -> registrar_fim(ciclo_id, outcome,
//     failure_class, {}) -- ciclo nao fica orfao.
//   * metrics.estilo_alterado === true -> alerta ao Jose (dedupe 24h via
//     autocura_unitv_monitor_estado.ultimo_codigo_desconhecido_alertado?
//     nao -- usa um marcador proprio simples: so' alerta se nao houve
//     alerta de estilo nas ultimas 24h, consultando as metricas).
//
// NUNCA recebe/grava: bytes do CAPTCHA, hash/base64 da imagem, a string
// de digitos prevista. So' numeros agregados.

import { NOME_TEMPLATE_NOVA_TRANSFERENCIA, IDIOMA_TEMPLATE_NOVA_TRANSFERENCIA } from "./mensagens_fixas.ts";

export const MOTIVO_ALERTA_ESTILO_CAPTCHA =
  "CAPTCHA do painel de revenda UniTV mudou de estilo/dimensao - pipeline de OCR da autocura precisa de revisao (F3-A)";

export interface ResultadoDeps {
  // deno-lint-ignore no-explicit-any
  supa: any;
  enviarTemplate: (
    numero: string,
    nome: string,
    idioma: string,
    params: string[],
  ) => Promise<{ outcome: "success"; messageId: string } | { outcome: "unavailable" }>;
  numeroJose: string;
  agora?: () => Date;
}

export interface ResultadoPayload {
  ciclo_id: string;
  outcome: string; // 'calibracao' | 'indeterminado' | 'falhou'
  failure_class?: string | null;
  // deno-lint-ignore no-explicit-any
  metrics?: Record<string, any>;
}

function log(evento: string, dados: Record<string, unknown>) {
  console.log(`[autocura-unitv-resultado] ${evento}`, JSON.stringify({ evento, ...dados }));
}

// colunas aceitas em autocura_unitv_ocr_metricas (allowlist -- nada
// alem disto cruza para a tabela)
const COLS_METRICAS = [
  "amostras_total", "amostras_4_segmentos", "amostras_gate_ok",
  "amostras_formato_invalido", "amostras_obviamente_invalida",
  "score_top1_p50", "score_top1_p90", "score_top1_min",
  "margem_p50", "margem_p10",
  "bucket_alta", "bucket_media", "bucket_baixa",
  "refreshes_total", "runner_sha", "estilo_alterado",
];

export async function processarResultado(
  payload: ResultadoPayload,
  deps: ResultadoDeps,
): Promise<{ outcome: "processado" | "erro"; detalhe?: string }> {
  const { supa, enviarTemplate, numeroJose } = deps;
  const agora = deps.agora ?? (() => new Date());
  const m = payload.metrics ?? {};
  log("recebido", {
    ciclo_id: payload.ciclo_id,
    outcome: payload.outcome,
    failure_class: payload.failure_class ?? null,
    amostras_total: m.amostras_total ?? null,
    amostras_gate_ok: m.amostras_gate_ok ?? null,
    login_posts: m.login_posts ?? 0, // sempre 0 -- so' pra deixar rastro
  });

  const outcomeFinal = payload.outcome === "calibracao" ? "calibracao"
    : (payload.outcome === "falhou" ? "falhou" : "indeterminado");
  const failureClass = outcomeFinal === "calibracao" ? null : (payload.failure_class ?? "excecao");

  // fecha o ciclo (RPC F1). CHECK observacao_sem_login garante que
  // login_posts nunca > 0 num ciclo modo_observacao=true.
  try {
    await supa.rpc("autocura_unitv_registrar_fim", {
      p_ciclo_id: payload.ciclo_id,
      p_outcome: outcomeFinal,
      p_failure_class: failureClass,
      p_metrics: {
        captcha_refreshes: Number(m.refreshes_total ?? 0),
        captcha_confianca_bucket: m.captcha_confianca_bucket ?? "n_a",
      },
    });
  } catch (e) {
    log("registrar_fim_erro", { ciclo_id: payload.ciclo_id, erro: String(e) });
    // segue -- ainda tenta gravar metricas; watchdog/expirar_orfaos cobre o ciclo
  }

  // Dedupe do alerta de estilo -- checado ANTES do insert desta execucao:
  // "houve alguma metrica com estilo_alterado nas ultimas 24h?".
  let jaAlertouEstilo = false;
  if (m.estilo_alterado === true && numeroJose) {
    try {
      const limite = new Date(agora().getTime() - 24 * 3_600_000).toISOString();
      const { data } = await supa
        .from("autocura_unitv_ocr_metricas")
        .select("id")
        .eq("estilo_alterado", true)
        .gte("executado_em", limite)
        .limit(1);
      jaAlertouEstilo = Array.isArray(data) && data.length >= 1;
    } catch (_e) { /* nao suprime */ }
  }

  // grava metricas SO' em calibracao
  if (outcomeFinal === "calibracao") {
    const linha: Record<string, unknown> = { ciclo_id: payload.ciclo_id };
    for (const c of COLS_METRICAS) if (m[c] !== undefined) linha[c] = m[c];
    linha.amostras_total = Number(m.amostras_total ?? 0);
    try {
      const { error } = await supa.from("autocura_unitv_ocr_metricas").insert(linha);
      if (error) log("insert_metricas_erro", { ciclo_id: payload.ciclo_id, erro: String(error.message ?? error) });
    } catch (e) {
      log("insert_metricas_excecao", { ciclo_id: payload.ciclo_id, erro: String(e) });
    }
  }

  // alerta de mudanca de estilo do CAPTCHA
  if (m.estilo_alterado === true && numeroJose) {
    if (!jaAlertouEstilo) {
      try {
        await enviarTemplate(numeroJose, NOME_TEMPLATE_NOVA_TRANSFERENCIA, IDIOMA_TEMPLATE_NOVA_TRANSFERENCIA, [MOTIVO_ALERTA_ESTILO_CAPTCHA]);
        log("alerta_estilo", { ciclo_id: payload.ciclo_id, enviado: true });
      } catch (e) {
        log("alerta_estilo_erro", { ciclo_id: payload.ciclo_id, erro: String(e) });
      }
    } else {
      log("alerta_estilo", { ciclo_id: payload.ciclo_id, enviado: false, dedupe: true });
    }
  }

  return { outcome: "processado" };
}
