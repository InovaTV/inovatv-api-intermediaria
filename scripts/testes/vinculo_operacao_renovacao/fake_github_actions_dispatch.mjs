// Fake de _shared/github_actions_dispatch.ts -- so registra o disparo,
// nunca chama o GitHub de verdade.
export const disparos = [];

export async function dispararWorkflowRenovacaoSigma(operacaoId) {
  disparos.push({ operacaoId });
  return { outcome: "disparado" };
}
