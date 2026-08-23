// Etapa 3 real (Picker, ver CLAUDE.md do inovatv_central) -- abre uma
// pagina local com o Google Picker para o usuario selecionar o
// CLIENTES_INOVATV.xlsx real UMA VEZ. Depois da selecao, o app passa
// a enxergar esse arquivo especifico dentro do escopo drive.file, sem
// precisar de escopo mais amplo.
//
// Nao faz nenhuma operacao de escrita. So mostra o seletor e captura
// o fileId escolhido.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const API_KEY = process.env.GOOGLE_PICKER_API_KEY;
const PORT = 8766;

if (!CLIENT_ID || !CLIENT_SECRET || !API_KEY) {
  console.error(
    "Defina GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e GOOGLE_PICKER_API_KEY antes de rodar.",
  );
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
console.log("Access token obtido (mesma autorizacao drive.file de sempre).");

const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Selecionar CLIENTES_INOVATV.xlsx</title></head>
<body>
  <h1>Selecione o CLIENTES_INOVATV.xlsx real</h1>
  <p>Escolha o arquivo dentro da pasta INOVATV_CENTRAL.</p>
  <div id="status"></div>
  <script src="https://apis.google.com/js/api.js"></script>
  <script>
    const ACCESS_TOKEN = ${JSON.stringify(tokenData.access_token)};
    const API_KEY = ${JSON.stringify(API_KEY)};

    function onApiLoad() {
      gapi.load('picker', onPickerApiLoad);
    }

    function onPickerApiLoad() {
      const view = new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS)
        .setIncludeFolders(true);
      const picker = new google.picker.PickerBuilder()
        .addView(view)
        .setOAuthToken(ACCESS_TOKEN)
        .setDeveloperKey(API_KEY)
        .setAppId('526934962744')
        .setCallback(pickerCallback)
        .build();
      picker.setVisible(true);
    }

    function pickerCallback(data) {
      if (data.action === google.picker.Action.PICKED) {
        const doc = data.docs[0];
        document.getElementById('status').innerText =
          'Selecionado: ' + doc.name + ' (fileId: ' + doc.id + ')';
        fetch('/selected', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: doc.id, name: doc.name, mimeType: doc.mimeType }),
        });
      } else if (data.action === google.picker.Action.CANCEL) {
        document.getElementById('status').innerText = 'Selecao cancelada.';
        fetch('/selected', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cancelled: true }),
        });
      }
    }

    onApiLoad();
  </script>
</body>
</html>`;

const result = await new Promise((resolve) => {
  const server = http.createServer((req, res) => {
    if (req.url === "/" ) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(html);
      return;
    }
    if (req.url === "/selected" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        res.setHeader("Content-Type", "application/json");
        res.end("{}");
        server.close();
        resolve(JSON.parse(body));
      });
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  server.listen(PORT, () => {
    console.log(`\nAbra: http://127.0.0.1:${PORT}/`);
    console.log("Aguardando selecao no Picker...");
  });
});

if (result.cancelled) {
  console.log("\nSelecao cancelada pelo usuario.");
  process.exit(1);
}

console.log("\nArquivo selecionado via Picker:");
console.log(JSON.stringify(result, null, 2));

const outPath = path.join(import.meta.dirname, ".credentials", "picked-file.json");
fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
console.log(`\nSalvo em ${outPath} (fora do git).`);

console.log("\nTeste imediato: files.get com o MESMO access_token usado no Picker (sem renovar)...");
const immediateGet = await fetch(
  `https://www.googleapis.com/drive/v3/files/${result.id}?fields=id,name,mimeType`,
  { headers: { Authorization: `Bearer ${tokenData.access_token}` } },
);
const immediateBody = await immediateGet.json();
console.log(`Status HTTP: ${immediateGet.status}`);
console.log(JSON.stringify(immediateBody, null, 2));
