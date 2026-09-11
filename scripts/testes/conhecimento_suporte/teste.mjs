// Testes isolados de _shared/conhecimento_suporte.ts (Fase 3,
// Checkpoint 1, 2026-09-11). Roda o arquivo REAL de producao via tsx,
// com a UNICA dependencia externa (Supabase) substituida por fake
// deste diretorio (mock-loader.mjs). Nao chama, nao importa, nao toca
// em orchestrator/index.ts nem em _shared/conhecimento.ts -- suite
// isolada, sem nenhuma integracao ainda.
//
// Como rodar: npx tsx scripts/testes/conhecimento_suporte/teste.mjs

import { register } from "node:module";

register("./mock-loader.mjs", import.meta.url);

const { resetarConhecimentoSuporte, seedConhecimentoSuporte, forcarFalhaConsulta } =
  await import("./fake_supabase_client.mjs");
const { buscarConhecimentoSuporte } = await import(
  "../../../supabase/functions/_shared/conhecimento_suporte.ts"
);

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

// Fixture principal: o registro REAL cadastrado em producao
// (id fictício aqui, so' pra identificar nos testes -- o conteudo
// espelha exatamente o que foi inserido: PlaySim + NewOne + Smart TV).
const PLAYSIM_ID = "conhecimento-playsim-teste";
function linhaPlaysimEspecifica(overrides = {}) {
  return {
    id: PLAYSIM_ID,
    titulo: "PlaySim — canais/playlist não carregam (botão Recarregar)",
    procedimento:
      'Na tela inicial do aplicativo PlaySim, toque no botão "Recarregar" (ícone ao lado do botão de Configurações). Aguarde alguns segundos para a playlist recarregar e verifique se os canais aparecem.',
    palavras_chave: [
      "playsim",
      "canais nao carregam",
      "nao carrega os canais",
      "canais nao aparecem",
      "playlist nao carrega",
      "lista nao carrega",
    ],
    aplicativo: "PlaySim",
    servidor: "NewOne",
    dispositivo: "Smart TV",
    status: "ativo",
    ...overrides,
  };
}

const GENERICO_ID = "conhecimento-generico-teste";
function linhaGenerica(overrides = {}) {
  return {
    id: GENERICO_ID,
    titulo: "Genérico — feche e abra o aplicativo",
    procedimento: "Feche completamente o aplicativo, abra novamente e verifique.",
    palavras_chave: ["aplicativo nao abre", "trava direto"],
    aplicativo: null,
    servidor: null,
    dispositivo: null,
    status: "ativo",
    ...overrides,
  };
}

function resetar() {
  resetarConhecimentoSuporte();
}

// ---------------------------------------------------------------------
// 1 -- conhecimento ativo + contexto compativel -> encontra
// ---------------------------------------------------------------------
async function teste1() {
  resetar();
  seedConhecimentoSuporte([linhaPlaysimEspecifica()]);

  const resultado = await buscarConhecimentoSuporte("meus canais nao carregam no playsim", {
    aplicativo: "PlaySim",
    servidor: "NewOne",
    dispositivo: "Smart TV",
  });

  ok(resultado.outcome === "encontrado", "Teste 1: contexto compatível -> encontrado");
  ok(
    resultado.outcome === "encontrado" && resultado.conhecimentoId === PLAYSIM_ID,
    "Teste 1: conhecimentoId é o do PlaySim",
  );
  ok(
    resultado.outcome === "encontrado" &&
      resultado.titulo === "PlaySim — canais/playlist não carregam (botão Recarregar)",
    "Teste 1: título correto",
  );
  ok(resultado.outcome === "encontrado" && resultado.score >= 1, "Teste 1: score >= 1");
}

// ---------------------------------------------------------------------
// 2 -- servidor incompativel -> nao encontra
// ---------------------------------------------------------------------
async function teste2() {
  resetar();
  seedConhecimentoSuporte([linhaPlaysimEspecifica()]);

  const resultado = await buscarConhecimentoSuporte("meus canais nao carregam no playsim", {
    aplicativo: "PlaySim",
    servidor: "BLAZE", // diferente do cadastrado (NewOne)
    dispositivo: "Smart TV",
  });

  ok(resultado.outcome === "nada_encontrado", "Teste 2: servidor incompatível -> nada_encontrado");
}

// ---------------------------------------------------------------------
// 3 -- aplicativo incompativel -> nao encontra
// ---------------------------------------------------------------------
async function teste3() {
  resetar();
  seedConhecimentoSuporte([linhaPlaysimEspecifica()]);

  const resultado = await buscarConhecimentoSuporte("meus canais nao carregam no playsim", {
    aplicativo: "OutroApp", // diferente do cadastrado (PlaySim)
    servidor: "NewOne",
    dispositivo: "Smart TV",
  });

  ok(resultado.outcome === "nada_encontrado", "Teste 3: aplicativo incompatível -> nada_encontrado");
}

// ---------------------------------------------------------------------
// 4 -- dispositivo incompativel -> nao encontra
// ---------------------------------------------------------------------
async function teste4() {
  resetar();
  seedConhecimentoSuporte([linhaPlaysimEspecifica()]);

  const resultado = await buscarConhecimentoSuporte("meus canais nao carregam no playsim", {
    aplicativo: "PlaySim",
    servidor: "NewOne",
    dispositivo: "Celular", // diferente do cadastrado (Smart TV)
  });

  ok(resultado.outcome === "nada_encontrado", "Teste 4: dispositivo incompatível -> nada_encontrado");
}

// ---------------------------------------------------------------------
// 5 -- campo NULL do conhecimento funciona como curinga
// ---------------------------------------------------------------------
async function teste5() {
  resetar();
  // Registro com aplicativo/dispositivo = null (curinga), so' servidor
  // preenchido -- deve bater mesmo quando o contexto informa
  // aplicativo/dispositivo especificos.
  seedConhecimentoSuporte([
    linhaGenerica({
      id: "conhecimento-curinga-teste",
      titulo: "NewOne — instabilidade geral",
      palavras_chave: ["canais instaveis", "conexao caindo"],
      servidor: "NewOne",
    }),
  ]);

  // "canais instaveis" precisa aparecer como sequencia CONTIGUA de
  // tokens (mesmo algoritmo de conhecimento.ts) -- daí o texto exato.
  const resultado = await buscarConhecimentoSuporte("estou com canais instaveis aqui", {
    aplicativo: "PlaySim",
    servidor: "NewOne",
    dispositivo: "Smart TV",
  });

  ok(
    resultado.outcome === "encontrado" && resultado.conhecimentoId === "conhecimento-curinga-teste",
    "Teste 5: registro com aplicativo/dispositivo=null funciona como curinga",
  );
}

// ---------------------------------------------------------------------
// 6 -- status='candidato' nunca e' encontrado
// ---------------------------------------------------------------------
async function teste6() {
  resetar();
  seedConhecimentoSuporte([linhaPlaysimEspecifica({ status: "candidato" })]);

  const resultado = await buscarConhecimentoSuporte("meus canais nao carregam no playsim", {
    aplicativo: "PlaySim",
    servidor: "NewOne",
    dispositivo: "Smart TV",
  });

  ok(
    resultado.outcome === "nada_encontrado",
    "Teste 6: status='candidato' nunca é retornado, mesmo com contexto e texto perfeitos",
  );
}

// ---------------------------------------------------------------------
// 7 -- empate no melhor score -> nada_encontrado
// ---------------------------------------------------------------------
async function teste7() {
  resetar();
  seedConhecimentoSuporte([
    linhaGenerica({
      id: "empate-a",
      titulo: "Empate A",
      palavras_chave: ["travando"],
    }),
    linhaGenerica({
      id: "empate-b",
      titulo: "Empate B",
      palavras_chave: ["travando"],
    }),
  ]);

  const resultado = await buscarConhecimentoSuporte("meu aplicativo esta travando", {});

  ok(
    resultado.outcome === "nada_encontrado",
    "Teste 7: empate no melhor score -> nada_encontrado (nunca escolhe arbitrariamente)",
  );
}

// ---------------------------------------------------------------------
// 8 -- ausencia de contexto nao inventa contexto: o registro
// ESPECIFICO do PlaySim nunca aparece quando o chamador nao informou
// NENHUM eixo, mesmo que o texto contenha as palavras-chave dele.
// ---------------------------------------------------------------------
async function teste8() {
  resetar();
  seedConhecimentoSuporte([linhaPlaysimEspecifica()]);

  const resultado = await buscarConhecimentoSuporte("meus canais nao carregam no playsim", {});

  ok(
    resultado.outcome === "nada_encontrado",
    "Teste 8: sem contexto informado, conhecimento específico (aplicativo/servidor/dispositivo preenchidos) não é elegível -- função não inventa contexto",
  );
}

// ---------------------------------------------------------------------
// 9 (extra) -- sem contexto informado, conhecimento 100% generico
// (todos os eixos null) continua funcionando normalmente.
// ---------------------------------------------------------------------
async function teste9() {
  resetar();
  seedConhecimentoSuporte([linhaGenerica()]);

  const resultado = await buscarConhecimentoSuporte("meu aplicativo nao abre", {});

  ok(
    resultado.outcome === "encontrado" && resultado.conhecimentoId === GENERICO_ID,
    "Teste 9: conhecimento 100% genérico (todos os eixos null) é encontrado mesmo sem nenhum contexto informado",
  );
}

// ---------------------------------------------------------------------
// 10 (extra) -- falha na consulta -> unavailable (nunca confundido com
// nada_encontrado), mesmo contrato de _shared/conhecimento.ts.
// ---------------------------------------------------------------------
async function teste10() {
  resetar();
  forcarFalhaConsulta();

  const resultado = await buscarConhecimentoSuporte("qualquer coisa", {});

  ok(resultado.outcome === "unavailable", "Teste 10: falha na consulta -> 'unavailable', não 'nada_encontrado'");
}

await teste1();
await teste2();
await teste3();
await teste4();
await teste5();
await teste6();
await teste7();
await teste8();
await teste9();
await teste10();

console.log("");
console.log(`Resultado: ${total - falhas}/${total} passando`);
if (falhas > 0) {
  console.log(`${falhas} teste(s) FALHARAM`);
  process.exit(1);
}
