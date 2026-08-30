// Callback do runner da autocura do UNITV_DEALER_TOKEN. Wrapper FINO:
// autentica por X-Internal-Token e DECIDE O CANAL pelo token:
//   * AUTOCURA_UNITV_OCR_CALLBACK_TOKEN    -> canal 'ocr'    (F3-A calibracao)
//   * AUTOCURA_UNITV_HEALER_CALLBACK_TOKEN -> canal 'healer'  (F4 disparo)
// Cross-check: um outcome so' e' aceito no canal correspondente
// (o token de OCR nunca fecha um ciclo 'disparo' e vice-versa).
//
// Logica em _shared/autocura_resultado.ts. NAO faz login/CAPTCHA/POST,
// NAO altera Vault/UNITV_DEALER_TOKEN/secret, NAO chama /api/account/renew,
// NAO cria cobranca, NAO dispara workflow. A 3a validacao do canal
// 'healer' apenas LE o Vault + /api/account read-only.

import { errorResponse, jsonResponse } from "../_shared/http.ts";
import { getServiceClient } from "../_shared/supabase_client.ts";
import { enviarTemplateWhatsApp } from "../_shared/whatsapp_client.ts";
import { outcomePermitidoNoCanal, processarResultado } from "../_shared/autocura_resultado.ts";
import { resolverContaUnitv } from "../_shared/unitv_conta.ts";

Deno.serve(async (req: Request) => {
  const tokenOcr = Deno.env.get("AUTOCURA_UNITV_OCR_CALLBACK_TOKEN");
  const tokenHealer = Deno.env.get("AUTOCURA_UNITV_HEALER_CALLBACK_TOKEN");
  const recebido = req.headers.get("X-Internal-Token");

  let canal: "ocr" | "healer" | null = null;
  if (recebido && tokenOcr && recebido === tokenOcr) canal = "ocr";
  else if (recebido && tokenHealer && recebido === tokenHealer) canal = "healer";
  if (!canal) return errorResponse("Nao autorizado", 401);

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
  if (!outcomePermitidoNoCanal(canal, outcome)) {
    return errorResponse(`outcome '${outcome}' nao permitido no canal ${canal}`, 422);
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
        canal,
        anchorSn: Deno.env.get("UNITV_DIAG_ANCHOR_SN") ?? "",
        dealerName: Deno.env.get("UNITV_DEALER_NAME") ?? "",
        resolverConta: resolverContaUnitv,
      },
    );
    return jsonResponse({ outcome: "ok", canal, ...r });
  } catch (e) {
    console.log("[autocura-unitv-resultado] excecao", String(e));
    return jsonResponse({ outcome: "erro", detalhe: String(e) }, 200);
  }
});
