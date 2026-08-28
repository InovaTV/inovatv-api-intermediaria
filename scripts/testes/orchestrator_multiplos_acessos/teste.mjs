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
const { resetarRenovacoesLote, chamadasCriarLote, definirLoteAtivoParaPublicId } =
  await import("./fake_renovacoes_lote.mjs");
const { configurarTokenExistente } = await import("./fake_tokens_renovacao.mjs");

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
  resetarRenovacoesLote();
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
  {
    const bloco1 = texto.slice(texto.indexOf("BLAZE"), texto.indexOf("─────────────────"));
    const bloco2 = texto.slice(texto.indexOf("NewOne"));
    ok(bloco1.includes("💰 Valor: R$ 35,00") && !bloco1.includes("42,00"), "Teste A: bloco BLAZE tem R$ 35,00, nunca o valor do NewOne");
    ok(bloco2.includes("💰 Valor: R$ 42,00") && !bloco2.includes("35,00"), "Teste A: bloco NewOne tem R$ 42,00, nunca o valor do BLAZE");
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
  ok(texto.includes("💰 Valor: R$ 35,00") && texto.includes("💰 Valor: R$ 42,00"), "Teste E: valor de cada acesso presente (via /status, interceptor C3)");
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

// ---------------------------------------------------------------------
// Etapa 1 -- Teste I: cliente responde "0" a lista -> renovacao em LOTE.
// Cria 1 lote com 2 filhos 'sigma', precifica pela regra interna
// (R$ 30,00 cada / R$ 60,00 total), envia UMA confirmacao interativa
// (ACEITO/CANCELAR) com o total -- sem transferencia, sem citar
// "promocao"/"desconto".
// ---------------------------------------------------------------------
async function testeI() {
  resetarTudo();
  configurarDoisAcessos();
  getConversaAtual().intencao_atual = "renovacao"; // lista ja foi enviada antes
  definirProximaRespostaGemini({
    outcome: "success",
    data: { tipo: "responder", texto: "Qual acesso você quer renovar?" },
  });

  const resp = await handler(req({ telefone: TELEFONE, conteudo: "0" }));
  const body = await resp.json();

  ok(resp.status === 200, "Teste I: HTTP 200");
  ok(acionamentosRegistrados().length === 0, "Teste I: NENHUMA transferencia humana");
  ok(getConversaAtual().estado !== "aguardando_humano", "Teste I: conversa nao vai para aguardando_humano");

  const chamadas = chamadasCriarLote();
  ok(chamadas.length === 1, "Teste I: criarRenovacaoLote chamado exatamente uma vez");
  const c = chamadas[0] ?? {};
  ok(c.valorTotalCentavos === 6000, "Teste I: total do lote = 6000 centavos (R$ 60,00)");
  ok(c.regraAplicada === "lote_2_acessos_30", "Teste I: regra interna aplicada e' a de 2 acessos");
  ok(Array.isArray(c.filhos) && c.filhos.length === 2, "Teste I: lote nasce com 2 filhos");
  ok(c.filhos?.every((f) => f.tipo === "sigma"), "Teste I: filhos tipo 'sigma' (UniTV so' na Etapa 2)");
  ok(c.filhos?.every((f) => f.valorEsperadoCentavos === 3000), "Teste I: cada filho custa 3000 centavos (R$ 30,00)");
  ok(
    c.filhos?.map((f) => f.publicId).sort().join(",") === [PUBLIC_ID_A, PUBLIC_ID_B].sort().join(","),
    "Teste I: filhos apontam para os public_id reais dos dois acessos",
  );

  const interativas = getMensagensInterativasEnviadas();
  ok(interativas.length === 1, "Teste I: exatamente 1 mensagem interativa (confirmacao do lote)");
  const texto = interativas[0]?.texto ?? "";
  ok(texto.includes("📋 *Confira sua renovação*"), "Teste I: cabecalho da confirmacao de lote");
  ok(texto.includes("Você vai renovar 2 acessos"), "Teste I: quantidade de acessos no texto");
  ok(texto.includes("*1. Meu Uso Testes*") && texto.includes("*2. Js Informática Rp*"), "Teste I: os dois nomes, numerados e em negrito");
  ok((texto.match(/💰 R\$ 30,00/g) ?? []).length === 2, "Teste I: valor final R$ 30,00 aparece uma vez por acesso");
  ok(texto.includes("💰 *Total: R$ 60,00*"), "Teste I: total consolidado");
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
// Etapa 1 -- Teste J: "0" com 3 acessos -> nenhuma regra comercial
// cobre N=3 (resolverPrecoLote retorna null) -> fallback pedindo pra
// escolher 1, NUNCA transferencia, NUNCA criacao de lote.
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
  definirProximaRespostaGemini({ outcome: "success", data: { tipo: "responder", texto: "..." } });

  const resp = await handler(req({ telefone: TELEFONE, conteudo: "0" }));
  await resp.json();

  ok(chamadasCriarLote().length === 0, "Teste J: nenhum lote criado (N=3 sem regra comercial)");
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
    data: { tipo: "responder", texto: "Qual acesso você quer renovar?" },
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
  definirProximaRespostaGemini({ outcome: "success", data: { tipo: "responder", texto: "..." } });

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
  definirProximaRespostaGemini({ outcome: "success", data: { tipo: "responder", texto: "Qual deles?" } });

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
  definirProximaRespostaGemini({ outcome: "success", data: { tipo: "responder", texto: PROSA } });

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
    data: { tipo: "propor_renovacao", texto: "Vou preparar a renovação do NewOne." },
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
    data: { tipo: "propor_renovacao", texto: "Vou preparar a renovação do BLAZE." },
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
  definirProximaRespostaGemini({ outcome: "success", data: { tipo: "responder", texto: "..." } });

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
    data: { tipo: "propor_renovacao", texto: "Vou preparar a renovação do BLAZE." },
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

console.log(`\n${falhas === 0 ? "TODOS OS TESTES PASSARAM" : `${falhas} FALHA(S)`}`);
process.exit(falhas === 0 ? 0 : 1);
