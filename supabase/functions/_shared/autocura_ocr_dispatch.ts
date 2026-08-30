// F3-A -- dispara o workflow autocura-unitv-ocr.yml (calibracao de OCR)
// via API do GitHub (workflow_dispatch). ISOLADO de
// _shared/github_actions_dispatch.ts (renovacao) -- zero risco ao fluxo
// financeiro. Reusa o mesmo token GITHUB_ACTIONS_DISPATCH_TOKEN
// (fine-grained, Actions: read/write, so' neste repo).
//
// So' dispara -- nunca acompanha resultado (a API de workflow_dispatch
// devolve 204, sem run id). A correlacao com o resultado acontece pelo
// callback (autocura-unitv-resultado) usando o ciclo_id.

const REPO_OWNER = "InovaTV";
const REPO_NAME = "inovatv-api-intermediaria";
const WORKFLOW_FILE = "autocura-unitv-ocr.yml";
const TIMEOUT_MS = 10000;

export type DispararOcrResultado = { outcome: "disparado" } | { outcome: "falha"; detalhe: string };

export async function dispararWorkflowOcr(cicloId: string): Promise<DispararOcrResultado> {
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
          "User-Agent": "inovatv-autocura-ocr-dispatch",
        },
        body: JSON.stringify({ ref: "main", inputs: { ciclo_id: cicloId } }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    if (resp.status === 204) return { outcome: "disparado" };
    const corpo = await resp.text().catch(() => "");
    console.log("[autocura-ocr-dispatch] falha ao disparar", JSON.stringify({ status: resp.status, corpo }));
    return { outcome: "falha", detalhe: `HTTP ${resp.status}` };
  } catch (erro) {
    console.log("[autocura-ocr-dispatch] excecao ao disparar", String(erro));
    return { outcome: "falha", detalhe: String(erro) };
  }
}
