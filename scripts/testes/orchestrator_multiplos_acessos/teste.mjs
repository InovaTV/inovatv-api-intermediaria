// Testes locais do ajuste de apresentacao da Mensagem 1 (multiplos
// acessos no fluxo de renovacao, 2026-08-28, inovatv_central/CLAUDE.md).
// Roda o handler REAL de supabase/functions/orchestrator/index.ts,
// com _shared/contexto.ts, _shared/validador.ts e
// _shared/mensagens_fixas.ts tambem REAIS (nao fakeados) -- e'
// exatamente a interacao entre eles que decide se
// "renovacao:acesso_nao_determinado" dispara corretamente. So as
// dependencias verdadeiramente externas (banco, WhatsApp, Gemini,
// Rocket) sao fakes, via mock-loader.mjs.
//
// Como rodar: npx tsx scripts/testes/orchestrator_multiplos_acessos/teste.mjs

import { register } from "node:module";

register("./mock-loader.mjs", import.meta.url);

const {
  resetarConversa,
  getConversaAtual,
  acionamentosRegistrados,
  atualizacoesSessaoRegistradas,
} = await import("./fake_conversas_estado.mjs");
const { resetarMensagens, mensagensRegistradas } = await import("./fake_mensagens_atendimento.mjs");
const { configurarMatch, configurarStatus, resetarRocketIntermediaria } =
  await import("./fake_rocket_intermediaria.mjs");
const { definirProximaRespostaGemini, resetarGemini } = await import("./fake_gemini_client.mjs");
const {
  resetarWhatsapp,
  getMensagensEnviadas,
  getMensagensInterativasEnviadas,
} = await import("./fake_whatsapp_client.mjs");
const { resetarValorCliente } = await import("./fake_rocket_valor_cliente.mjs");
const { resetarTokensRenovacao } = await import("./fake_tokens_renovacao.mjs");

const TOKEN_INTERNO = "orchestrator-token-de-teste";
process.env.ORCHESTRATOR_INTERNAL_TOKEN = TOKEN_INTERNO;
process.env.SUPABASE_URL = "https://exemplo-teste.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-de-teste";

let handler;
globalThis.Deno = {
  serve: (fn) => {
    handler = fn;
  },
  env: {
    get: (nome) => process.env[nome],
  },
};

await import("../../../supabase/functions/orchestrator/index.ts");

let falhas = 0;
function ok(condicao, mensagem) {
  if (!condicao) {
    falhas++;
    console.error(`FALHA: ${mensagem}`);
  } else {
    console.log(`ok: ${mensagem}`);
  }
}

function resetarTudo() {
  resetarConversa();
  resetarMensagens();
  resetarRocketIntermediaria();
  resetarGemini();
  resetarWhatsapp();
  resetarValorCliente();
  resetarTokensRenovacao();
}

function req(corpo) {
  return new Request("https://exemplo-teste.supabase.co/functions/v1/orchestrator", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Internal-Token": TOKEN_INTERNO },
    body: JSON.stringify(corpo),
  });
}

const TELEFONE = "5511999999999";
const PUBLIC_ID_A = "pub-blaze-teste";
const PUBLIC_ID_B = "pub-newone-teste";

function configurarDoisAcessos() {
  configurarMatch({
    outcome: "multiple_matches",
    candidates: [
      { publicId: PUBLIC_ID_A, nome: "Meu Uso Testes", usuario: "828667229" },
      { publicId: PUBLIC_ID_B, nome: "Js Informática Rp", usuario: "2715749553" },
    ],
  });
  configurarStatus(PUBLIC_ID_A, {
    outcome: "success",
    linkState: "linked",
    publicId: PUBLIC_ID_A,
    syncedAt: new Date().toISOString(),
    cliente: {
      nome: "Meu Uso Testes",
      vencimento: "2026-09-13T23:59:00-03:00",
      planoNome: "Mensal",
      servidorNome: "BLAZE",
      telas: 1,
    },
  });
  configurarStatus(PUBLIC_ID_B, {
    outcome: "success",
    linkState: "linked",
    publicId: PUBLIC_ID_B,
    syncedAt: new Date().toISOString(),
    cliente: {
      nome: "Js Informática Rp",
      vencimento: "2026-12-08T23:59:00-03:00",
      planoNome: "Mensal",
      servidorNome: "NewOne",
      telas: 1,
    },
  });
}

// ---------------------------------------------------------------------
// Teste A -- multiplos acessos + nenhum identificado -> lista fixa,
// nunca transferencia automatica
// ---------------------------------------------------------------------
async function testeA() {
  resetarTudo();
  configurarDoisAcessos();
  definirProximaRespostaGemini({
    outcome: "success",
    data: { tipo: "propor_renovacao", texto: "Claro, vou te ajudar a renovar seu acesso!" },
  });

  const resp = await handler(req({ telefone: TELEFONE, conteudo: "quero renovar meu plano" }));
  const body = await resp.json();

  ok(resp.status === 200, "Teste A: HTTP 200");
  ok(
    body?.validacao?.aprovado === false && body?.validacao?.motivo === "renovacao:acesso_nao_determinado",
    "Teste A: Validador REAL rejeitou com motivo renovacao:acesso_nao_determinado",
  );
  ok(acionamentosRegistrados().length === 0, "Teste A: NENHUMA transferencia humana acionada");
  ok(getConversaAtual().estado !== "aguardando_humano", "Teste A: conversa nao vai para aguardando_humano");

  const enviadas = getMensagensEnviadas();
  ok(enviadas.length === 1, "Teste A: exatamente 1 mensagem de texto enviada ao cliente");
  const texto = enviadas[0]?.texto ?? "";

  ok(texto.includes("Meu Uso Testes"), "Teste A: nome do 1º acesso presente");
  ok(texto.includes("828667229"), "Teste A: usuario REAL do 1º acesso presente");
  ok(texto.includes("BLAZE"), "Teste A: servidor do 1º acesso presente");
  ok(texto.includes("Js Informática Rp"), "Teste A: nome do 2º acesso presente");
  ok(texto.includes("2715749553"), "Teste A: usuario REAL do 2º acesso presente");
  ok(texto.includes("NewOne"), "Teste A: servidor do 2º acesso presente");
  ok(texto.includes("Mensal"), "Teste A: plano presente");
  ok(texto.includes("─────────────────"), "Teste A: linha separadora presente");
  ok(texto.includes("Qual desses acessos você gostaria de renovar?"), "Teste A: pergunta final presente");

  // Separador so' entre os acessos, nunca depois do ultimo.
  const linhas = texto.split("\n");
  const ultimaLinhaNaoVazia = [...linhas].reverse().find((l) => l.trim().length > 0);
  ok(
    ultimaLinhaNaoVazia === "Qual desses acessos você gostaria de renovar?",
    "Teste A: separador nunca aparece depois do ultimo acesso (pergunta e' a ultima linha)",
  );
  ok(
    texto.indexOf("BLAZE") < texto.indexOf("─────────────────") &&
      texto.indexOf("─────────────────") < texto.indexOf("NewOne"),
    "Teste A: separador aparece ESPECIFICAMENTE entre os dois blocos, nao antes nem depois dos dois",
  );

  ok(!texto.includes("Claro, vou te ajudar"), "Teste A: texto do Gemini NUNCA e' o que chega ao cliente");

  const mensagensLog = mensagensRegistradas();
  const iaLogada = mensagensLog.find((m) => m.origem === "ia");
  ok(iaLogada?.texto === texto, "Teste A: mensagem logada como 'ia' e' exatamente o texto fixo enviado");
  ok(
    mensagensLog.some((m) => m.origem === "cliente" && m.texto === "quero renovar meu plano"),
    "Teste A: mensagem do cliente tambem registrada no historico",
  );
}

// ---------------------------------------------------------------------
// Teste B -- cliente cita um servidor -> fluxo existente de resolucao
// continua normalmente (nunca a lista fixa, nunca transferencia)
// ---------------------------------------------------------------------
async function testeB() {
  resetarTudo();
  configurarDoisAcessos();
  definirProximaRespostaGemini({
    outcome: "success",
    data: { tipo: "propor_renovacao", texto: "Perfeito, vou preparar a renovação do BLAZE." },
  });

  const resp = await handler(req({ telefone: TELEFONE, conteudo: "quero renovar o BLAZE" }));
  const body = await resp.json();

  ok(resp.status === 200, "Teste B: HTTP 200");
  ok(body?.validacao?.aprovado === true, "Teste B: Validador REAL aprovou (servidor citado resolve sozinho)");
  ok(acionamentosRegistrados().length === 0, "Teste B: nenhuma transferencia humana acionada");

  const interativas = getMensagensInterativasEnviadas();
  ok(interativas.length === 1, "Teste B: mensagem 2 (interativa, botões ACEITO/CANCELAR) foi enviada");
  const texto2 = interativas[0]?.texto ?? "";
  ok(texto2.includes("*Usuário:* 828667229"), "Teste B: mensagem 2 traz o usuario REAL do acesso resolvido (BLAZE)");
  ok(texto2.includes("*Servidor:* BLAZE"), "Teste B: mensagem 2 confirma o servidor certo");
  ok(interativas[0]?.botoes?.some((b) => b.titulo === "ACEITO"), "Teste B: botão ACEITO presente");
  ok(interativas[0]?.botoes?.some((b) => b.titulo === "CANCELAR"), "Teste B: botão CANCELAR presente");

  const listaMultipla = getMensagensEnviadas().some((m) => m.texto.includes("Qual desses acessos"));
  ok(!listaMultipla, "Teste B: a lista de multiplos acessos NAO e' enviada quando o acesso ja foi citado");
}

// ---------------------------------------------------------------------
// Teste C -- outro motivo de validarPropostaRenovacao (nao
// acesso_nao_determinado) continua transferindo normalmente
// ---------------------------------------------------------------------
async function testeC() {
  resetarTudo();
  // Nenhum acesso encontrado (no_match) -- contexto.acessos.length===0,
  // validarPropostaRenovacao reprova com "renovacao:cliente_nao_identificado",
  // motivo DIFERENTE de "renovacao:acesso_nao_determinado".
  configurarMatch({ outcome: "no_match", candidates: [] });
  definirProximaRespostaGemini({
    outcome: "success",
    data: { tipo: "propor_renovacao", texto: "Vou te ajudar a renovar!" },
  });

  const resp = await handler(req({ telefone: TELEFONE, conteudo: "quero renovar meu plano" }));
  const body = await resp.json();

  ok(resp.status === 200, "Teste C: HTTP 200");
  ok(
    body?.validacao?.aprovado === false &&
      body?.validacao?.motivo === "renovacao:cliente_nao_identificado",
    "Teste C: Validador REAL rejeitou com um motivo DIFERENTE de acesso_nao_determinado",
  );
  ok(
    acionamentosRegistrados().length === 1 &&
      acionamentosRegistrados()[0].motivo === "renovacao:cliente_nao_identificado",
    "Teste C: transferencia humana ACIONADA (outros motivos continuam transferindo)",
  );
  const enviadas = getMensagensEnviadas();
  ok(
    enviadas.some((m) => m.texto.includes("encaminhar seu atendimento")),
    "Teste C: cliente recebe a mensagem fixa de transferência, nunca a lista de acessos",
  );
  ok(
    !enviadas.some((m) => m.texto.includes("Qual desses acessos")),
    "Teste C: a lista de multiplos acessos nunca e' enviada neste caso",
  );
}

// ---------------------------------------------------------------------
// Teste D -- geminiData.tipo === "transferir" continua transferindo
// (garantia adicional: so' acesso_nao_determinado saiu do caminho)
// ---------------------------------------------------------------------
async function testeD() {
  resetarTudo();
  configurarDoisAcessos();
  definirProximaRespostaGemini({
    outcome: "success",
    data: { tipo: "transferir", texto: "Vou te encaminhar para um atendente." },
  });

  const resp = await handler(req({ telefone: TELEFONE, conteudo: "preciso falar com um humano" }));
  await resp.json();

  ok(acionamentosRegistrados().length === 1, "Teste D: tipo=transferir continua acionando transferencia normalmente");
  const enviadas = getMensagensEnviadas();
  ok(
    !enviadas.some((m) => m.texto.includes("Qual desses acessos")),
    "Teste D: lista de multiplos acessos nunca aparece para tipo=transferir",
  );
}

function configurarUmAcesso() {
  configurarMatch({
    outcome: "single_match",
    candidates: [{ publicId: PUBLIC_ID_A, nome: "Meu Uso Testes", usuario: "828667229" }],
  });
  configurarStatus(PUBLIC_ID_A, {
    outcome: "success",
    linkState: "linked",
    publicId: PUBLIC_ID_A,
    syncedAt: new Date().toISOString(),
    cliente: {
      nome: "Meu Uso Testes",
      vencimento: "2026-09-13T23:59:00-03:00",
      planoNome: "Mensal",
      servidorNome: "BLAZE",
      telas: 1,
    },
  });
}

// ---------------------------------------------------------------------
// C3 -- Teste E: interceptor DETERMINISTICO. Gemini classifica como
// "responder" (prosa livre) mas: 2+ acessos + cliente disse "renovar"
// + nenhum acesso citado -> a lista fixa e' o que vai ao cliente,
// NUNCA a prosa do Gemini. Sem transferencia.
// ---------------------------------------------------------------------
async function testeE() {
  resetarTudo();
  configurarDoisAcessos();
  const PROSA_GEMINI =
    "Você tem mais de um acesso vinculado a este número. Poderia me dizer qual deles você quer renovar?";
  definirProximaRespostaGemini({
    outcome: "success",
    data: { tipo: "responder", texto: PROSA_GEMINI },
  });

  const resp = await handler(req({ telefone: TELEFONE, conteudo: "quero renovar meu plano" }));
  const body = await resp.json();

  ok(resp.status === 200, "Teste E: HTTP 200");
  ok(body?.validacao?.aprovado === true, "Teste E: Validador REAL aprovou o 'responder'");
  ok(acionamentosRegistrados().length === 0, "Teste E: NENHUMA transferencia humana");
  ok(getConversaAtual().estado !== "aguardando_humano", "Teste E: conversa nao vai para aguardando_humano");

  const enviadas = getMensagensEnviadas();
  ok(enviadas.length === 1, "Teste E: exatamente 1 mensagem de texto ao cliente");
  const texto = enviadas[0]?.texto ?? "";
  ok(texto.includes("Qual desses acessos você gostaria de renovar?"), "Teste E: e' a lista fixa deterministica");
  ok(texto.includes("*1. Meu Uso Testes*") && texto.includes("BLAZE"), "Teste E: bloco 1 (BLAZE) presente");
  ok(texto.includes("*2. Js Informática Rp*") && texto.includes("NewOne"), "Teste E: bloco 2 (NewOne) presente");
  ok(texto.includes("─────────────────"), "Teste E: separador presente");
  ok(!texto.includes("Poderia me dizer qual deles"), "Teste E: a PROSA do Gemini NUNCA chega ao cliente");

  const log = mensagensRegistradas();
  ok(log.some((m) => m.origem === "ia" && m.texto === texto), "Teste E: lista fixa registrada no historico como 'ia'");
  ok(
    log.some((m) => m.origem === "cliente" && m.texto === "quero renovar meu plano"),
    "Teste E: mensagem do cliente registrada",
  );
  ok(
    !log.some((m) => m.origem === "ia" && m.texto === PROSA_GEMINI),
    "Teste E: a prosa do Gemini NUNCA e' gravada no historico",
  );
  ok(
    atualizacoesSessaoRegistradas().some((a) => a.dados?.intencaoAtual === "renovacao"),
    "Teste E: intencao de renovar registrada na sessao (como o caminho propor_renovacao ja faz)",
  );
  ok(body?.renovacao?.acessoResolvido === null, "Teste E: diagnostico marca acessoResolvido=null");
}

// ---------------------------------------------------------------------
// C3 -- Teste F (negativo): "responder" + 2 acessos, mas SEM intencao
// de renovar (nenhuma palavra, nenhuma sessao) -> prosa do Gemini vai
// ao cliente normalmente. O 'responder' geral NAO muda.
// ---------------------------------------------------------------------
async function testeF() {
  resetarTudo();
  configurarDoisAcessos();
  const PROSA = "Seu plano Mensal está ativo. Posso ajudar com mais alguma coisa?";
  definirProximaRespostaGemini({ outcome: "success", data: { tipo: "responder", texto: PROSA } });

  const resp = await handler(req({ telefone: TELEFONE, conteudo: "meu plano está funcionando?" }));
  await resp.json();

  const enviadas = getMensagensEnviadas();
  ok(enviadas.length === 1 && enviadas[0].texto === PROSA, "Teste F: prosa do Gemini enviada como hoje (sem intencao de renovar)");
  ok(!enviadas.some((m) => m.texto.includes("Qual desses acessos")), "Teste F: lista fixa NAO e' enviada");
  ok(acionamentosRegistrados().length === 0, "Teste F: nenhuma transferencia");
}

// ---------------------------------------------------------------------
// C3 -- Teste G (negativo): "responder" + "quero renovar" mas SO' 1
// acesso -> interceptor NAO dispara (precisa de 2+); prosa do Gemini
// segue normal.
// ---------------------------------------------------------------------
async function testeG() {
  resetarTudo();
  configurarUmAcesso();
  const PROSA = "Claro! Seu acesso BLAZE pode ser renovado. Deseja seguir?";
  definirProximaRespostaGemini({ outcome: "success", data: { tipo: "responder", texto: PROSA } });

  const resp = await handler(req({ telefone: TELEFONE, conteudo: "quero renovar" }));
  await resp.json();

  const enviadas = getMensagensEnviadas();
  ok(enviadas.length === 1 && enviadas[0].texto === PROSA, "Teste G: com 1 acesso, prosa do Gemini segue normal");
  ok(!enviadas.some((m) => m.texto.includes("Qual desses acessos")), "Teste G: lista fixa nunca aparece com 1 acesso");
}

// ---------------------------------------------------------------------
// C3 -- Teste H: intencao ja' estabelecida na sessao (mensagem
// anterior). Mensagem atual NAO tem a palavra "renovar", mas
// conversa.intencao_atual === "renovacao" -> interceptor dispara.
// ---------------------------------------------------------------------
async function testeH() {
  resetarTudo();
  configurarDoisAcessos();
  getConversaAtual().intencao_atual = "renovacao"; // estabelecida antes desta mensagem
  const PROSA = "Certo! Sobre qual acesso você gostaria de falar?";
  definirProximaRespostaGemini({ outcome: "success", data: { tipo: "responder", texto: PROSA } });

  const resp = await handler(req({ telefone: TELEFONE, conteudo: "vamos lá então" }));
  await resp.json();

  const enviadas = getMensagensEnviadas();
  ok(enviadas.length === 1, "Teste H: exatamente 1 mensagem ao cliente");
  ok(enviadas[0].texto.includes("Qual desses acessos você gostaria de renovar?"), "Teste H: lista fixa disparada pela intencao de sessao");
  ok(!enviadas[0].texto.includes("Sobre qual acesso você gostaria de falar"), "Teste H: prosa do Gemini nao vai ao cliente");
  ok(acionamentosRegistrados().length === 0, "Teste H: nenhuma transferencia");
}

await testeA();
await testeB();
await testeC();
await testeD();
await testeE();
await testeF();
await testeG();
await testeH();

console.log(`\n${falhas === 0 ? "TODOS OS TESTES PASSARAM" : `${falhas} FALHA(S)`}`);
process.exit(falhas === 0 ? 0 : 1);
