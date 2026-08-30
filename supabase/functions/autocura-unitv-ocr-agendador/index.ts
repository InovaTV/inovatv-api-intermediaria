// F3-A -- agendador da calibracao de OCR (modo observacao). Wrapper
// FINO: auth (X-Internal-Token == AUTOCURA_UNITV_OCR_AGENDADOR_TOKEN) +
// injecao das deps reais. Logica em _shared/autocura_ocr_agendador.ts.
//
// Disparado pelo cron 'autocura-unitv-ocr-agendador' (pg_net, 03:00 UTC)
// -- migration 20260830200000_autocura_unitv_ocr.sql.
//
// NAO faz login/CAPTCHA/POST de login, NAO altera Vault/UNITV_DEALER_TOKEN
// nem secret, NAO chama /api/account/renew, NAO cria cobranca, NAO
// dispara o workflow do healer, NAO usa 'disparo' -- so' 'calibracao'.

import { errorResponse, jsonResponse } from "../_shared/http.ts";
import { getServiceClient } from "../_shared/supabase_client.ts";
import { dispararWorkflowOcr } from "../_shared/autocura_ocr_dispatch.ts";
import { executarAgendadorOcr } from "../_shared/autocura_ocr_agendador.ts";

Deno.serve(async (req: Request) => {
  const tokenInterno = Deno.env.get("AUTOCURA_UNITV_OCR_AGENDADOR_TOKEN");
  const tokenRecebido = req.headers.get("X-Internal-Token");
  if (!tokenInterno || !tokenRecebido || tokenRecebido !== tokenInterno) {
    return errorResponse("Nao autorizado", 401);
  }

  try {
    const resumo = await executarAgendadorOcr({
      supa: getServiceClient(),
      dispararWorkflow: dispararWorkflowOcr,
    });
    return jsonResponse({ outcome: "ok", ...resumo });
  } catch (e) {
    console.log("[autocura-unitv-ocr-agendador] excecao", String(e));
    return jsonResponse({ outcome: "erro", detalhe: String(e) }, 200);
  }
});
