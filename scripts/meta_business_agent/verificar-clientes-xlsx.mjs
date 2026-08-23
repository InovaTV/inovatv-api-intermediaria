// Verificacao independente do arquivo gerado por gerar-clientes-xlsx.mjs
// -- le o .xlsx de volta do disco (nao reaproveita nenhum dado em
// memoria do script que gerou) e confere estrutura/ausencia de campos.

const { default: ExcelJS } = await import("exceljs");
const path = await import("node:path");

const filePath = path.join(import.meta.dirname, "output", "CLIENTES_INOVATV.xlsx");

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(filePath);
const sheet = workbook.getWorksheet("Clientes");

const headerRow = sheet.getRow(1).values.filter((v) => v !== undefined && v !== null);
console.log("Cabecalho (linha 1):", headerRow);

const PROIBIDOS = ["publicId", "senha", "device_key_or_OTP_code"];
const encontrados = PROIBIDOS.filter((p) => headerRow.includes(p));
console.log(
  encontrados.length === 0
    ? "Nenhum campo proibido no cabecalho (confirmado de forma independente)."
    : `ALERTA: campos proibidos encontrados: ${encontrados.join(", ")}`,
);

console.log("Total de linhas de dados:", sheet.rowCount - 1);

console.log("\nPrimeiras 3 linhas:");
for (let i = 2; i <= 4; i++) {
  const row = sheet.getRow(i);
  if (!row.hasValues) continue;
  console.log(`  Linha ${i - 1}:`, row.values.slice(1));
}
