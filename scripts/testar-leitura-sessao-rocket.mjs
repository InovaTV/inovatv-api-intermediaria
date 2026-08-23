// TEMPORARIO E DESCARTAVEL -- testa se a sessao capturada por
// capturar-sessao-rocket.mjs pode ser reutilizada SEM NAVEGADOR, via
// HTTP puro, para uma chamada de SOMENTE LEITURA (nao altera nenhum
// dado, nao renova nada, nao chama pagamento/add).
//
// Endpoint usado: GET /gerenciador/cliente/sigma/info/?cliente_id=X
// -- o mesmo ja documentado no levantamento (secao 10.2/11.6), so
// consulta/confirma o ID do cliente no Sigma, ja usado varias vezes
// durante a investigacao sem nenhum efeito colateral.
//
// Cliente de teste fixo (mesmo de toda a investigacao ate aqui):
// Js Informatica Rp / NewOne, id interno do Rocket = 1553554.
//
// Le sessionid/csrftoken de scripts/.credentials/rocket-session.json
// (gerado pelo capturar-sessao-rocket.mjs) -- nunca imprime os
// valores.

import { readFile } from "node:fs/promises";
import path from "node:path";

const CRED_PATH = path.join(process.cwd(), ".credentials", "rocket-session.json");
const CLIENTE_ID_INTERNO_TESTE = "1553554"; // Js Informatica Rp / NewOne

async function main() {
  let sessao;
  try {
    const raw = await readFile(CRED_PATH, "utf8");
    sessao = JSON.parse(raw);
  } catch {
    console.error(
      `Nao consegui ler ${CRED_PATH}. Rode capturar-sessao-rocket.mjs primeiro.`,
    );
    process.exit(1);
  }

  if (!sessao.sessionid || !sessao.csrftoken) {
    console.error("Arquivo de sessao encontrado, mas sem sessionid/csrftoken. Recapture a sessao.");
    process.exit(1);
  }

  const url = `https://app.rocketgestor.com/gerenciador/cliente/sigma/info/?cliente_id=${CLIENTE_ID_INTERNO_TESTE}`;
  const cookieHeader = `sessionid=${sessao.sessionid}; csrftoken=${sessao.csrftoken}`;

  console.log("Sessao capturada em:", sessao.capturadoEm);
  console.log(`Fazendo GET (somente leitura) em ${url} ...`);

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Cookie: cookieHeader,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Referer: "https://app.rocketgestor.com/gerenciador/",
      "X-Requested-With": "XMLHttpRequest",
    },
    redirect: "manual", // se a sessao expirou, o Rocket normalmente redireciona pro login -- queremos ver isso, nao seguir
  });

  console.log("--- RESULTADO ---");
  console.log("Status HTTP:", res.status);

  if (res.status >= 300 && res.status < 400) {
    console.log("Redirecionamento recebido -- Location:", res.headers.get("location"));
    console.log(
      "Isso normalmente significa que a sessao NAO e valida (redirecionado pro login).",
    );
    return;
  }

  const bodyText = await res.text();
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    body = bodyText.slice(0, 500);
  }

  console.log("Corpo da resposta:", JSON.stringify(body, null, 2));
  console.log("");
  if (res.status === 200 && !(body && body.error)) {
    console.log("SESSAO REUTILIZADA COM SUCESSO -- resposta valida sem passar pelo navegador/Turnstile.");
  } else {
    console.log("Resposta recebida, mas parece indicar erro/sessao invalida -- ver corpo acima.");
  }
}

main().catch((e) => {
  console.error("Erro inesperado:", e.message ?? e);
  process.exit(1);
});
