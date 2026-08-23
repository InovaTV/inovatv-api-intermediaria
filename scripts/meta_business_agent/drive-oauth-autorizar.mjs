// Etapa 3 (teste controlado) -- autorizacao OAuth2 unica com a conta
// Google real, escopo drive.file (minimo necessario, ver CLAUDE.md do
// inovatv_central). Roda uma vez; grava o refresh_token localmente,
// NUNCA no git (scripts/.credentials/, coberto pelo .gitignore).
//
// Fluxo "loopback" recomendado pelo Google para apps tipo "Desktop
// app": abre um servidor HTTP temporario em 127.0.0.1, direciona o
// usuario para a tela de consentimento do Google, captura o codigo de
// autorizacao no redirect, troca por access_token + refresh_token.

import http from "node:http";
import { URL } from "node:url";
import fs from "node:fs";
import path from "node:path";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const PORT = 8765;
const REDIRECT_URI = `http://127.0.0.1:${PORT}`;
const SCOPE = "https://www.googleapis.com/auth/drive.file";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Defina GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET antes de rodar.");
  process.exit(1);
}

const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.searchParams.set("client_id", CLIENT_ID);
authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("scope", SCOPE);
authUrl.searchParams.set("access_type", "offline");
authUrl.searchParams.set("prompt", "consent");

console.log("Abra esta URL e autorize com a conta correta:");
console.log(authUrl.toString());
console.log(`\nAguardando redirect em ${REDIRECT_URI} ...`);

const code = await new Promise((resolve, reject) => {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, REDIRECT_URI);
    const receivedCode = url.searchParams.get("code");
    const error = url.searchParams.get("error");

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    if (error) {
      res.end(`<h1>Erro na autorizacao: ${error}</h1>Pode fechar esta aba.`);
      server.close();
      reject(new Error(error));
      return;
    }
    res.end("<h1>Autorizado.</h1>Pode fechar esta aba e voltar ao terminal.");
    server.close();
    resolve(receivedCode);
  });
  server.listen(PORT);
});

const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    code,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
    grant_type: "authorization_code",
  }),
});

const tokens = await tokenResponse.json();

if (!tokenResponse.ok) {
  console.error("Falha ao trocar o codigo por tokens:", tokens);
  process.exit(1);
}

if (!tokens.refresh_token) {
  console.error(
    "Resposta sem refresh_token -- provavelmente essa conta ja autorizou este client antes sem 'prompt=consent' surtir efeito. Revogue o acesso em https://myaccount.google.com/permissions e rode de novo.",
  );
  process.exit(1);
}

const credsDir = path.join(import.meta.dirname, ".credentials");
fs.mkdirSync(credsDir, { recursive: true });
const credsPath = path.join(credsDir, "drive-test-refresh-token.json");
fs.writeFileSync(
  credsPath,
  JSON.stringify({ refresh_token: tokens.refresh_token, scope: SCOPE }, null, 2),
);

console.log(`\nOK: refresh_token salvo em ${credsPath} (fora do git).`);
console.log("Escopo concedido:", tokens.scope);
