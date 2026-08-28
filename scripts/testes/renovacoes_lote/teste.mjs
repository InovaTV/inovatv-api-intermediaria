// Teste local de _shared/renovacoes_lote.ts (Etapa 1, 2026-08-29).
// Roda o modulo REAL; so' o supabase_client e' fake (estado em memoria,
// sem FK/CAS -- essas sao SQL, testadas so' em producao). Foco: a forma
// das linhas gravadas por criarRenovacaoLote, as queries de leitura, e
// que as RPCs sao chamadas com o parametro certo.
//
// Como rodar: npx tsx scripts/testes/renovacoes_lote/teste.mjs

import { register } from "node:module";
register("./mock-loader.mjs", import.meta.url);

const { resetar, tabela, seed, chamadasRpc, definirRespostaRpc, getServiceClient } =
  await import("./fake_supabase_client.mjs");
const lote = await import("../../../supabase/functions/_shared/renovacoes_lote.ts");

let falhas = 0;
function ok(cond, msg) {
  if (!cond) {
    falhas++;
    console.error(`FALHA: ${msg}`);
  } else {
    console.log(`ok: ${msg}`);
  }
}

const CONV = "conv-lote-teste";
const TEL = "5517981625486";

// ---------------------------------------------------------------------
// criarRenovacaoLote -- 1 linha em renovacoes_lote + N filhos em
// tokens_renovacao, com snapshot dos dados e token_hash proprio.
// ---------------------------------------------------------------------
{
  resetar();
  const filhos = [
    {
      tipo: "sigma",
      publicId: "pub-A",
      unitvSn: null,
      unitvId: null,
      clienteNome: "Meu Uso Testes",
      servidorNome: "BLAZE",
      planoNome: "Mensal",
      valorEsperadoCentavos: 3000,
      vencimentoAtual: "2026-09-13T23:59:00-03:00",
    },
    {
      tipo: "sigma",
      publicId: "pub-B",
      unitvSn: null,
      unitvId: null,
      clienteNome: "Js Informática Rp",
      servidorNome: "NewOne",
      planoNome: "Mensal",
      valorEsperadoCentavos: 3000,
      vencimentoAtual: "2026-12-08T23:59:00-03:00",
    },
  ];
  const { tokenBruto, lote: capa } = await lote.criarRenovacaoLote({
    conversationId: CONV,
    telefone: TEL,
    valorTotalCentavos: 6000,
    regraAplicada: "lote_2_acessos_30",
    filhos,
  });

  ok(typeof tokenBruto === "string" && tokenBruto.length > 0, "criar: devolve tokenBruto (usado no id do botao)");
  const capas = tabela("renovacoes_lote");
  ok(capas.length === 1, "criar: exatamente 1 linha em renovacoes_lote");
  ok(capas[0].conversation_id === CONV && capas[0].telefone === TEL, "criar: capa carrega conversation_id/telefone");
  ok(capas[0].valor_total_centavos === 6000, "criar: total gravado");
  ok(capas[0].regra_aplicada === "lote_2_acessos_30", "criar: rotulo interno da regra gravado");
  ok(capas[0].estado === "aguardando_confirmacao", "criar: capa nasce aguardando_confirmacao");
  ok(typeof capas[0].token_hash === "string" && capas[0].token_hash.length === 64, "criar: token_hash e' SHA-256 hex (64)");
  ok(capas[0].token_hash !== tokenBruto, "criar: o hash NUNCA e' o token bruto");
  ok(!("operacao_id" in capas[0]) || capas[0].operacao_id == null, "criar: sem operacao_id ainda (cobranca so' apos ACEITO)");

  const kids = tabela("tokens_renovacao");
  ok(kids.length === 2, "criar: 2 filhos em tokens_renovacao");
  ok(kids.every((k) => k.grupo_id === capa.grupo_id), "criar: filhos apontam pro grupo_id da capa");
  ok(kids.every((k) => k.estado === "aguardando_confirmacao"), "criar: filhos nascem aguardando_confirmacao");
  ok(kids.every((k) => k.tipo === "sigma"), "criar: filhos tipo 'sigma'");
  ok(kids.map((k) => k.public_id).sort().join(",") === "pub-A,pub-B", "criar: public_id de cada acesso preservado");
  ok(kids.every((k) => k.valor_esperado_centavos === 3000), "criar: valor por acesso no snapshot do filho");
  ok(kids.some((k) => k.cliente_nome === "Js Informática Rp" && k.servidor_nome === "NewOne"), "criar: snapshot nome/servidor por filho");
  ok(kids.every((k) => typeof k.token_hash === "string" && k.token_hash.length === 64), "criar: cada filho tem token_hash proprio");
  ok(new Set(kids.map((k) => k.token_hash)).size === 2 && !kids.some((k) => k.token_hash === capa.token_hash), "criar: token_hash dos filhos e' distinto entre si e da capa (nunca usado pra lookup)");
}

// ---------------------------------------------------------------------
// buscarFilhosDoLote / buscarLotePorTokenHash / buscarLotePorOperacaoId
// ---------------------------------------------------------------------
{
  resetar();
  seed("renovacoes_lote", [
    { grupo_id: "g1", token_hash: "h".repeat(64), operacao_id: "op1", estado: "autorizada", conversation_id: CONV, telefone: TEL },
  ]);
  seed("tokens_renovacao", [
    { id: "t1", grupo_id: "g1", criado_em: "2026-01-01T00:00:02Z", estado: "autorizada" },
    { id: "t2", grupo_id: "g1", criado_em: "2026-01-01T00:00:01Z", estado: "autorizada" },
    { id: "t3", grupo_id: "OUTRO", criado_em: "2026-01-01T00:00:00Z", estado: "autorizada" },
  ]);

  const porHash = await lote.buscarLotePorTokenHash("h".repeat(64));
  ok(porHash?.grupo_id === "g1", "buscarLotePorTokenHash: acha pelo hash");
  ok((await lote.buscarLotePorTokenHash("z".repeat(64))) === null, "buscarLotePorTokenHash: hash desconhecido -> null (cai no fluxo individual)");

  const porOp = await lote.buscarLotePorOperacaoId("op1");
  ok(porOp?.grupo_id === "g1", "buscarLotePorOperacaoId: acha pela operacao");

  const kids = await lote.buscarFilhosDoLote("g1");
  ok(kids.length === 2 && kids.every((k) => k.grupo_id === "g1"), "buscarFilhosDoLote: so' os filhos daquele grupo");
  ok(kids[0].id === "t2" && kids[1].id === "t1", "buscarFilhosDoLote: ordenado por criado_em asc");
}

// ---------------------------------------------------------------------
// expirarLoteSeVencido
// ---------------------------------------------------------------------
{
  resetar();
  const venceu = { grupo_id: "gv", estado: "aguardando_confirmacao", expira_em: new Date(Date.now() - 1000).toISOString() };
  seed("renovacoes_lote", [{ ...venceu }]);
  const r = await lote.expirarLoteSeVencido(venceu);
  ok(r.estado === "expirada", "expirar: lote vencido em aguardando_confirmacao -> expirada");
  ok(tabela("renovacoes_lote")[0].estado === "expirada", "expirar: persistido no banco");

  const noPrazo = { grupo_id: "gp", estado: "aguardando_confirmacao", expira_em: new Date(Date.now() + 60000).toISOString() };
  ok((await lote.expirarLoteSeVencido(noPrazo)).estado === "aguardando_confirmacao", "expirar: dentro do prazo nao mexe");

  const jaAutorizada = { grupo_id: "ga", estado: "autorizada", expira_em: new Date(Date.now() - 1000).toISOString() };
  ok((await lote.expirarLoteSeVencido(jaAutorizada)).estado === "autorizada", "expirar: estado nao-aguardando nunca e' expirado");
}

// ---------------------------------------------------------------------
// existeLoteAtivoParaPublicId -- fluxo INDIVIDUAL usa isto pra
// reconhecer "esse acesso ja esta num lote" e NAO reaproveitar/criar
// token individual. So' TRUE quando ha' um token ATIVO com grupo_id
// preenchido para aquele public_id.
// ---------------------------------------------------------------------
{
  resetar();
  seed("tokens_renovacao", [
    // pX: token de LOTE ativo -> existeLoteAtivo = true
    { id: "kX", public_id: "pX", grupo_id: "gX", estado: "aguardando_confirmacao", criado_em: "2026-01-01T00:00:00Z" },
    // pY: token INDIVIDUAL ativo (grupo_id null) -> false
    { id: "kY", public_id: "pY", grupo_id: null, estado: "autorizada", criado_em: "2026-01-01T00:00:00Z" },
    // pZ: token de lote, mas TERMINAL -> false (nao esta ativo)
    { id: "kZ", public_id: "pZ", grupo_id: "gZ", estado: "renovacao_falhou", criado_em: "2026-01-01T00:00:00Z" },
  ]);

  ok((await lote.existeLoteAtivoParaPublicId("pX")) === true, "existeLoteAtivo: token de lote ativo -> true");
  ok((await lote.existeLoteAtivoParaPublicId("pY")) === false, "existeLoteAtivo: token individual ativo -> false (pertence ao fluxo individual)");
  ok((await lote.existeLoteAtivoParaPublicId("pZ")) === false, "existeLoteAtivo: token de lote em estado terminal -> false");
  ok((await lote.existeLoteAtivoParaPublicId("pW")) === false, "existeLoteAtivo: acesso sem nenhum token -> false");
}

// ---------------------------------------------------------------------
// buscarLotesEmAndamentoAntigos / buscarLotesAutorizadosOrfaosAntigos
// (backstop do watchdog, Etapa 1)
// ---------------------------------------------------------------------
{
  resetar();
  const antigo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const recente = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  seed("renovacoes_lote", [
    // orfao real: autorizada, sem operacao_id, decidido ha 30min
    { grupo_id: "orf1", estado: "autorizada", operacao_id: null, decidido_em: antigo },
    // autorizada mas com cobranca vinculada -> aguardando pagamento legitimo, NUNCA e' orfao
    { grupo_id: "vinc", estado: "autorizada", operacao_id: "op-existe", decidido_em: antigo },
    // autorizada recente -> ainda dentro da janela
    { grupo_id: "novo", estado: "autorizada", operacao_id: null, decidido_em: recente },
    // em andamento antigo (para buscarLotesEmAndamentoAntigos)
    { grupo_id: "and1", estado: "renovacao_em_andamento", operacao_id: "op-x", renovacao_iniciada_em: antigo },
  ]);

  const orfaos = await lote.buscarLotesAutorizadosOrfaosAntigos(15);
  ok(orfaos.length === 1 && orfaos[0].grupo_id === "orf1", "orfaos: so' o lote autorizada + sem operacao_id + antigo");
  ok(!orfaos.some((l) => l.grupo_id === "vinc"), "orfaos: NUNCA inclui lote com operacao_id ja vinculado (aguardando pagamento)");
  ok(!orfaos.some((l) => l.grupo_id === "novo"), "orfaos: NUNCA inclui lote dentro da janela (recente)");

  const presos = await lote.buscarLotesEmAndamentoAntigos(15);
  ok(presos.length === 1 && presos[0].grupo_id === "and1", "emAndamento: so' o lote renovacao_em_andamento antigo");
}

// ---------------------------------------------------------------------
// vincularOperacaoAoLote -- CAS: so' quando estado='autorizada'
// ---------------------------------------------------------------------
{
  resetar();
  seed("renovacoes_lote", [{ grupo_id: "gok", estado: "autorizada" }]);
  await lote.vincularOperacaoAoLote("gok", "op-nova");
  ok(tabela("renovacoes_lote")[0].operacao_id === "op-nova", "vincular: grava operacao_id quando autorizada");

  resetar();
  seed("renovacoes_lote", [{ grupo_id: "gbad", estado: "cancelada" }]);
  let lancou = false;
  try {
    await lote.vincularOperacaoAoLote("gbad", "op-x");
  } catch {
    lancou = true;
  }
  ok(lancou, "vincular: lanca quando o lote nao esta mais 'autorizada' (0 linhas afetadas)");
}

// ---------------------------------------------------------------------
// marcarEstadoFinalLote / marcarResultadoFilhoLote -- CAS por
// 'renovacao_em_andamento' (idempotencia contra callback duplicado)
// ---------------------------------------------------------------------
{
  resetar();
  seed("renovacoes_lote", [{ grupo_id: "gf", estado: "renovacao_em_andamento" }]);
  const r1 = await lote.marcarEstadoFinalLote("gf", "parcial");
  ok(r1?.estado === "parcial", "estadoFinal: em_andamento -> parcial");
  const r2 = await lote.marcarEstadoFinalLote("gf", "concluida");
  ok(r2 === null, "estadoFinal: 2a chamada nao reprocessa (ja nao esta em_andamento) -> null");

  resetar();
  seed("tokens_renovacao", [{ id: "k1", estado: "renovacao_em_andamento" }]);
  const f1 = await lote.marcarResultadoFilhoLote("k1", "renovacao_concluida", { vencimentoConfirmado: "2026-10-01" });
  ok(f1?.estado === "renovacao_concluida" && f1?.vencimento_confirmado === "2026-10-01", "filho: marca terminal + vencimento");
  const f2 = await lote.marcarResultadoFilhoLote("k1", "renovacao_falhou", { motivo: "x" });
  ok(f2 === null, "filho: idempotente -- 2a chamada nao mexe");
}

// ---------------------------------------------------------------------
// RPCs -- so' verifica o nome do parametro repassado
// ---------------------------------------------------------------------
{
  resetar();
  definirRespostaRpc("reivindicar_aceite_lote", { grupo_id: "g", estado: "autorizada" });
  await lote.reivindicarAceiteLote("hash-x");
  await lote.reivindicarCancelamentoLote("hash-y");
  await lote.reivindicarInicioRenovacaoLote("op-z");
  await lote.marcarLoteComoFalha("g-1", "motivo");
  const c = chamadasRpc();
  ok(c.find((x) => x.nome === "reivindicar_aceite_lote")?.params?.p_token_hash === "hash-x", "rpc: aceite usa p_token_hash");
  ok(c.find((x) => x.nome === "reivindicar_cancelamento_lote")?.params?.p_token_hash === "hash-y", "rpc: cancelamento usa p_token_hash");
  ok(c.find((x) => x.nome === "reivindicar_inicio_renovacao_lote")?.params?.p_operacao_id === "op-z", "rpc: inicio usa p_operacao_id");
  ok(
    c.find((x) => x.nome === "marcar_lote_como_falha")?.params?.p_grupo_id === "g-1" &&
      c.find((x) => x.nome === "marcar_lote_como_falha")?.params?.p_motivo === "motivo",
    "rpc: falha usa p_grupo_id + p_motivo",
  );
}

console.log(`\n${falhas === 0 ? "TODOS OS TESTES PASSARAM" : `${falhas} FALHA(S)`}`);
process.exit(falhas === 0 ? 0 : 1);
