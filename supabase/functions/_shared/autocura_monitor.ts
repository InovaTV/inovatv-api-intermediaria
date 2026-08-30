// F2 da autocura do UNITV_DEALER_TOKEN (2026-08-30) -- LOGICA do monitor
// proativo. A EF autocura-unitv-monitor/index.ts e' um wrapper fino
// (auth + injecao das dependencias reais). Toda a logica testavel vive
// aqui, com deps injetadas.
//
// Documento oficial: docs/renovacao_automatica/AUTOCURA_UNITV_DEALER_TOKEN.md
//
// O QUE FAZ, por tick (cron */15):
//   1. le autocura_unitv_config (kill_switch, pausado_ate,
//      confirmacao_gap_min; + modo_observacao / return_codes_que_disparam
//      SO' para log). kill_switch OU pausado_ate>now -> tick_pulado,
//      sem probe/alerta.
//   2. lock advisory em autocura_unitv_monitor_estado.tick_em_andamento_desde
//      (fresco < 10min -> pula; senao assume; SEMPRE libera no fim).
//   3. diagnosticarTokenUnitv({ motivoOrigem:'monitor-proativo',
//      numeroJose:'' }) -- 1 execucao completa (probes read-only, grava
//      1 linha unitv_token_diagnostico). numeroJose:'' suprime o alerta
//      da Fase 1 -> o monitor e' o unico alertante do caminho proativo.
//   4. dupla confirmacao de token_morto (regra abaixo).
//   5. UNICO alerta ao Jose (token morto confirmado, returnCode C),
//      dedupe por-codigo + 12h.
//   6. atualiza autocura_unitv_monitor_estado (ultimo tick, contadores).
//
// O QUE NAO FAZ (garantido por desenho):
//   * NAO faz login / CAPTCHA / POST de login.
//   * NAO escreve no Vault, NAO altera UNITV_DEALER_TOKEN nem secret.
//   * NAO chama /api/account/renew, NAO cria cobranca.
//   * NAO dispara workflow, NAO chama autocura_unitv_pode_disparar,
//     autocura_unitv_registrar_inicio nem _registrar_fim.
//   * NAO escreve em tokens_renovacao / renovacoes_lote / cobrancas_pix.
//   * NAO cria ciclo de disparo (nao existe ciclo em F2).
//   Unicas escritas: autocura_unitv_monitor_estado (esta tabela) e --
//   indiretamente, via diagnosticarTokenUnitv -- unitv_token_diagnostico
//   (append-only, ja em producao desde a Fase 1).
//
// DUPLA CONFIRMACAO (ajustes aprovados 2026-08-30):
//   batida 2 = a execucao DESTE tick, veredito 'token_morto', codigo C.
//   batida 1 = a execucao valida anterior MAIS RECENTE com:
//              veredito='token_morto' AND probe_return_code = C
//              AND criado_em < tickStart
//              AND criado_em >= tickStart - 24h        (janela)
//              AND criado_em <= tickStart - gap_min    (intervalo minimo)
//              AND criado_em > (ultimo token_vivo antes de tickStart)
//                  -> se houve token_vivo depois da batida 1, a sequencia
//                     anterior fica INVALIDADA; o monitor recomeca a
//                     partir de uma nova morte.
//   confirmado <=> existe batida 1 (a MAIS RECENTE que satisfaz tudo --
//                  nunca uma linha arbitrariamente antiga).
//   sem batida 1 -> 'pendente' (o proximo tick, >= gap depois, fecha).
//
// NUNCA loga: token, dealer_name, SN ancora, painel_msg textual,
// telefone/e-mail/nome. (I6)

import type { ResultadoDiagnostico } from "./unitv_token_diag.ts";
import { NOME_TEMPLATE_NOVA_TRANSFERENCIA, IDIOMA_TEMPLATE_NOVA_TRANSFERENCIA } from "./mensagens_fixas.ts";

// O staleness do lock (10 min) vive na RPC autocura_unitv_monitor_adquirir_lock
// (interval '10 minutes'), nao aqui -- a aquisicao e' um UPDATE atomico
// no Postgres, nunca uma decisao no runtime.
const CONFIRMACAO_JANELA_MS = 24 * 3_600_000; // batida 1 tem que estar nas ultimas 24h
const DEDUPE_ALERTA_MS = 12 * 3_600_000; // re-alerta mesmo codigo so' apos 12h
const DEFAULT_GAP_MIN = 10; // fallback se a config nao trouxer

// Texto do UNICO alerta de F2 (slot {{1}} do template nova_transferencia_humana).
export function motivoAlertaMonitor(c: number): string {
  return `UNITV_DEALER_TOKEN morto confirmado 2x (returnCode ${c}) - autocura F2, recapturar manual; se for rejeicao de auth genuina, autorizar em return_codes_que_disparam para F3+`;
}

export interface MonitorDeps {
  // cliente service-role (fake nos testes). So' toca
  // autocura_unitv_config (read), autocura_unitv_monitor_estado
  // (read+write) e unitv_token_diagnostico (read).
  // deno-lint-ignore no-explicit-any
  supa: any;
  // = diagnosticarTokenUnitv (real em producao). Chamada 1x por tick.
  diagnosticar: (opts: { motivoOrigem: string; numeroJose: string }) => Promise<ResultadoDiagnostico | null>;
  // = enviarTemplateWhatsApp (real em producao).
  enviarTemplate: (
    numero: string,
    nome: string,
    idioma: string,
    params: string[],
  ) => Promise<{ outcome: "success"; messageId: string } | { outcome: "unavailable" }>;
  numeroJose: string;
  agora?: () => Date;
}

export interface ResumoTick {
  outcome: "processado" | "pulado";
  motivo_pulado?: "kill_switch" | "pausado" | "sobreposto" | "config_ausente";
  veredito?: string;
  probe_return_code?: number | null;
  confirmacao?: "pendente" | "confirmado" | "nao_aplica";
  batida1_criado_em?: string | null;
  alerta?: { enviado: boolean; dedupe_suprimiu: boolean };
}

function log(evento: string, dados: Record<string, unknown>) {
  console.log(`[autocura-unitv-monitor] ${evento}`, JSON.stringify({ evento, ...dados }));
}

export async function executarTickMonitor(deps: MonitorDeps): Promise<ResumoTick> {
  const { supa, diagnosticar, enviarTemplate, numeroJose } = deps;
  const agora = deps.agora ?? (() => new Date());
  const tickId = crypto.randomUUID();
  const t0 = agora().getTime();
  const isoT0 = new Date(t0).toISOString();
  log("tick_inicio", { tick_id: tickId, agora: isoT0 });

  // ---- 1. config ----
  const { data: cfg } = await supa
    .from("autocura_unitv_config")
    .select("kill_switch, pausado_ate, confirmacao_gap_min, modo_observacao, return_codes_que_disparam")
    .eq("id", 1)
    .maybeSingle();

  if (!cfg) {
    log("tick_pulado", { tick_id: tickId, motivo: "config_ausente" });
    return { outcome: "pulado", motivo_pulado: "config_ausente" };
  }

  const gapMin = Number(cfg.confirmacao_gap_min ?? DEFAULT_GAP_MIN);
  const pausado = cfg.pausado_ate != null && new Date(cfg.pausado_ate).getTime() > t0;
  if (cfg.kill_switch === true || pausado) {
    const motivo = cfg.kill_switch === true ? "kill_switch" : "pausado";
    log("tick_pulado", { tick_id: tickId, motivo });
    await supa.from("autocura_unitv_monitor_estado").update({ atualizado_em: isoT0 }).eq("id", 1);
    return { outcome: "pulado", motivo_pulado: motivo };
  }

  // ---- 2. lock anti-sobreposicao -- AQUISICAO ATOMICA ----
  // RPC autocura_unitv_monitor_adquirir_lock() faz, num UNICO UPDATE:
  //   update ... set tick_em_andamento_desde = now()
  //    where id = 1
  //      and (tick_em_andamento_desde is null
  //           or tick_em_andamento_desde < now() - interval '10 minutes')
  //   returning *;
  // 1 linha -> este tick GANHOU (retorna adquiriu=true + a linha atual);
  // 0 linhas -> outro tick ja detem o lock fresco (adquiriu=false).
  // SEM SELECT separado -> sem janela de corrida entre decidir e adquirir.
  const { data: lockRes } = await supa.rpc("autocura_unitv_monitor_adquirir_lock");
  const r = Array.isArray(lockRes) ? lockRes[0] : null;
  if (!r || r.adquiriu !== true) {
    log("tick_pulado", { tick_id: tickId, motivo: "sobreposto" });
    return { outcome: "pulado", motivo_pulado: "sobreposto" };
  }
  // linha atual (contadores / dedupe) devolvida pela propria RPC do lock
  const est: Record<string, unknown> = (r.estado as Record<string, unknown>) ?? {};
  // valor EXATO gravado no lock -- a liberacao no finally so' zera SE
  // ainda for este valor (se um tick posterior assumiu por staleness,
  // esta liberacao vira no-op e nao "rouba" o lock do sucessor).
  const lockValue = est.tick_em_andamento_desde as string | null;

  // estado local a persistir no fim
  let ultimoCodAlertado: number | null = (est.ultimo_codigo_desconhecido_alertado as number | null) ?? null;
  let ultimoCodAlertadoEm: string | null = (est.ultimo_codigo_desconhecido_alertado_em as string | null) ?? null;
  let incrConfirmado = 0;
  const resumo: ResumoTick = { outcome: "processado" };

  try {
    // tickStart: referencia para a batida 1 (< tickStart). diagnosticar()
    // demora segundos (probes espacados ~20s), entao a linha da batida 2
    // tera criado_em >> tickStart mesmo com skew de relogio sub-segundo
    // entre o edge runtime e o proprio Postgres. Em producao a comparacao
    // e' feita pelo Postgres como timestamptz (PostgREST casta o literal).
    const tickStartIso = isoT0;

    // ---- 3. diagnostico (1 execucao completa) ----
    const diag = await diagnosticar({ motivoOrigem: "monitor-proativo", numeroJose: "" });
    const veredito = diag?.veredito ?? "indeterminado";
    const code = diag?.probe_return_code ?? null;
    resumo.veredito = veredito;
    resumo.probe_return_code = code;
    log("diagnostico", {
      tick_id: tickId,
      veredito,
      probe_return_code: code,
      ancora_status: diag?.ancora_status ?? "ausente",
      diag_falhou: diag === null,
    });

    if (veredito === "token_vivo") {
      // a sequencia de morte (se havia) reiniciou -> zera o dedupe do alerta
      ultimoCodAlertado = null;
      ultimoCodAlertadoEm = null;
      resumo.confirmacao = "nao_aplica";
      log("confirmacao", { tick_id: tickId, resultado: "nao_aplica", motivo: "token_vivo" });
    } else if (veredito !== "token_morto") {
      // indeterminado_outage / indeterminado / diag falhou -> nao avanca
      resumo.confirmacao = "nao_aplica";
      log("confirmacao", { tick_id: tickId, resultado: "nao_aplica", motivo: veredito });
    } else {
      // veredito === 'token_morto' -- code e' nao-nulo por construcao
      const C = code as number;

      // ultimo token_vivo antes de tickStart -- linha divisoria de sequencia
      const { data: vivoRow } = await supa
        .from("unitv_token_diagnostico")
        .select("criado_em")
        .eq("veredito", "token_vivo")
        .lt("criado_em", tickStartIso)
        .order("criado_em", { ascending: false })
        .limit(1)
        .maybeSingle();
      const tVivoIso: string | null = vivoRow?.criado_em ?? null;

      // batida 1 = a MAIS RECENTE token_morto/C valida
      let q = supa
        .from("unitv_token_diagnostico")
        .select("criado_em")
        .eq("veredito", "token_morto")
        .eq("probe_return_code", C)
        .lt("criado_em", tickStartIso)
        .gte("criado_em", new Date(t0 - CONFIRMACAO_JANELA_MS).toISOString())
        .lte("criado_em", new Date(t0 - gapMin * 60_000).toISOString());
      if (tVivoIso != null) q = q.gt("criado_em", tVivoIso);
      const { data: b1Row } = await q.order("criado_em", { ascending: false }).limit(1).maybeSingle();

      if (!b1Row) {
        resumo.confirmacao = "pendente";
        resumo.batida1_criado_em = null;
        log("confirmacao", {
          tick_id: tickId,
          resultado: "pendente",
          code: C,
          batida1_encontrada: false,
          houve_token_vivo_posterior: tVivoIso != null,
        });
      } else {
        // ---- CONFIRMADO ----
        resumo.confirmacao = "confirmado";
        resumo.batida1_criado_em = b1Row.criado_em;
        incrConfirmado = 1;
        const naAllowlist = Array.isArray(cfg.return_codes_que_disparam)
          ? cfg.return_codes_que_disparam.includes(C)
          : false; // NULL em F2 -> sempre false. So' informativo, NAO ramifica.
        log("confirmacao", {
          tick_id: tickId,
          resultado: "confirmado",
          code: C,
          batida1_criado_em: b1Row.criado_em,
          codigo_ja_autorizado: naAllowlist,
        });

        // ---- 5. UNICO alerta, dedupe por-codigo + 12h ----
        const jaAlertouMesmoCodRecente = ultimoCodAlertado === C &&
          ultimoCodAlertadoEm != null &&
          t0 - new Date(ultimoCodAlertadoEm).getTime() < DEDUPE_ALERTA_MS;

        if (jaAlertouMesmoCodRecente) {
          resumo.alerta = { enviado: false, dedupe_suprimiu: true };
          log("alerta_jose", { tick_id: tickId, enviado: false, dedupe_suprimiu: true });
        } else if (!numeroJose) {
          resumo.alerta = { enviado: false, dedupe_suprimiu: false };
          log("alerta_jose", { tick_id: tickId, enviado: false, motivo: "numero_jose_ausente" });
        } else {
          let enviado = false;
          try {
            const env = await enviarTemplate(
              numeroJose,
              NOME_TEMPLATE_NOVA_TRANSFERENCIA,
              IDIOMA_TEMPLATE_NOVA_TRANSFERENCIA,
              [motivoAlertaMonitor(C)],
            );
            enviado = env.outcome === "success";
          } catch (e) {
            log("alerta_jose_excecao", { tick_id: tickId, erro: String(e) });
          }
          if (enviado) {
            ultimoCodAlertado = C;
            ultimoCodAlertadoEm = isoT0;
          }
          resumo.alerta = { enviado, dedupe_suprimiu: false };
          log("alerta_jose", { tick_id: tickId, enviado, dedupe_suprimiu: false });
        }
      }
    }

    // ---- 6. persiste estado do monitor (contadores + ultimo tick) ----
    const patch: Record<string, unknown> = {
      ultimo_tick_em: isoT0,
      ultimo_veredito: veredito,
      ultimo_probe_return_code: code,
      total_ticks: Number(est.total_ticks ?? 0) + 1,
      total_token_morto_confirmado: Number(est.total_token_morto_confirmado ?? 0) + incrConfirmado,
      ultimo_codigo_desconhecido_alertado: ultimoCodAlertado,
      ultimo_codigo_desconhecido_alertado_em: ultimoCodAlertadoEm,
      atualizado_em: isoT0,
    };
    // so' aplica se este tick ainda detem o lock (nao sobrescreve os
    // contadores de um sucessor que assumiu por staleness)
    await supa
      .from("autocura_unitv_monitor_estado")
      .update(patch)
      .eq("id", 1)
      .eq("tick_em_andamento_desde", lockValue);

    log("tick_fim", {
      tick_id: tickId,
      duracao_ms: agora().getTime() - t0,
      veredito_final: veredito,
      resultado_confirmacao: resumo.confirmacao ?? "nao_aplica",
      modo_observacao: cfg.modo_observacao === true, // apenas informativo em F2
    });
    return resumo;
  } finally {
    // libera o lock SEMPRE (sucesso ou erro), mas so' se ainda for ESTE
    // tick que o detem (tick_em_andamento_desde == lockValue). Se um
    // sucessor ja assumiu por staleness, esta liberacao e' no-op.
    try {
      await supa
        .from("autocura_unitv_monitor_estado")
        .update({ tick_em_andamento_desde: null })
        .eq("id", 1)
        .eq("tick_em_andamento_desde", lockValue);
    } catch (_e) {
      // best-effort -- um lock stale e' auto-ignorado apos 10min
    }
  }
}
