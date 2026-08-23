// Envia a sessao capturada localmente (scripts/.credentials/rocket-session.json)
// para a Edge Function atualizar-sessao-rocket, que grava no Supabase
// Vault e ja faz uma verificacao real. Este e' o "um comando local"
// do fluxo combinado: apos um login manual novo + captura via
// DevTools (ou capturar-sessao-rocket.mjs, quando aplicavel), rode
// este script pra propagar a sessao pra infraestrutura.
//
// Nunca imprime sessionid/csrftoken. So confirma sucesso/falha.

import { readFile } from "node:fs/promises";
import path from "node:path";

const CRED_PATH = path.join(process.cwd(), ".credentials", "rocket-session.json");
const FUNCTION_URL =
  "https://nduxsuxkopuvhwugdkqi.supabase.co/functions/v1/atualizar-sessao-rocket";

async function main() {
  const token = process.env.SESSAO_ROCKET_UPDATE_TOKEN;
  if (!token) {
    console.error(
      "Defina SESSAO_ROCKET_UPDATE_TOKEN (ja deve estar em scripts/.env) antes de rodar: " +
        "node --env-file=.env atualizar-sessao-remota.mjs",
    );
    process.exit(1);
  }

  const sessao = JSON.parse(await readFile(CRED_PATH, "utf8"));
  if (!sessao.sessionid || !sessao.csrftoken) {
    console.error("Arquivo de sessao local sem sessionid/csrftoken. Capture a sessao primeiro.");
    process.exit(1);
  }

  console.log("Enviando sessao para a infraestrutura...");
  const res = await fetch(FUNCTION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Token": token,
    },
    body: JSON.stringify({ sessionid: sessao.sessionid, csrftoken: sessao.csrftoken }),
  });

  const corpo = await res.json().catch(() => null);
  console.log("Status HTTP:", res.status);
  console.log("Resposta:", JSON.stringify(corpo, null, 2));

  if (res.ok && corpo?.sessaoValidada) {
    console.log("");
    console.log("Sessao nova validada com sucesso -- monitoramento e automacao ja usam ela.");
  } else if (res.ok) {
    console.log("");
    console.log("Sessao gravada, mas a verificacao imediata nao confirmou sucesso -- confira o Rocket.");
  } else {
    console.log("");
    console.log("Falha ao atualizar a sessao -- ver resposta acima.");
  }
}

main().catch((e) => {
  console.error("Erro:", e.message ?? e);
  process.exit(1);
});
