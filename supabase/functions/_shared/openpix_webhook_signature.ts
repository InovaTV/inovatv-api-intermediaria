// Validacao da assinatura do webhook OpenPix (x-webhook-signature,
// RSA-SHA256) -- peca nova, nunca existiu no desenho PagBank (que
// travou antes de chegar nesta etapa). Comprovada em POC real de
// Sandbox (2026-08-24, inovatv_central/CLAUDE.md): chave publica real
// obtida do painel, verificacao real com Node crypto.createVerify
// contra 2 webhooks reais recebidos -- os dois validos.
//
// Mesma disciplina ja usada no Webhook do WhatsApp (Componente 3 §7):
// validar a assinatura sobre o CORPO BRUTO exatamente como recebido,
// antes de qualquer parsing/reserializacao -- reserializar o JSON e
// assinar de novo pode produzir uma assinatura diferente da original.
//
// A chave publica (formato PEM, "-----BEGIN PUBLIC KEY-----...") vem
// de secret (OPENPIX_WEBHOOK_PUBLIC_KEY) -- nunca hardcoded. E' dado
// publico por natureza (serve pra VERIFICAR, nunca pra assinar), mas
// tratada como secret por simplicidade operacional (mesmo mecanismo de
// configuracao das outras chaves do projeto).

export type ValidacaoAssinaturaResultado =
  | { outcome: "valida" }
  | { outcome: "invalida" }
  | { outcome: "chave_ausente" }
  | { outcome: "erro"; detalhe: string };

export async function validarAssinaturaWebhookOpenPix(
  corpoBruto: string,
  assinaturaBase64: string | null,
): Promise<ValidacaoAssinaturaResultado> {
  if (!assinaturaBase64) return { outcome: "invalida" };

  const chavePem = Deno.env.get("OPENPIX_WEBHOOK_PUBLIC_KEY");
  if (!chavePem) return { outcome: "chave_ausente" };

  try {
    const chave = await importarChavePublicaPem(chavePem);
    const assinaturaBytes = base64ParaBytes(assinaturaBase64);
    const dadosBytes = new TextEncoder().encode(corpoBruto);

    const valida = await crypto.subtle.verify(
      { name: "RSASSA-PKCS1-v1_5" },
      chave,
      assinaturaBytes,
      dadosBytes,
    );

    return valida ? { outcome: "valida" } : { outcome: "invalida" };
  } catch (erro) {
    return { outcome: "erro", detalhe: String(erro) };
  }
}

// Converte uma chave publica em PEM (SPKI, formato exportado pela
// OpenPix -- "-----BEGIN PUBLIC KEY-----") em CryptoKey utilizavel por
// crypto.subtle.verify. RSASSA-PKCS1-v1_5 com SHA-256, mesmo algoritmo
// confirmado no POC (RSA-SHA256).
async function importarChavePublicaPem(pem: string): Promise<CryptoKey> {
  const corpoBase64 = pem
    .replace(/-----BEGIN PUBLIC KEY-----/, "")
    .replace(/-----END PUBLIC KEY-----/, "")
    .replace(/\s+/g, "");

  const derBytes = base64ParaBytes(corpoBase64);

  return await crypto.subtle.importKey(
    "spki",
    derBytes,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
}

function base64ParaBytes(base64: string): Uint8Array {
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) {
    bytes[i] = binario.charCodeAt(i);
  }
  return bytes;
}
