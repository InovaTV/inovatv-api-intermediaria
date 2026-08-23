// Etapa 3 (teste controlado, ver CLAUDE.md do inovatv_central) --
// prova o mecanismo de autenticacao/escrita no Google Drive usando um
// arquivo criado pelo proprio app (CLIENTES_INOVATV_TESTE.xlsx),
// nunca o arquivo real conectado a Meta AI.
//
// Sequencia: autentica (refresh_token -> access_token) -> cria o
// arquivo de teste com o conteudo da Etapa 2 -> files.get confirma ->
// files.update substitui o conteudo -> files.get de novo confirma
// mesmo fileId -> files.list confirma que nao existe duplicata.

import fs from "node:fs";
import path from "node:path";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Defina GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET antes de rodar.");
  process.exit(1);
}

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
console.log("1. Autenticacao OAuth2: OK (access_token obtido via refresh_token)");

const MIME_XLSX =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const TEST_FILE_NAME = "CLIENTES_INOVATV_TESTE.xlsx";

const originalPath = path.join(import.meta.dirname, "output", "CLIENTES_INOVATV.xlsx");
const originalBytes = fs.readFileSync(originalPath);

// --- 2. Cria o arquivo de teste (multipart: metadata + conteudo) ---
function buildMultipartBody(metadata, mimeType, bytes) {
  const boundary = "inovatv-teste-etapa3-boundary";
  const metadataPart =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify(metadata) +
    `\r\n`;
  const mediaHeader = `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`;
  const closing = `\r\n--${boundary}--`;
  return Buffer.concat([
    Buffer.from(metadataPart, "utf-8"),
    Buffer.from(mediaHeader, "utf-8"),
    bytes,
    Buffer.from(closing, "utf-8"),
  ]);
}

const createBody = buildMultipartBody({ name: TEST_FILE_NAME }, MIME_XLSX, originalBytes);

const createRes = await fetch(
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,md5Checksum",
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "multipart/related; boundary=inovatv-teste-etapa3-boundary",
    },
    body: createBody,
  },
);
const created = await createRes.json();
if (!createRes.ok) {
  console.error("Falha ao criar arquivo de teste:", created);
  process.exit(1);
}
console.log(`2. Arquivo de teste criado: nome="${created.name}", fileId=${created.id}`);
console.log(`   md5Checksum inicial: ${created.md5Checksum}`);

const fileId = created.id;

// --- 3. files.get confirma o arquivo criado ---
const get1Res = await fetch(
  `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,md5Checksum`,
  { headers: { Authorization: `Bearer ${accessToken}` } },
);
const get1 = await get1Res.json();
console.log(
  `3. files.get confirma: nome="${get1.name}", id=${get1.id}, mimeType=${get1.mimeType}`,
);

// --- 4. Gera conteudo v2 (mesma allowlist + marcador de teste) e faz files.update ---
const { default: ExcelJS } = await import("exceljs");
const readWb = new ExcelJS.Workbook();
await readWb.xlsx.load(originalBytes);
const readSheet = readWb.getWorksheet("Clientes");
const rows = [];
readSheet.eachRow((row, rowNumber) => {
  if (rowNumber === 1) return;
  rows.push(row.values.slice(1));
});

const writeWb = new ExcelJS.Workbook();
const writeSheet = writeWb.addWorksheet("Clientes");
const columns = [
  "nome", "telefone", "usuario", "plano", "servidor",
  "valor", "vencimento", "telas", "aplicativo", "dispositivo",
];
writeSheet.columns = columns.map((key) => ({ header: key, key }));
for (const values of rows) {
  writeSheet.addRow(values);
}
writeSheet.addRow([]);
writeSheet.addRow([`Marcador de teste Etapa 3: ${new Date().toISOString()}`]);
const v2Buffer = await writeWb.xlsx.writeBuffer();

const updateRes = await fetch(
  `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&fields=id,name,md5Checksum`,
  {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": MIME_XLSX,
    },
    body: v2Buffer,
  },
);
const updated = await updateRes.json();
if (!updateRes.ok) {
  console.error("Falha ao atualizar arquivo de teste:", updated);
  process.exit(1);
}
console.log(`4. files.update executado: fileId=${updated.id}`);
console.log(`   md5Checksum apos update: ${updated.md5Checksum}`);

// --- 5. files.get de novo, confirma mesmo fileId ---
const get2Res = await fetch(
  `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,md5Checksum,modifiedTime`,
  { headers: { Authorization: `Bearer ${accessToken}` } },
);
const get2 = await get2Res.json();
console.log(
  `5. files.get pos-update: id=${get2.id}, md5Checksum=${get2.md5Checksum}, modifiedTime=${get2.modifiedTime}`,
);
console.log(`   Mesmo fileId preservado: ${get2.id === fileId}`);
console.log(`   Conteudo realmente mudou (checksum diferente): ${created.md5Checksum !== get2.md5Checksum}`);

// --- 6. files.list confirma ausencia de duplicata ---
const listRes = await fetch(
  `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
    `name='${TEST_FILE_NAME}' and trashed=false`,
  )}&fields=files(id,name)`,
  { headers: { Authorization: `Bearer ${accessToken}` } },
);
const list = await listRes.json();
console.log(`6. files.list encontrou ${list.files.length} arquivo(s) com o nome "${TEST_FILE_NAME}":`);
for (const f of list.files) {
  console.log(`   - id=${f.id}`);
}
console.log(`   Duplicata? ${list.files.length > 1 ? "SIM (problema)" : "Nao"}`);
