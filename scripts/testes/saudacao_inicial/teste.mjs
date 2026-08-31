// Testes locais da SAUDACAO INICIAL do novo atendimento (decisao de
// produto 2026-08-31). Roda o handler REAL de
// supabase/functions/orchestrator/index.ts, com _shared/contexto.ts,
// _shared/validador.ts, _shared/mensagens_fixas.ts e _shared/telefone.ts
// tambem REAIS. So' as deps externas (banco, WhatsApp, Gemini, Rocket)
// sao fakes (mock-loader.mjs). conversas_estado e mensagens_atendimento
// sao fakes LOCAIS -- a suite precisa controlar estado da conversa e
// contagem de mensagens (o criterio de "primeiro contato").
//
// Como rodar: npx tsx scripts/testes/saudacao_inicial/teste.mjs

import { register } from "node:module";

register("./mock-loader.mjs", import.meta.url);

const { resetarConversa, acionamentosRegistrados } = await import("./fake_conversas_estado.mjs");
const { resetarMensagens, mensagensRegistradas, semearMensagensPrevias } =
  await import("./fake_mensagens_atendimento.mjs");
const { configurarMatch, configurarStatus, resetarRocketIntermediaria } = await import(
  "../orchestrator_multiplos_acessos/fake_rocket_intermediaria.mjs"
);
const { definirProximaRespostaGemini, resetarGemini } = await import(
  "../orchestrator_multiplos_acessos/fake_gemini_client.mjs"
);
const { resetarWhatsapp, getMensagensEnviadas, getMensagensInterativasEnviadas } = await import(
  "../orchestrator_multiplos_acessos/fake_whatsapp_client.mjs"
);
const { resetarValorCliente } = await import(
  "../orchestrator_multiplos_acessos/fake_rocket_valor_cliente.mjs"
);
const { resetarTokensRenovacao, chamadasCriarToken } = await import(
  "../orchestrator_multiplos_acessos/fake_tokens_renovacao.mjs"
);
const { resetarRenovacoesLote } = await import(
  "../orchestrator_multiplos_acessos/fake_renovacoes_lote.mjs"
);
const { resetarUnitvContaClient } = await import(
  "../orchestrator_multiplos_acessos/fake_unitv_conta_client.mjs"
);

const { MENSAGEM_SAUDACAO_INICIAL, MENSAGEM_TRANSFERENCIA_CLIENTE } = await import(
  "../../../supabase/functions/_shared/mensagens_fixas.ts"
);

const TOKEN_INTERNO = "orchestrator-token-de-teste";
process.env.ORCHESTRATOR_INTERNAL_TOKEN = TOKEN_INTERNO;
process.env.SUPABASE_URL = "https://exemplo-teste.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-de-teste";
process.env.WHATSAPP_JOSE_NUMERO = "5511777777777";

let handler;
globalThis.Deno = {
  serve: (fn) => {
    handler = fn;
  },
  env: { get: (nome) => process.env[nome] },
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
}

function req(corpo) {
  return new Request("https://exemplo-teste.supabase.co/functions/v1/orchestrator", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Internal-Token": TOKEN_INTERNO },
    body: JSON.stringify(corpo),
  });
}

const TELEFONE = "5511999999999";
const AGORA_ISO = new Date().toISOString();

// ---------------------------------------------------------------------
// Teste 1 -- PRIMEIRO CONTATO recebe a saudacao (uma vez, e ADITIVA:
// nao substitui a resposta normal)
// ---------------------------------------------------------------------
async function teste1() {
  resetarTudo();
  configurarMatch({ outcome: "no_match", candidates: [] });
  definirProximaRespostaGemini({
    outcome: "success",
    data: { tipo: "responder", texto: "Olá! Estou aqui para ajudar." },
  });

  const resp = await handler(req({ telefone: TELEFONE, conteudo: "oi" }));
  ok(resp.status === 200, "Teste 1: HTTP 200");

  const enviadas = getMensagensEnviadas();
  ok(enviadas.length === 2, "Teste 1: exatamente 2 mensagens enviadas (saudacao + resposta normal)");
  ok(
    enviadas[0]?.texto === MENSAGEM_SAUDACAO_INICIAL,
    "Teste 1: a 1a mensagem enviada e' a saudacao inicial (texto exato)",
  );
  ok(
    enviadas[0]?.telefone === TELEFONE,
    "Teste 1: saudacao enviada para o telefone da conversa",
  );
  ok(
    enviadas[1]?.texto === "Olá! Estou aqui para ajudar.",
    "Teste 1: a resposta normal do atendimento continua sendo enviada (aditiva, nao substituida)",
  );
  ok(
    mensagensRegistradas().some(
      (m) => m.origem === "ia" && m.texto === MENSAGEM_SAUDACAO_INICIAL,
    ),
    "Teste 1: saudacao registrada no historico (origem 'ia')",
  );
  ok(
    acionamentosRegistrados().length === 0,
    "Teste 1: nenhuma transferencia acionada",
  );
}

// ---------------------------------------------------------------------
// Teste 2 -- SEGUNDA mensagem da MESMA conversa NAO repete a saudacao
// ---------------------------------------------------------------------
async function teste2() {
  resetarTudo();
  configurarMatch({ outcome: "no_match", candidates: [] });

  // 1a mensagem -- gera a saudacao + resposta 1 (deixa o historico com
  // linhas em mensagens_conversa)
  definirProximaRespostaGemini({
    outcome: "success",
    data: { tipo: "responder", texto: "Resposta 1." },
  });
  await handler(req({ telefone: TELEFONE, conteudo: "oi" }));
  ok(
    getMensagensEnviadas().some((m) => m.texto === MENSAGEM_SAUDACAO_INICIAL),
    "Teste 2 (pre-condicao): 1a mensagem gerou a saudacao",
  );

  // 2a mensagem da mesma conversa -- limpa so' o registro de envios,
  // mantem o historico de mensagens_conversa
  resetarWhatsapp();
  definirProximaRespostaGemini({
    outcome: "success",
    data: { tipo: "responder", texto: "Resposta 2." },
  });
  const resp = await handler(req({ telefone: TELEFONE, conteudo: "quanto custa o plano?" }));

  ok(resp.status === 200, "Teste 2: HTTP 200");
  const enviadas = getMensagensEnviadas();
  ok(
    !enviadas.some((m) => m.texto === MENSAGEM_SAUDACAO_INICIAL),
    "Teste 2: a saudacao NAO e' reenviada na 2a mensagem",
  );
  ok(
    enviadas.length === 1 && enviadas[0]?.texto === "Resposta 2.",
    "Teste 2: a 2a mensagem recebe so' a resposta normal do atendimento",
  );
}

// ---------------------------------------------------------------------
// Teste 3 -- CLIENTE JA CONHECIDO (conversa com historico): comportamento
// normal, sem saudacao
// ---------------------------------------------------------------------
async function teste3() {
  resetarTudo();
  resetarConversa({ sessao_atividade_em: AGORA_ISO });
  semearMensagensPrevias("conv-teste-1", 6); // conversa que ja trocou 6 mensagens

  configurarMatch({
    outcome: "single_match",
    candidates: [{ publicId: "pub-conhecido", nome: "Cliente Conhecido", usuario: "usr123" }],
  });
  configurarStatus("pub-conhecido", {
    outcome: "success",
    linkState: "linked",
    publicId: "pub-conhecido",
    syncedAt: AGORA_ISO,
    cliente: {
      nome: "Cliente Conhecido",
      usuario: "usr123",
      vencimento: "2026-12-08T23:59:00-03:00",
      planoNome: "Mensal",
      servidorNome: "NewOne",
      telas: 1,
      valor: "35.00",
    },
  });
  definirProximaRespostaGemini({
    outcome: "success",
    data: { tipo: "responder", texto: "Localizei seu acesso NewOne. Posso ajudar com mais algo?" },
  });

  const resp = await handler(req({ telefone: TELEFONE, conteudo: "me ajuda?" }));
  ok(resp.status === 200, "Teste 3: HTTP 200");

  const enviadas = getMensagensEnviadas();
  ok(
    !enviadas.some((m) => m.texto === MENSAGEM_SAUDACAO_INICIAL),
    "Teste 3: cliente conhecido NAO recebe a saudacao inicial",
  );
  ok(
    enviadas.length === 1 &&
      enviadas[0]?.texto === "Localizei seu acesso NewOne. Posso ajudar com mais algo?",
    "Teste 3: cliente conhecido recebe so' a resposta normal (comportamento inalterado)",
  );
  ok(acionamentosRegistrados().length === 0, "Teste 3: nenhuma transferencia acionada");
}

// ---------------------------------------------------------------------
// Teste 4 -- FLUXO DE TRANSFERENCIA nao e' afetado (e a saudacao no
// primeiro contato coexiste com a transferencia)
// ---------------------------------------------------------------------
async function teste4() {
  resetarTudo();
  configurarMatch({ outcome: "no_match", candidates: [] });
  definirProximaRespostaGemini({
    outcome: "success",
    data: { tipo: "transferir", texto: "Vou te encaminhar para um atendente." },
  });

  const resp = await handler(req({ telefone: TELEFONE, conteudo: "quero falar com um humano" }));
  ok(resp.status === 200, "Teste 4: HTTP 200");

  const enviadas = getMensagensEnviadas();
  ok(
    enviadas.some((m) => m.texto === MENSAGEM_SAUDACAO_INICIAL),
    "Teste 4: saudacao enviada (primeiro contato)",
  );
  ok(
    enviadas.some((m) => m.texto === MENSAGEM_TRANSFERENCIA_CLIENTE),
    "Teste 4: mensagem fixa de transferencia continua sendo enviada",
  );
  ok(
    acionamentosRegistrados().length === 1 &&
      acionamentosRegistrados()[0]?.motivo === "gemini:transferir",
    "Teste 4: transferencia humana acionada normalmente (motivo gemini:transferir)",
  );
}

// ---------------------------------------------------------------------
// Teste 5 -- FLUXO DE RENOVACAO nao e' afetado (cliente conhecido ->
// sem saudacao; a proposta de renovacao segue e cria o token)
// ---------------------------------------------------------------------
async function teste5() {
  resetarTudo();
  resetarConversa({ sessao_atividade_em: AGORA_ISO });
  semearMensagensPrevias("conv-teste-1", 4);

  configurarMatch({
    outcome: "single_match",
    candidates: [{ publicId: "pub-blaze", nome: "Cliente Blaze", usuario: "blz001" }],
  });
  configurarStatus("pub-blaze", {
    outcome: "success",
    linkState: "linked",
    publicId: "pub-blaze",
    syncedAt: AGORA_ISO,
    cliente: {
      nome: "Cliente Blaze",
      usuario: "blz001",
      vencimento: "2026-09-13T23:59:00-03:00",
      planoNome: "Mensal",
      servidorNome: "BLAZE",
      telas: 1,
      valor: "35.00",
    },
  });
  definirProximaRespostaGemini({
    outcome: "success",
    data: { tipo: "propor_renovacao", texto: "Perfeito! Vou te ajudar a renovar seu acesso BLAZE." },
  });

  const resp = await handler(req({ telefone: TELEFONE, conteudo: "quero renovar meu plano BLAZE" }));
  ok(resp.status === 200, "Teste 5: HTTP 200");
  ok(
    !getMensagensEnviadas().some((m) => m.texto === MENSAGEM_SAUDACAO_INICIAL) &&
      !getMensagensInterativasEnviadas().some((m) => m.texto === MENSAGEM_SAUDACAO_INICIAL),
    "Teste 5: cliente conhecido em fluxo de renovacao NAO recebe a saudacao",
  );
  ok(
    chamadasCriarToken() === 1,
    "Teste 5: fluxo de renovacao segue normalmente (token de renovacao criado)",
  );
}

async function main() {
  await teste1();
  await teste2();
  await teste3();
  await teste4();
  await teste5();

  console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} FALHA(S)`);
  process.exit(falhas === 0 ? 0 : 1);
}

await main();
