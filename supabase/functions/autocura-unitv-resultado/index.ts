// F3-A -- callback do runner de calibracao de OCR. Wrapper FINO: auth
// (X-Internal-Token == AUTOCURA_UNITV_OCR_CALLBACK_TOKEN) + injecao das
// deps reais. Logica em _shared/autocura_resultado.ts.
//
// Em F3-A trata SO' tipo='calibracao'. Em F4 sera estendido para
// tipo='disparo' (healer) -- nao agora.
//
// NAO faz login/CAPTCHA/POST de login, NAO altera Vault/UNITV_DEALER_TOKEN
// nem secret, NAO chama /api/account/renew, NAO cria cobranca, NAO
// dispara workflow. So' fecha o ciclo (registrar_fim) e grava agregados
// em autocura_unitv_ocr_metricas.

import { errorResponse, jsonResponse } from "../_shared/http.ts";
import { getServiceClient } from "../_shared/supabase_client.ts";
import { enviarTemplateWhatsApp } from "../_shared/whatsapp_client.ts";
import { processarResultado } from "../_shared/autocura_resultado.ts";

Deno.serve(async (req: Request) => {
  const tokenInterno = Deno.env.get("AUTOCURA_UNITV_OCR_CALLBACK_TOKEN");
  const tokenRecebido = req.headers.get("X-Internal-Token");
  if (!tokenInterno || !tokenRecebido || tokenRecebido !== tokenInterno) {
    return errorResponse("Nao autorizado", 401);
  }

  let body: { ciclo_id?: unknown; outcome?: unknown; failure_class?: unknown; metrics?: unknown };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Corpo precisa ser JSON valido");
  }
  const cicloId = typeof body.ciclo_id === "string" ? body.ciclo_id : "";
  const outcome = typeof body.outcome === "string" ? body.outcome : "";
  if (!cicloId || !outcome) {
    return errorResponse("Campos obrigatorios: ciclo_id, outcome");
  }

  try {
    const r = await processarResultado(
      {
        ciclo_id: cicloId,
        outcome,
        failure_class: typeof body.failure_class === "string" ? body.failure_class : null,
        // deno-lint-ignore no-explicit-any
        metrics: (body.metrics && typeof body.metrics === "object") ? body.metrics as Record<string, any> : {},
      },
      {
        supa: getServiceClient(),
        enviarTemplate: enviarTemplateWhatsApp,
        numeroJose: Deno.env.get("WHATSAPP_JOSE_NUMERO") ?? "",
      },
    );
    return jsonResponse({ outcome: "ok", ...r });
  } catch (e) {
    console.log("[autocura-unitv-resultado] excecao", String(e));
    return jsonResponse({ outcome: "erro", detalhe: String(e) }, 200);
  }
});
