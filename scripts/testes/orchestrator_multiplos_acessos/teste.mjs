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
const { definirProximaRespostaGemini, resetarGemini, chamadasGemini } = await import("./fake_gemini_client.mjs");
const {
  definirProximoResultadoConhecimentoInstitucional,
  resetarConhecimentoInstitucionalFake,
  chamadasConhecimentoInstitucional,
} = await import("./fake_conhecimento.mjs");
const {
  definirProximoResultadoConhecimentoSuporte,
  forcarErroConhecimentoSuporte,
  resetarConhecimentoSuporteFake,
  chamadasConhecimentoSuporte,
} = await import("./fake_conhecimento_suporte.mjs");
const {
  resetarWhatsapp,
  getMensagensEnviadas,
  getMensagensInterativasEnviadas,
  getTemplatesEnviados,
} = await import("./fake_whatsapp_client.mjs");
const { resetarValorCliente, chamadasConsultarValor } =
  await import("./fake_rocket_valor_cliente.mjs");
const { resetarTokensRenovacao, chamadasCriarToken, argsCriarToken } = await import("./fake_tokens_renovacao.mjs");
const {
  resetarRenovacoesLote,
  chamadasCriarLote,
  definirLoteAtivoParaPublicId,
  definirUltimaOperacaoTerminalParaPublicId,
} = await import("./fake_renovacoes_lote.mjs");
const { configurarTokenExistente } = await import("./fake_tokens_renovacao.mjs");
const {
  resetarUnitvContaClient,
  definirResolucaoContaUnitv,
  snsResolverContaUnitv,
} = await import("./fake_unitv_conta_client.mjs");
const { definirProximoResultadoValorCliente } = await import("./fake_rocket_valor_cliente.mjs");

const TOKEN_INTERNO = "orchestrator-token-de-teste";
process.env.ORCHESTRATOR_INTERNAL_TOKEN = TOKEN_INTERNO;
process.env.SUPABASE_URL = "https://exemplo-teste.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-de-teste";
// Etapa 1.5: com o numero do Jose configurado, o aviso por template
// tambem e' exercitado nos testes de roteamento UniTV.
process.env.WHATSAPP_JOSE_NUMERO = "5511777777777";

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
  resetarRenovacoesLote();
  resetarUnitvContaClient();
  resetarConhecimentoInstitucionalFake();
  resetarConhecimentoSuporteFake();
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
      valor: "35.00", // formato ponto -- formatarValorBRL normaliza p/ "35,00"
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
      valor: "42,00", // formato virgula -- valor DIFERENTE do acesso A
    },
  });
}

// Etapa 1.5 (Lacuna A): acesso 1 = Sigma (BLAZE), acesso 2 = UniTV.
function configurarSigmaMaisUnitv() {
  configurarMatch({
    outcome: "multiple_matches",
    candidates: [
      { publicId: PUBLIC_ID_A, nome: "Meu Uso Testes", usuario: "828667229" },
      { publicId: PUBLIC_ID_B, nome: "José Antonio Dos Santos", usuario: "gcnv6v" },
    ],
  });
  configurarStatus(PUBLIC_ID_A, {
    outcome: "success",
    linkState: "linked",
    publicId: PUBLIC_ID_A,
    syncedAt: new Date().toISOString(),
    cliente: { nome: "Meu Uso Testes", usuario: "828667229", vencimento: "2026-09-13T23:59:00-03:00", planoNome: "Mensal", servidorNome: "BLAZE", telas: 1, valor: "35.00" },
  });
  configurarStatus(PUBLIC_ID_B, {
    outcome: "success",
    linkState: "linked",
    publicId: PUBLIC_ID_B,
    syncedAt: new Date().toISOString(),
    cliente: { nome: "José Antonio Dos Santos", usuario: "gcnv6v", vencimento: "2026-11-03T23:59:00-03:00", planoNome: "Mensal", servidorNome: "UNITV", telas: 1, valor: "35.00" },
  });
}

// Etapa 1.5: os dois acessos UniTV.
function configurarDoisUnitv() {
  configurarMatch({
    outcome: "multiple_matches",
    candidates: [
      { publicId: PUBLIC_ID_A, nome: "Karla Filha", usuario: "3tnjsc" },
      { publicId: PUBLIC_ID_B, nome: "José Antonio Dos Santos", usuario: "gcnv6v" },
    ],
  });
  configurarStatus(PUBLIC_ID_A, {
    outcome: "success", linkState: "linked", publicId: PUBLIC_ID_A, syncedAt: new Date().toISOString(),
    cliente: { nome: "Karla Filha", usuario: "3tnjsc", vencimento: "2026-09-21T23:59:00-03:00", planoNome: "Mensal", servidorNome: "UNITV", telas: 1, valor: "35.00" },
  });
  configurarStatus(PUBLIC_ID_B, {
    outcome: "success", linkState: "linked", publicId: PUBLIC_ID_B, syncedAt: new Date().toISOString(),
    cliente: { nome: "José Antonio Dos Santos", usuario: "gcnv6v", vencimento: "2026-11-03T23:59:00-03:00", planoNome: "Mensal", servidorNome: "UNITV", telas: 1, valor: "35.00" },
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
    data: { tipo: "propor_renovacao", texto: "Claro, vou te ajudar a renovar seu acesso!", esclarecimento: false },
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
  ok(texto.includes("Qual desses acessos você gostaria de renovar?"), "Teste A: pergunta presente");
  ok(texto.includes("📋 *Seus acessos*"), "Teste A: cabecalho da lista presente");
  ok(
    texto.includes("Digite o número do acesso, ou *0* para renovar os dois."),
    "Teste A: instrucao de entrada (numero do acesso ou 0 = lote) presente",
  );

  // Valor por acesso -- vem do /status (fake), formatarValorBRL
  // normaliza "35.00"/"42,00" -> "35,00"/"42,00". Cada valor no SEU bloco.
  ok(texto.includes("💰 Valor: R$ 35,00"), "Teste A: valor do acesso BLAZE (35.00 -> R$ 35,00)");
  ok(texto.includes("💰 Valor: R$ 42,00"), "Teste A: valor do acesso NewOne (42,00 -> R$ 42,00)");
  // Vencimento por acesso -- vem do `vencimento` do /status (fake),
  // formatado DD/MM/AAAA (fuso America/Sao_Paulo). Cada um no SEU bloco.
  ok(texto.includes("📅 Vencimento: 13/09/2026"), "Teste A: vencimento do acesso BLAZE (13/09/2026)");
  ok(texto.includes("📅 Vencimento: 08/12/2026"), "Teste A: vencimento do acesso NewOne (08/12/2026)");
  {
    const bloco1 = texto.slice(texto.indexOf("BLAZE"), texto.indexOf("─────────────────"));
    const bloco2 = texto.slice(texto.indexOf("NewOne"));
    ok(bloco1.includes("💰 Valor: R$ 35,00") && !bloco1.includes("42,00"), "Teste A: bloco BLAZE tem R$ 35,00, nunca o valor do NewOne");
    ok(bloco2.includes("💰 Valor: R$ 42,00") && !bloco2.includes("35,00"), "Teste A: bloco NewOne tem R$ 42,00, nunca o valor do BLAZE");
    ok(bloco1.includes("📅 Vencimento: 13/09/2026") && !bloco1.includes("08/12/2026"), "Teste A: bloco BLAZE tem seu vencimento, nunca o do NewOne");
    ok(bloco2.includes("📅 Vencimento: 08/12/2026") && !bloco2.includes("13/09/2026"), "Teste A: bloco NewOne tem seu vencimento, nunca o do BLAZE");
  }

  // Separador so' entre os acessos, nunca depois do ultimo.
  const linhas = texto.split("\n");
  const ultimaLinhaNaoVazia = [...linhas].reverse().find((l) => l.trim().length > 0);
  ok(
    ultimaLinhaNaoVazia === "Digite o número do acesso, ou *0* para renovar os dois.",
    "Teste A: separador nunca aparece depois do ultimo acesso (instrucao de entrada e' a ultima linha)",
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

// Mesmos dois acessos de configurarDoisAcessos, mas o /match devolve os
// candidatos na ORDEM INVERTIDA (NewOne antes de BLAZE). Sem a ordenacao
// deterministica, a posicao 1 da lista viraria NewOne e "2" resolveria
// BLAZE -- exatamente o bug que ordenarAcessosMultiplos previne.
function configurarDoisAcessosOrdemInvertida() {
  configurarDoisAcessos();
  configurarMatch({
    outcome: "multiple_matches",
    candidates: [
      { publicId: PUBLIC_ID_B, nome: "Js Informática Rp", usuario: "2715749553" },
      { publicId: PUBLIC_ID_A, nome: "Meu Uso Testes", usuario: "828667229" },
    ],
  });
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
    data: { tipo: "propor_renovacao", texto: "Perfeito, vou preparar a renovação do BLAZE.", esclarecimento: false },
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
  // 2026-09-07: o MESMO usuario da proposta e' PERSISTIDO no token
  // (Sigma), sem nova consulta ao Rocket -- pra mensagem final.
  ok((argsCriarToken()[0] ?? {}).usuario === "828667229", "Teste B: criarTokenRenovacao recebe o usuario real (persistencia Sigma)");
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
    data: { tipo: "propor_renovacao", texto: "Vou te ajudar a renovar!", esclarecimento: false },
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
    data: { tipo: "transferir", texto: "Vou te encaminhar para um atendente.", esclarecimento: false },
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
      valor: "35.00",
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
    data: { tipo: "responder", texto: PROSA_GEMINI, esclarecimento: false },
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
  ok(texto.includes("💰 Valor: R$ 35,00") && texto.includes("💰 Valor: R$ 42,00"), "Teste E: valor de cada acesso presente (via /status, interceptor C3)");
  ok(texto.includes("📅 Vencimento: 13/09/2026") && texto.includes("📅 Vencimento: 08/12/2026"), "Teste E: vencimento de cada acesso presente (via /status)");
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
  definirProximaRespostaGemini({ outcome: "success", data: { tipo: "responder", texto: PROSA, esclarecimento: false } });

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
  definirProximaRespostaGemini({ outcome: "success", data: { tipo: "responder", texto: PROSA, esclarecimento: false } });

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
  definirProximaRespostaGemini({ outcome: "success", data: { tipo: "responder", texto: PROSA, esclarecimento: false } });

  const resp = await handler(req({ telefone: TELEFONE, conteudo: "vamos lá então" }));
  await resp.json();

  const enviadas = getMensagensEnviadas();
  ok(enviadas.length === 1, "Teste H: exatamente 1 mensagem ao cliente");
  ok(enviadas[0].texto.includes("Qual desses acessos você gostaria de renovar?"), "Teste H: lista fixa disparada pela intencao de sessao");
  ok(!enviadas[0].texto.includes("Sobre qual acesso você gostaria de falar"), "Teste H: prosa do Gemini nao vai ao cliente");
  ok(acionamentosRegistrados().length === 0, "Teste H: nenhuma transferencia");
}

// ---------------------------------------------------------------------
// Etapa 1 -- Teste I: cliente responde "0" a lista -> renovacao em LOTE.
// Cria 1 lote com 2 filhos 'sigma'. O preco de cada acesso e' o VALOR
// REAL dele no Rocket (fake /status: BLAZE 35,00 + NewOne 42,00) e o
// total e' a SOMA (77,00) -- sem constante fixa, sem desconto. Envia
// UMA confirmacao interativa (ACEITO/CANCELAR) com o total -- sem
// transferencia, sem citar "promocao"/"desconto".
// ---------------------------------------------------------------------
async function testeI() {
  resetarTudo();
  configurarDoisAcessos();
  getConversaAtual().intencao_atual = "renovacao"; // lista ja foi enviada antes
  definirProximaRespostaGemini({
    outcome: "success",
    data: { tipo: "responder", texto: "Qual acesso você quer renovar?", esclarecimento: false },
  });

  const resp = await handler(req({ telefone: TELEFONE, conteudo: "0" }));
  const body = await resp.json();

  ok(resp.status === 200, "Teste I: HTTP 200");
  ok(acionamentosRegistrados().length === 0, "Teste I: NENHUMA transferencia humana");
  ok(getConversaAtual().estado !== "aguardando_humano", "Teste I: conversa nao vai para aguardando_humano");

  const chamadas = chamadasCriarLote();
  ok(chamadas.length === 1, "Teste I: criarRenovacaoLote chamado exatamente uma vez");
  const c = chamadas[0] ?? {};
  ok(c.valorTotalCentavos === 7700, "Teste I: total do lote = 7700 centavos (35,00 + 42,00 = R$ 77,00)");
  ok(c.regraAplicada === "soma_valores_rocket", "Teste I: rotulo interno = soma dos valores reais (sem regra comercial)");
  ok(Array.isArray(c.filhos) && c.filhos.length === 2, "Teste I: lote nasce com 2 filhos");
  ok(c.filhos?.every((f) => f.tipo === "sigma"), "Teste I: filhos tipo 'sigma' (UniTV so' na Etapa 2)");
  {
    const porPub = Object.fromEntries((c.filhos ?? []).map((f) => [f.publicId, f.valorEsperadoCentavos]));
    ok(porPub[PUBLIC_ID_A] === 3500, "Teste I: filho BLAZE carrega o valor REAL dele (3500)");
    ok(porPub[PUBLIC_ID_B] === 4200, "Teste I: filho NewOne carrega o valor REAL dele (4200)");
    ok((c.filhos ?? []).reduce((s, f) => s + f.valorEsperadoCentavos, 0) === c.valorTotalCentavos, "Teste I: total = soma exata dos valores dos filhos");
  }
  ok(
    c.filhos?.map((f) => f.publicId).sort().join(",") === [PUBLIC_ID_A, PUBLIC_ID_B].sort().join(","),
    "Teste I: filhos apontam para os public_id reais dos dois acessos",
  );
  {
    // 2026-09-07: cada filho Sigma carrega o SEU usuario real (aqui via
    // fallback /match, ja que este fake /status nao traz `usuario`) --
    // persistido no snapshot para a mensagem final.
    const porPubUsuario = Object.fromEntries((c.filhos ?? []).map((f) => [f.publicId, f.usuario]));
    ok(porPubUsuario[PUBLIC_ID_A] === "828667229", "Teste I: filho A carrega o usuario real (828667229)");
    ok(porPubUsuario[PUBLIC_ID_B] === "2715749553", "Teste I: filho B carrega o usuario real (2715749553)");
  }

  const interativas = getMensagensInterativasEnviadas();
  ok(interativas.length === 1, "Teste I: exatamente 1 mensagem interativa (confirmacao do lote)");
  const texto = interativas[0]?.texto ?? "";
  ok(texto.includes("📋 *Confira sua renovação*"), "Teste I: cabecalho da confirmacao de lote");
  ok(texto.includes("Você vai renovar 2 acessos"), "Teste I: quantidade de acessos no texto");
  ok(texto.includes("*1. Meu Uso Testes*") && texto.includes("*2. Js Informática Rp*"), "Teste I: os dois nomes, numerados e em negrito");
  ok(texto.includes("💰 R$ 35,00") && texto.includes("💰 R$ 42,00"), "Teste I: cada acesso mostra o SEU valor real (35,00 e 42,00)");
  ok(texto.includes("💰 *Total: R$ 77,00*"), "Teste I: total consolidado = soma real (77,00)");
  ok(!/promo|desconto/i.test(texto), "Teste I: NUNCA cita 'promocao'/'desconto' ao cliente");

  const botoes = interativas[0]?.botoes ?? [];
  ok(botoes.some((b) => b.titulo === "ACEITO" && b.id === `renovacao:aceitar:${"a".repeat(64)}`), "Teste I: botao ACEITO com id do token_hash do lote");
  ok(botoes.some((b) => b.titulo === "CANCELAR" && b.id === `renovacao:cancelar:${"a".repeat(64)}`), "Teste I: botao CANCELAR com id do token_hash do lote");

  ok(getMensagensEnviadas().length === 0, "Teste I: nenhuma mensagem de texto simples (so' a interativa)");
  ok(!texto.includes("Qual acesso você quer renovar?"), "Teste I: prosa do Gemini nunca vai ao cliente");
  ok(body?.renovacao?.acessoResolvido === null, "Teste I: diagnostico marca acessoResolvido=null (e' lote)");

  const log = mensagensRegistradas();
  ok(log.some((m) => m.origem === "cliente" && m.texto === "0"), "Teste I: mensagem '0' do cliente registrada");
  ok(log.some((m) => m.origem === "ia" && m.texto === texto), "Teste I: confirmacao do lote registrada como 'ia'");
}

// ---------------------------------------------------------------------
// Etapa 1 -- Teste J: "0" com 3 acessos -> fora do ESCOPO OPERACIONAL
// atual do lote (exatamente 2 acessos). A precificacao ja generaliza
// (soma dos valores reais), mas o Orquestrador so' oferece o lote pra
// N===2 -> fallback pedindo pra escolher 1, NUNCA transferencia, NUNCA
// criacao de lote. (limite operacional, nao regra de preco)
// ---------------------------------------------------------------------
async function testeJ() {
  resetarTudo();
  configurarDoisAcessos();
  const PUBLIC_ID_C = "pub-terceiro-teste";
  configurarMatch({
    outcome: "multiple_matches",
    candidates: [
      { publicId: PUBLIC_ID_A, nome: "Meu Uso Testes", usuario: "828667229" },
      { publicId: PUBLIC_ID_B, nome: "Js Informática Rp", usuario: "2715749553" },
      { publicId: PUBLIC_ID_C, nome: "Terceiro Acesso", usuario: "999999999" },
    ],
  });
  configurarStatus(PUBLIC_ID_C, {
    outcome: "success",
    linkState: "linked",
    publicId: PUBLIC_ID_C,
    syncedAt: new Date().toISOString(),
    cliente: { nome: "Terceiro Acesso", vencimento: "2026-10-01T23:59:00-03:00", planoNome: "Mensal", servidorNome: "OUTRO", telas: 1, valor: "35.00" },
  });
  getConversaAtual().intencao_atual = "renovacao";
  definirProximaRespostaGemini({ outcome: "success", data: { tipo: "responder", texto: "...", esclarecimento: false } });

  const resp = await handler(req({ telefone: TELEFONE, conteudo: "0" }));
  await resp.json();

  ok(chamadasCriarLote().length === 0, "Teste J: nenhum lote criado (N=3 fora do escopo operacional de 2 acessos)");
  ok(acionamentosRegistrados().length === 0, "Teste J: nenhuma transferencia humana");
  const enviadas = getMensagensEnviadas();
  ok(enviadas.length === 1 && /renovar 2 acessos de uma vez/i.test(enviadas[0].texto), "Teste J: fallback pede pra escolher 1 (consigo renovar 2 de uma vez)");
  ok(getMensagensInterativasEnviadas().length === 0, "Teste J: nenhuma confirmacao interativa de lote");
}

// ---------------------------------------------------------------------
// Etapa 1 -- Teste K: cliente responde "1" a lista -> seleciona o
// acesso da POSICAO 1 (BLAZE) e entra no MESMO caminho individual de
// propostaRenovacaoComAcesso (confirmacao interativa ACEITO/CANCELAR).
// NAO e' lote, NAO e' transferencia, NAO re-envia a lista.
// ---------------------------------------------------------------------
async function testeK() {
  resetarTudo();
  configurarDoisAcessos();
  getConversaAtual().intencao_atual = "renovacao"; // lista ja enviada antes
  definirProximaRespostaGemini({
    outcome: "success",
    data: { tipo: "responder", texto: "Qual acesso você quer renovar?", esclarecimento: false },
  });

  const resp = await handler(req({ telefone: TELEFONE, conteudo: "1" }));
  const body = await resp.json();

  ok(resp.status === 200, "Teste K: HTTP 200");
  ok(acionamentosRegistrados().length === 0, "Teste K: NENHUMA transferencia humana");
  ok(chamadasCriarLote().length === 0, "Teste K: NAO cria lote (selecao individual)");
  ok(
    body?.renovacao?.acessoResolvido?.publicId === PUBLIC_ID_A &&
      body?.renovacao?.acessoResolvido?.servidorNome === "BLAZE",
    "Teste K: acesso resolvido e' o da POSICAO 1 (BLAZE)",
  );
  const interativas = getMensagensInterativasEnviadas();
  ok(interativas.length === 1, "Teste K: confirmacao interativa (ACEITO/CANCELAR) enviada -- caminho individual");
  ok(
    interativas[0]?.botoes?.some((b) => b.titulo === "ACEITO") &&
      interativas[0]?.botoes?.some((b) => b.titulo === "CANCELAR"),
    "Teste K: botoes ACEITO/CANCELAR presentes",
  );
  ok(!getMensagensEnviadas().some((m) => m.texto.includes("Qual desses acessos")), "Teste K: a lista NAO e' re-enviada");
  ok(!getMensagensEnviadas().some((m) => m.texto.includes("Qual acesso você quer renovar?")), "Teste K: prosa do Gemini nunca vai ao cliente");
  ok(
    atualizacoesSessaoRegistradas().some((a) => a.dados?.acessoSelecionado === PUBLIC_ID_A),
    "Teste K: acesso_selecionado gravado na sessao (posicao 1)",
  );
}

// ---------------------------------------------------------------------
// Etapa 1 -- Teste L: "2" -> seleciona o acesso da POSICAO 2 (NewOne).
// ---------------------------------------------------------------------
async function testeL() {
  resetarTudo();
  configurarDoisAcessos();
  getConversaAtual().intencao_atual = "renovacao";
  definirProximaRespostaGemini({ outcome: "success", data: { tipo: "responder", texto: "...", esclarecimento: false } });

  const resp = await handler(req({ telefone: TELEFONE, conteudo: " 2 " })); // espacos: mesmo formato ancorado do "0"
  const body = await resp.json();

  ok(acionamentosRegistrados().length === 0, "Teste L: nenhuma transferencia");
  ok(chamadasCriarLote().length === 0, "Teste L: NAO cria lote");
  ok(
    body?.renovacao?.acessoResolvido?.publicId === PUBLIC_ID_B &&
      body?.renovacao?.acessoResolvido?.servidorNome === "NewOne",
    "Teste L: acesso resolvido e' o da POSICAO 2 (NewOne), nunca o da posicao 1",
  );
  ok(getMensagensInterativasEnviadas().length === 1, "Teste L: confirmacao interativa enviada");
  ok(
    atualizacoesSessaoRegistradas().some((a) => a.dados?.acessoSelecionado === PUBLIC_ID_B),
    "Teste L: acesso_selecionado gravado = posicao 2",
  );
}

// ---------------------------------------------------------------------
// Etapa 1 -- Teste M (borda): numero FORA de 1..N (ex.: "3" com 2
// acessos) NAO e' selecao -> segue o fluxo normal (aqui: interceptor C3
// re-envia a lista). Nunca cria lote, nunca cobra um acesso inexistente.
// ---------------------------------------------------------------------
async function testeM() {
  resetarTudo();
  configurarDoisAcessos();
  getConversaAtual().intencao_atual = "renovacao";
  definirProximaRespostaGemini({ outcome: "success", data: { tipo: "responder", texto: "Qual deles?", esclarecimento: false } });

  const resp = await handler(req({ telefone: TELEFONE, conteudo: "3" }));
  const body = await resp.json();

  ok(chamadasCriarLote().length === 0, "Teste M: '3' com 2 acessos -> nenhum lote");
  ok(getMensagensInterativasEnviadas().length === 0, "Teste M: '3' com 2 acessos -> nenhuma confirmacao individual");
  ok(acionamentosRegistrados().length === 0, "Teste M: nenhuma transferencia");
  const enviadas = getMensagensEnviadas();
  ok(
    enviadas.length === 1 && enviadas[0].texto.includes("Qual desses acessos você gostaria de renovar?"),
    "Teste M: numero fora de 1..N -> a lista e' (re)enviada, sem selecionar nada",
  );
  ok(body?.renovacao?.acessoResolvido === null, "Teste M: nenhum acesso resolvido");
}

// ---------------------------------------------------------------------
// Etapa 1 -- Teste N (negativo): "1" SEM intencao de renovar (nenhuma
// palavra, nenhuma sessao) -> NAO e' selecao de acesso; prosa do Gemini
// segue normal. Um "1" solto nunca sequestra o fluxo.
// ---------------------------------------------------------------------
async function testeN() {
  resetarTudo();
  configurarDoisAcessos();
  const PROSA = "Certo, anotado. Mais alguma coisa?";
  definirProximaRespostaGemini({ outcome: "success", data: { tipo: "responder", texto: PROSA, esclarecimento: false } });

  const resp = await handler(req({ telefone: TELEFONE, conteudo: "1" }));
  await resp.json();

  ok(chamadasCriarLote().length === 0, "Teste N: sem intencao de renovar -> nenhum lote");
  ok(getMensagensInterativasEnviadas().length === 0, "Teste N: sem intencao -> nenhuma confirmacao de renovacao");
  ok(acionamentosRegistrados().length === 0, "Teste N: nenhuma transferencia");
  const enviadas = getMensagensEnviadas();
  ok(enviadas.length === 1 && enviadas[0].texto === PROSA, "Teste N: prosa do Gemini enviada normalmente (um '1' solto nao dispara selecao)");
}

// ---------------------------------------------------------------------
// Etapa 1 -- Teste O: seleçao por NOME de servidor continua funcionando
// (o caminho numerico so' ADICIONA, nunca substitui).
// ---------------------------------------------------------------------
async function testeO() {
  resetarTudo();
  configurarDoisAcessos();
  getConversaAtual().intencao_atual = "renovacao";
  definirProximaRespostaGemini({
    outcome: "success",
    data: { tipo: "propor_renovacao", texto: "Vou preparar a renovação do NewOne.", esclarecimento: false },
  });

  const resp = await handler(req({ telefone: TELEFONE, conteudo: "quero o NewOne" }));
  const body = await resp.json();

  ok(chamadasCriarLote().length === 0, "Teste O: selecao por nome -> nenhum lote");
  ok(getMensagensInterativasEnviadas().length === 1, "Teste O: confirmacao interativa (caminho individual por nome, inalterado)");
  ok(
    body?.renovacao?.acessoResolvido?.servidorNome === "NewOne",
    "Teste O: resolveu por NOME de servidor, como antes",
  );
}

// ---------------------------------------------------------------------
// Etapa 1 -- Teste P: o acesso escolhido (por NOME de servidor) ja faz
// parte de um LOTE ativo -> pertence EXCLUSIVAMENTE ao fluxo de lote.
// O fluxo individual NAO cria token novo, NAO consulta o Rocket, NAO
// gera confirmacao interativa, NAO transfere -- so' informa "ja ha' uma
// renovacao em andamento" e para.
// ---------------------------------------------------------------------
async function testeP() {
  resetarTudo();
  configurarDoisAcessos();
  configurarTokenExistente(null); // nenhum token INDIVIDUAL ativo
  definirLoteAtivoParaPublicId(PUBLIC_ID_A); // ...mas ha' um LOTE cobrindo o acesso 1 (BLAZE)
  getConversaAtual().intencao_atual = "renovacao";
  definirProximaRespostaGemini({
    outcome: "success",
    data: { tipo: "propor_renovacao", texto: "Vou preparar a renovação do BLAZE.", esclarecimento: false },
  });

  const resp = await handler(req({ telefone: TELEFONE, conteudo: "quero renovar o BLAZE" }));
  const body = await resp.json();

  ok(resp.status === 200, "Teste P: HTTP 200");
  ok(acionamentosRegistrados().length === 0, "Teste P: NENHUMA transferencia humana");
  ok(chamadasCriarLote().length === 0, "Teste P: nao cria lote novo");
  ok(getMensagensInterativasEnviadas().length === 0, "Teste P: NENHUMA confirmacao interativa (token de lote nao e' reaproveitado)");

  const enviadas = getMensagensEnviadas();
  ok(
    enviadas.length === 1 && enviadas[0].texto.includes("Você já tem uma renovação em andamento para este acesso"),
    "Teste P: cliente recebe 'ja ha' uma renovacao em andamento', uma unica vez",
  );
  ok(
    !enviadas.some((m) => m.texto.includes("Estou buscando") || m.texto.includes("buscando os dados")),
    "Teste P: guard e' ANTES da consulta ao Rocket -- nenhuma 'mensagem 1' de busca e' enviada",
  );

  const log = mensagensRegistradas();
  ok(log.some((m) => m.origem === "cliente" && m.texto === "quero renovar o BLAZE"), "Teste P: mensagem do cliente registrada uma vez");
  ok(
    log.filter((m) => m.origem === "ia" && m.texto.includes("Você já tem uma renovação em andamento")).length === 1,
    "Teste P: a resposta 'ja existe' e' registrada no historico exatamente uma vez",
  );
}

// ---------------------------------------------------------------------
// Etapa 1 -- Teste Q: mesmo cenario, mas via SELECAO NUMERICA ("1").
// O guard de lote-exclusivo vale para os dois pontos de entrada do
// fluxo individual (nome de servidor E numero).
// ---------------------------------------------------------------------
async function testeQ() {
  resetarTudo();
  configurarDoisAcessos();
  configurarTokenExistente(null);
  definirLoteAtivoParaPublicId(PUBLIC_ID_B); // lote cobre o acesso 2 (NewOne)
  getConversaAtual().intencao_atual = "renovacao";
  definirProximaRespostaGemini({ outcome: "success", data: { tipo: "responder", texto: "...", esclarecimento: false } });

  const resp = await handler(req({ telefone: TELEFONE, conteudo: "2" }));
  const body = await resp.json();

  ok(acionamentosRegistrados().length === 0, "Teste Q: nenhuma transferencia");
  ok(chamadasCriarLote().length === 0, "Teste Q: nao cria lote novo");
  ok(getMensagensInterativasEnviadas().length === 0, "Teste Q: nenhuma confirmacao interativa (acesso pertence a um lote)");
  const enviadas = getMensagensEnviadas();
  ok(
    enviadas.length === 1 && enviadas[0].texto.includes("Você já tem uma renovação em andamento para este acesso"),
    "Teste Q: selecao numerica de um acesso ja em lote -> 'ja ha' uma renovacao em andamento'",
  );
}

// ---------------------------------------------------------------------
// Etapa 1 -- Teste R (regressao): acesso SEM lote ativo -> o fluxo
// individual segue normal (cria token, confirmacao interativa). O guard
// so' bloqueia quem realmente esta num lote.
// ---------------------------------------------------------------------
async function testeR() {
  resetarTudo();
  configurarDoisAcessos();
  configurarTokenExistente(null);
  // nenhum definirLoteAtivoParaPublicId -> nenhum acesso em lote
  getConversaAtual().intencao_atual = "renovacao";
  definirProximaRespostaGemini({
    outcome: "success",
    data: { tipo: "propor_renovacao", texto: "Vou preparar a renovação do BLAZE.", esclarecimento: false },
  });

  const resp = await handler(req({ telefone: TELEFONE, conteudo: "quero renovar o BLAZE" }));
  await resp.json();

  ok(getMensagensInterativasEnviadas().length === 1, "Teste R: sem lote -> confirmacao interativa individual normal");
  ok(
    !getMensagensEnviadas().some((m) => m.texto.includes("Você já tem uma renovação em andamento")),
    "Teste R: sem lote -> nunca a mensagem de 'ja existe'",
  );
  ok(acionamentosRegistrados().length === 0, "Teste R: nenhuma transferencia");
}

// ---------------------------------------------------------------------
// Etapa 4 (2026-09-15, guard de expiracao) -- mesmo guard de
// _shared/renovacao_guard_expiracao.ts usado pelo Portal, aplicado ao
// fluxo individual do WhatsApp (buscarTokenAtivoPorPublicId). So' o
// caso 'aguardando_confirmacao' (fecha via CAS, sem Woovi) e' testado
// de ponta a ponta aqui -- a logica completa (incluindo Woovi/
// cobranca) ja esta' coberta exaustivamente em
// scripts/testes/renovacao_guard_expiracao/teste.mjs; aqui o objetivo
// e' so' provar a FIACAO real dentro do orchestrator.
// ---------------------------------------------------------------------
async function testeEtapa4AguardandoVencidoFechaECriaNovo() {
  resetarTudo();
  configurarDoisAcessos();
  configurarTokenExistente({
    id: "tk-etapa4-aguardando",
    estado: "aguardando_confirmacao",
    operacao_id: null,
    grupo_id: null,
    expira_em: new Date(Date.now() - 60 * 1000).toISOString(),
  });
  getConversaAtual().intencao_atual = "renovacao";
  definirProximaRespostaGemini({
    outcome: "success",
    data: { tipo: "propor_renovacao", texto: "Vou preparar a renovação do BLAZE.", esclarecimento: false },
  });

  const resp = await handler(req({ telefone: TELEFONE, conteudo: "quero renovar o BLAZE" }));
  await resp.json();

  ok(
    getMensagensInterativasEnviadas().length === 1,
    "Etapa4 orchestrator: token 'aguardando_confirmacao' vencido -> fecha e cria proposta nova normalmente",
  );
  ok(
    !getMensagensEnviadas().some((m) => m.texto.includes("Você já tem uma renovação em andamento")),
    "Etapa4 orchestrator: token vencido -> nunca bloqueia (era o 2o bloqueio real do incidente Flavio)",
  );
  ok(chamadasCriarToken() === 1, "Etapa4 orchestrator: exatamente 1 token novo criado");
  ok(acionamentosRegistrados().length === 0, "Etapa4 orchestrator: nenhuma transferencia");
}
async function testeEtapa4EmAndamentoNuncaTocado() {
  resetarTudo();
  configurarDoisAcessos();
  configurarTokenExistente({
    id: "tk-etapa4-andamento",
    estado: "renovacao_em_andamento",
    operacao_id: "op-etapa4-andamento",
    grupo_id: null,
    expira_em: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1h atras -- bem vencido
  });
  getConversaAtual().intencao_atual = "renovacao";
  definirProximaRespostaGemini({
    outcome: "success",
    data: { tipo: "propor_renovacao", texto: "Vou preparar a renovação do BLAZE.", esclarecimento: false },
  });

  const resp = await handler(req({ telefone: TELEFONE, conteudo: "quero renovar o BLAZE" }));
  await resp.json();

  ok(
    getMensagensInterativasEnviadas().length === 0,
    "Etapa4 orchestrator: 'renovacao_em_andamento' continua bloqueando mesmo com expira_em bem vencido",
  );
  ok(
    getMensagensEnviadas().some((m) => m.texto.includes("Você já tem uma renovação em andamento")),
    "Etapa4 orchestrator: mensagem de bloqueio enviada normalmente",
  );
  ok(chamadasCriarToken() === 0, "Etapa4 orchestrator: nenhum token novo criado");
}

// =====================================================================
// Etapa 1.5 (Lacuna A) -- roteamento por tipo de acesso (Sigma x UniTV)
// =====================================================================
const {
  MENSAGEM_RENOVACAO_UNITV_INSTABILIDADE,
  MENSAGEM_RENOVACAO_UNITV_NAO_IDENTIFICADO,
  MENSAGEM_RENOVACAO_LOTE_UNITV_INSTABILIDADE,
  MENSAGEM_RENOVACAO_LOTE_UNITV_NAO_IDENTIFICADO,
} = await import("../../../supabase/functions/_shared/mensagens_fixas.ts");

// Etapa 2 (Bloco 4) -- roteamento UniTV VIRADO: UniTV resolvida segue
// o fluxo normal de renovacao (token tipo='unitv' + ACEITO/CANCELAR);
// as mensagens fixas de UniTV so' aparecem como FALLBACK quando a
// resolucao da conta (sn -> id do painel) falha. A resolucao acontece
// via renovacao-unitv-conta (fake_unitv_conta_client).

// Teste S: seleciona por NUMERO um acesso UniTV, resolucao OK -> cria
// token tipo='unitv' (public_id + unitv_sn + unitv_id) + confirmacao
// interativa. NENHUMA transferencia, NENHUMA mensagem fixa de UniTV.
async function testeS() {
  resetarTudo();
  configurarSigmaMaisUnitv(); // 1=BLAZE sigma, 2=UNITV (usuario "gcnv6v")
  definirProximoResultadoValorCliente({
    outcome: "success", nome: "José Antonio Dos Santos", servidorNome: "UNITV",
    planoNome: "Mensal", valor: "35.00", vencimento: "2026-11-03T23:59:00-03:00", usuario: "gcnv6v",
  });
  getConversaAtual().intencao_atual = "renovacao";
  definirProximaRespostaGemini({ outcome: "success", data: { tipo: "responder", texto: "...", esclarecimento: false } });

  const resp = await handler(req({ telefone: TELEFONE, conteudo: "2" }));
  const body = await resp.json();

  ok(resp.status === 200, "Teste S: HTTP 200");
  ok(snsResolverContaUnitv().includes("gcnv6v"), "Teste S: resolveu a conta UniTV pelo sn (== usuario) 'gcnv6v'");
  ok(chamadasCriarToken() === 1, "Teste S: 1 token de renovacao criado (UniTV resolvida segue o fluxo)");
  const arg = argsCriarToken()[0] ?? {};
  ok(arg.tipo === "unitv", "Teste S: token criado com tipo='unitv'");
  ok(arg.unitvSn === "gcnv6v" && arg.unitvId === 3433363, "Teste S: token carrega unitv_sn + unitv_id resolvidos");
  ok(arg.publicId === PUBLIC_ID_B, "Teste S: token mantem public_id (id do cliente no Rocket)");
  ok(getMensagensInterativasEnviadas().length === 1, "Teste S: confirmacao interativa ACEITO/CANCELAR enviada");
  ok(chamadasCriarLote().length === 0, "Teste S: nao cria lote");
  ok(acionamentosRegistrados().length === 0, "Teste S: NENHUMA transferencia humana (UniTV resolvida)");
  ok(
    !getMensagensEnviadas().some((m) =>
      [MENSAGEM_RENOVACAO_UNITV_INSTABILIDADE, MENSAGEM_RENOVACAO_UNITV_NAO_IDENTIFICADO].includes(m.texto),
    ),
    "Teste S: nenhuma mensagem de fallback UniTV quando a conta resolve",
  );
  ok(body?.renovacao?.acessoResolvido?.servidorNome === "UNITV", "Teste S: diagnostico -- acesso selecionado era UniTV");
}

// Teste S2: acesso UniTV, resolucao da conta FALHA (nao_encontrado) ->
// NENHUM token/cobranca; mensagem fixa de fallback + transferencia com
// motivo especifico + aviso ao Jose.
async function testeS2() {
  resetarTudo();
  configurarSigmaMaisUnitv();
  definirResolucaoContaUnitv({ outcome: "nao_encontrado" });
  getConversaAtual().intencao_atual = "renovacao";
  definirProximaRespostaGemini({ outcome: "success", data: { tipo: "responder", texto: "...", esclarecimento: false } });

  const resp = await handler(req({ telefone: TELEFONE, conteudo: "2" }));
  await resp.json();

  ok(chamadasCriarToken() === 0, "Teste S2: resolucao falhou -> NENHUM token criado");
  ok(chamadasConsultarValor() === 0, "Teste S2: NENHUMA consulta de valor no Rocket");
  ok(getMensagensInterativasEnviadas().length === 0, "Teste S2: NENHUMA confirmacao interativa");
  const acion = acionamentosRegistrados();
  ok(
    acion.length === 1 && acion[0].motivo === "renovacao:unitv_conta_nao_encontrado",
    "Teste S2: transferencia com motivo 'renovacao:unitv_conta_nao_encontrado'",
  );
  ok(
    getMensagensEnviadas().some((m) => m.texto === MENSAGEM_RENOVACAO_UNITV_NAO_IDENTIFICADO),
    "Teste S2: nao_encontrado -> mensagem de NAO IDENTIFICACAO segura (nunca 'nao esta disponivel')",
  );
  ok(
    getTemplatesEnviados().some((t) => (t.parametros ?? [])[0] === "renovacao:unitv_conta_nao_encontrado"),
    "Teste S2: aviso ao Jose com o motivo especifico",
  );
}

// Teste S3: acesso UniTV sem `usuario` em lugar nenhum (/status e
// /match) -> fallback com motivo 'renovacao:unitv_sem_usuario', sem
// nem chamar o resolvedor.
async function testeS3() {
  resetarTudo();
  configurarSigmaMaisUnitv();
  configurarMatch({
    outcome: "multiple_matches",
    candidates: [
      { publicId: PUBLIC_ID_A, nome: "Meu Uso Testes", usuario: "828667229" },
      { publicId: PUBLIC_ID_B, nome: "José Antonio Dos Santos", usuario: null },
    ],
  });
  configurarStatus(PUBLIC_ID_B, {
    outcome: "success", linkState: "linked", publicId: PUBLIC_ID_B, syncedAt: new Date().toISOString(),
    cliente: { nome: "José Antonio Dos Santos", usuario: null, vencimento: "2026-11-03T23:59:00-03:00", planoNome: "Mensal", servidorNome: "UNITV", telas: 1, valor: "35.00" },
  });
  getConversaAtual().intencao_atual = "renovacao";
  definirProximaRespostaGemini({ outcome: "success", data: { tipo: "responder", texto: "...", esclarecimento: false } });

  const resp = await handler(req({ telefone: TELEFONE, conteudo: "2" }));
  await resp.json();

  ok(snsResolverContaUnitv().length === 0, "Teste S3: sem usuario -> resolvedor nunca e' chamado");
  ok(chamadasCriarToken() === 0, "Teste S3: nenhum token criado");
  const acion = acionamentosRegistrados();
  ok(
    acion.length === 1 && acion[0].motivo === "renovacao:unitv_sem_usuario",
    "Teste S3: transferencia com motivo 'renovacao:unitv_sem_usuario'",
  );
  ok(
    getMensagensEnviadas().some((m) => m.texto === MENSAGEM_RENOVACAO_UNITV_NAO_IDENTIFICADO),
    "Teste S3: sem_usuario -> mensagem de NAO IDENTIFICACAO segura",
  );
}

// Teste S4 (UX 2026-08-29): acesso UniTV individual, resolucao da conta
// = 'indisponivel' (falha TRANSITORIA do painel) -> mensagem de
// INSTABILIDADE TEMPORARIA (nunca "ainda nao esta disponivel"). Motivo
// interno de transferencia INALTERADO.
async function testeS4() {
  resetarTudo();
  configurarSigmaMaisUnitv();
  definirResolucaoContaUnitv({ outcome: "indisponivel" });
  getConversaAtual().intencao_atual = "renovacao";
  definirProximaRespostaGemini({ outcome: "success", data: { tipo: "responder", texto: "...", esclarecimento: false } });

  const resp = await handler(req({ telefone: TELEFONE, conteudo: "2" }));
  await resp.json();

  ok(chamadasCriarToken() === 0, "Teste S4: indisponivel -> nenhum token criado");
  const acion = acionamentosRegistrados();
  ok(
    acion.length === 1 && acion[0].motivo === "renovacao:unitv_conta_indisponivel",
    "Teste S4: motivo interno de transferencia INALTERADO ('renovacao:unitv_conta_indisponivel')",
  );
  ok(
    getMensagensEnviadas().some((m) => m.texto === MENSAGEM_RENOVACAO_UNITV_INSTABILIDADE),
    "Teste S4: cliente recebe mensagem de INSTABILIDADE TEMPORARIA",
  );
  ok(
    !getMensagensEnviadas().some((m) => m.texto === MENSAGEM_RENOVACAO_UNITV_NAO_IDENTIFICADO),
    "Teste S4: NAO recebe a mensagem de 'nao identificacao segura'",
  );
  ok(
    getTemplatesEnviados().some((t) => (t.parametros ?? [])[0] === "renovacao:unitv_conta_indisponivel"),
    "Teste S4: aviso ao Jose com o motivo especifico (inalterado)",
  );
}

// Teste T: no mesmo cliente Sigma+UniTV, selecionar o acesso SIGMA (1)
// continua funcionando normalmente -- o irmao UniTV nao contamina.
async function testeT() {
  resetarTudo();
  configurarSigmaMaisUnitv();
  getConversaAtual().intencao_atual = "renovacao";
  definirProximaRespostaGemini({ outcome: "success", data: { tipo: "responder", texto: "...", esclarecimento: false } });

  const resp = await handler(req({ telefone: TELEFONE, conteudo: "1" }));
  const body = await resp.json();

  ok(acionamentosRegistrados().length === 0, "Teste T: acesso Sigma -> nenhuma transferencia");
  ok(chamadasCriarToken() === 1, "Teste T: acesso Sigma -> token de renovacao criado normalmente");
  ok((argsCriarToken()[0] ?? {}).tipo === "sigma", "Teste T: token Sigma nasce tipo='sigma'");
  ok(snsResolverContaUnitv().length === 0, "Teste T: acesso Sigma -> resolvedor UniTV nunca chamado");
  ok(getMensagensInterativasEnviadas().length === 1, "Teste T: confirmacao interativa ACEITO/CANCELAR do acesso Sigma");
  ok(body?.renovacao?.acessoResolvido?.publicId === PUBLIC_ID_A, "Teste T: acesso resolvido = o Sigma (posicao 1)");
  ok(
    !getMensagensEnviadas().some((m) => m.texto.includes("UniTV")),
    "Teste T: nada de mensagem sobre UniTV ao renovar o acesso Sigma",
  );
}

// Teste U: "0" com Sigma + UniTV, TODAS as contas UniTV resolvem ->
// lote MISTO criado (preco = soma real, filhos tipo-aware com
// unitv_sn/unitv_id nos filhos UniTV, public_id em todos).
async function testeU() {
  resetarTudo();
  configurarSigmaMaisUnitv();
  getConversaAtual().intencao_atual = "renovacao";
  definirProximaRespostaGemini({ outcome: "success", data: { tipo: "responder", texto: "...", esclarecimento: false } });

  const resp = await handler(req({ telefone: TELEFONE, conteudo: "0" }));
  const body = await resp.json();

  ok(snsResolverContaUnitv().includes("gcnv6v"), "Teste U: resolveu a conta do filho UniTV");
  ok(chamadasCriarLote().length === 1, "Teste U: lote misto criado (todas as contas UniTV resolveram)");
  const c = chamadasCriarLote()[0] ?? {};
  ok(Array.isArray(c.filhos) && c.filhos.length === 2, "Teste U: 2 filhos");
  ok(c.filhos[0].tipo === "sigma" && c.filhos[1].tipo === "unitv", "Teste U: tipos derivados do servidor (BLAZE->sigma, UNITV->unitv)");
  ok(c.filhos.every((f) => f.publicId), "Teste U: TODOS os filhos carregam public_id (inclusive UniTV)");
  ok(c.filhos[0].unitvSn === null && c.filhos[0].unitvId === null, "Teste U: filho Sigma nao tem unitv_sn/unitv_id");
  ok(c.filhos[1].unitvSn === "gcnv6v" && c.filhos[1].unitvId === 3433363, "Teste U: filho UniTV carrega unitv_sn + unitv_id resolvidos");
  // 2026-09-07: Sigma usa `usuario`; UniTV IGNORA (usuario=null, usa unitvSn).
  ok(c.filhos[0].usuario === "828667229", "Teste U: filho Sigma carrega o usuario real na coluna `usuario`");
  ok(c.filhos[1].usuario === null, "Teste U: filho UniTV -> usuario=null (o usuario dele e' o unitv_sn)");
  ok(c.valorTotalCentavos === 7000, "Teste U: total = soma dos valores reais (35,00 + 35,00 = R$ 70,00)");
  ok(getMensagensInterativasEnviadas().length === 1, "Teste U: confirmacao interativa do lote enviada");
  ok(acionamentosRegistrados().length === 0, "Teste U: nenhuma transferencia (lote criado)");
  ok(
    !getMensagensEnviadas().some((m) =>
      [MENSAGEM_RENOVACAO_LOTE_UNITV_INSTABILIDADE, MENSAGEM_RENOVACAO_LOTE_UNITV_NAO_IDENTIFICADO].includes(m.texto),
    ),
    "Teste U: nenhuma mensagem de fallback UniTV (lote resolve)",
  );
}

// Teste U2: "0" com Sigma + UniTV, a conta UniTV NAO resolve
// (indisponivel) -> NENHUM lote, NENHUMA cobranca; mensagem fixa de
// fallback + transferencia com motivo especifico.
async function testeU2() {
  resetarTudo();
  configurarSigmaMaisUnitv();
  definirResolucaoContaUnitv({ outcome: "indisponivel" });
  getConversaAtual().intencao_atual = "renovacao";
  definirProximaRespostaGemini({ outcome: "success", data: { tipo: "responder", texto: "...", esclarecimento: false } });

  const resp = await handler(req({ telefone: TELEFONE, conteudo: "0" }));
  const body = await resp.json();

  ok(chamadasCriarLote().length === 0, "Teste U2: resolucao UniTV falhou -> NENHUM lote criado");
  ok(chamadasCriarToken() === 0, "Teste U2: nenhum token individual criado");
  ok(getMensagensInterativasEnviadas().length === 0, "Teste U2: nenhuma confirmacao interativa");
  const acion = acionamentosRegistrados();
  ok(
    acion.length === 1 && acion[0].motivo === "renovacao:lote_unitv_conta_indisponivel",
    "Teste U2: transferencia com motivo 'renovacao:lote_unitv_conta_indisponivel'",
  );
  ok(
    getMensagensEnviadas().some((m) => m.texto === MENSAGEM_RENOVACAO_LOTE_UNITV_INSTABILIDADE),
    "Teste U2: indisponivel -> mensagem de INSTABILIDADE TEMPORARIA (lote), nunca 'nao esta disponivel'",
  );
  ok(
    getTemplatesEnviados().some((t) => (t.parametros ?? [])[0] === "renovacao:lote_unitv_conta_indisponivel"),
    "Teste U2: aviso ao Jose com o motivo especifico",
  );
  ok(!/promo|desconto/i.test(getMensagensEnviadas().map((m) => m.texto).join(" ")), "Teste U2: nunca cita promocao/desconto");
  ok(body?.renovacao?.acessoResolvido === null, "Teste U2: diagnostico acessoResolvido=null");
}

// Teste V: "0" com DOIS acessos UniTV, ambos resolvem -> lote 2xUniTV
// criado (2 filhos tipo='unitv', cada um com seu unitv_sn/unitv_id).
async function testeV() {
  resetarTudo();
  configurarDoisUnitv();
  getConversaAtual().intencao_atual = "renovacao";
  definirProximaRespostaGemini({ outcome: "success", data: { tipo: "responder", texto: "...", esclarecimento: false } });

  const resp = await handler(req({ telefone: TELEFONE, conteudo: "0" }));
  await resp.json();

  ok(chamadasCriarLote().length === 1, "Teste V: 2 UniTV resolvidas + '0' -> lote criado");
  const c = chamadasCriarLote()[0] ?? {};
  ok(c.filhos.length === 2 && c.filhos.every((f) => f.tipo === "unitv"), "Teste V: 2 filhos, ambos tipo='unitv'");
  ok(c.filhos.every((f) => f.publicId && f.unitvSn && f.unitvId), "Teste V: cada filho UniTV com public_id + unitv_sn + unitv_id");
  ok(c.filhos.every((f) => f.usuario === null), "Teste V: filhos UniTV -> usuario=null (usam unitv_sn)");
  ok(c.filhos.find((f) => f.unitvSn === "3tnjsc") && c.filhos.find((f) => f.unitvSn === "gcnv6v"), "Teste V: os dois sn corretos nos filhos");
  ok(c.valorTotalCentavos === 7000, "Teste V: total = soma real (35 + 35)");
  ok(getMensagensInterativasEnviadas().length === 1, "Teste V: confirmacao interativa do lote enviada");
  ok(acionamentosRegistrados().length === 0, "Teste V: nenhuma transferencia");
}

// Teste V2: "0" com 2 UniTV, uma delas resolve 'ambiguo' -> nenhum lote
// + fallback.
async function testeV2() {
  resetarTudo();
  configurarDoisUnitv();
  definirResolucaoContaUnitv({ outcome: "ambiguo" });
  getConversaAtual().intencao_atual = "renovacao";
  definirProximaRespostaGemini({ outcome: "success", data: { tipo: "responder", texto: "...", esclarecimento: false } });

  const resp = await handler(req({ telefone: TELEFONE, conteudo: "0" }));
  await resp.json();

  ok(chamadasCriarLote().length === 0, "Teste V2: resolucao ambigua -> nenhum lote");
  ok(getMensagensInterativasEnviadas().length === 0, "Teste V2: nenhuma confirmacao interativa");
  ok(
    acionamentosRegistrados().some((a) => a.motivo === "renovacao:lote_unitv_conta_ambiguo"),
    "Teste V2: transferencia com motivo 'renovacao:lote_unitv_conta_ambiguo'",
  );
  ok(
    getMensagensEnviadas().some((m) => m.texto === MENSAGEM_RENOVACAO_LOTE_UNITV_NAO_IDENTIFICADO),
    "Teste V2: ambiguo -> mensagem de NAO IDENTIFICACAO segura (lote)",
  );
}

// Teste V4 (UX 2026-08-29): "0" com Sigma + UniTV, conta UniTV =
// 'nao_encontrado' -> mensagem de NAO IDENTIFICACAO segura (lote),
// nunca "lote com UniTV nao esta disponivel". Motivo interno
// INALTERADO ('renovacao:lote_unitv_conta_nao_encontrado').
async function testeV4() {
  resetarTudo();
  configurarSigmaMaisUnitv();
  definirResolucaoContaUnitv({ outcome: "nao_encontrado" });
  getConversaAtual().intencao_atual = "renovacao";
  definirProximaRespostaGemini({ outcome: "success", data: { tipo: "responder", texto: "...", esclarecimento: false } });

  const resp = await handler(req({ telefone: TELEFONE, conteudo: "0" }));
  await resp.json();

  ok(chamadasCriarLote().length === 0, "Teste V4: nao_encontrado -> nenhum lote");
  const acion = acionamentosRegistrados();
  ok(
    acion.length === 1 && acion[0].motivo === "renovacao:lote_unitv_conta_nao_encontrado",
    "Teste V4: motivo interno de transferencia INALTERADO",
  );
  ok(
    getMensagensEnviadas().some((m) => m.texto === MENSAGEM_RENOVACAO_LOTE_UNITV_NAO_IDENTIFICADO),
    "Teste V4: cliente recebe mensagem de NAO IDENTIFICACAO segura (lote)",
  );
  ok(
    !getMensagensEnviadas().some((m) => m.texto === MENSAGEM_RENOVACAO_LOTE_UNITV_INSTABILIDADE),
    "Teste V4: NAO recebe a mensagem de instabilidade temporaria",
  );
  ok(
    getTemplatesEnviados().some((t) => (t.parametros ?? [])[0] === "renovacao:lote_unitv_conta_nao_encontrado"),
    "Teste V4: aviso ao Jose com o motivo especifico (inalterado)",
  );
}

// Teste V3 (REGRESSAO -- falha real 2026-08-29): o /status de producao
// pode NAO carregar `usuario` ainda (versao pre-Bloco-2). O lote 2xUniTV
// tem que resolver mesmo assim, caindo para o candidato do /match --
// exatamente como o 0-A individual ja faz. Sem o fallback, o lote
// falhava 'unitv_sem_usuario' antes de chamar o resolvedor.
async function testeV3() {
  resetarTudo();
  configurarDoisUnitv(); // /match candidates COM usuario (3tnjsc / gcnv6v)
  // Reconfigura o /status dos dois SEM `usuario` (simula producao pre-Bloco-2).
  configurarStatus(PUBLIC_ID_A, {
    outcome: "success", linkState: "linked", publicId: PUBLIC_ID_A, syncedAt: new Date().toISOString(),
    cliente: { nome: "Karla Filha", vencimento: "2026-09-21T23:59:00-03:00", planoNome: "Mensal", servidorNome: "UNITV", telas: 1, valor: "35.00" },
  });
  configurarStatus(PUBLIC_ID_B, {
    outcome: "success", linkState: "linked", publicId: PUBLIC_ID_B, syncedAt: new Date().toISOString(),
    cliente: { nome: "José Antonio Dos Santos", vencimento: "2026-11-03T23:59:00-03:00", planoNome: "Mensal", servidorNome: "UNITV", telas: 1, valor: "35.00" },
  });
  getConversaAtual().intencao_atual = "renovacao";
  definirProximaRespostaGemini({ outcome: "success", data: { tipo: "responder", texto: "...", esclarecimento: false } });

  const resp = await handler(req({ telefone: TELEFONE, conteudo: "0" }));
  await resp.json();

  ok(
    snsResolverContaUnitv().includes("gcnv6v") && snsResolverContaUnitv().includes("3tnjsc"),
    "Teste V3: /status sem usuario -> os dois sn vem do /match e chegam ao resolvedor",
  );
  ok(chamadasCriarLote().length === 1, "Teste V3: lote 2xUniTV criado normalmente (fallback /match)");
  const c = chamadasCriarLote()[0] ?? {};
  ok(c.filhos.length === 2 && c.filhos.every((f) => f.tipo === "unitv" && f.unitvSn && f.unitvId), "Teste V3: 2 filhos UniTV com unitv_sn/unitv_id");
  ok(acionamentosRegistrados().length === 0, "Teste V3: NENHUMA transferencia (nao caiu em 'unitv_sem_usuario')");
  ok(
    !getMensagensEnviadas().some((m) =>
      [MENSAGEM_RENOVACAO_LOTE_UNITV_INSTABILIDADE, MENSAGEM_RENOVACAO_LOTE_UNITV_NAO_IDENTIFICADO].includes(m.texto),
    ),
    "Teste V3: nenhuma mensagem de fallback UniTV (lote resolve via /match)",
  );
}

// Teste W: 2 UniTV, seleciona 1 por NUMERO, resolve OK -> token
// tipo='unitv' + confirmacao interativa (mesmo caminho do individual).
// Ordem deterministica (servidorNome -> nome -> publicId): ambos UNITV,
// "José..." < "Karla..." -> posicao 1 = PUBLIC_ID_B (usuario "gcnv6v").
async function testeW() {
  resetarTudo();
  configurarDoisUnitv();
  definirProximoResultadoValorCliente({
    outcome: "success", nome: "José Antonio Dos Santos", servidorNome: "UNITV",
    planoNome: "Mensal", valor: "35.00", vencimento: "2026-11-03T23:59:00-03:00", usuario: "gcnv6v",
  });
  getConversaAtual().intencao_atual = "renovacao";
  definirProximaRespostaGemini({ outcome: "success", data: { tipo: "responder", texto: "...", esclarecimento: false } });

  const resp = await handler(req({ telefone: TELEFONE, conteudo: "1" }));
  await resp.json();

  ok(snsResolverContaUnitv().includes("gcnv6v"), "Teste W: resolveu a conta do acesso da posicao 1 (sn 'gcnv6v')");
  ok(chamadasCriarToken() === 1, "Teste W: token criado (UniTV resolvida)");
  const arg = argsCriarToken()[0] ?? {};
  ok(arg.tipo === "unitv" && arg.unitvSn === "gcnv6v" && arg.unitvId === 3433363, "Teste W: token tipo='unitv' com sn/id do acesso 1");
  ok(arg.usuario === null, "Teste W: token UniTV -> usuario=null no call site (usa unitv_sn)");
  ok(getMensagensInterativasEnviadas().length === 1, "Teste W: confirmacao interativa enviada");
  ok(acionamentosRegistrados().length === 0, "Teste W: nenhuma transferencia");
  ok(
    !getMensagensEnviadas().some((m) =>
      [MENSAGEM_RENOVACAO_UNITV_INSTABILIDADE, MENSAGEM_RENOVACAO_UNITV_NAO_IDENTIFICADO].includes(m.texto),
    ),
    "Teste W: sem mensagem de fallback UniTV (conta resolve)",
  );
}


// Teste X (regressao): 2 acessos SIGMA + "0" -> o lote continua sendo
// criado, agora com o tipo DERIVADO do servidor (nao mais hardcoded).
async function testeX() {
  resetarTudo();
  configurarDoisAcessos(); // BLAZE + NewOne (ambos sigma)
  getConversaAtual().intencao_atual = "renovacao";
  definirProximaRespostaGemini({ outcome: "success", data: { tipo: "responder", texto: "...", esclarecimento: false } });

  const resp = await handler(req({ telefone: TELEFONE, conteudo: "0" }));
  await resp.json();

  ok(chamadasCriarLote().length === 1, "Teste X: 2 Sigma + '0' -> lote criado (regressao)");
  const c = chamadasCriarLote()[0] ?? {};
  ok(Array.isArray(c.filhos) && c.filhos.length === 2, "Teste X: 2 filhos");
  ok(c.filhos?.every((f) => f.tipo === "sigma"), "Teste X: tipo derivado do servidor = 'sigma' (nunca mais hardcode)");
  ok(c.filhos?.every((f) => f.publicId), "Teste X: filhos Sigma carregam publicId");
  ok(c.valorTotalCentavos === 7700, "Teste X: total = soma dos valores reais (35,00 + 42,00 = R$ 77,00)");
  ok((c.filhos ?? []).reduce((s, f) => s + f.valorEsperadoCentavos, 0) === 7700, "Teste X: soma dos filhos bate com o total");
  ok(acionamentosRegistrados().length === 0, "Teste X: nenhuma transferencia");
  ok(getMensagensInterativasEnviadas().length === 1, "Teste X: confirmacao interativa do lote enviada");
}

// ---------------------------------------------------------------------
// Etapa 1.5 -- Teste Y: ordem DETERMINISTICA da lista x selecao numerica.
// A lista e' montada numa requisicao e o numero e' escolhido na
// seguinte; cada uma refaz o /match e o Rocket NAO garante a mesma
// ordem. ordenarAcessosMultiplos (servidorNome -> nome -> publicId)
// garante que "1"/"2" sempre casam com a posicao apresentada.
// ---------------------------------------------------------------------
async function testeY() {
  // Parte 1: a LISTA -- /match devolve NewOne antes de BLAZE, mas a
  // lista tem que sair BLAZE (*1.*) antes de NewOne (*2.*).
  resetarTudo();
  configurarDoisAcessosOrdemInvertida();
  definirProximaRespostaGemini({
    outcome: "success",
    data: { tipo: "propor_renovacao", texto: "Vou te ajudar a renovar!", esclarecimento: false },
  });
  const respLista = await handler(req({ telefone: TELEFONE, conteudo: "quero renovar meu plano" }));
  await respLista.json();
  const textoLista = (getMensagensEnviadas()[0] ?? {}).texto ?? "";
  ok(
    textoLista.indexOf("*1. Meu Uso Testes*") >= 0 &&
      textoLista.indexOf("*1. Meu Uso Testes*") < textoLista.indexOf("*2. Js Informática Rp*"),
    "Teste Y: lista sai BLAZE como *1.* e NewOne como *2.* mesmo com /match invertido",
  );
  ok(
    textoLista.indexOf("BLAZE") < textoLista.indexOf("NewOne"),
    "Teste Y: bloco BLAZE aparece antes do bloco NewOne (ordem deterministica)",
  );

  // Parte 2: a SELECAO -- nova requisicao, /match ainda invertido,
  // cliente digita "2" -> tem que resolver NewOne (posicao 2 da lista),
  // nunca BLAZE.
  resetarTudo();
  configurarDoisAcessosOrdemInvertida();
  getConversaAtual().intencao_atual = "renovacao";
  definirProximaRespostaGemini({ outcome: "success", data: { tipo: "responder", texto: "...", esclarecimento: false } });
  const resp2 = await handler(req({ telefone: TELEFONE, conteudo: "2" }));
  const body2 = await resp2.json();
  ok(
    body2?.renovacao?.acessoResolvido?.publicId === PUBLIC_ID_B &&
      body2?.renovacao?.acessoResolvido?.servidorNome === "NewOne",
    "Teste Y: '2' resolve o acesso da POSICAO 2 da lista (NewOne), mesmo com /match invertido",
  );
  ok(getMensagensInterativasEnviadas().length === 1, "Teste Y: confirmacao interativa enviada (caminho individual)");
  ok(chamadasCriarLote().length === 0, "Teste Y: selecao individual -> nenhum lote");
  ok(
    atualizacoesSessaoRegistradas().some((a) => a.dados?.acessoSelecionado === PUBLIC_ID_B),
    "Teste Y: acesso_selecionado gravado = posicao 2 (NewOne)",
  );

  // Parte 3: "1" -> BLAZE (posicao 1), simetria.
  resetarTudo();
  configurarDoisAcessosOrdemInvertida();
  getConversaAtual().intencao_atual = "renovacao";
  definirProximaRespostaGemini({ outcome: "success", data: { tipo: "responder", texto: "...", esclarecimento: false } });
  const resp1 = await handler(req({ telefone: TELEFONE, conteudo: "1" }));
  const body1 = await resp1.json();
  ok(
    body1?.renovacao?.acessoResolvido?.publicId === PUBLIC_ID_A &&
      body1?.renovacao?.acessoResolvido?.servidorNome === "BLAZE",
    "Teste Y: '1' resolve o acesso da POSICAO 1 da lista (BLAZE), mesmo com /match invertido",
  );
}

// =====================================================================
// Peca 1 (NOVA_INTENCAO_EXPLICITA) + Peca 2 (validade read-side do
// estado de sessao) -- gerenciamento de estado conversacional,
// 2026-08-29. Criterio original: uma nova solicitacao explicita NUNCA
// pode ser silenciosamente interpretada como continuacao de uma
// selecao antiga.
//
// CORRIGIDO (2026-09-11, achado real -- caso Js Informatica Rp "2" ->
// "Renovar"): "nova solicitacao explicita" e "selecao de acesso
// invalida" deixaram de ser a MESMA coisa. A palavra "renovar"
// sozinha, na mensagem atual, continua estabelecendo INTENCAO de
// renovacao (ehContextoRenovacao/intencaoRenovacaoEstabelecida,
// inalterados) -- mas nao invalida mais, sozinha, o
// acesso_selecionado. So invalidam a selecao as condicoes REAIS
// (Peca 2 -- operacao terminal; TTL de sessao; public_id que sumiu do
// conjunto atual). Os testes Z1/Z2/Z8 abaixo foram atualizados pra
// refletir esse contrato; Z3-Z7 continuam validos e inalterados.
// =====================================================================

// Peca 1, CORRIGIDO -- caso real ChannelTV: 2 acessos, acesso_selecionado
// + intencao_atual gravados de uma escolha anterior (SEM nenhuma
// operacao terminal associada) -> "quero renovar", sozinho, agora
// HONRA a selecao guardada (BLAZE) e vai direto pra "Confira os
// dados", em vez de relistar. Espelha o caso real: "2" -> ChannelTV
// persistido, "Renovar" isolado tem que continuar usando ChannelTV.
async function testeZ1() {
  resetarTudo();
  configurarSigmaMaisUnitv();
  getConversaAtual().acesso_selecionado = PUBLIC_ID_A; // escolha anterior (BLAZE)
  getConversaAtual().intencao_atual = "renovacao";
  definirProximaRespostaGemini({
    outcome: "success",
    data: { tipo: "propor_renovacao", texto: "Claro, vou te ajudar a renovar seu acesso!", esclarecimento: false },
  });

  const resp = await handler(req({ telefone: TELEFONE, conteudo: "quero renovar" }));
  const body = await resp.json();
  const enviadas = getMensagensEnviadas();

  ok(resp.status === 200, "Teste Z1: HTTP 200");
  ok(
    !enviadas.some((m) => m.texto.includes("📋 *Seus acessos*")),
    "Teste Z1: NAO relista -- honra a selecao guardada (BLAZE), sem operacao terminal",
  );
  ok(
    getMensagensInterativasEnviadas().some((m) => m.texto.includes("Confira os dados")),
    "Teste Z1: foi direto pra 'Confira os dados'",
  );
  ok(
    body?.renovacao?.acessoResolvido?.publicId === PUBLIC_ID_A &&
      body?.renovacao?.acessoResolvido?.servidorNome === "BLAZE",
    "Teste Z1: acesso resolvido e' o BLAZE guardado, nao outro",
  );
  ok(chamadasCriarToken() === 1, "Teste Z1: token individual criado para o acesso guardado");
}

// Peca 1, CORRIGIDO -- outras formas do verbo tem o MESMO efeito
// corrigido de Z1: continuam contando como intencao explicita, mas
// nao invalidam mais, sozinhas, uma selecao guardada e valida.
async function testeZ2() {
  for (const frase of ["preciso renovar", "vou renovar", "quero fazer a renovação"]) {
    resetarTudo();
    configurarSigmaMaisUnitv();
    getConversaAtual().acesso_selecionado = PUBLIC_ID_A;
    getConversaAtual().intencao_atual = "renovacao";
    definirProximaRespostaGemini({
      outcome: "success",
      data: { tipo: "propor_renovacao", texto: "Claro, vou te ajudar a renovar seu acesso!", esclarecimento: false },
    });
    const resp = await handler(req({ telefone: TELEFONE, conteudo: frase }));
    const body = await resp.json();
    ok(
      getMensagensInterativasEnviadas().some((m) => m.texto.includes("Confira os dados")) &&
        body?.renovacao?.acessoResolvido?.publicId === PUBLIC_ID_A &&
        chamadasCriarToken() === 1,
      `Teste Z2: "${frase}" -> honra a selecao guardada (BLAZE), nao relista`,
    );
  }
}

// Peca 2 -- CONTINUACAO: sem verbo renovar, com acesso_selecionado NAO
// obsoleto (nenhuma operacao terminal) -> honra a selecao anterior,
// vai pra "Confira os dados", NAO relista.
async function testeZ3() {
  resetarTudo();
  configurarSigmaMaisUnitv();
  getConversaAtual().acesso_selecionado = PUBLIC_ID_A; // BLAZE
  getConversaAtual().intencao_atual = "renovacao";
  definirProximaRespostaGemini({
    outcome: "success",
    data: { tipo: "propor_renovacao", texto: "Confirmando sua renovação, um momento.", esclarecimento: false },
  });

  const resp = await handler(req({ telefone: TELEFONE, conteudo: "pode ser esse acesso mesmo" }));
  const body = await resp.json();

  ok(resp.status === 200, "Teste Z3: HTTP 200");
  ok(
    !getMensagensEnviadas().some((m) => m.texto.includes("📋 *Seus acessos*")),
    "Teste Z3: continuacao -> NAO relista",
  );
  ok(
    body?.renovacao?.acessoResolvido?.publicId === PUBLIC_ID_A,
    "Teste Z3: continuacao -> resolve pela selecao de sessao (BLAZE)",
  );
  ok(chamadasCriarToken() === 1, "Teste Z3: token individual criado (Confira os dados)");
}

// Peca 1 -- nova intencao explicita MAS o cliente nomeia o servidor na
// mensagem atual -> resolve pela mensagem atual, NAO relista.
async function testeZ4() {
  resetarTudo();
  configurarSigmaMaisUnitv();
  getConversaAtual().acesso_selecionado = PUBLIC_ID_A; // BLAZE guardado
  getConversaAtual().intencao_atual = "renovacao";
  definirProximaRespostaGemini({
    outcome: "success",
    data: { tipo: "propor_renovacao", texto: "Vou renovar seu acesso UNITV!", esclarecimento: false },
  });

  const resp = await handler(req({ telefone: TELEFONE, conteudo: "quero renovar o UNITV" }));
  const body = await resp.json();

  ok(resp.status === 200, "Teste Z4: HTTP 200");
  ok(
    !getMensagensEnviadas().some((m) => m.texto.includes("📋 *Seus acessos*")),
    "Teste Z4: servidor nomeado na msg atual -> NAO relista",
  );
  ok(
    body?.renovacao?.acessoResolvido?.publicId === PUBLIC_ID_B,
    "Teste Z4: resolve UNITV pela mensagem atual (nao a selecao guardada BLAZE)",
  );
}

// Peca 2 -- selecao por numero "1" NAO e' afetada pelo gate, mesmo com
// acesso_selecionado velho e diferente pre-setado.
async function testeZ5() {
  resetarTudo();
  configurarSigmaMaisUnitv();
  getConversaAtual().acesso_selecionado = PUBLIC_ID_B; // velho, diferente
  getConversaAtual().intencao_atual = "renovacao"; // lista foi enviada antes
  definirProximaRespostaGemini({
    outcome: "success",
    data: { tipo: "responder", texto: "Qual acesso?", esclarecimento: false },
  });

  const resp = await handler(req({ telefone: TELEFONE, conteudo: "1" }));
  const body = await resp.json();

  ok(resp.status === 200, "Teste Z5: HTTP 200");
  ok(
    body?.renovacao?.acessoResolvido?.publicId === PUBLIC_ID_A,
    "Teste Z5: '1' resolve a POSICAO 1 da lista (BLAZE), gate nao interfere",
  );
  ok(
    atualizacoesSessaoRegistradas().some((a) => a.dados?.acessoSelecionado === PUBLIC_ID_A),
    "Teste Z5: acesso_selecionado re-gravado do zero (posicao 1)",
  );
}

// Peca 2 -- validade read-side: acesso_selecionado cuja ULTIMA operacao
// e' TERMINAL -> obsoleto -> "quero renovar" relista (cenario 1/2 da
// analise: renovacao concluida, depois nova intencao).
async function testeZ6() {
  resetarTudo();
  configurarSigmaMaisUnitv();
  getConversaAtual().acesso_selecionado = PUBLIC_ID_A;
  getConversaAtual().intencao_atual = "renovacao";
  definirUltimaOperacaoTerminalParaPublicId(PUBLIC_ID_A); // ultima renovacao do BLAZE ja terminou
  definirProximaRespostaGemini({
    outcome: "success",
    data: { tipo: "propor_renovacao", texto: "Claro, vou te ajudar a renovar seu acesso!", esclarecimento: false },
  });

  const resp = await handler(req({ telefone: TELEFONE, conteudo: "quero renovar" }));
  await resp.json();
  const enviadas = getMensagensEnviadas();

  ok(
    enviadas.length === 1 && enviadas[0]?.texto.includes("📋 *Seus acessos*") && chamadasCriarToken() === 0,
    "Teste Z6: selecao obsoleta por operacao terminal -> relista",
  );
}

// Peca 2 -- read-side: acesso_selecionado com operacao NAO-terminal
// (viva) + mensagem de continuacao -> honra.
async function testeZ7() {
  resetarTudo();
  configurarSigmaMaisUnitv();
  getConversaAtual().acesso_selecionado = PUBLIC_ID_A;
  getConversaAtual().intencao_atual = "renovacao";
  // NAO marca como terminal -> operacao viva / anafora -> honra
  definirProximaRespostaGemini({
    outcome: "success",
    data: { tipo: "propor_renovacao", texto: "Confirmando, um momento.", esclarecimento: false },
  });

  const resp = await handler(req({ telefone: TELEFONE, conteudo: "isso, esse mesmo" }));
  const body = await resp.json();

  ok(
    !getMensagensEnviadas().some((m) => m.texto.includes("📋 *Seus acessos*")) &&
      body?.renovacao?.acessoResolvido?.publicId === PUBLIC_ID_A,
    "Teste Z7: operacao viva + continuacao -> honra a selecao (Confira os dados)",
  );
}

// Peca 2 -- UNICO write de sessao: apresentar a lista zera
// acesso_selecionado. CORRIGIDO (2026-09-11): com a selecao guardada
// valida (sem operacao terminal), "quero renovar" agora HONRA a
// selecao (Z1/Z2) em vez de relistar -- entao, pra este teste
// continuar exercitando um relista de verdade, marca a ultima
// operacao do acesso guardado como TERMINAL (mesma condicao de Z6),
// unica forma real de a lista voltar a ser mostrada aqui.
async function testeZ8() {
  resetarTudo();
  configurarSigmaMaisUnitv();
  getConversaAtual().acesso_selecionado = PUBLIC_ID_A;
  getConversaAtual().intencao_atual = "renovacao";
  definirUltimaOperacaoTerminalParaPublicId(PUBLIC_ID_A);
  definirProximaRespostaGemini({
    outcome: "success",
    data: { tipo: "propor_renovacao", texto: "Claro, vou te ajudar a renovar seu acesso!", esclarecimento: false },
  });

  const resp = await handler(req({ telefone: TELEFONE, conteudo: "quero renovar" }));
  await resp.json();

  ok(
    getMensagensEnviadas()[0]?.texto.includes("📋 *Seus acessos*"),
    "Teste Z8: (pre-condicao) lista enviada",
  );
  ok(
    atualizacoesSessaoRegistradas().some(
      (a) => "acessoSelecionado" in (a.dados ?? {}) && a.dados.acessoSelecionado === null,
    ),
    "Teste Z8: ao enviar a lista, acesso_selecionado e' zerado na sessao",
  );
}

// =====================================================================
// Teste de regressao dedicado -- reproduz o caso REAL (2026-09-11,
// Js Informatica Rp, conversation_id 43fcff07-...): 4 acessos
// (BLAZE/ChannelTV/NewOne/UNITV), cliente escolhe um deles por numero
// numa mensagem, depois manda "Renovar" ISOLADO (sem citar nenhum
// servidor) numa mensagem SEPARADA. Antes da correcao, "Renovar"
// sozinho invalidava a selecao guardada e o Gemini podia propor
// QUALQUER outro acesso (reproduzido ao vivo: "2" -> ChannelTV
// persistido, "Renovar" devolveu UNITV -- posicao 4). Depois da
// correcao, a selecao guardada (sem operacao terminal, TTL valido,
// public_id ainda no conjunto atual) tem que ser honrada nos 4 casos.
//
// getConversaAtual().acesso_selecionado e' pre-setado diretamente
// (mesmo padrao de Z1/Z3/Z6/Z7) para representar o estado que "2" (ou
// "1"/"3"/"4") ja deixou persistido, sem depender de simular aqui o
// parser de prosa do Gemini (mapaNumeroAcesso) -- isso e' testado a
// parte (mecanismo de persistencia da selecao numerica, ja coberto
// pelo restante da suite); este teste isola exatamente o ponto que
// mudou: a validade da selecao guardada diante de "Renovar" isolado.
// =====================================================================
const PUBLIC_ID_BLAZE_REAL = "pub-blaze-real";
const PUBLIC_ID_CHANNELTV_REAL = "pub-channeltv-real";
const PUBLIC_ID_NEWONE_REAL = "pub-newone-real";
const PUBLIC_ID_UNITV_REAL = "pub-unitv-real";

function configurarQuatroAcessosCasoReal() {
  configurarMatch({
    outcome: "multiple_matches",
    candidates: [
      { publicId: PUBLIC_ID_BLAZE_REAL, nome: "Js Informática Rp", usuario: "828667229" },
      { publicId: PUBLIC_ID_CHANNELTV_REAL, nome: "Js Informática Rp", usuario: "759334773" },
      { publicId: PUBLIC_ID_NEWONE_REAL, nome: "Js Informática Rp", usuario: "2715749553" },
      { publicId: PUBLIC_ID_UNITV_REAL, nome: "Js Informática Rp", usuario: "gcnv6v" },
    ],
  });
  configurarStatus(PUBLIC_ID_BLAZE_REAL, {
    outcome: "success", linkState: "linked", publicId: PUBLIC_ID_BLAZE_REAL, syncedAt: new Date().toISOString(),
    cliente: { nome: "Js Informática Rp", usuario: "828667229", vencimento: "2027-01-13T20:59:00-03:00", planoNome: "Mensal", servidorNome: "BLAZE", telas: 1, valor: "35.00" },
  });
  configurarStatus(PUBLIC_ID_CHANNELTV_REAL, {
    outcome: "success", linkState: "linked", publicId: PUBLIC_ID_CHANNELTV_REAL, syncedAt: new Date().toISOString(),
    cliente: { nome: "Js Informática Rp", usuario: "759334773", vencimento: "2026-12-30T20:59:00-03:00", planoNome: "Mensal", servidorNome: "ChannelTV", telas: 2, valor: "35.00" },
  });
  configurarStatus(PUBLIC_ID_NEWONE_REAL, {
    outcome: "success", linkState: "linked", publicId: PUBLIC_ID_NEWONE_REAL, syncedAt: new Date().toISOString(),
    cliente: { nome: "Js Informática Rp", usuario: "2715749553", vencimento: "2027-04-08T20:59:00-03:00", planoNome: "Mensal", servidorNome: "NewOne", telas: 1, valor: "35.00" },
  });
  configurarStatus(PUBLIC_ID_UNITV_REAL, {
    outcome: "success", linkState: "linked", publicId: PUBLIC_ID_UNITV_REAL, syncedAt: new Date().toISOString(),
    cliente: { nome: "Js Informática Rp", usuario: "gcnv6v", vencimento: "2027-01-04T02:31:00-03:00", planoNome: "Mensal", servidorNome: "UNITV", telas: 1, valor: "35.00" },
  });
}

async function testeZ9() {
  const casos = [
    { publicId: PUBLIC_ID_BLAZE_REAL, servidor: "BLAZE" },
    { publicId: PUBLIC_ID_CHANNELTV_REAL, servidor: "ChannelTV" }, // caso real exato
    { publicId: PUBLIC_ID_NEWONE_REAL, servidor: "NewOne" },
    { publicId: PUBLIC_ID_UNITV_REAL, servidor: "UNITV" },
  ];
  for (const caso of casos) {
    resetarTudo();
    configurarQuatroAcessosCasoReal();
    // Estado exatamente como fica logo apos a selecao numerica (via
    // consulta) ser resolvida e persistida -- SEM nenhuma intencao de
    // renovacao estabelecida ainda (igual ao caso real: a lista veio
    // de "quantos acessos tenho", nao de "quero renovar").
    getConversaAtual().acesso_selecionado = caso.publicId;
    getConversaAtual().intencao_atual = null;
    // Gemini NAO cita nenhum servidor no texto -- mesma ambiguidade do
    // caso real ("Renovar" sozinho, sem rotulo). E' exatamente esta
    // ambiguidade que so' a selecao guardada (fallback) pode resolver.
    definirProximaRespostaGemini({
      outcome: "success",
      data: { tipo: "propor_renovacao", texto: "Claro, vou providenciar a renovação do seu acesso!", esclarecimento: false },
    });

    const resp = await handler(req({ telefone: TELEFONE, conteudo: "Renovar" }));
    const body = await resp.json();

    ok(resp.status === 200, `Teste Z9 (${caso.servidor}): HTTP 200`);
    ok(
      body?.renovacao?.acessoResolvido?.publicId === caso.publicId &&
        body?.renovacao?.acessoResolvido?.servidorNome === caso.servidor,
      `Teste Z9 (${caso.servidor}): "Renovar" isolado honra o acesso selecionado por numero, nao troca para outro`,
    );
    const ultimoArgCriarToken = argsCriarToken().at(-1);
    ok(
      chamadasCriarToken() === 1 && ultimoArgCriarToken?.publicId === caso.publicId,
      `Teste Z9 (${caso.servidor}): token criado com o publicId certo (${caso.publicId})`,
    );
    ok(
      getMensagensInterativasEnviadas().some((m) => m.texto.includes("Confira os dados")),
      `Teste Z9 (${caso.servidor}): foi direto pra 'Confira os dados' (nao relistou)`,
    );
  }
}

// =======================================================================
// Fase 3, Checkpoint 2 (shadow mode, aprovado 2026-09-11): provam as 6
// propriedades exigidas -- chamada sombra executada; resultado nunca
// altera a resposta/Gemini; erro da busca sombra nunca interrompe o
// atendimento; conhecimento_institucional continua consultado
// normalmente; e nenhum dado sensivel entra no log. (A exclusao de
// status='candidato' e' do algoritmo real, ja coberta exaustivamente
// pela suite isolada scripts/testes/conhecimento_suporte/ -- aqui
// _shared/conhecimento_suporte.ts e' fake, entao nao ha o que reprovar
// nesse eixo especifico nesta suite.)
// =======================================================================

// ---------------------------------------------------------------------
// Sombra 1 -- a chamada sombra acontece, e recebe SOMENTE servidor
// (nunca aplicativo/dispositivo, que o Orquestrador nao possui de
// forma estruturada hoje) -- mesmo cenario base do Teste Z1 (selecao
// guardada = BLAZE, "quero renovar" isolado).
// ---------------------------------------------------------------------
async function testeSombra1() {
  resetarTudo();
  configurarSigmaMaisUnitv();
  getConversaAtual().acesso_selecionado = PUBLIC_ID_A; // BLAZE
  getConversaAtual().intencao_atual = "renovacao";
  definirProximaRespostaGemini({
    outcome: "success",
    data: { tipo: "propor_renovacao", texto: "Claro, vou te ajudar a renovar seu acesso!", esclarecimento: false },
  });

  await handler(req({ telefone: TELEFONE, conteudo: "quero renovar" }));

  const chamadas = chamadasConhecimentoSuporte();
  ok(chamadas.length === 1, "Sombra 1: buscarConhecimentoSuporte foi chamada exatamente 1 vez");
  ok(chamadas[0]?.pergunta === "quero renovar", "Sombra 1: pergunta passada e' o conteudo real da mensagem");
  ok(chamadas[0]?.contexto?.servidor === "BLAZE", "Sombra 1: contexto.servidor = BLAZE (selecao guardada)");
  ok(
    chamadas[0]?.contexto?.aplicativo === undefined,
    "Sombra 1: contexto.aplicativo NUNCA e' inventado (nao existe estruturado no Orquestrador)",
  );
  ok(
    chamadas[0]?.contexto?.dispositivo === undefined,
    "Sombra 1: contexto.dispositivo NUNCA e' inventado (nao existe estruturado no Orquestrador)",
  );
}

// ---------------------------------------------------------------------
// Sombra 2 -- sem selecao guardada nenhuma (fluxo do Teste A), o
// contexto.servidor passado tambem e' null -- nunca inventa um servidor
// que o Orquestrador nao tem.
// ---------------------------------------------------------------------
async function testeSombra2() {
  resetarTudo();
  configurarDoisAcessos();
  definirProximaRespostaGemini({
    outcome: "success",
    data: { tipo: "propor_renovacao", texto: "Claro, vou te ajudar a renovar seu acesso!", esclarecimento: false },
  });

  await handler(req({ telefone: TELEFONE, conteudo: "quero renovar meu plano" }));

  const chamadas = chamadasConhecimentoSuporte();
  ok(chamadas.length === 1, "Sombra 2: buscarConhecimentoSuporte chamada mesmo sem selecao guardada");
  ok(
    chamadas[0]?.contexto?.servidor === null,
    "Sombra 2: sem selecao guardada, contexto.servidor e' null (nao inventado)",
  );
}

// ---------------------------------------------------------------------
// Sombra 3 -- resultado "encontrado" da busca sombra NAO altera a
// resposta ao cliente nem o contexto enviado ao Gemini (cenario do
// Teste A, lista de multiplos acessos).
// ---------------------------------------------------------------------
async function testeSombra3() {
  resetarTudo();
  configurarDoisAcessos();
  definirProximoResultadoConhecimentoSuporte({
    outcome: "encontrado",
    conhecimentoId: "sombra-nao-deve-aparecer",
    titulo: "PROCEDIMENTO SOMBRA -- NAO PODE CHEGAR NO CLIENTE",
    procedimento: "PROCEDIMENTO SOMBRA -- NAO PODE CHEGAR NO CLIENTE NEM NO GEMINI",
    score: 3,
  });
  definirProximaRespostaGemini({
    outcome: "success",
    data: { tipo: "propor_renovacao", texto: "Claro, vou te ajudar a renovar seu acesso!", esclarecimento: false },
  });

  const resp = await handler(req({ telefone: TELEFONE, conteudo: "quero renovar meu plano" }));
  const body = await resp.json();
  const enviadas = getMensagensEnviadas();
  const texto = enviadas[0]?.texto ?? "";

  ok(resp.status === 200, "Sombra 3: HTTP 200 (fluxo normal, identico ao Teste A)");
  ok(
    body?.validacao?.aprovado === false && body?.validacao?.motivo === "renovacao:acesso_nao_determinado",
    "Sombra 3: validacao identica ao Teste A -- resultado sombra nao mudou o comportamento",
  );
  ok(
    !texto.includes("PROCEDIMENTO SOMBRA"),
    "Sombra 3: procedimento/titulo do resultado sombra NUNCA aparece na mensagem ao cliente",
  );
  const chamadaGemini = chamadasGemini().at(-1);
  ok(
    !String(chamadaGemini?.contexto ?? "").includes("PROCEDIMENTO SOMBRA"),
    "Sombra 3: contextoCompleto passado ao Gemini NUNCA contem o resultado sombra",
  );
}

// ---------------------------------------------------------------------
// Sombra 4 -- erro na busca sombra (throw) NUNCA interrompe o
// atendimento real (cenario do Teste B: selecao por servidor citado,
// fluxo completo ate a mensagem interativa).
// ---------------------------------------------------------------------
async function testeSombra4() {
  resetarTudo();
  configurarDoisAcessos();
  forcarErroConhecimentoSuporte(new Error("falha simulada na busca sombra"));
  definirProximaRespostaGemini({
    outcome: "success",
    data: { tipo: "propor_renovacao", texto: "Perfeito, vou preparar a renovação do BLAZE.", esclarecimento: false },
  });

  const resp = await handler(req({ telefone: TELEFONE, conteudo: "quero renovar o BLAZE" }));
  const body = await resp.json();

  ok(resp.status === 200, "Sombra 4: HTTP 200 mesmo com a busca sombra lançando erro");
  ok(body?.validacao?.aprovado === true, "Sombra 4: Validador aprova normalmente, erro sombra nao propagou");
  ok(
    getMensagensInterativasEnviadas().some((m) => m.texto.includes("Confira os dados")),
    "Sombra 4: mensagem 2 (interativa) enviada normalmente, atendimento nao foi interrompido",
  );
  ok(chamadasConhecimentoSuporte().length === 1, "Sombra 4: a chamada sombra foi de fato tentada (nao pulada)");
}

// ---------------------------------------------------------------------
// Sombra 5 -- conhecimento_institucional (conhecimento.ts) continua
// sendo consultado normalmente e continua sendo o UNICO dos dois a
// alimentar o contexto do Gemini -- mesmo com a busca sombra tambem
// retornando "encontrado" ao mesmo tempo.
// ---------------------------------------------------------------------
async function testeSombra5() {
  resetarTudo();
  configurarDoisAcessos();
  definirProximoResultadoConhecimentoInstitucional({
    outcome: "encontrado",
    titulo: "Titulo institucional real",
    conteudo: "Conteudo institucional real, precisa continuar chegando ao Gemini.",
  });
  definirProximoResultadoConhecimentoSuporte({
    outcome: "encontrado",
    conhecimentoId: "sombra-2",
    titulo: "Titulo da base evolutiva (sombra)",
    procedimento: "Procedimento da base evolutiva -- nunca deve ir ao Gemini",
    score: 1,
  });
  definirProximaRespostaGemini({
    outcome: "success",
    data: { tipo: "propor_renovacao", texto: "Claro, vou te ajudar a renovar seu acesso!", esclarecimento: false },
  });

  await handler(req({ telefone: TELEFONE, conteudo: "quero renovar meu plano" }));

  ok(
    chamadasConhecimentoInstitucional().length === 1 &&
      chamadasConhecimentoInstitucional()[0]?.pergunta === "quero renovar meu plano",
    "Sombra 5: conhecimento_institucional continua sendo consultado normalmente, com o conteudo real",
  );
  const chamadaGemini = chamadasGemini().at(-1);
  const contextoEnviado = String(chamadaGemini?.contexto ?? "");
  ok(
    contextoEnviado.includes("CONHECIMENTO INSTITUCIONAL - Titulo institucional real") &&
      contextoEnviado.includes("Conteudo institucional real"),
    "Sombra 5: contexto do Gemini contem o CONHECIMENTO INSTITUCIONAL normalmente",
  );
  ok(
    !contextoEnviado.includes("base evolutiva") && !contextoEnviado.includes("Procedimento da base evolutiva"),
    "Sombra 5: contexto do Gemini NAO contem nada da Base Evolutiva de Suporte (sombra)",
  );
}

// ---------------------------------------------------------------------
// Sombra 6 -- o log da chamada sombra nao contem dados sensiveis
// (telefone do cliente, token interno, texto bruto da mensagem).
// ---------------------------------------------------------------------
async function testeSombra6() {
  resetarTudo();
  configurarDoisAcessos();
  definirProximoResultadoConhecimentoSuporte({
    outcome: "encontrado",
    conhecimentoId: "sombra-3",
    titulo: "Titulo qualquer",
    procedimento: "Procedimento qualquer",
    score: 1,
  });
  definirProximaRespostaGemini({
    outcome: "success",
    data: { tipo: "propor_renovacao", texto: "Claro, vou te ajudar a renovar seu acesso!", esclarecimento: false },
  });

  const logsCapturados = [];
  const logOriginal = console.log;
  console.log = (...args) => {
    logsCapturados.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  };
  try {
    await handler(
      req({ telefone: TELEFONE, conteudo: "mensagem sensivel do cliente, nao pode vazar no log" }),
    );
  } finally {
    console.log = logOriginal;
  }

  const linhasSombra = logsCapturados.filter((l) => l.includes("[shadow:conhecimento_suporte]"));
  ok(linhasSombra.length === 1, "Sombra 6: exatamente 1 linha de log da chamada sombra");
  const linha = linhasSombra[0] ?? "";
  ok(!linha.includes(TELEFONE), "Sombra 6: log sombra NAO contem o telefone do cliente");
  ok(!linha.includes(TOKEN_INTERNO), "Sombra 6: log sombra NAO contem o token interno");
  ok(
    !linha.includes("mensagem sensivel do cliente"),
    "Sombra 6: log sombra NAO contem o texto bruto da mensagem do cliente",
  );
}

await testeA();
await testeB();
await testeC();
await testeD();
await testeE();
await testeF();
await testeG();
await testeH();
await testeI();
await testeJ();
await testeK();
await testeL();
await testeM();
await testeN();
await testeO();
await testeP();
await testeQ();
await testeR();
await testeEtapa4AguardandoVencidoFechaECriaNovo();
await testeEtapa4EmAndamentoNuncaTocado();
await testeS();
await testeS2();
await testeS3();
await testeS4();
await testeT();
await testeU();
await testeU2();
await testeV();
await testeV2();
await testeV4();
await testeV3();
await testeW();
await testeX();
await testeY();
await testeZ1();
await testeZ2();
await testeZ3();
await testeZ4();
await testeZ5();
await testeZ6();
await testeZ7();
await testeZ8();
await testeZ9();
await testeSombra1();
await testeSombra2();
await testeSombra3();
await testeSombra4();
await testeSombra5();
await testeSombra6();

console.log(`\n${falhas === 0 ? "TODOS OS TESTES PASSARAM" : `${falhas} FALHA(S)`}`);
process.exit(falhas === 0 ? 0 : 1);
