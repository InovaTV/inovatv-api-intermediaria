// Etapa 3 real (leitura, ver CLAUDE.md do inovatv_central) -- SOMENTE
// files.get no CLIENTES_INOVATV.xlsx ja conectado a Meta AI. Nenhuma
// escrita: sem files.update, sem files.create, sem mover de pasta.
//
// Objetivo: confirmar que o fileId corresponde ao arquivo certo e
// verificar se o escopo drive.file (da autorizacao ja feita) consegue
// enxergar um arquivo que o app nao criou nem foi selecionado via
// Picker -- resultado esperado, dado como o escopo funciona, e um
// 404 (drive.file nao concede acesso a esse arquivo).

import fs from "node:fs";
import path from "node:path";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const FILE_ID = process.argv[2];

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Defina GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET antes de rodar.");
  process.exit(1);
}
if (!FILE_ID) {
  console.error("Uso: node ler-arquivo-producao.mjs <fileId>");
  process.exit(1);
}

const credsPath = path.join(
  import.meta.dirname,
  ".credentials",
  "drive-test-refresh-token.json",
);
const { refresh_token } = JSON.parse(fs.readFileSync(credsPath, "utf-8"));

const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token,
    grant_type: "refresh_token",
  }),
});
const tokenData = await tokenRes.json();
if (!tokenRes.ok) {
  console.error("Falha ao renovar token:", tokenData);
  process.exit(1);
}
console.log("Autenticacao OK (mesma autorizacao drive.file da Etapa 3 de teste).");

const getRes = await fetch(
  `https://www.googleapis.com/drive/v3/files/${FILE_ID}?fields=id,name,mimeType,parents,webViewLink,owners,shared`,
  { headers: { Authorization: `Bearer ${tokenData.access_token}` } },
);
const body = await getRes.json();

console.log(`\nGET /drive/v3/files/${FILE_ID}`);
console.log(`Status HTTP: ${getRes.status}`);
console.log(JSON.stringify(body, null, 2));

if (!getRes.ok) {
  console.log(
    "\nRESULTADO: drive.file NAO tem acesso a este arquivo (esperado -- o app nao criou nem foi selecionado via Picker para ele).",
  );
} else {
  console.log("\nRESULTADO: drive.file conseguiu acessar o arquivo.");
}
