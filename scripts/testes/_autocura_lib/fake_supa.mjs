// Fake do cliente Supabase (service-role) para os testes do monitor F2
// (_shared/autocura_monitor.ts). Cobre EXATAMENTE o subconjunto usado:
//   .from(t).select(cols).eq/lt/lte/gte/gt(col,val).order(col,{ascending}).limit(n).maybeSingle()
//   .from(t).update(patch).eq(col,val)[.eq(col2,val2)]   (via await -> aplica o patch)
//   .rpc("autocura_unitv_monitor_adquirir_lock")          (aquisicao ATOMICA do lock)
//
// A aquisicao do lock e' modelada como UMA operacao sincrona (checa a
// condicao + grava + devolve, sem await no meio) -> dois awaits
// concorrentes: o primeiro grava, o segundo ja ve o lock -> exatamente
// 1 adquire. Igual ao "UPDATE ... WHERE ... RETURNING" do Postgres.
//
// Timestamps sao strings ISO-Z (mesmo formato que o monitor gera) ->
// comparacao lexicografica == cronologica. Em PRODUCAO o Postgres faz a
// comparacao real como timestamptz.

const DEZ_MIN_MS = 10 * 60_000;

export function makeFakeSupa({ config, estado, diagnosticos = [], agora }) {
  const nowMs = () => (typeof agora === "function" ? agora().getTime() : Date.now());
  const tabelas = {
    autocura_unitv_config: [config],
    autocura_unitv_monitor_estado: [estado], // mutado in-place
    unitv_token_diagnostico: diagnosticos.slice(),
  };
  const updates = []; // historico { table, patch, via } para assercoes
  const rpcs = []; // historico de chamadas rpc

  function builder(nome) {
    const rows = tabelas[nome] ?? [];
    const filtros = [];
    let ordem = null;
    let lim = null;
    let patch = null;

    const casa = () => rows.filter((r) => filtros.every((f) => f(r)));

    const aplicarLeitura = () => {
      let out = casa();
      if (ordem) {
        out = out.slice().sort((a, b) => {
          const x = a[ordem.col];
          const y = b[ordem.col];
          const c = x < y ? -1 : x > y ? 1 : 0;
          return ordem.asc ? c : -c;
        });
      }
      if (lim != null) out = out.slice(0, lim);
      return out;
    };

    const executar = () => {
      if (patch) {
        const alvo = casa();
        for (const r of alvo) Object.assign(r, patch);
        updates.push({ table: nome, patch, afetadas: alvo.length });
        return { data: null, error: null };
      }
      return { data: aplicarLeitura(), error: null };
    };

    const api = {
      select() { return api; },
      update(p) { patch = p; return api; },
      eq(col, val) { filtros.push((r) => r[col] === val); return api; },
      lt(col, val) { filtros.push((r) => r[col] != null && r[col] < val); return api; },
      lte(col, val) { filtros.push((r) => r[col] != null && r[col] <= val); return api; },
      gte(col, val) { filtros.push((r) => r[col] != null && r[col] >= val); return api; },
      gt(col, val) { filtros.push((r) => r[col] != null && r[col] > val); return api; },
      order(col, opt) { ordem = { col, asc: opt?.ascending !== false }; return api; },
      limit(n) { lim = n; return api; },
      async maybeSingle() { const o = executar(); return { data: (o.data ?? [])[0] ?? null, error: null }; },
      // await direto (updates): PostgrestFilterBuilder e' thenable
      then(res, rej) {
        try { res(executar()); } catch (e) { rej ? rej(e) : Promise.reject(e); }
      },
    };
    return api;
  }

  function rpc(nome) {
    // thenable -- executa SINCRONO quando awaited (modela atomicidade)
    return {
      then(res, rej) {
        try {
          rpcs.push(nome);
          if (nome === "autocura_unitv_monitor_adquirir_lock") {
            const e = tabelas.autocura_unitv_monitor_estado[0];
            const staleIso = new Date(nowMs() - DEZ_MIN_MS).toISOString();
            const livre = e.tick_em_andamento_desde == null || e.tick_em_andamento_desde < staleIso;
            if (!livre) {
              res({ data: [{ adquiriu: false, estado: null }], error: null });
              return;
            }
            e.tick_em_andamento_desde = new Date(nowMs()).toISOString();
            updates.push({ table: "autocura_unitv_monitor_estado", patch: { tick_em_andamento_desde: e.tick_em_andamento_desde }, via: "rpc_lock" });
            res({ data: [{ adquiriu: true, estado: { ...e } }], error: null });
            return;
          }
          res({ data: null, error: { message: `rpc fake nao implementada: ${nome}` } });
        } catch (err) {
          rej ? rej(err) : Promise.reject(err);
        }
      },
    };
  }

  return { from: builder, rpc, _updates: updates, _rpcs: rpcs, _tabelas: tabelas };
}

// Config F1 inerte (defaults) -- ponto de partida dos testes.
export function configInerte(over = {}) {
  return {
    id: 1,
    healer_ativo: false,
    modo_observacao: true,
    return_codes_que_disparam: null,
    kill_switch: false,
    pausado_ate: null,
    confirmacao_gap_min: 10,
    ...over,
  };
}

// Estado do monitor "zerado".
export function estadoZerado(over = {}) {
  return {
    id: 1,
    ultimo_tick_em: null,
    ultimo_veredito: null,
    ultimo_probe_return_code: null,
    tick_em_andamento_desde: null,
    ultimo_codigo_desconhecido_alertado: null,
    ultimo_codigo_desconhecido_alertado_em: null,
    total_ticks: 0,
    total_token_morto_confirmado: 0,
    atualizado_em: "2026-08-30T00:00:00.000Z",
    ...over,
  };
}
