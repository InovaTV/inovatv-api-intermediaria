// Dispara o workflow renovacao-sigma.yml via API do GitHub
// (workflow_dispatch) -- Bloco 2, 2026-08-24. Token dedicado
// (GITHUB_ACTIONS_DISPATCH_TOKEN), fine-grained, escopo minimo
// (Actions: read/write, so' neste repositorio) -- NUNCA o
// GITHUB_ALERT_TOKEN existente (esse tem escopo Issues, nao Actions --
// nao seria suficiente, e ampliar o escopo dele misturaria duas
// responsabilidades num token so').
//
// So' dispara -- nunca acompanha o resultado (a API de
// workflow_dispatch nao devolve run id nenhum, so 204). Correlacao
// com o resultado real acontece inteiramente pelo lado de ca
// (tokens_renovacao.operacao_id + o callback em renovacao-sigma-resultado.ts),
// nunca por polling da API do GitHub.

const REPO_OWNER = "InovaTV";
const REPO_NAME = "inovatv-api-intermediaria";
const WORKFLOW_FILE = "renovacao-sigma.yml";
const TIMEOUT_MS = 10000;

export type DispararRenovacaoSigmaResultado = { outcome: "disparado" } | { outcome: "falha"; detalhe: string };

export async function dispararWorkflowRenovacaoSigma(
  operacaoId: string,
): Promise<DispararRenovacaoSigmaResultado> {
  const token = Deno.env.get("GITHUB_ACTIONS_DISPATCH_TOKEN");
  if (!token) return { outcome: "falha", detalhe: "GITHUB_ACTIONS_DISPATCH_TOKEN ausente" };

  try {
    const resp = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "User-Agent": "inovatv-renovacao-sigma-dispatch",
        },
        body: JSON.stringify({
          ref: "main",
          inputs: { operacao_id: operacaoId },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );

    if (resp.status === 204) return { outcome: "disparado" };

    const corpo = await resp.text().catch(() => "");
    console.log(
      "[github_actions_dispatch] falha ao disparar workflow",
      JSON.stringify({ status: resp.status, corpo }),
    );
    return { outcome: "falha", detalhe: `HTTP ${resp.status}` };
  } catch (erro) {
    console.log("[github_actions_dispatch] excecao ao disparar workflow", String(erro));
    return { outcome: "falha", detalhe: String(erro) };
  }
}
