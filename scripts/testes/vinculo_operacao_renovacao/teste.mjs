// Teste de regressao real para o bug encontrado na homologacao de
// 27/08/2026: em _shared/renovacao_confirmacao.ts, o caminho ACEITO
// chamava vincularOperacaoAoToken() ANTES de criarCobrancaPixRegistro(),
// violando a foreign key tokens_renovacao.operacao_id -> cobrancas_pix
// (operacao_id) -- migration 20260824130000_tokens_renovacao.sql.
// A falha era engolida por um .catch() best-effort, deixando o
// pagamento orfao em silencio.
//
// Roda os arquivos REAIS de producao (_shared/renovacao_confirmacao.ts,
// _shared/tokens_renovacao.ts, _shared/cobrancas_pix.ts,
// openpix-webhook/index.ts) via tsx, com as dependencias externas
// (Supabase, OpenPix, WhatsApp, GitHub Actions) substituidas por fakes
// deste diretorio -- nunca fakes que "sempre funcionam": o fake do
// Supabase (fake_supabase_client.mjs) reproduz de verdade a foreign key
// real, e' isso que faz este teste pegar o bug.
//
// Como rodar: npx tsx scripts/testes/vinculo_operacao_renovacao/teste.mjs

import { register } from "node:module";

register("./mock-loader.mjs", import.meta.url);

const { getServiceClient, resetarEstado, lerTabela, inserirDireto, forcarFalhaProximoInsertCobrancasPix } =
  await import("./fake_supabase_client.mjs");
const { chamadas: chamadasOpenpix, configurar: configurarOpenpix, resetarConfiguracao: resetarOpenpix } =
  await import("./fake_openpix_client.mjs");
const { mensagensEnviadas } = await import("./fake_whatsapp_client.mjs");
const { transferencias } = await import("./fake_conversas_estado.mjs");
const { disparos } = await import("./fake_github_actions_dispatch.mjs");

const { confirmarRenovacao } = await import("../../../supabase/functions/_shared/renovacao_confirmacao.ts");
const { vincularOperacaoAoToken, hashToken } = await import("../../../supabase/functions/_shared/tokens_renovacao.ts");
const { criarCobrancaPixRegistro } = await import("../../../supabase/functions/_shared/cobrancas_pix.ts");

let handlerWebhook;
globalThis.Deno = { serve: (fn) => { handlerWebhook = fn; } };
globalThis.EdgeRuntime = { waitUntil: (p) => { globalThis.__ultimoWaitUntil = p; } };
await import("../../../supabase/functions/openpix-webhook/index.ts");

const TELEFONE = "5511999990000";
const CONVERSATION_ID = "00000000-0000-0000-0000-000000000001";
const PUBLIC_ID = "public-id-teste";

let falhas = 0;
let total = 0;
function ok(condicao, mensagem) {
  total++;
  if (condicao) {
    console.log("PASS -", mensagem);
  } else {
    falhas++;
    console.log("FAIL -", mensagem);
  }
}

function limparRegistros() {
  mensagensEnviadas.length = 0;
  transferencias.length = 0;
  disparos.length = 0;
  chamadasOpenpix.criarCobrancaOpenPix.length = 0;
  chamadasOpenpix.consultarCobrancaOpenPix.length = 0;
}

async function criarTokenDeTeste(overrides = {}) {
  const tokenBruto = crypto.randomUUID();
  const tokenHash = await hashToken(tokenBruto);
  const id = crypto.randomUUID();
  const linha = {
    id,
    token_hash: tokenHash,
    conversation_id: CONVERSATION_ID,
    public_id: PUBLIC_ID,
    telefone: TELEFONE,
    operacao_id: null,
    cliente_nome: "Cliente Teste",
    servidor_nome: "ServidorTeste",
    plano_nome: "Mensal",
    valor_esperado_centavos: 3500,
    vencimento_atual: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    estado: "aguardando_confirmacao",
    criado_em: new Date().toISOString(),
    expira_em: new Date(Date.now() + 3600 * 1000).toISOString(),
    decidido_em: null,
    renovacao_iniciada_em: null,
    renovacao_concluida_em: null,
    vencimento_confirmado: null,
    motivo_falha: null,
    ...overrides,
  };
  inserirDireto("tokens_renovacao", linha);
  return { tokenBruto, tokenHash, id };
}

// ---------------------------------------------------------------------
// Teste 1 -- ordem corrigida: ACEITO real vincula operacao_id de verdade
// ---------------------------------------------------------------------
async function teste1() {
  resetarEstado();
  resetarOpenpix();
  limparRegistros();

  const { tokenHash, id } = await criarTokenDeTeste();
  const resultado = await confirmarRenovacao({ tokenHash, acao: "aceitar", telefoneOrigem: TELEFONE, origem: "whatsapp" });
  ok(resultado.outcome === "confirmada", "Teste 1: ACEITO com a ordem corrigida retorna outcome 'confirmada'");

  const token = lerTabela("tokens_renovacao").find((t) => t.id === id);
  ok(token?.operacao_id != null, "Teste 1: tokens_renovacao.operacao_id foi vinculado (nao fica null)");
  ok(token?.estado === "autorizada", "Teste 1: token permanece 'autorizada' apos ACEITO bem-sucedido");

  const cobranca = lerTabela("cobrancas_pix").find((c) => c.operacao_id === token?.operacao_id);
  ok(!!cobranca, "Teste 1: existe uma linha em cobrancas_pix com o mesmo operacao_id do token");
  ok(cobranca?.status === "pendente", "Teste 1: cobranca criada com status 'pendente'");

  const enviouPix = mensagensEnviadas.some((m) => m.texto?.includes("Aqui está o Pix"));
  ok(enviouPix, "Teste 1: cliente recebeu a mensagem final do Pix (fluxo feliz completo)");
}

// ---------------------------------------------------------------------
// Teste 1b -- prova de que o fake reproduz a FK real / o bug de ordem
// ---------------------------------------------------------------------
async function teste1b() {
  resetarEstado();

  const { id } = await criarTokenDeTeste({ estado: "autorizada" });
  const operacaoIdSemCobranca = crypto.randomUUID();

  let lancouErro = false;
  try {
    await vincularOperacaoAoToken(id, operacaoIdSemCobranca);
  } catch {
    lancouErro = true;
  }
  ok(
    lancouErro,
    "Teste 1b: vincularOperacaoAoToken ANTES de criarCobrancaPixRegistro falha (reproduz a FK real / a ordem antiga que causou o bug)",
  );

  const token = lerTabela("tokens_renovacao").find((t) => t.id === id);
  ok(token?.operacao_id == null, "Teste 1b: operacao_id permanece null depois da tentativa fora de ordem (nada gravado)");
}

// ---------------------------------------------------------------------
// Teste 2 -- openpix-webhook real encontra o token vinculado e inicia
// a renovacao (dispara o workflow do GitHub Actions)
// ---------------------------------------------------------------------
async function teste2() {
  resetarEstado();
  resetarOpenpix();
  limparRegistros();

  const { tokenHash, id } = await criarTokenDeTeste();
  const aceite = await confirmarRenovacao({ tokenHash, acao: "aceitar", telefoneOrigem: TELEFONE, origem: "whatsapp" });
  ok(aceite.outcome === "confirmada", "Teste 2 (setup): ACEITO funcionou");

  const tokenPosAceite = lerTabela("tokens_renovacao").find((t) => t.id === id);
  const operacaoId = tokenPosAceite?.operacao_id;
  ok(operacaoId != null, "Teste 2 (setup): operacao_id vinculado, pronto para o pagamento");

  configurarOpenpix({ consultar: () => ({ outcome: "success", status: "COMPLETED", amountCentavos: 3500 }) });

  const requisicao = new Request("https://fake.local/functions/v1/openpix-webhook", {
    method: "POST",
    headers: { "x-webhook-signature": "assinatura-fake-aceita-pelo-fake-de-verificacao" },
    body: JSON.stringify({ event: "OPENPIX:CHARGE_COMPLETED", charge: { correlationID: operacaoId } }),
  });

  const resposta = await handlerWebhook(requisicao);
  ok(resposta.status === 200, "Teste 2: openpix-webhook responde 200 pro evento CHARGE_COMPLETED");

  if (globalThis.__ultimoWaitUntil) await globalThis.__ultimoWaitUntil;

  const cobranca = lerTabela("cobrancas_pix").find((c) => c.operacao_id === operacaoId);
  ok(cobranca?.status === "pago", "Teste 2: cobranca marcada como 'pago' apos reconsulta real ao provedor");

  const tokenPosPagamento = lerTabela("tokens_renovacao").find((t) => t.id === id);
  ok(
    tokenPosPagamento?.estado === "renovacao_em_andamento",
    "Teste 2: openpix-webhook ENCONTROU o token pelo operacao_id vinculado e avancou para 'renovacao_em_andamento'",
  );
  ok(
    disparos.length === 1 && disparos[0].operacaoId === operacaoId,
    "Teste 2: workflow renovacao-sigma.yml foi disparado exatamente uma vez, com o operacao_id correto",
  );
}

// ---------------------------------------------------------------------
// Teste 3 -- falha de vinculo tratada como condicao FATAL/alertavel,
// nunca best-effort silencioso
// ---------------------------------------------------------------------
async function teste3() {
  resetarEstado();
  resetarOpenpix();
  limparRegistros();

  const { tokenHash, id } = await criarTokenDeTeste();
  // Simula uma falha real (nao relacionada a FK) exatamente no insert de
  // cobrancas_pix -- com isso a linha nunca chega a existir, e o vinculo
  // seguinte falha pela FK real, exercitando o caminho fatal de ponta a
  // ponta a partir de uma causa raiz diferente (defesa em profundidade).
  forcarFalhaProximoInsertCobrancasPix();

  const resultado = await confirmarRenovacao({ tokenHash, acao: "aceitar", telefoneOrigem: TELEFONE, origem: "whatsapp" });
  ok(resultado.outcome === "falha_cobranca", "Teste 3: falha ao persistir cobranca -> vinculo tambem falha -> outcome 'falha_cobranca'");

  const token = lerTabela("tokens_renovacao").find((t) => t.id === id);
  ok(token?.estado === "renovacao_falhou", "Teste 3: token marcado como 'renovacao_falhou' (nunca fica preso em 'autorizada')");
  ok(
    token?.motivo_falha === "renovacao:falha_vincular_operacao_token",
    "Teste 3: motivo_falha registrado com o motivo especifico do vinculo",
  );

  ok(
    transferencias.some((t) => t.motivo === "renovacao:falha_vincular_operacao_token"),
    "Teste 3: transferencia humana foi acionada com o motivo correto (alertavel, nunca silencioso)",
  );

  const prometeuPix = mensagensEnviadas.some((m) => m.texto?.includes("Aqui está o Pix"));
  ok(!prometeuPix, "Teste 3: cliente NUNCA recebe a mensagem final do Pix quando o vinculo falha (nao promete o que nao pode cumprir)");
}

// ---------------------------------------------------------------------
// Teste 4 -- "0 linhas afetadas, sem erro de banco" tambem e' detectado
// (a fragilidade secundaria descrita na investigacao: antes da
// correcao, vincularOperacaoAoToken nunca verificava isso)
// ---------------------------------------------------------------------
async function teste4() {
  resetarEstado();

  const { id } = await criarTokenDeTeste({ estado: "cancelada" }); // ja nao esta mais 'autorizada'
  const operacaoId = crypto.randomUUID();
  await criarCobrancaPixRegistro({
    operacaoId,
    conversationId: CONVERSATION_ID,
    publicId: PUBLIC_ID,
    servidorNome: "ServidorTeste",
    planoNome: "Mensal",
    valorEsperadoCentavos: 3500,
    transactionIdProvedor: "tx-teste-4",
    qrCodeTexto: "qr-teste-4",
  });

  let lancouErro = false;
  try {
    await vincularOperacaoAoToken(id, operacaoId);
  } catch {
    lancouErro = true;
  }
  ok(
    lancouErro,
    "Teste 4: vincular falha quando o token nao esta mais 'autorizada' (0 linhas afetadas, sem erro de banco) -- antes da correcao isso passava em silencio",
  );
}

await teste1();
await teste1b();
await teste2();
await teste3();
await teste4();

console.log("");
console.log(`Resultado: ${total - falhas}/${total} passando`);
if (falhas > 0) {
  console.log(`${falhas} teste(s) FALHARAM`);
  process.exit(1);
}
