// Escrita do `vencimento` de um cliente no Rocket -- PATCH cru via
// X-API-Key. Isolado aqui para nao ficar no handler da Edge Function e
// para ser testavel/fakeavel separadamente.
//
// Mecanismo COMPROVADO (docs/renovacao_automatica/SESSAO_ROCKET_MONITORAMENTO.md
// + supabase/functions/teste-patch-renovacao-newone/index.ts, teste real
// autorizado 2026-08-21): PATCH /gerenciador/api/v1/cliente/{public_id}
// com corpo { vencimento } atualiza o vencimento. PATCH cru NAO dispara
// RocketZap (so' o fluxo "ADD Pagamento" do Sigma dispara) -- o que e'
// o comportamento desejado aqui: a mensagem ao cliente sai pela nossa
// Cloud API (renovacao-sigma-resultado), nunca pelo RocketZap.
//
// SEGURANCA: a resposta crua do Rocket a este PATCH inclui `senha` e
// `device_key_or_OTP_code` em texto puro. Esta funcao NUNCA le nem
// loga o corpo da resposta -- so' o status HTTP importa. O stream do
// corpo e' descartado sem leitura.
//
// Mesma ROCKET_BASE_URL / ROCKET_API_KEY dos secrets ja existentes
// (as mesmas do caminho read-only /status). Nao ha' secret novo.

const TIMEOUT_MS = 10000;

export type ResultadoPatchVencimento =
  | { outcome: "success"; httpStatus: number }
  | { outcome: "unavailable"; httpStatus?: number };

export async function atualizarVencimentoRocket(
  publicId: string,
  vencimento: string,
): Promise<ResultadoPatchVencimento> {
  const rocketBaseUrl = Deno.env.get("ROCKET_BASE_URL");
  const rocketApiKey = Deno.env.get("ROCKET_API_KEY");
  if (!rocketBaseUrl || !rocketApiKey) return { outcome: "unavailable" };

  try {
    const resp = await fetch(
      `${rocketBaseUrl}/gerenciador/api/v1/cliente/${encodeURIComponent(publicId)}`,
      {
        method: "PATCH",
        headers: { "X-API-Key": rocketApiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ vencimento }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );

    // Descarta o corpo SEM ler (contem senha/device_key em texto puro).
    try {
      await resp.body?.cancel();
    } catch {
      // ignora -- o corpo ja pode ter sido consumido/fechado
    }

    if (!resp.ok) return { outcome: "unavailable", httpStatus: resp.status };
    return { outcome: "success", httpStatus: resp.status };
  } catch {
    return { outcome: "unavailable" };
  }
}
