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

// Bloco 2 (2026-08-24) -- dados completos pra apresentar na tela de
// confirmacao (ACEITO/CANCELAR) e pro snapshot de tokens_renovacao.
// Mesmo endpoint/API-Key de consultarValorClienteRocket (acima) --
// so' devolve mais campos do mesmo corpo ja recebido, nao e' uma
// segunda chamada.
export interface ClienteCompletoRocket {
  outcome: "success";
  nome: string;
  servidorNome: string;
  planoNome: string;
  valor: string | number | null;
  vencimento: string;
  // `usuario` do cadastro Rocket (Etapa 2 -- Renovacao UniTV, Bloco 2).
  // Para um acesso UniTV == `sn` da conta no painel de revenda. Pode ser
  // null (acessos que nao o tenham cadastrado -- Sigma nao precisa dele).
  // NUNCA senha/device_key_or_OTP_code.
  usuario: string | null;
}

export type ConsultaClienteCompletoResultado = ClienteCompletoRocket | { outcome: "unavailable" };

export async function consultarClienteCompletoRocket(
  publicId: string,
): Promise<ConsultaClienteCompletoResultado> {
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
    if (!cliente || !cliente.nome || !cliente.servidor?.nome || !cliente.plano?.nome || !cliente.vencimento) {
      return { outcome: "unavailable" };
    }

    return {
      outcome: "success",
      nome: cliente.nome,
      servidorNome: cliente.servidor.nome,
      planoNome: cliente.plano.nome,
      valor: cliente.valor ?? null,
      vencimento: cliente.vencimento,
      // `usuario` NAO entra no guard de sucesso acima (um acesso sem
      // usuario cadastrado ainda resolve, so' vem null) -- Sigma nao
      // depende dele; UniTV sim (Bloco 3 trata usuario null como
      // fallback, nunca inventa).
      usuario: cliente.usuario ?? null,
    };
  } catch {
    return { outcome: "unavailable" };
  }
}

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
