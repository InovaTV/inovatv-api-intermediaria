// F3-A -- LOGICA do agendador de calibracao de OCR. A EF
// autocura-unitv-ocr-agendador/index.ts e' um wrapper fino (auth +
// injecao das deps reais).
//
// 1x/dia (cron 03:00 UTC), por tick:
//   1. autocura_unitv_expirar_orfaos()  -- fecha ciclo pendurado
//   2. idade da ultima calibracao >= calibracao_intervalo_h ? senao sai
//   3. autocura_unitv_pode_disparar('calibracao') -- guards de F1
//      (kill_switch, pausado, ciclo_em_andamento, renovacao_unitv_em_voo,
//       cooldown, cap_calibracao_diario). NAO checa healer_ativo (o ramo
//       'calibracao' de pode_disparar ja ignora isso).
//   4. autocura_unitv_registrar_inicio('calibracao','agendado') -> ciclo_id
//   5. dispara o workflow autocura-unitv-ocr.yml com { ciclo_id }
//
// O QUE NAO FAZ: NUNCA 'disparo' (so' 'calibracao'). NAO faz login. NAO
// escreve no Vault. NAO altera secret. NAO chama /api/account/renew. NAO
// cria cobranca. NAO toca autocura_unitv_config (so' LE). NAO dispara o
// workflow do healer.

export interface AgendadorDeps {
  // deno-lint-ignore no-explicit-any
  supa: any; // service-role: le autocura_unitv_config / autocura_unitv_ciclos; chama RPCs F1 + expirar_orfaos
  dispararWorkflow: (cicloId: string) => Promise<{ outcome: "disparado" } | { outcome: "falha"; detalhe: string }>;
  agora?: () => Date;
}

export interface ResumoAgendador {
  outcome: "disparado" | "pulado";
  motivo?: string;         // quando pulado
  ciclo_id?: string;       // quando disparado
  orfaos_fechados?: number;
}

function log(evento: string, dados: Record<string, unknown>) {
  console.log(`[autocura-unitv-ocr-agendador] ${evento}`, JSON.stringify({ evento, ...dados }));
}

export async function executarAgendadorOcr(deps: AgendadorDeps): Promise<ResumoAgendador> {
  const { supa, dispararWorkflow } = deps;
  const agora = deps.agora ?? (() => new Date());
  const t0 = agora().getTime();
  log("inicio", { agora: new Date(t0).toISOString() });

  // 1. sweep de orfao (RPC nova de F3-A)
  let orfaos = 0;
  try {
    const { data } = await supa.rpc("autocura_unitv_expirar_orfaos");
    orfaos = typeof data === "number" ? data : (Array.isArray(data) ? Number(data[0] ?? 0) : 0);
    if (orfaos > 0) log("orfaos_fechados", { n: orfaos });
  } catch (e) {
    log("orfaos_erro", { erro: String(e) });
  }

  // 2. config: intervalo entre calibracoes
  const { data: cfg } = await supa
    .from("autocura_unitv_config")
    .select("calibracao_intervalo_h")
    .eq("id", 1)
    .maybeSingle();
  const intervaloH = Number(cfg?.calibracao_intervalo_h ?? 24);

  const { data: ultima } = await supa
    .from("autocura_unitv_ciclos")
    .select("iniciado_em")
    .eq("tipo", "calibracao")
    .order("iniciado_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (ultima?.iniciado_em) {
    const horas = (t0 - new Date(ultima.iniciado_em).getTime()) / 3_600_000;
    if (horas < intervaloH) {
      log("pulado", { motivo: "intervalo_nao_completo", horas: Math.round(horas * 10) / 10, intervalo_h: intervaloH });
      return { outcome: "pulado", motivo: "intervalo_nao_completo", orfaos_fechados: orfaos };
    }
  }

  // 3. guards de F1 (ramo 'calibracao')
  const { data: pode } = await supa.rpc("autocura_unitv_pode_disparar", { p_tipo: "calibracao" });
  const p = Array.isArray(pode) ? pode[0] : pode;
  if (!p || p.pode !== true) {
    log("pulado", { motivo: p?.motivo ?? "pode_disparar_negou" });
    return { outcome: "pulado", motivo: p?.motivo ?? "pode_disparar_negou", orfaos_fechados: orfaos };
  }

  // 4. claim atomico do ciclo (RPC F1 -- indice unico parcial garante 1 em_andamento)
  let cicloId: string;
  try {
    const { data: id, error } = await supa.rpc("autocura_unitv_registrar_inicio", {
      p_tipo: "calibracao",
      p_trigger: "agendado",
      p_return_code: null,
    });
    if (error || !id) throw new Error(error?.message ?? "registrar_inicio sem id");
    cicloId = typeof id === "string" ? id : String(id);
  } catch (e) {
    log("pulado", { motivo: "registrar_inicio_falhou", erro: String(e) });
    return { outcome: "pulado", motivo: "registrar_inicio_falhou", orfaos_fechados: orfaos };
  }

  // 5. dispara o workflow de OCR
  const disp = await dispararWorkflow(cicloId);
  if (disp.outcome !== "disparado") {
    // fecha o ciclo que nao chegou a rodar -- nao deixa orfao
    try {
      await supa.rpc("autocura_unitv_registrar_fim", {
        p_ciclo_id: cicloId,
        p_outcome: "indeterminado",
        p_failure_class: "excecao",
        p_metrics: {},
      });
    } catch (_e) { /* expirar_orfaos cobre no proximo dia */ }
    log("pulado", { motivo: "dispatch_falhou", detalhe: disp.detalhe, ciclo_id: cicloId });
    return { outcome: "pulado", motivo: "dispatch_falhou", ciclo_id: cicloId, orfaos_fechados: orfaos };
  }

  log("disparado", { ciclo_id: cicloId });
  return { outcome: "disparado", ciclo_id: cicloId, orfaos_fechados: orfaos };
}
