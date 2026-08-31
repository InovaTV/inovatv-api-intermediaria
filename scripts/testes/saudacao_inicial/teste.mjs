// Testes locais da SAUDACAO INICIAL do novo atendimento (decisao de
// produto 2026-08-31; ajuste pos-teste real aprovado 2026-08-31).
//
// Comportamento validado:
//  - PRIMEIRO CONTATO (contarMensagensDaConversa === 0): a requisicao
//    grava a mensagem do cliente PRIMEIRO, envia SO' a MENSAGEM_SAUDACAO_
//    INICIAL, grava a saudacao no historico so' se o envio teve sucesso,
//    e ENCERRA (return "saudacao_inicial") -- Gemini nunca e' chamado,
//    nenhuma 2a mensagem do sistema e' enviada.
//  - Ordem no historico: cliente -> Assistente Virtual (nunca o inverso).
//  - Mensagens seguintes (count > 0): fluxo normal do Gemini assume; a
//    saudacao nao repete; a mensagem do cliente nao e' gravada em
//    duplicidade.
//  - Cliente conhecido / transferencia / renovacao: inalterados.
//
// Roda o handler REAL de supabase/functions/orchestrator/index.ts, com
// _shared/contexto.ts, _shared/validador.ts, _shared/mensagens_fixas.ts
// e _shared/telefone.ts REAIS. Deps externas (banco, WhatsApp, Gemini,
// Rocket) sao fakes (mock-loader.mjs).
//
// Como rodar: npx tsx scripts/testes/saudacao_inicial/teste.mjs

import { register } from "node:module";

register("./mock-loader.mjs", import.meta.url);

const { resetarConversa, acionamentosRegistrados } = await import("./fake_conversas_estado.mjs");
const { resetarMensagens, mensagensRegistradas, semearMensagensPrevias } =
  await import("./fake_mensagens_atendimento.mjs");
const {
  resetarWhatsapp,
  getMensagensEnviadas,
  getMensagensInterativasEnviadas,
  forcarFalhaEnvioTexto,
} = await import("./fake_whatsapp_client.mjs");
const { configurarMatch, configurarStatus, resetarRocketIntermediaria } = await import(
  "../orchestrator_multiplos_acessos/fake_rocket_intermediaria.mjs"
);
const { definirProximaRespostaGemini, resetarGemini } = await import(
  "../orchestrator_multiplos_acessos/fake_gemini_client.mjs"
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
// Teste 1 -- PRIMEIRO CONTATO: so' a saudacao, ordem cliente->IA, sem Gemini
// ---------------------------------------------------------------------
async function teste1() {
  resetarTudo();
  configurarMatch({ outcome: "no_match", candidates: [] });
  definirProximaRespostaGemini({
    outcome: "success",
    data: { tipo: "responder", texto: "ESTA RESPOSTA DO GEMINI NAO DEVE SAIR" },
  });

  const resp = await handler(req({ telefone: TELEFONE, conteudo: "ola" }));
  ok(resp.status === 200, "Teste 1: HTTP 200");
  const body = await resp.json();
  ok(body?.outcome === "saudacao_inicial", "Teste 1: outcome 'saudacao_inicial'");
  ok(body?.envio?.enviado === true, "Teste 1: envio.enviado === true");

  const enviadas = getMensagensEnviadas();
  ok(enviadas.length === 1, "Teste 1: exatamente 1 mensagem enviada (so' a saudacao)");
  ok(enviadas[0]?.texto === MENSAGEM_SAUDACAO_INICIAL, "Teste 1: a mensagem enviada e' a saudacao (texto exato)");
  ok(
    !enviadas.some((m) => m.texto === "ESTA RESPOSTA DO GEMINI NAO DEVE SAIR"),
    "Teste 1: o Gemini NAO e' consultado/enviado no primeiro contato",
  );

  const registradas = mensagensRegistradas();
  ok(registradas.length === 2, "Teste 1: exatamente 2 linhas no historico (cliente + saudacao)");
  ok(
    registradas[0]?.origem === "cliente" && registradas[0]?.texto === "ola",
    "Teste 1: 1a linha do historico = mensagem do CLIENTE ('ola')",
  );
  ok(
    registradas[1]?.origem === "ia" && registradas[1]?.texto === MENSAGEM_SAUDACAO_INICIAL,
    "Teste 1: 2a linha do historico = saudacao (cliente ANTES da saudacao)",
  );
  ok(acionamentosRegistrados().length === 0, "Teste 1: nenhuma transferencia acionada");
}

// ---------------------------------------------------------------------
// Teste 2 -- PRIMEIRO CONTATO com FALHA no envio da saudacao:
// cliente gravado, saudacao NAO gravada, ainda assim encerra sem Gemini
// ---------------------------------------------------------------------
async function teste2() {
  resetarTudo();
  forcarFalhaEnvioTexto();
  configurarMatch({ outcome: "no_match", candidates: [] });
  definirProximaRespostaGemini({
    outcome: "success",
    data: { tipo: "responder", texto: "GEMINI NAO DEVE SER CHAMADO" },
  });

  const resp = await handler(req({ telefone: TELEFONE, conteudo: "ola" }));
  ok(resp.status === 200, "Teste 2: HTTP 200");
  const body = await resp.json();
  ok(body?.outcome === "saudacao_inicial", "Teste 2: outcome 'saudacao_inicial' mesmo com envio falho");
  ok(body?.envio?.enviado === false, "Teste 2: envio.enviado === false");

  const registradas = mensagensRegistradas();
  ok(registradas.length === 1, "Teste 2: apenas 1 linha no historico");
  ok(
    registradas[0]?.origem === "cliente" && registradas[0]?.texto === "ola",
    "Teste 2: a linha gravada e' a mensagem do CLIENTE",
  );
  ok(
    !registradas.some((m) => m.origem === "ia" && m.texto === MENSAGEM_SAUDACAO_INICIAL),
    "Teste 2: a saudacao NAO e' gravada quando o envio falha",
  );
  ok(
    !getMensagensEnviadas().some((m) => m.texto === "GEMINI NAO DEVE SER CHAMADO"),
    "Teste 2: Gemini nao e' chamado nem quando a saudacao falha",
  );
}

// ---------------------------------------------------------------------
// Teste 3 -- SEGUNDA mensagem (count > 0): fluxo normal do Gemini assume,
// saudacao nao repete, mensagem do cliente nao duplica
// ---------------------------------------------------------------------
async function teste3() {
  resetarTudo();
  configurarMatch({ outcome: "no_match", candidates: [] });

  // 1a mensagem -> saudacao (historico: cliente 'ola', ia saudacao)
  definirProximaRespostaGemini({
    outcome: "success",
    data: { tipo: "responder", texto: "resposta 1" },
  });
  await handler(req({ telefone: TELEFONE, conteudo: "ola" }));

  // 2a mensagem da mesma conversa
  resetarWhatsapp();
  definirProximaRespostaGemini({
    outcome: "success",
    data: { tipo: "responder", texto: "Resposta normal do Gemini." },
  });
  const resp = await handler(req({ telefone: TELEFONE, conteudo: "quanto custa o plano?" }));

  ok(resp.status === 200, "Teste 3: HTTP 200");
  const body = await resp.json();
  ok(body?.outcome !== "saudacao_inicial", "Teste 3: 2a mensagem NAO e' 'saudacao_inicial'");

  const enviadas = getMensagensEnviadas();
  ok(
    !enviadas.some((m) => m.texto === MENSAGEM_SAUDACAO_INICIAL),
    "Teste 3: a saudacao NAO e' reenviada",
  );
  ok(
    enviadas.length === 1 && enviadas[0]?.texto === "Resposta normal do Gemini.",
    "Teste 3: a 2a mensagem recebe a resposta normal do Gemini",
  );

  const registradas = mensagensRegistradas();
  const qtdOla = registradas.filter((m) => m.origem === "cliente" && m.texto === "ola").length;
  ok(qtdOla === 1, "Teste 3: a mensagem inicial 'ola' aparece no historico EXATAMENTE uma vez (sem duplicidade)");
  ok(
    registradas.some((m) => m.origem === "cliente" && m.texto === "quanto custa o plano?"),
    "Teste 3: a 2a mensagem do cliente foi gravada",
  );
  ok(
    registradas.some((m) => m.origem === "ia" && m.texto === "Resposta normal do Gemini."),
    "Teste 3: a resposta do Gemini foi gravada",
  );
}

// ---------------------------------------------------------------------
// Teste 4 -- CLIENTE CONHECIDO (conversa com historico): sem saudacao,
// comportamento normal
// ---------------------------------------------------------------------
async function teste4() {
  resetarTudo();
  resetarConversa({ sessao_atividade_em: AGORA_ISO });
  semearMensagensPrevias("conv-teste-1", 6);

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
    data: { tipo: "responder", texto: "Localizei seu acesso. Posso ajudar com mais algo?" },
  });

  const resp = await handler(req({ telefone: TELEFONE, conteudo: "me ajuda?" }));
  ok(resp.status === 200, "Teste 4: HTTP 200");

  const enviadas = getMensagensEnviadas();
  ok(
    !enviadas.some((m) => m.texto === MENSAGEM_SAUDACAO_INICIAL),
    "Teste 4: cliente conhecido NAO recebe a saudacao",
  );
  ok(
    enviadas.length === 1 &&
      enviadas[0]?.texto === "Localizei seu acesso. Posso ajudar com mais algo?",
    "Teste 4: cliente conhecido recebe so' a resposta normal",
  );
  ok(acionamentosRegistrados().length === 0, "Teste 4: nenhuma transferencia acionada");
}

// ---------------------------------------------------------------------
// Teste 5 -- TRANSFERENCIA nao e' afetada (conversa com historico)
// ---------------------------------------------------------------------
async function teste5() {
  resetarTudo();
  resetarConversa({ sessao_atividade_em: AGORA_ISO });
  semearMensagensPrevias("conv-teste-1", 3);
  configurarMatch({ outcome: "no_match", candidates: [] });
  definirProximaRespostaGemini({
    outcome: "success",
    data: { tipo: "transferir", texto: "Vou te encaminhar para um atendente." },
  });

  const resp = await handler(req({ telefone: TELEFONE, conteudo: "quero falar com um humano" }));
  ok(resp.status === 200, "Teste 5: HTTP 200");

  const enviadas = getMensagensEnviadas();
  ok(
    !enviadas.some((m) => m.texto === MENSAGEM_SAUDACAO_INICIAL),
    "Teste 5: nenhuma saudacao (conversa ja tem historico)",
  );
  ok(
    enviadas.some((m) => m.texto === MENSAGEM_TRANSFERENCIA_CLIENTE),
    "Teste 5: mensagem fixa de transferencia enviada normalmente",
  );
  ok(
    acionamentosRegistrados().length === 1 &&
      acionamentosRegistrados()[0]?.motivo === "gemini:transferir",
    "Teste 5: transferencia humana acionada normalmente (motivo gemini:transferir)",
  );
}

// ---------------------------------------------------------------------
// Teste 6 -- RENOVACAO nao e' afetada (conversa com historico)
// ---------------------------------------------------------------------
async function teste6() {
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
  ok(resp.status === 200, "Teste 6: HTTP 200");
  ok(
    !getMensagensEnviadas().some((m) => m.texto === MENSAGEM_SAUDACAO_INICIAL) &&
      !getMensagensInterativasEnviadas().some((m) => m.texto === MENSAGEM_SAUDACAO_INICIAL),
    "Teste 6: renovacao (conversa com historico) NAO recebe a saudacao",
  );
  ok(chamadasCriarToken() === 1, "Teste 6: fluxo de renovacao segue normalmente (token criado)");
}

async function main() {
  await teste1();
  await teste2();
  await teste3();
  await teste4();
  await teste5();
  await teste6();

  console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} FALHA(S)`);
  process.exit(falhas === 0 ? 0 : 1);
}

await main();
