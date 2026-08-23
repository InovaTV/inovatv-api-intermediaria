// Etapa 2 da automacao Rocket -> Google Drive -> Meta AI (ver
// CLAUDE.md do inovatv_central, secao "Frente -- IA do WhatsApp
// (Meta Business Agent) + automacao Rocket -> Google Drive").
//
// Script local, nao implantado como Edge Function ainda -- so gera o
// arquivo CLIENTES_INOVATV.xlsx a partir do endpoint export-clientes
// ja implementado e testado. Nao mexe no Google Drive, nao agenda
// nada, nao trata pagamentos.
//
// Le todas as paginas de GET /functions/v1/export-clientes, remove
// publicId (uso interno da funcao, nunca do arquivo final) e grava
// somente as colunas aprovadas.

const FUNCTION_URL =
  "https://nduxsuxkopuvhwugdkqi.supabase.co/functions/v1/export-clientes";

const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
if (!PUBLISHABLE_KEY) {
  console.error(
    "Defina SUPABASE_PUBLISHABLE_KEY (chave publishable do projeto inovatv-api-intermediaria) antes de rodar.",
  );
  process.exit(1);
}

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

function toRow(cliente) {
  return {
    nome: cliente.nome ?? null,
    telefone: cliente.telefone ?? null,
    usuario: cliente.usuario ?? null,
    plano: cliente.planoNome ?? null,
    servidor: cliente.servidorNome ?? null,
    valor: cliente.valor ?? null,
    vencimento: cliente.vencimento ?? null,
    telas: cliente.telas ?? null,
    aplicativo: cliente.aplicativoNome ?? null,
    dispositivo: cliente.dispositivoNome ?? null,
  };
}

async function fetchAllClientes() {
  const clientes = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const response = await fetch(`${FUNCTION_URL}?page=${page}`, {
      headers: {
        Authorization: `Bearer ${PUBLISHABLE_KEY}`,
        apikey: PUBLISHABLE_KEY,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} na pagina ${page}`);
    }

    const data = await response.json();

    if (data.outcome !== "success") {
      throw new Error(`outcome inesperado na pagina ${page}: ${data.outcome}`);
    }

    clientes.push(...data.clientes);
    totalPages = data.totalPages ?? page;
    page += 1;
  }

  return clientes;
}

const clientesBrutos = await fetchAllClientes();

// Verificacao explicita: nenhum campo proibido pode existir em nenhum
// registro bruto vindo do endpoint, antes mesmo de montar as linhas.
const CAMPOS_PROIBIDOS = ["senha", "device_key_or_OTP_code"];
for (const cliente of clientesBrutos) {
  for (const campo of CAMPOS_PROIBIDOS) {
    if (campo in cliente) {
      throw new Error(
        `Campo proibido "${campo}" encontrado na resposta do export-clientes -- abortando.`,
      );
    }
  }
}

const linhas = clientesBrutos.map(toRow);

// Confirma que nenhuma linha final tem publicId ou qualquer chave fora
// da allowlist aprovada.
for (const linha of linhas) {
  const chaves = Object.keys(linha);
  const chavesInvalidas = chaves.filter((k) => !COLUMN_ORDER.includes(k));
  if (chavesInvalidas.length > 0) {
    throw new Error(`Linha com colunas nao aprovadas: ${chavesInvalidas.join(", ")}`);
  }
}

const { default: ExcelJS } = await import("exceljs");
const workbook = new ExcelJS.Workbook();
const worksheet = workbook.addWorksheet("Clientes");
worksheet.columns = COLUMN_ORDER.map((key) => ({ header: key, key }));
worksheet.addRows(linhas);

const fs = await import("node:fs");
const path = await import("node:path");
const outDir = path.join(import.meta.dirname, "output");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "CLIENTES_INOVATV.xlsx");
await workbook.xlsx.writeFile(outPath);

console.log(`OK: ${linhas.length} clientes escritos em ${outPath}`);
console.log(`Colunas: ${COLUMN_ORDER.join(", ")}`);
console.log("publicId: ausente (confirmado)");
console.log("senha / device_key_or_OTP_code: ausentes (confirmado)");
console.log("Amostra (1a linha):", JSON.stringify(linhas[0], null, 2));
