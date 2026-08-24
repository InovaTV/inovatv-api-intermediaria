// Consulta direta ao Rocket para obter o valor real do plano do
// cliente -- usado EXCLUSIVAMENTE no momento de criar uma cobranca
// PagBank (Bloco 1, 2026-08-23, fluxo de renovacao automatica). NUNCA
// via /status (que alimenta o contexto do Gemini) -- decisao
// arquitetural ja fechada e documentada (Lacuna 7,
// docs/renovacao_automatica/levantamentos/
// 2026-08-22_fluxo_renovacao_automatica_pagbank_rocket_cloudapi.md):
// "consultar cliente no Rocket... NUNCA a /status que alimenta a IA,
// allowlist dela permanece intocada". /status foi revertido nesta
// mesma etapa para nao mais incluir `valor` (ver status/index.ts).
//
// Mesmo padrao de chamada direta ja usado em
// poc-confirmacao-renovacao/index.ts (GET /gerenciador/api/v1/cliente/{id},
// ROCKET_API_KEY) -- nao reinventa nada, so isola numa funcao
// reutilizavel.
//
// `valor` sai exatamente como o Rocket devolve (numero ou texto,
// formato observado varia) -- normalizado so' no ponto de uso
// (mensagens_fixas.ts: parseValorReais/formatarValorBRL/paraCentavos).

export interface ValorClienteRocket {
  outcome: "success";
  valor: string | number | null;
  nome: string | null;
  servidorNome: string | null;
  planoNome: string | null;
}

export type ConsultaValorClienteResultado = ValorClienteRocket | { outcome: "unavailable" };

const TIMEOUT_MS = 10000;

export async function consultarValorClienteRocket(
  publicId: string,
): Promise<ConsultaValorClienteResultado> {
  const rocketBaseUrl = Deno.env.get("ROCKET_BASE_URL");
  const rocketApiKey = Deno.env.get("ROCKET_API_KEY");
  if (!rocketBaseUrl || !rocketApiKey) return { outcome: "unavailable" };

  try {
    const resp = await fetch(
      `${rocketBaseUrl}/gerenciador/api/v1/cliente/${encodeURIComponent(publicId)}`,
      {
        headers: { "X-API-Key": rocketApiKey },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    if (!resp.ok) return { outcome: "unavailable" };

    const data = await resp.json().catch(() => null);
    const cliente = data?.cliente;
    if (!cliente) return { outcome: "unavailable" };

    return {
      outcome: "success",
      valor: cliente.valor ?? null,
      nome: cliente.nome ?? null,
      servidorNome: cliente.servidor?.nome ?? null,
      planoNome: cliente.plano?.nome ?? null,
    };
  } catch {
    return { outcome: "unavailable" };
  }
}
