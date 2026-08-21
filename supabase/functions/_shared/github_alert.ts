// Cria issue no GitHub como alerta de sessao do Rocket expirada
// (opcao 1 aprovada pelo usuario -- reaproveita infraestrutura ja
// existente, zero servico novo). Token dedicado
// (GITHUB_ALERT_TOKEN), fine-grained, escopo minimo (Issues:
// read/write num unico repositorio) -- nunca o token amplo da gh CLI
// interativa.

const REPO_OWNER = "InovaTV";
const REPO_NAME = "inovatv-api-intermediaria";

export interface DetalhesAlertaSessao {
  detectadoEm: string;
  ultimaVerificacaoBemSucedidaEm: string | null;
}

export async function criarIssueSessaoRocketExpirada(
  detalhes: DetalhesAlertaSessao,
): Promise<{ numero: number } | null> {
  const token = Deno.env.get("GITHUB_ALERT_TOKEN");
  if (!token) {
    console.error("GITHUB_ALERT_TOKEN ausente -- alerta nao pode ser criado.");
    return null;
  }

  const corpo = [
    "A sessao do Rocket usada pelas automacoes de renovacao deixou de ser valida.",
    "",
    "**As renovacoes automaticas estao temporariamente suspensas.**",
    "",
    `- Detectado em: ${detalhes.detectadoEm}`,
    `- Ultima verificacao valida conhecida: ${detalhes.ultimaVerificacaoBemSucedidaEm ?? "nunca confirmada"}`,
    "",
    "**Proximo passo:** faca login novamente no Rocket e atualize a sessao para reativar a automacao.",
  ].join("\n");

  const res = await fetch(
    `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/issues`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "inovatv-rocket-session-monitor",
      },
      body: JSON.stringify({
        title: "⚠️ Sessão do Rocket expirada",
        body: corpo,
        labels: ["alerta-automatico", "sessao-rocket"],
      }),
    },
  );

  if (!res.ok) {
    const erro = await res.text().catch(() => "");
    console.error("Falha ao criar issue de alerta no GitHub:", res.status, erro);
    return null;
  }

  const json = await res.json();
  return { numero: json.number };
}
