// Sincroniza a Planilha Google nativa "clientes" (a fonte real que o
// Meta Business Agent le) com o conteudo sanitizado ja gerado e
// validado pela Etapa 2 (gerar-clientes-xlsx.mjs + verificar-clientes-xlsx.mjs).
//
// NUNCA regenera dado do Rocket aqui -- le exclusivamente o
// output/CLIENTES_INOVATV.xlsx ja existente em disco, o mesmo que a
// verificacao independente ja confirmou. gerar-clientes-xlsx.mjs e
// verificar-clientes-xlsx.mjs nao sao alterados por este script.
//
// fileId fixo como constante (nunca por parametro livre), mesmo
// padrao ja usado em substituir-arquivo-producao.mjs. Diferenca real
// em relacao aquele script: o alvo aqui e' uma Planilha Google
// NATIVA (mimeType application/vnd.google-apps.spreadsheet), entao a
// escrita usa a Google Sheets API (values.clear/values.update), nao
// o Drive API files.update usado para o .xlsx.
//
// Escopo OAuth: drive.file e' suficiente para values.get/clear/update
// (confirmado na documentacao oficial do Google, nao presumido) --
// mesma autorizacao ja concedida antes, desde que o Picker seja
// rodado apontando para esta planilha especifica (arquivo que o app
// nao criou).

import fs from "node:fs";
import path from "node:path";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Defina GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET antes de rodar.");
  process.exit(1);
}

const FILE_ID = "1WuyPXKLnXHz0Dkgum0vy5cMDUpC85Nm9GHtrjFCMqDA"; // Planilha "clientes" real -- fixo, nunca por parametro
const EXPECTED_NAME = "clientes";
const EXPECTED_MIME = "application/vnd.google-apps.spreadsheet";
const EXPECTED_PARENT = "1Qf14TvocQ7BoOWXzbHU18RqmoJdFlkeJ"; // pasta INOVATV_CENTRAL
const SHEET_TITLE = "Clientes"; // nome da aba dentro da planilha

// Mesma allowlist/ordem ja aprovada em gerar-clientes-xlsx.mjs --
// duplicada aqui de proposito (scripts independentes, sem modulo
// compartilhado neste repositorio) para que a checagem de cabecalho
// nao dependa de importar o outro script.
const COLUMN_ORDER = [
  "nome",
  "telefone",
  "usuario",
  "plano",
  "servidor",
  "valor",
  "vencimento",
  "telas",
  "aplicativo",
  "dispositivo",
];

const CAMPOS_PROIBIDOS = ["senha", "device_key_or_otp_code"];

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

// --- 1. Le e valida o .xlsx JA GERADO (nunca regenera dado aqui) ---
const { default: ExcelJS } = await import("exceljs");
const xlsxPath = path.join(import.meta.dirname, "output", "CLIENTES_INOVATV.xlsx");
if (!fs.existsSync(xlsxPath)) {
  console.error(
    `ABORTADO: ${xlsxPath} nao existe. Rode gerar-clientes-xlsx.mjs (e verificar-clientes-xlsx.mjs) antes.`,
  );
  process.exit(1);
}
const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(xlsxPath);
const worksheet = workbook.getWorksheet("Clientes");
if (!worksheet) {
  console.error('ABORTADO: aba "Clientes" nao encontrada no .xlsx local.');
  process.exit(1);
}

const linhasBrutas = [];
worksheet.eachRow((row) => {
  // row.values[0] e' sempre undefined (ExcelJS usa indice 1-based);
  // descarta esse primeiro elemento.
  linhasBrutas.push(row.values.slice(1));
});

const headerLido = linhasBrutas[0];
const dadosLidos = linhasBrutas.slice(1);

const headerConfere =
  headerLido.length === COLUMN_ORDER.length &&
  headerLido.every((valor, i) => valor === COLUMN_ORDER[i]);
if (!headerConfere) {
  console.error("ABORTADO: cabecalho do .xlsx local nao bate com a allowlist esperada.");
  console.error("Esperado:", COLUMN_ORDER);
  console.error("Encontrado:", headerLido);
  process.exit(1);
}

for (const linha of dadosLidos) {
  for (const campo of CAMPOS_PROIBIDOS) {
    const idx = COLUMN_ORDER.findIndex((c) => c.toLowerCase() === campo);
    if (idx !== -1) {
      console.error(`ABORTADO: campo proibido "${campo}" presente na allowlist -- nao deveria estar aqui.`);
      process.exit(1);
    }
  }
}

console.log(`1. .xlsx local lido e validado: ${dadosLidos.length} linhas de dados, cabecalho conferido.\n`);

// --- 2. Autenticacao ---
const accessToken = await getAccessToken();
console.log("2. Autenticacao OK.\n");

// --- 3. Confirmacao do arquivo ANTES de qualquer leitura/escrita real ---
const metaRes = await fetch(
  `https://www.googleapis.com/drive/v3/files/${FILE_ID}?fields=id,name,mimeType,parents`,
  { headers: { Authorization: `Bearer ${accessToken}` } },
);
const meta = await metaRes.json();
if (!metaRes.ok) {
  console.error("ABORTADO: files.get falhou.", meta);
  process.exit(1);
}
console.log("3. Confirmacao de identidade do arquivo:");
console.log(JSON.stringify(meta, null, 2));
if (meta.name !== EXPECTED_NAME) {
  console.error(`ABORTADO: nome inesperado ("${meta.name}" != "${EXPECTED_NAME}").`);
  process.exit(1);
}
if (meta.mimeType !== EXPECTED_MIME) {
  console.error(`ABORTADO: mimeType inesperado ("${meta.mimeType}" != "${EXPECTED_MIME}") -- isto nao e' uma Planilha Google nativa.`);
  process.exit(1);
}
if (!meta.parents || !meta.parents.includes(EXPECTED_PARENT)) {
  console.error(`ABORTADO: pasta inesperada (${JSON.stringify(meta.parents)}).`);
  process.exit(1);
}

const sheetMetaRes = await fetch(
  `https://sheets.googleapis.com/v4/spreadsheets/${FILE_ID}?fields=sheets.properties.title`,
  { headers: { Authorization: `Bearer ${accessToken}` } },
);
const sheetMeta = await sheetMetaRes.json();
if (!sheetMetaRes.ok) {
  console.error("ABORTADO: spreadsheets.get falhou.", sheetMeta);
  process.exit(1);
}
const abaExiste = (sheetMeta.sheets ?? []).some((s) => s.properties?.title === SHEET_TITLE);
if (!abaExiste) {
  console.error(`ABORTADO: aba "${SHEET_TITLE}" nao encontrada na planilha real.`);
  console.error("Abas encontradas:", (sheetMeta.sheets ?? []).map((s) => s.properties?.title));
  process.exit(1);
}
console.log(`   Nome, mimeType, pasta e aba "${SHEET_TITLE}" conferem. Prosseguindo.\n`);

// --- 4. Backup do conteudo atual (dado cru, com senha) ANTES de limpar ---
const getRes = await fetch(
  `https://sheets.googleapis.com/v4/spreadsheets/${FILE_ID}/values/${encodeURIComponent(SHEET_TITLE)}`,
  { headers: { Authorization: `Bearer ${accessToken}` } },
);
const conteudoAtual = await getRes.json();
if (!getRes.ok) {
  console.error("ABORTADO: falha ao ler conteudo atual para backup.", conteudoAtual);
  process.exit(1);
}

const backupDir = path.join(import.meta.dirname, ".credentials", "backups");
fs.mkdirSync(backupDir, { recursive: true });
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupPath = path.join(backupDir, `clientes_planilha_antes_${timestamp}.json`);
fs.writeFileSync(backupPath, JSON.stringify(conteudoAtual, null, 2));

// Verificacao obrigatoria do backup ANTES de qualquer clear() --
// aborta sem tocar a planilha se o backup falhar, estiver vazio ou
// nao puder ser confirmado (exigencia explicita do usuario).
if (!fs.existsSync(backupPath)) {
  console.error("ABORTADO: arquivo de backup nao foi criado.");
  process.exit(1);
}
const backupStat = fs.statSync(backupPath);
if (backupStat.size === 0) {
  console.error("ABORTADO: arquivo de backup foi criado vazio (0 bytes).");
  process.exit(1);
}
const backupRelido = JSON.parse(fs.readFileSync(backupPath, "utf-8"));
const linhasNoBackup = Array.isArray(backupRelido.values) ? backupRelido.values.length : 0;
if (linhasNoBackup === 0) {
  console.error("ABORTADO: backup relido do disco nao contem nenhuma linha (values vazio ou ausente).");
  process.exit(1);
}
console.log(`4. Backup do conteudo atual salvo, verificado e relido com sucesso:`);
console.log(`   ${backupPath}`);
console.log(`   Linhas no backup: ${linhasNoBackup} (inclui cabecalho cru original, fora do git).\n`);

// --- 5. Limpar a aba inteira (SO depois do backup confirmado) ---
console.log("5. Executando values.clear (aba inteira)...");
const clearRes = await fetch(
  `https://sheets.googleapis.com/v4/spreadsheets/${FILE_ID}/values/${encodeURIComponent(SHEET_TITLE)}:clear`,
  { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } },
);
const clearBody = await clearRes.json();
if (!clearRes.ok) {
  console.error("ERRO no values.clear:", clearBody);
  process.exit(1);
}
console.log("   Aba limpa.\n");

// --- 6. Escrever cabecalho + dados sanitizados ---
console.log("6. Executando values.update com os dados sanitizados...");
const valores = [COLUMN_ORDER, ...dadosLidos];
const updateRes = await fetch(
  `https://sheets.googleapis.com/v4/spreadsheets/${FILE_ID}/values/${encodeURIComponent(`${SHEET_TITLE}!A1`)}?valueInputOption=RAW`,
  {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ values: valores }),
  },
);
const updateBody = await updateRes.json();
if (!updateRes.ok) {
  console.error("ERRO no values.update:", updateBody);
  console.error("A aba foi limpa mas a escrita falhou -- restaurar manualmente a partir do backup se necessario.");
  process.exit(1);
}
console.log("   Escrita concluida:", JSON.stringify(updateBody, null, 2), "\n");

// --- 7. Leitura pos-escrita: confirmar resultado e ausencia de campo proibido ---
const posRes = await fetch(
  `https://sheets.googleapis.com/v4/spreadsheets/${FILE_ID}/values/${encodeURIComponent(SHEET_TITLE)}`,
  { headers: { Authorization: `Bearer ${accessToken}` } },
);
const posBody = await posRes.json();
if (!posRes.ok) {
  console.error("ABORTADO na verificacao pos-escrita:", posBody);
  process.exit(1);
}
const headerPos = posBody.values?.[0] ?? [];
const headerPosConfere =
  headerPos.length === COLUMN_ORDER.length && headerPos.every((v, i) => v === COLUMN_ORDER[i]);
const totalLinhasPos = (posBody.values?.length ?? 1) - 1;
const contemCampoProibido = (posBody.values ?? []).some((linha) =>
  linha.some((celula) =>
    CAMPOS_PROIBIDOS.some((proibido) => String(celula).toLowerCase().includes(proibido)),
  ),
);

console.log("7. Confirmacao pos-escrita:");
console.log(`   Cabecalho confere exatamente: ${headerPosConfere}`);
console.log(`   Total de linhas de dados: ${totalLinhasPos} (esperado: ${dadosLidos.length})`);
console.log(`   Contem algum campo proibido em qualquer celula: ${contemCampoProibido}`);
console.log(`   fileId inalterado (mesma planilha, nunca criou arquivo novo): ${FILE_ID}`);

if (!headerPosConfere || contemCampoProibido || totalLinhasPos !== dadosLidos.length) {
  console.error("\nALERTA: verificacao pos-escrita encontrou divergencia -- investigar manualmente antes de considerar concluido.");
  process.exit(1);
}

const logPath = path.join(import.meta.dirname, ".credentials", `sincronizacao_${timestamp}.json`);
fs.writeFileSync(
  logPath,
  JSON.stringify(
    {
      fileId: FILE_ID,
      horarioLocal: new Date().toISOString(),
      backupPath,
      linhasNoBackup,
      linhasEscritas: dadosLidos.length,
      headerPosConfere,
      contemCampoProibido,
    },
    null,
    2,
  ),
);
console.log(`\nOK: sincronizacao concluida com sucesso. Log completo em ${logPath} (fora do git).`);
