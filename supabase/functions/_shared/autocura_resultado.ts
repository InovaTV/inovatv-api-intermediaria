// Callback do runner da autocura do UNITV_DEALER_TOKEN. A EF
// autocura-unitv-resultado/index.ts e' um wrapper fino (auth por
// X-Internal-Token, injecao das deps reais). Toda a logica vive aqui.
//
// DOIS CANAIS (o token do header decide qual):
//   * canal='ocr'  (F3-A, AUTOCURA_UNITV_OCR_CALLBACK_TOKEN) -- runner de
//     CALIBRACAO de OCR. outcome in {calibracao, indeterminado, falhou}.
//       - 'calibracao'   -> registrar_fim(ciclo,'calibracao',null,{...})
//                           + INSERT em autocura_unitv_ocr_metricas (SO' agregados).
//       - outros         -> registrar_fim(ciclo, outcome, failure_class, {});
//                           NAO grava metricas.
//       - metrics.estilo_alterado === true -> alerta ao Jose (dedupe 24h).
//   * canal='healer' (F4, AUTOCURA_UNITV_HEALER_CALLBACK_TOKEN) -- runner do
//     HEALER (scripts/autocura-unitv-token.mjs). outcome in {sucesso, falhou}.
//       - registrar_fim(ciclo, outcome, failure_class,
//                       {captcha_refreshes, captcha_confianca_bucket,
//                        login_posts, vault_gravado, alertado_jose}).
//       - sucesso -> 3a validacao INDEPENDENTE (le o Vault + /api/account
//                    read-only). Passou -> alerta informativo. Falhou ->
//                    alerta CRITICO.
//       - falhou  -> alerta URGENTE com a failure_class.
//                    revalidacao_falhou -> alerta CRITICO.
//       - dedupe: 1 alerta de disparo por janela de 6h (via
//         autocura_unitv_ciclos.alertado_jose nos ciclos recentes).
//
// NUNCA recebe/grava: bytes do CAPTCHA, hash/base64 da imagem, a string
// de digitos prevista, o token, a senha, o login. So' numeros agregados
// e o bucket de confianca. (I6)
//
// NUNCA chama /api/account/renew, /pagamento/add/, cria cobranca, nem
// altera o Edge secret UNITV_DEALER_TOKEN. A 3a validacao (canal healer)
// so' LE o Vault e faz /api/account read-only.

import { NOME_TEMPLATE_NOVA_TRANSFERENCIA, IDIOMA_TEMPLATE_NOVA_TRANSFERENCIA } from "./mensagens_fixas.ts";

export const MOTIVO_ALERTA_ESTILO_CAPTCHA =
  "CAPTCHA do painel de revenda UniTV mudou de estilo/dimensao - pipeline de OCR da autocura precisa de revisao (F3-A)";

// --- textos dos alertas do healer (canal='healer') ---
export const MSG_AUTOCURA_OK =
  "Autocura do token do painel UniTV concluida com sucesso - nenhuma acao necessaria (F4)";
export const MSG_AUTOCURA_SUCESSO_MAS_3A_FALHOU =
  "Autocura UniTV reportou sucesso mas a validacao independente falhou - RECAPTURAR o dealer token manualmente agora (F4)";
export const MSG_AUTOCURA_REVALIDACAO_CRITICA =
  "Autocura UniTV gravou o Vault mas a revalidacao falhou - o Vault pode conter token invalido - RECAPTURAR manualmente agora (F4)";
export function msgAutocuraFalhou(fc: string | null): string {
  return `Autocura do token do painel UniTV falhou (${fc ?? "desconhecido"}) - recapturar o dealer token manualmente (F4)`;
}

// Cross-check canal x outcome (usado tambem pela EF antes de processar).
export function outcomePermitidoNoCanal(canal: "ocr" | "healer", outcome: string): boolean {
  if (canal === "healer") return outcome === "sucesso" || outcome === "falhou";
  return outcome === "calibracao" || outcome === "indeterminado" || outcome === "falhou";
}

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
  // --- so' canal='healer' ---
  canal?: "ocr" | "healer";
  anchorSn?: string;
  dealerName?: string;
  // resolvedor read-only de /api/account (import de _shared/unitv_conta.ts)
  resolverConta?: (
    sn: string,
    opts: { dealerToken?: string; dealerName?: string },
  ) => Promise<{ ok: boolean }>;
}

export interface ResultadoPayload {
  ciclo_id: string;
  outcome: string; // ocr: 'calibracao'|'indeterminado'|'falhou' ; healer: 'sucesso'|'falhou'
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
  const canal = deps.canal ?? "ocr";

  // ===================================================================
  // canal='healer' (F4) -- caminho isolado; o de OCR abaixo fica intacto.
  // ===================================================================
  if (canal === "healer") {
    const outcomeFinal = payload.outcome === "sucesso" ? "sucesso" : "falhou";
    const failureClass = outcomeFinal === "sucesso" ? null : (payload.failure_class ?? "excecao");
    return await processarDisparo(payload, deps, outcomeFinal, failureClass);
  }

  // ===================================================================
  // canal='ocr' (F3-A) -- INALTERADO.
  // ===================================================================
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

// ---------------------------------------------------------------------
// canal='healer' (F4). registrar_fim + 3a validacao + alerta com dedupe.
// ---------------------------------------------------------------------
async function processarDisparo(
  payload: ResultadoPayload,
  deps: ResultadoDeps,
  outcomeFinal: "sucesso" | "falhou",
  failureClass: string | null,
): Promise<{ outcome: "processado" | "erro"; detalhe?: string }> {
  const { supa, enviarTemplate, numeroJose } = deps;
  const agora = deps.agora ?? (() => new Date());
  const m = payload.metrics ?? {};
  const ehSucesso = outcomeFinal === "sucesso";

  log("recebido", {
    ciclo_id: payload.ciclo_id,
    canal: "healer",
    outcome: outcomeFinal,
    failure_class: failureClass,
    login_posts: Number(m.login_posts ?? 0),
    vault_gravado: m.vault_gravado === true,
  });

  // 3a validacao INDEPENDENTE (so' em sucesso): le o Vault e resolve a
  // conta ancora read-only. NUNCA /renew.
  let validacao3aOk: boolean | null = null;
  if (ehSucesso && deps.resolverConta && deps.anchorSn && deps.dealerName) {
    try {
      const { data } = await supa.rpc("unitv_dealer_token_ler");
      const lido = typeof data === "string"
        ? data
        : (Array.isArray(data) && typeof data[0] === "string" ? data[0] : null);
      if (lido && lido.trim() !== "") {
        const rc = await deps.resolverConta(deps.anchorSn, { dealerToken: lido, dealerName: deps.dealerName });
        validacao3aOk = !!(rc && rc.ok);
      } else {
        validacao3aOk = false;
      }
    } catch (e) {
      log("validacao3a_excecao", { ciclo_id: payload.ciclo_id, erro: String(e) });
      validacao3aOk = false;
    }
  }

  const critico = (!ehSucesso && failureClass === "revalidacao_falhou")
    || (ehSucesso && validacao3aOk === false);

  // dedupe 6h: houve ciclo de disparo com alerta enviado nas ultimas 6h?
  let jaAlertou = false;
  if (numeroJose) {
    try {
      const limite = new Date(agora().getTime() - 6 * 3_600_000).toISOString();
      const { data } = await supa
        .from("autocura_unitv_ciclos")
        .select("id")
        .eq("tipo", "disparo")
        .eq("alertado_jose", true)
        .gte("ended_at", limite)
        .limit(1);
      jaAlertou = Array.isArray(data) && data.length >= 1;
    } catch (_e) { /* nao suprime */ }
  }
  const vaiAlertar = !!numeroJose && !jaAlertou;

  // fecha o ciclo
  try {
    await supa.rpc("autocura_unitv_registrar_fim", {
      p_ciclo_id: payload.ciclo_id,
      p_outcome: outcomeFinal,
      p_failure_class: failureClass,
      p_metrics: {
        captcha_refreshes: Number(m.captcha_refreshes ?? m.refreshes_total ?? 0),
        captcha_confianca_bucket: m.captcha_confianca_bucket ?? "n_a",
        login_posts: Number(m.login_posts ?? 0),
        vault_gravado: m.vault_gravado === true,
        alertado_jose: vaiAlertar,
      },
    });
  } catch (e) {
    log("registrar_fim_erro", { ciclo_id: payload.ciclo_id, erro: String(e) });
  }

  // monta e envia o alerta
  if (vaiAlertar) {
    let texto: string;
    if (ehSucesso && validacao3aOk !== false) texto = MSG_AUTOCURA_OK;
    else if (ehSucesso) texto = MSG_AUTOCURA_SUCESSO_MAS_3A_FALHOU;
    else if (failureClass === "revalidacao_falhou") texto = MSG_AUTOCURA_REVALIDACAO_CRITICA;
    else texto = msgAutocuraFalhou(failureClass);
    try {
      await enviarTemplate(numeroJose, NOME_TEMPLATE_NOVA_TRANSFERENCIA, IDIOMA_TEMPLATE_NOVA_TRANSFERENCIA, [texto]);
      log("alerta_disparo", { ciclo_id: payload.ciclo_id, enviado: true, critico, sucesso: ehSucesso });
    } catch (e) {
      log("alerta_disparo_erro", { ciclo_id: payload.ciclo_id, erro: String(e) });
    }
  } else {
    log("alerta_disparo", { ciclo_id: payload.ciclo_id, enviado: false, dedupe: jaAlertou });
  }

  return { outcome: "processado" };
}
