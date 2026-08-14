// Primeira substituicao REAL do CLIENTES_INOVATV.xlsx conectado a Meta
// AI. Segue exatamente o plano registrado no CLAUDE.md do
// inovatv_central (commit 26ec01f). SO RODA UMA VEZ -- nao ha logica
// de reexecucao automatica aqui de proposito.
//
// fileId fixo como constante (nunca recebido por parametro livre).
// Sempre files.update (PATCH .../files/{fileId}?uploadType=media),
// nunca files.create. Confirma o arquivo certo ANTES de escrever --
// aborta se nome/mimeType/pasta nao baterem. Guarda backup + checksum
// do conteudo anterior. Confirma depois que o mesmo fileId permanece
// e que o conteudo realmente mudou.

import fs from "node:fs";
import path from "node:path";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Defina GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET antes de rodar.");
  process.exit(1);
}

const FILE_ID = "1MKqRAXfBsZewNvOzZjsGW9GaWraOyOx5"; // CLIENTES_INOVATV.xlsx real -- fixo, nunca por parametro
const EXPECTED_NAME = "CLIENTES_INOVATV.xlsx";
const EXPECTED_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const EXPECTED_PARENT = "1Qf14TvocQ7BoOWXzbHU18RqmoJdFlkeJ"; // pasta INOVATV_CENTRAL

const credsPath = path.join(
  import.meta.dirname,
  ".credentials",
  "drive-test-refresh-token.json",
);
const { refresh_token } = JSON.parse(fs.readFileSync(credsPath, "utf-8"));

async function getAccessToken() {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Falha ao renovar token: ${JSON.stringify(data)}`);
  return data.access_token;
}

const accessToken = await getAccessToken();
console.log("1. Autenticacao OK.\n");

// --- 2. Confirmacao final do fileId ANTES de qualquer escrita ---
const get1Res = await fetch(
  `https://www.googleapis.com/drive/v3/files/${FILE_ID}?fields=id,name,mimeType,parents,md5Checksum`,
  { headers: { Authorization: `Bearer ${accessToken}` } },
);
const before = await get1Res.json();
if (!get1Res.ok) {
  console.error("ABORTADO: files.get falhou antes da escrita.", before);
  process.exit(1);
}
console.log("2. Confirmacao antes da escrita:");
console.log(JSON.stringify(before, null, 2));

if (before.name !== EXPECTED_NAME) {
  console.error(`ABORTADO: nome inesperado ("${before.name}" != "${EXPECTED_NAME}").`);
  process.exit(1);
}
if (before.mimeType !== EXPECTED_MIME) {
  console.error(`ABORTADO: mimeType inesperado ("${before.mimeType}" != "${EXPECTED_MIME}").`);
  process.exit(1);
}
if (!before.parents || !before.parents.includes(EXPECTED_PARENT)) {
  console.error(`ABORTADO: pasta inesperada (${JSON.stringify(before.parents)}).`);
  process.exit(1);
}
console.log("   Nome, mimeType e pasta conferem. Prosseguindo.\n");

// --- 3. Backup do conteudo atual antes de sobrescrever ---
const downloadRes = await fetch(
  `https://www.googleapis.com/drive/v3/files/${FILE_ID}?alt=media`,
  { headers: { Authorization: `Bearer ${accessToken}` } },
);
if (!downloadRes.ok) {
  console.error("ABORTADO: falha ao baixar conteudo atual para backup.", await downloadRes.text());
  process.exit(1);
}
const currentBytes = Buffer.from(await downloadRes.arrayBuffer());
const backupDir = path.join(import.meta.dirname, ".credentials", "backups");
fs.mkdirSync(backupDir, { recursive: true });
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupPath = path.join(backupDir, `CLIENTES_INOVATV_antes_${timestamp}.xlsx`);
fs.writeFileSync(backupPath, currentBytes);
console.log(`3. Backup do conteudo atual salvo em ${backupPath} (fora do git).`);
console.log(`   md5Checksum ANTES: ${before.md5Checksum}\n`);

// --- 4. Le o arquivo gerado pela Etapa 2 ---
const newPath = path.join(import.meta.dirname, "output", "CLIENTES_INOVATV.xlsx");
const newBytes = fs.readFileSync(newPath);
console.log(`4. Arquivo da Etapa 2 lido: ${newPath} (${newBytes.length} bytes).\n`);

// --- 5/6. files.update (PATCH, nunca create) + horario exato ---
const horarioLocal = new Date().toISOString();
console.log(`5. Executando files.update. Horario local (antes da chamada): ${horarioLocal}`);

const updateRes = await fetch(
  `https://www.googleapis.com/upload/drive/v3/files/${FILE_ID}?uploadType=media&fields=id,name,md5Checksum,modifiedTime`,
  {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": EXPECTED_MIME,
    },
    body: newBytes,
  },
);
const after = await updateRes.json();
if (!updateRes.ok) {
  console.error("ERRO no files.update:", after);
  process.exit(1);
}
console.log("   Resposta do files.update:");
console.log(JSON.stringify(after, null, 2));

// --- 7. Confirmacao pos-escrita ---
console.log("\n6. Confirmacao pos-escrita:");
console.log(`   Mesmo fileId preservado: ${after.id === FILE_ID}`);
console.log(`   md5Checksum ANTES:  ${before.md5Checksum}`);
console.log(`   md5Checksum DEPOIS: ${after.md5Checksum}`);
console.log(`   Conteudo realmente mudou: ${before.md5Checksum !== after.md5Checksum}`);
console.log(`   modifiedTime (Drive): ${after.modifiedTime}`);
console.log(`   Horario local da chamada: ${horarioLocal}`);

const logPath = path.join(
  import.meta.dirname,
  ".credentials",
  `substituicao_${timestamp}.json`,
);
fs.writeFileSync(
  logPath,
  JSON.stringify(
    {
      fileId: FILE_ID,
      horarioLocalAntesDaChamada: horarioLocal,
      before: { md5Checksum: before.md5Checksum },
      after,
      backupPath,
      valorDeTesteAlterado: {
        cliente: "Js Informática Rp",
        servidor: "ChannelTV",
        vencimentoAnterior: "2026-08-31T23:59:00-03:00",
        vencimentoNovo: "2026-09-20T20:09:00-03:00",
      },
    },
    null,
    2,
  ),
);
console.log(`\n7. Log completo salvo em ${logPath} (fora do git).`);
