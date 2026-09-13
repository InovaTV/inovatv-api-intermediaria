// Testes locais de supabase/functions/_shared/portal_rate_limit.ts
// (REAL) -- Checkpoint 5 (rate limiting da identificacao por telefone
// do Portal de Renovacao).
//
// So' o supabase_client e' fake (via mock-loader) -- hashToken()
// (_shared/tokens_renovacao.ts) e' o modulo REAL.
//
// Limitacao HONESTA deste teste (nao escondida): a garantia de
// atomicidade sob concorrencia real e' uma propriedade do "insert ...
// on conflict ... returning" executado pelo Postgres (migration
// 20260913160000_portal_renovacao_rate_limit.sql) -- nao existe
// Postgres real neste ambiente de teste local, entao nao e' possivel
// provar a atomicidade da transacao de banco aqui. O que ESTE teste
// prova: (a) o modulo TypeScript nunca faz select->conta->insert em
// passos separados -- so' 1 chamada RPC por tentativa, o que por
// construcao elimina qualquer corrida do LADO DO CLIENTE; (b) disparar
// N chamadas concorrentes contra um fake que implementa a MESMA
// semantica da funcao SQL (janela + limite por chave) produz o
// resultado esperado -- exatamente `limite` permitidas, o resto
// bloqueado.
//
// Como rodar: npx tsx scripts/testes/portal_rate_limit/teste.mjs

import { register } from "node:module";
register("./mock-loader.mjs", import.meta.url);

const { resetar, configurarFixo, configurarAtomico, configurarExcecao, chamadasRpc } =
  await import("./fake_supabase_client.mjs");
const { tentativaDeIdentificacaoPermitida } = await import(
  "../../../supabase/functions/_shared/portal_rate_limit.ts"
);

let falhas = 0;
let total = 0;
function ok(cond, msg) {
  total++;
  if (cond) console.log("ok:", msg);
  else { falhas++; console.error("FALHA:", msg); }
}

// -----------------------------------------------------------------------
// 1. Primeira tentativa permitida.
// -----------------------------------------------------------------------
{
  resetar();
  configurarFixo(true);
  const permitido = await tentativaDeIdentificacaoPermitida("5517999999999");
  ok(permitido === true, "1) primeira tentativa: permitida");
  ok(chamadasRpc.length === 1 && chamadasRpc[0].nome === "registrar_tentativa_portal_renovacao",
    "1) chamou a RPC correta exatamente 1 vez");
}

// -----------------------------------------------------------------------
// 2 e 3. Dentro do limite -> permitido; excedendo -> bloqueado (modo
// atomico, mesma semantica da funcao SQL).
// -----------------------------------------------------------------------
{
  resetar();
  configurarAtomico();
  const LIMITE = 5; // mesmo valor default de _shared/portal_rate_limit.ts
  const resultados = [];
  for (let i = 0; i < LIMITE + 2; i++) {
    resultados.push(await tentativaDeIdentificacaoPermitida("5517988887777"));
  }
  ok(resultados.slice(0, LIMITE).every((r) => r === true), "2) as primeiras 5 tentativas (dentro do limite) sao permitidas");
  ok(resultados.slice(LIMITE).every((r) => r === false), "3) a 6a e a 7a tentativa (excedendo o limite) sao bloqueadas");
}

// -----------------------------------------------------------------------
// 4. Telefone normalizado produz a MESMA chave (2 chamadas com o mesmo
// telefone -> mesmo p_chave enviado a RPC).
// -----------------------------------------------------------------------
{
  resetar();
  configurarFixo(true);
  await tentativaDeIdentificacaoPermitida("5517977776666");
  await tentativaDeIdentificacaoPermitida("5517977776666");
  ok(chamadasRpc[0].params.p_chave === chamadasRpc[1].params.p_chave,
    "4) mesmo telefone normalizado produz exatamente a mesma chave nas 2 chamadas");
}

// -----------------------------------------------------------------------
// 5. Telefones diferentes NUNCA compartilham o mesmo limite (chaves
// diferentes).
// -----------------------------------------------------------------------
{
  resetar();
  configurarFixo(true);
  await tentativaDeIdentificacaoPermitida("5517900000001");
  await tentativaDeIdentificacaoPermitida("5517900000002");
  ok(chamadasRpc[0].params.p_chave !== chamadasRpc[1].params.p_chave,
    "5) telefones diferentes produzem chaves diferentes");
}

// -----------------------------------------------------------------------
// 6. Concorrencia -- N chamadas SIMULTANEAS (Promise.all) pro MESMO
// telefone, contra um fake com a mesma semantica atomica da funcao SQL.
// Prova que o wrapper nao introduz corrida propria: o resultado bate
// exatamente com "1 chamada RPC por tentativa, backend atomico".
// -----------------------------------------------------------------------
{
  resetar();
  configurarAtomico();
  const LIMITE = 5;
  const N = 12;
  const promessas = Array.from({ length: N }, () => tentativaDeIdentificacaoPermitida("5517911112222"));
  const resultados = await Promise.all(promessas);
  const permitidas = resultados.filter((r) => r === true).length;
  const bloqueadas = resultados.filter((r) => r === false).length;
  ok(permitidas === LIMITE, `6) concorrencia: exatamente ${LIMITE} de ${N} chamadas simultaneas permitidas (obtido: ${permitidas})`);
  ok(bloqueadas === N - LIMITE, `6) concorrencia: as demais ${N - LIMITE} bloqueadas (obtido: ${bloqueadas})`);
  ok(chamadasRpc.length === N, "6) exatamente 1 chamada RPC por tentativa -- nenhum select/insert separado do lado do cliente");
}

// -----------------------------------------------------------------------
// 7. Resposta nao revela nada alem de um booleano -- o modulo nunca
// expoe contagem/limite interno pro chamador.
// -----------------------------------------------------------------------
{
  resetar();
  configurarFixo(false);
  const resultado = await tentativaDeIdentificacaoPermitida("5517933334444");
  ok(typeof resultado === "boolean", "7) retorno e' SEMPRE um booleano puro -- nunca contagem/limite/detalhe interno");
}

// -----------------------------------------------------------------------
// 8. Telefone NUNCA aparece em nenhum log (console.log/error/warn), nem
// em texto puro nem dentro de outro valor.
// -----------------------------------------------------------------------
{
  resetar();
  const TELEFONE_SECRETO = "5517955556666";
  const linhasLogadas = [];
  const originais = { log: console.log, error: console.error, warn: console.warn };
  console.log = (...args) => linhasLogadas.push(args.join(" "));
  console.error = (...args) => linhasLogadas.push(args.join(" "));
  console.warn = (...args) => linhasLogadas.push(args.join(" "));

  try {
    configurarExcecao(); // caminho de erro -- o mais provavel de logar algo por engano
    await tentativaDeIdentificacaoPermitida(TELEFONE_SECRETO);
    configurarFixo(false);
    await tentativaDeIdentificacaoPermitida(TELEFONE_SECRETO);
  } finally {
    console.log = originais.log;
    console.error = originais.error;
    console.warn = originais.warn;
  }

  const vazou = linhasLogadas.some((linha) => linha.includes(TELEFONE_SECRETO));
  ok(!vazou, "8) telefone NUNCA aparece em nenhuma linha de log, nem no caminho de erro/excecao");
}

// -----------------------------------------------------------------------
// 9. Falha da propria infra de rate limiting NUNCA bloqueia o cliente
// legitimo (falha aberta) -- erro do RPC e excecao de transporte.
// -----------------------------------------------------------------------
{
  resetar();
  configurarFixo(null, { message: "tabela indisponivel", code: "XX000" });
  const r1 = await tentativaDeIdentificacaoPermitida("5517922223333");
  ok(r1 === true, "9a) erro devolvido pelo RPC -> falha aberta, tentativa permitida");

  resetar();
  configurarExcecao();
  const r2 = await tentativaDeIdentificacaoPermitida("5517922223333");
  ok(r2 === true, "9b) excecao de transporte (rede fora) -> falha aberta, tentativa permitida");
}

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
