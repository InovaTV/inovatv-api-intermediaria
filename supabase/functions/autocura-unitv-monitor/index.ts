// F2 da autocura do UNITV_DEALER_TOKEN (2026-08-30) -- MONITOR PROATIVO.
// Wrapper FINO: auth (X-Internal-Token == AUTOCURA_UNITV_MONITOR_TOKEN)
// + injecao das dependencias reais. Toda a logica (guards, lock, dupla
// confirmacao, alerta, metrica) vive em _shared/autocura_monitor.ts.
//
// Disparado pelo cron 'autocura-unitv-monitor' (pg_net, */15) --
// migration 20260830180000_autocura_unitv_monitor.sql.
//
// NAO faz login/CAPTCHA/POST de login, NAO altera Vault/UNITV_DEALER_TOKEN
// nem nenhum secret, NAO chama /api/account/renew, NAO cria cobranca,
// NAO dispara workflow, NAO chama autocura_unitv_pode_disparar nem
// autocura_unitv_registrar_*. Em modo observacao o maximo permitido e'
// detectar, registrar e medir.

import { errorResponse, jsonResponse } from "../_shared/http.ts";
import { getServiceClient } from "../_shared/supabase_client.ts";
import { diagnosticarTokenUnitv } from "../_shared/unitv_token_diag.ts";
import { enviarTemplateWhatsApp } from "../_shared/whatsapp_client.ts";
import { executarTickMonitor } from "../_shared/autocura_monitor.ts";

Deno.serve(async (req: Request) => {
  const tokenInterno = Deno.env.get("AUTOCURA_UNITV_MONITOR_TOKEN");
  const tokenRecebido = req.headers.get("X-Internal-Token");
  if (!tokenInterno || !tokenRecebido || tokenRecebido !== tokenInterno) {
    return errorResponse("Nao autorizado", 401);
  }

  try {
    const resumo = await executarTickMonitor({
      supa: getServiceClient(),
      diagnosticar: (opts) => diagnosticarTokenUnitv({ motivoOrigem: opts.motivoOrigem, numeroJose: opts.numeroJose }),
      enviarTemplate: enviarTemplateWhatsApp,
      numeroJose: Deno.env.get("WHATSAPP_JOSE_NUMERO") ?? "",
    });
    return jsonResponse({ outcome: "ok", ...resumo });
  } catch (e) {
    // Nunca 5xx pro cron (evita retry-storm do pg_net). Falha do tick e'
    // logada; o lock ja foi liberado no finally de executarTickMonitor.
    console.log("[autocura-unitv-monitor] excecao no tick", String(e));
    return jsonResponse({ outcome: "erro", detalhe: String(e) }, 200);
  }
});
