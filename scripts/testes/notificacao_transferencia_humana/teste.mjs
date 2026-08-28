// Teste da correcao "comunicacao ao cliente em falha automatica"
// (prioridade 1, achado real do Ciclo 1 da homologacao 27/08/2026):
// _shared/renovacao_confirmacao.ts, renovacao-sigma-resultado/index.ts
// e renovacao-sigma-watchdog/index.ts passam a chamar o novo
// _shared/notificacao_transferencia.ts sempre que uma transferencia
// humana automatica e' realmente acionada -- nunca mais deixando o
// cliente em silencio.
//
// Roda os arquivos REAIS de producao (notificacao_transferencia.ts,
// renovacao_confirmacao.ts, tokens_renovacao.ts, cobrancas_pix.ts,
// conversas_estado.ts, e os handlers renovacao-sigma-resultado/
// renovacao-sigma-watchdog) via tsx. So as dependencias externas
// (Supabase, WhatsApp, OpenPix, log de mensagens) sao fakes -- inclusive
// o .rpc("acionar_transferencia_humana", ...), que reproduz o
// comportamento REAL confirmado por leitura direta da migration
// 20260823160000 (idempotente por conversation_id, erro P0001 na
// segunda tentativa).
//
// confirmacao-renovacao/index.ts (fluxo web legado) e' deliberadamente
// FORA de escopo -- divida tecnica ja registrada, nao tocada aqui.
//
// Como rodar: npx tsx scripts/testes/notificacao_transferencia_humana/teste.mjs

import { register } from "node:module";

register("./mock-loader.mjs", import.meta.url);

const {
  resetarEstado,
  lerTabela,
  inserirDireto,
  marcarConversaComoAguardandoHumano,
  forcarFalhaProximoInsertCobrancasPix,
} = await import("./fake_supabase_client.mjs");
const {
  mensagensEnviadas,
  templatesEnviados,
  forcarFalhaProximoTexto,
  forcarFalhaProximoTemplate,
  resetar: resetarWhats,
} = await import("./fake_whatsapp_client.mjs");
const { configurarCriar: configurarOpenpixCriar, resetar: resetarOpenpix } = await import("./fake_openpix_client.mjs");
const { mensagens: mensagensHistorico, resetarMensagensFake } = await import("./fake_mensagens_atendimento.mjs");

const { notificarTransferenciaHumana } = await import("../../../supabase/functions/_shared/notificacao_transferencia.ts");
const { confirmarRenovacao } = await import("../../../supabase/functions/_shared/renovacao_confirmacao.ts");
const { hashToken, marcarResultadoRenovacao } = await import("../../../supabase/functions/_shared/tokens_renovacao.ts");

const ENV = {
  RENOVACAO_SIGMA_CALLBACK_TOKEN: "teste-callback-token",
  RENOVACAO_SIGMA_WATCHDOG_TOKEN: "teste-watchdog-token",
  WHATSAPP_JOSE_NUMERO: "5511900000000",
};
let ultimoHandlerRegistrado;
globalThis.Deno = {
  env: { get: (k) => ENV[k] },
  serve: (fn) => {
    ultimoHandlerRegistrado = fn;
  },
};

await import("../../../supabase/functions/renovacao-sigma-resultado/index.ts");
const handlerResultado = ultimoHandlerRegistrado;

await import("../../../supabase/functions/renovacao-sigma-watchdog/index.ts");
const handlerWatchdog = ultimoHandlerRegistrado;

const TELEFONE = "5511999990000";
const CONVERSATION_ID_BASE = "00000000-0000-0000-0000-000000000001";
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

function limparRegistrosComuns() {
  resetarWhats();
  resetarOpenpix();
  resetarMensagensFake();
}

// C5: a frase fixa MENSAGEM_TRANSFERENCIA_CLIENTE ("...atendentes...")
// foi gravada no historico como "ia" para aquela conversa?
function transferenciaPersistida(conversationId) {
  return mensagensHistorico.some(
    (m) => m.conversationId === conversationId && m.origem === "ia" && m.texto.includes("atendentes"),
  );
}

async function criarTokenDeTeste(conversationId, overrides = {}) {
  const tokenBruto = crypto.randomUUID();
  const tokenHash = await hashToken(tokenBruto);
  const id = crypto.randomUUID();
  const linha = {
    id,
    token_hash: tokenHash,
    conversation_id: conversationId,
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

// =======================================================================
// Grupo 1 -- unidade do helper notificarTransferenciaHumana
// =======================================================================
async function grupo1() {
  limparRegistrosComuns();
  let r = await notificarTransferenciaHumana(TELEFONE, "motivo:teste", false);
  ok(r.clienteAvisado === false && r.joseAvisado === false, "G1: acionadaAgora=false nao notifica ninguem");
  ok(mensagensEnviadas.length === 0 && templatesEnviados.length === 0, "G1: nenhum envio realizado quando nao acionada");

  limparRegistrosComuns();
  r = await notificarTransferenciaHumana(TELEFONE, "motivo:teste", true);
  ok(r.clienteAvisado === true, "G1: cliente avisado quando acionada=true");
  ok(r.joseAvisado === true, "G1: Jose avisado quando acionada=true");
  ok(
    mensagensEnviadas.length === 1 && mensagensEnviadas[0].texto.includes("atendentes"),
    "G1: mensagem ao cliente e a MENSAGEM_TRANSFERENCIA_CLIENTE ja existente (nenhuma mensagem nova criada)",
  );
  ok(
    templatesEnviados.length === 1 && templatesEnviados[0].parametros[0] === "motivo:teste",
    "G1: template ao Jose (NOME_TEMPLATE_NOVA_TRANSFERENCIA) usa o motivo correto",
  );

  limparRegistrosComuns();
  forcarFalhaProximoTexto();
  r = await notificarTransferenciaHumana(TELEFONE, "motivo:teste", true);
  ok(r.clienteAvisado === false, "G1: falha isolada no envio ao CLIENTE reportada corretamente");
  ok(r.joseAvisado === true, "G1: falha no envio ao cliente NAO impede o aviso ao Jose (independente)");

  limparRegistrosComuns();
  forcarFalhaProximoTemplate();
  r = await notificarTransferenciaHumana(TELEFONE, "motivo:teste", true);
  ok(r.clienteAvisado === true, "G1: falha no envio ao Jose NAO impede o aviso ao cliente (independente)");
  ok(r.joseAvisado === false, "G1: falha isolada no envio ao JOSE reportada corretamente");

  // C5 -- persistencia opcional/aditiva da frase fixa no historico
  limparRegistrosComuns();
  await notificarTransferenciaHumana(TELEFONE, "motivo:teste", true);
  ok(
    !transferenciaPersistida("conv-c5"),
    "G1 (C5): sem conversationId, comportamento antigo -- NADA e' persistido no historico",
  );

  limparRegistrosComuns();
  await notificarTransferenciaHumana(TELEFONE, "motivo:teste", true, "conv-c5");
  ok(
    transferenciaPersistida("conv-c5"),
    "G1 (C5): com conversationId + envio ok, a frase fixa e' gravada como 'ia' no historico",
  );
  ok(
    mensagensHistorico.filter((m) => m.origem === "ia" && m.texto.includes("atendentes")).length === 1,
    "G1 (C5): grava exatamente 1 linha (nao duplica)",
  );

  limparRegistrosComuns();
  forcarFalhaProximoTexto();
  await notificarTransferenciaHumana(TELEFONE, "motivo:teste", true, "conv-c5");
  ok(
    !transferenciaPersistida("conv-c5"),
    "G1 (C5): se o envio ao cliente FALHOU, nada e' gravado no historico (so' persiste o que o cliente recebeu)",
  );

  limparRegistrosComuns();
  await notificarTransferenciaHumana(TELEFONE, "motivo:teste", false, "conv-c5");
  ok(
    !transferenciaPersistida("conv-c5"),
    "G1 (C5): acionadaAgora=false nunca persiste (retorno antecipado)",
  );
}

// =======================================================================
// Grupo 2 -- _shared/renovacao_confirmacao.ts (fluxo botao ACEITO)
// =======================================================================
async function grupo2() {
  // Ponto A -- falha ao criar cobranca OpenPix apos ACEITO
  resetarEstado();
  limparRegistrosComuns();
  const conv2a = crypto.randomUUID();
  const { tokenHash } = await criarTokenDeTeste(conv2a);
  configurarOpenpixCriar(() => ({ outcome: "unavailable" }));

  const r1 = await confirmarRenovacao({ tokenHash, acao: "aceitar", telefoneOrigem: TELEFONE, origem: "whatsapp" });
  ok(r1.outcome === "falha_cobranca", "G2 Ponto A: falha ao criar cobranca retorna outcome 'falha_cobranca'");
  ok(
    mensagensEnviadas.some((m) => m.texto.includes("atendentes")),
    "G2 Ponto A: cliente foi notificado da transferencia (achado do Ciclo 1, agora corrigido)",
  );
  ok(templatesEnviados.length >= 1, "G2 Ponto A: Jose foi notificado");
  ok(transferenciaPersistida(conv2a), "G2 Ponto A (C5): frase fixa de transferencia gravada no historico do Painel");

  // Ponto B -- falha ao vincular operacao_id (o bug do Ciclo 1)
  resetarEstado();
  limparRegistrosComuns();
  const conv2b = crypto.randomUUID();
  const { tokenHash: tokenHashB } = await criarTokenDeTeste(conv2b);
  forcarFalhaProximoInsertCobrancasPix();

  const r2 = await confirmarRenovacao({ tokenHash: tokenHashB, acao: "aceitar", telefoneOrigem: TELEFONE, origem: "whatsapp" });
  ok(r2.outcome === "falha_cobranca", "G2 Ponto B: falha de vinculo retorna outcome 'falha_cobranca'");
  ok(
    mensagensEnviadas.some((m) => m.texto.includes("atendentes")),
    "G2 Ponto B: cliente foi notificado (o mesmo cenario real que aconteceu no Ciclo 1, agora corrigido)",
  );
  ok(templatesEnviados.length >= 1, "G2 Ponto B: Jose foi notificado");
  ok(
    templatesEnviados[templatesEnviados.length - 1].parametros[0] === "renovacao:falha_vincular_operacao_token",
    "G2 Ponto B: motivo enviado a Jose e' especificamente o de falha de vinculo",
  );
  ok(transferenciaPersistida(conv2b), "G2 Ponto B (C5): frase fixa de transferencia gravada no historico do Painel");

  // Sem duplicacao -- conversa ja em aguardando_humano (RPC real
  // recusaria com P0001) quando a falha de vinculo acontece de novo
  resetarEstado();
  limparRegistrosComuns();
  const conv2c = crypto.randomUUID();
  const { tokenHash: tokenHashC } = await criarTokenDeTeste(conv2c);
  marcarConversaComoAguardandoHumano(conv2c);
  forcarFalhaProximoInsertCobrancasPix();

  await confirmarRenovacao({ tokenHash: tokenHashC, acao: "aceitar", telefoneOrigem: TELEFONE, origem: "whatsapp" });
  // Nota: a mensagem "Certo! Vou preparar seu pagamento..." e enviada
  // incondicionalmente mais cedo no fluxo (antes de qualquer falha) --
  // a checagem aqui e especificamente sobre a mensagem de TRANSFERENCIA
  // (MENSAGEM_TRANSFERENCIA_CLIENTE) e o template ao Jose, que sao os
  // dois efeitos de notificarTransferenciaHumana.
  ok(
    !mensagensEnviadas.some((m) => m.texto.includes("atendentes")) && templatesEnviados.length === 0,
    "G2: sem duplicacao -- conversa ja transferida (RPC real retornaria P0001) nao gera nova notificacao de transferencia",
  );
  ok(
    !transferenciaPersistida(conv2c),
    "G2 (C5): sem duplicacao -- transferencia nao acionada agora nao grava frase fixa no historico",
  );
}

// =======================================================================
// Grupo 3 -- renovacao-sigma-resultado/index.ts
// =======================================================================
async function grupo3() {
  resetarEstado();
  limparRegistrosComuns();
  const conv3 = crypto.randomUUID();
  const operacaoId = crypto.randomUUID();
  inserirDireto("tokens_renovacao", {
    id: crypto.randomUUID(),
    token_hash: await hashToken(crypto.randomUUID()),
    conversation_id: conv3,
    public_id: PUBLIC_ID,
    telefone: TELEFONE,
    operacao_id: operacaoId,
    cliente_nome: "Cliente Teste",
    servidor_nome: "ServidorTeste",
    plano_nome: "Mensal",
    valor_esperado_centavos: 3500,
    vencimento_atual: new Date().toISOString(),
    estado: "renovacao_em_andamento",
    criado_em: new Date().toISOString(),
    expira_em: new Date().toISOString(),
    decidido_em: new Date().toISOString(),
    renovacao_iniciada_em: new Date().toISOString(),
    renovacao_concluida_em: null,
    vencimento_confirmado: null,
    motivo_falha: null,
  });
  inserirDireto("cobrancas_pix", {
    operacao_id: operacaoId,
    conversation_id: conv3,
    public_id: PUBLIC_ID,
    servidor_nome: "ServidorTeste",
    plano_nome: "Mensal",
    valor_esperado_centavos: 3500,
    transaction_id_provedor: "tx-teste",
    qr_code_texto: "qr-teste",
    status: "pago",
    criado_em: new Date().toISOString(),
    atualizado_em: new Date().toISOString(),
  });

  const corpoResultadoFalha = JSON.stringify({ operacao_id: operacaoId, resultado: "falha", detalhe: "erro simulado no Sigma" });
  const criarReqResultado = () =>
    new Request("https://fake.local/functions/v1/renovacao-sigma-resultado", {
      method: "POST",
      headers: { "X-Internal-Token": ENV.RENOVACAO_SIGMA_CALLBACK_TOKEN, "Content-Type": "application/json" },
      body: corpoResultadoFalha,
    });
  const resp = await handlerResultado(criarReqResultado());
  const body = await resp.json();
  ok(body.outcome === "falha_processado", "G3: callback de falha processado corretamente");
  ok(
    mensagensEnviadas.some((m) => m.texto.includes("atendentes")),
    "G3: cliente notificado quando a renovacao no Sigma falha (gap real corrigido)",
  );
  ok(
    templatesEnviados.some((t) => t.nomeTemplate === "nova_transferencia_humana" && t.parametros[0] === "renovacao_sigma:falha"),
    "G3: Jose notificado com o motivo correto",
  );
  ok(transferenciaPersistida(conv3), "G3 (C5): frase fixa de transferencia gravada no historico do Painel (falha Sigma)");

  // Sem duplicacao -- callback repetido (idempotencia da propria
  // camada de dados, marcarResultadoRenovacao so' afeta estado
  // 'renovacao_em_andamento')
  resetarWhats();
  const resp2 = await handlerResultado(criarReqResultado());
  const body2 = await resp2.json();
  ok(body2.outcome === "ja_processado", "G3: callback duplicado detectado (idempotencia)");
  ok(mensagensEnviadas.length === 0 && templatesEnviados.length === 0, "G3: sem duplicacao -- callback repetido nao notifica de novo");

  // Regressao -- sucesso continua enviando o template de pagamento
  // confirmado normalmente (nao afetado por esta mudanca) + C4:
  // agora tambem persiste o texto no historico do Painel
  resetarEstado();
  resetarWhats();
  resetarMensagensFake();
  const conv3b = crypto.randomUUID();
  const operacaoId2 = crypto.randomUUID();
  inserirDireto("tokens_renovacao", {
    id: crypto.randomUUID(),
    token_hash: await hashToken(crypto.randomUUID()),
    conversation_id: conv3b,
    public_id: PUBLIC_ID,
    telefone: TELEFONE,
    operacao_id: operacaoId2,
    cliente_nome: "Cliente Teste",
    servidor_nome: "ServidorTeste",
    plano_nome: "Mensal",
    valor_esperado_centavos: 3500,
    vencimento_atual: new Date().toISOString(),
    estado: "renovacao_em_andamento",
    criado_em: new Date().toISOString(),
    expira_em: new Date().toISOString(),
    decidido_em: new Date().toISOString(),
    renovacao_iniciada_em: new Date().toISOString(),
    renovacao_concluida_em: null,
    vencimento_confirmado: null,
    motivo_falha: null,
  });
  const reqSucesso = new Request("https://fake.local/functions/v1/renovacao-sigma-resultado", {
    method: "POST",
    headers: { "X-Internal-Token": ENV.RENOVACAO_SIGMA_CALLBACK_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ operacao_id: operacaoId2, resultado: "sucesso", vencimentoConfirmado: new Date().toISOString() }),
  });
  const respSucesso = await handlerResultado(reqSucesso);
  const bodySucesso = await respSucesso.json();
  ok(bodySucesso.outcome === "sucesso_processado", "G3 (regressao): sucesso continua processado normalmente");
  ok(
    templatesEnviados.some((t) => t.nomeTemplate === "pagamento_confirmado"),
    "G3 (regressao): template de pagamento confirmado continua sendo enviado ao cliente no sucesso",
  );
  ok(
    mensagensHistorico.some(
      (m) =>
        m.conversationId === conv3b &&
        m.origem === "ia" &&
        m.texto.startsWith("✅ Pagamento confirmado!") &&
        m.texto.includes("Olá,Cliente Teste!"),
    ),
    "G3 (C4): texto de confirmacao de pagamento agora e' gravado no historico do Painel (bug corrigido)",
  );
  ok(
    mensagensHistorico.filter((m) => m.origem === "ia" && m.texto.startsWith("✅ Pagamento confirmado!")).length === 1,
    "G3 (C4): grava exatamente 1 linha de confirmacao (nao duplica)",
  );
}

// =======================================================================
// Grupo 4 -- renovacao-sigma-watchdog/index.ts, incluindo o cenario
// REAL do Ciclo 1 (renovacao:watchdog_autorizacao_orfa)
// =======================================================================
async function grupo4() {
  const HA_20_MIN = new Date(Date.now() - 20 * 60 * 1000).toISOString();

  // Cenario REAL do Ciclo 1: autorizacao orfa (operacao_id nunca vinculado)
  resetarEstado();
  limparRegistrosComuns();
  const conv4a = crypto.randomUUID();
  await criarTokenDeTeste(conv4a, {
    estado: "autorizada",
    operacao_id: null,
    decidido_em: HA_20_MIN,
  });

  const criarReqWatchdog = () =>
    new Request("https://fake.local/functions/v1/renovacao-sigma-watchdog", {
      method: "POST",
      headers: { "X-Internal-Token": ENV.RENOVACAO_SIGMA_WATCHDOG_TOKEN },
    });
  const resp = await handlerWatchdog(criarReqWatchdog());
  const body = await resp.json();
  ok(body.outcome === "processado" && body.quantidade === 1, "G4 (Ciclo 1 real): watchdog processou a autorizacao orfa");
  ok(
    mensagensEnviadas.some((m) => m.texto.includes("atendentes")),
    "G4 (Ciclo 1 real): CLIENTE agora e' notificado -- exatamente o gap que ficou em silencio no Ciclo 1 real",
  );
  ok(
    templatesEnviados.some((t) => t.parametros[0] === "renovacao:watchdog_autorizacao_orfa"),
    "G4 (Ciclo 1 real): Jose notificado com o motivo especifico da autorizacao orfa",
  );
  ok(transferenciaPersistida(conv4a), "G4 (C5): frase fixa de transferencia gravada no historico (autorizacao orfa)");

  const tokenDepois = lerTabela("tokens_renovacao").find((t) => t.conversation_id === conv4a);
  ok(tokenDepois?.estado === "renovacao_falhou", "G4 (Ciclo 1 real): token marcado como renovacao_falhou (comportamento do watchdog inalterado)");

  // Sem duplicacao -- rodar o watchdog de novo nao reencontra o mesmo
  // token (ja nao esta mais 'autorizada')
  resetarWhats();
  const resp2 = await handlerWatchdog(criarReqWatchdog());
  const body2 = await resp2.json();
  ok(body2.outcome === "nenhuma_presa", "G4: sem duplicacao -- segunda rodada do watchdog nao reencontra o mesmo token");
  ok(mensagensEnviadas.length === 0 && templatesEnviados.length === 0, "G4: sem duplicacao -- nenhuma notificacao extra na segunda rodada");

  // Cenario 2: timeout de renovacao_em_andamento (o outro backstop do watchdog)
  resetarEstado();
  limparRegistrosComuns();
  const conv4b = crypto.randomUUID();
  const operacaoIdB = crypto.randomUUID();
  await criarTokenDeTeste(conv4b, {
    estado: "renovacao_em_andamento",
    operacao_id: operacaoIdB,
    renovacao_iniciada_em: HA_20_MIN,
  });
  inserirDireto("cobrancas_pix", {
    operacao_id: operacaoIdB,
    conversation_id: conv4b,
    public_id: PUBLIC_ID,
    servidor_nome: "ServidorTeste",
    plano_nome: "Mensal",
    valor_esperado_centavos: 3500,
    transaction_id_provedor: "tx-teste-b",
    qr_code_texto: "qr-teste-b",
    status: "pago",
    criado_em: new Date().toISOString(),
    atualizado_em: new Date().toISOString(),
  });

  const req2 = new Request("https://fake.local/functions/v1/renovacao-sigma-watchdog", {
    method: "POST",
    headers: { "X-Internal-Token": ENV.RENOVACAO_SIGMA_WATCHDOG_TOKEN },
  });
  const resp3 = await handlerWatchdog(req2);
  const body3 = await resp3.json();
  ok(body3.outcome === "processado" && body3.quantidade === 1, "G4 (timeout): watchdog processou o timeout de renovacao_em_andamento");
  ok(
    mensagensEnviadas.some((m) => m.texto.includes("atendentes")),
    "G4 (timeout): cliente notificado quando o job do GitHub Actions nunca responde",
  );
  ok(
    templatesEnviados.some((t) => t.parametros[0] === "renovacao_sigma:watchdog_timeout"),
    "G4 (timeout): Jose notificado com o motivo especifico do timeout",
  );
  ok(transferenciaPersistida(conv4b), "G4 (C5): frase fixa de transferencia gravada no historico (timeout)");
}

await grupo1();
await grupo2();
await grupo3();
await grupo4();

console.log("");
console.log(`Resultado: ${total - falhas}/${total} passando`);
if (falhas > 0) {
  console.log(`${falhas} teste(s) FALHARAM`);
  process.exit(1);
}
