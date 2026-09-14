// Testes locais de supabase/functions/renovacao-status/index.ts (REAL) --
// Checkpoint 2 do Portal de Renovacao Tope TV.
//
// So' o supabase_client e' fake (estado em memoria) -- tokens_renovacao.ts
// e renovacoes_lote.ts (hashToken, buscarTokenPorHash,
// buscarLotePorTokenHash, buscarFilhosDoLote) sao os modulos REAIS,
// exatamente como usados em producao pelo resto do fluxo de renovacao.
//
// Como rodar: npx tsx scripts/testes/renovacao_status/teste.mjs

import { register } from "node:module";
register("./mock-loader.mjs", import.meta.url);

const { resetar, seed } = await import("./fake_supabase_client.mjs");
const { hashToken } = await import("../../../supabase/functions/_shared/tokens_renovacao.ts");

let handler;
globalThis.Deno = {
  serve: (fn) => { handler = fn; },
  env: { get: () => undefined },
};

await import("../../../supabase/functions/renovacao-status/index.ts");

let falhas = 0;
let total = 0;
function ok(cond, msg) {
  total++;
  if (!cond) { falhas++; console.error(`FALHA: ${msg}`); }
  else console.log(`ok: ${msg}`);
}

function reqPost(corpo) {
  return new Request("https://x.test/renovacao-status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
}

const AGORA = new Date().toISOString();

// ---------------------------------------------------------------------
// Token individual -- 'autorizada' (aceito, cobranca criada, aguardando
// pagamento).
// ---------------------------------------------------------------------
{
  resetar();
  const tokenBruto = crypto.randomUUID();
  const tokenHash = await hashToken(tokenBruto);
  seed("tokens_renovacao", [{
    id: "tok-1",
    token_hash: tokenHash,
    conversation_id: "conv-1",
    public_id: "pub-1",
    telefone: "5517981625486",
    cliente_nome: "Cliente Teste",
    servidor_nome: "BLAZE",
    plano_nome: "Mensal",
    valor_esperado_centavos: 3500,
    vencimento_atual: "2027-01-13T23:59:00-03:00",
    estado: "autorizada",
    criado_em: AGORA,
    expira_em: AGORA,
    grupo_id: null,
    tipo: "sigma",
  }]);

  const resp = await handler(reqPost({ token: tokenBruto }));
  const corpo = await resp.json();
  ok(resp.status === 200, "individual autorizada: HTTP 200");
  ok(corpo.estado === "aguardando_pagamento", "individual autorizada: estado mapeado para aguardando_pagamento");
  ok(Array.isArray(corpo.itens) && corpo.itens.length === 1, "individual: 1 item");
  ok(corpo.itens[0].servidor === "BLAZE", "individual: servidor correto");
  ok(corpo.itens[0].resultado === null, "individual autorizada: resultado ainda null (nao terminal)");
  ok(corpo.itens[0].vencimentoFormatado === null, "individual autorizada: sem vencimento_confirmado -> vencimentoFormatado null");
}

// ---------------------------------------------------------------------
// Token individual -- 'renovacao_concluida' (sucesso).
// ---------------------------------------------------------------------
{
  resetar();
  const tokenBruto = crypto.randomUUID();
  const tokenHash = await hashToken(tokenBruto);
  seed("tokens_renovacao", [{
    id: "tok-2",
    token_hash: tokenHash,
    conversation_id: "conv-2",
    public_id: "pub-2",
    telefone: "5517981625486",
    cliente_nome: "Cliente Teste",
    servidor_nome: "NewOne",
    plano_nome: "Mensal",
    valor_esperado_centavos: 3500,
    vencimento_atual: "2027-01-13T23:59:00-03:00",
    vencimento_confirmado: "2027-02-13T23:59:00-03:00",
    estado: "renovacao_concluida",
    criado_em: AGORA,
    expira_em: AGORA,
    grupo_id: null,
    tipo: "sigma",
  }]);

  const corpo = await (await handler(reqPost({ token: tokenBruto }))).json();
  ok(corpo.estado === "concluido", "individual concluida: estado concluido");
  ok(corpo.itens[0].resultado === "sucesso", "individual concluida: resultado sucesso");
  ok(corpo.itens[0].vencimentoFormatado === "13/02/2027 às 23:59", "individual concluida: vencimentoFormatado no formato DD/MM/AAAA às HH:mm");
}

// ---------------------------------------------------------------------
// Token individual -- 'renovacao_concluida' SEM vencimento_confirmado
// (token anterior a coluna existir, ou callback sem o campo) --
// vencimentoFormatado precisa ser null, nunca lancar excecao.
// ---------------------------------------------------------------------
{
  resetar();
  const tokenBruto = crypto.randomUUID();
  const tokenHash = await hashToken(tokenBruto);
  seed("tokens_renovacao", [{
    id: "tok-2b", token_hash: tokenHash, conversation_id: "conv-2b", public_id: "pub-2b",
    telefone: "5517981625486", cliente_nome: "Cliente Teste", servidor_nome: "BLAZE",
    plano_nome: "Mensal", valor_esperado_centavos: 3500, vencimento_atual: "2027-01-13T23:59:00-03:00",
    estado: "renovacao_concluida", criado_em: AGORA, expira_em: AGORA, grupo_id: null, tipo: "sigma",
  }]);

  const corpo = await (await handler(reqPost({ token: tokenBruto }))).json();
  ok(corpo.itens[0].resultado === "sucesso", "individual concluida sem vencimento_confirmado: resultado ainda sucesso");
  ok(corpo.itens[0].vencimentoFormatado === null, "individual concluida sem vencimento_confirmado: vencimentoFormatado null, sem excecao");
}

// ---------------------------------------------------------------------
// Token individual -- 'renovacao_falhou'.
// ---------------------------------------------------------------------
{
  resetar();
  const tokenBruto = crypto.randomUUID();
  const tokenHash = await hashToken(tokenBruto);
  seed("tokens_renovacao", [{
    id: "tok-3", token_hash: tokenHash, conversation_id: "conv-3", public_id: "pub-3",
    telefone: "5517981625486", cliente_nome: "Cliente Teste", servidor_nome: "ChannelTV",
    plano_nome: "Mensal", valor_esperado_centavos: 3500, vencimento_atual: AGORA,
    estado: "renovacao_falhou", criado_em: AGORA, expira_em: AGORA, grupo_id: null, tipo: "sigma",
  }]);

  const corpo = await (await handler(reqPost({ token: tokenBruto }))).json();
  ok(corpo.estado === "falhou", "individual falhou: estado falhou");
  ok(corpo.itens[0].resultado === "falha", "individual falhou: resultado falha");
  ok(corpo.itens[0].vencimentoFormatado === null, "individual falhou: vencimentoFormatado null");
}

// ---------------------------------------------------------------------
// Lote -- 'renovacao_em_andamento', 1 filho ja concluido e outro ainda
// em andamento (estado agregado do LOTE e' quem manda, nao os filhos).
// ---------------------------------------------------------------------
{
  resetar();
  const tokenBruto = crypto.randomUUID();
  const tokenHash = await hashToken(tokenBruto);
  seed("renovacoes_lote", [{
    grupo_id: "grupo-1",
    conversation_id: "conv-lote",
    telefone: "5517981625486",
    token_hash: tokenHash,
    estado: "renovacao_em_andamento",
    valor_total_centavos: 7000,
    regra_aplicada: "soma_valores_rocket",
    criado_em: AGORA,
    expira_em: AGORA,
  }]);
  seed("tokens_renovacao", [
    {
      id: "filho-1", token_hash: "hash-filho-1", conversation_id: "conv-lote", public_id: "pub-A",
      telefone: "5517981625486", cliente_nome: "Cliente Teste", servidor_nome: "BLAZE",
      plano_nome: "Mensal", valor_esperado_centavos: 3500, vencimento_atual: AGORA,
      vencimento_confirmado: "2027-03-08T20:59:00-03:00",
      estado: "renovacao_concluida", criado_em: AGORA, expira_em: AGORA, grupo_id: "grupo-1", tipo: "sigma",
    },
    {
      id: "filho-2", token_hash: "hash-filho-2", conversation_id: "conv-lote", public_id: "pub-B",
      telefone: "5517981625486", cliente_nome: "Cliente Teste", servidor_nome: "NewOne",
      plano_nome: "Mensal", valor_esperado_centavos: 3500, vencimento_atual: AGORA,
      estado: "renovacao_em_andamento", criado_em: AGORA, expira_em: AGORA, grupo_id: "grupo-1", tipo: "sigma",
    },
  ]);

  const corpo = await (await handler(reqPost({ token: tokenBruto }))).json();
  ok(corpo.estado === "processando_renovacao", "lote em andamento: estado processando_renovacao (do LOTE, nao do filho)");
  ok(corpo.itens.length === 2, "lote: 2 itens (1 por filho)");
  const blaze = corpo.itens.find((i) => i.servidor === "BLAZE");
  const newone = corpo.itens.find((i) => i.servidor === "NewOne");
  ok(blaze.resultado === "sucesso", "lote: filho ja concluido mostra resultado sucesso mesmo com lote ainda em andamento");
  ok(newone.resultado === null, "lote: filho ainda em andamento mostra resultado null");
  ok(blaze.vencimentoFormatado === "08/03/2027 às 20:59", "lote: filho concluido mostra vencimentoFormatado formatado");
  ok(newone.vencimentoFormatado === null, "lote: filho ainda em andamento mostra vencimentoFormatado null");
}

// ---------------------------------------------------------------------
// Lote -- 'concluida' (todos os filhos com sucesso).
// ---------------------------------------------------------------------
{
  resetar();
  const tokenBruto = crypto.randomUUID();
  const tokenHash = await hashToken(tokenBruto);
  seed("renovacoes_lote", [{
    grupo_id: "grupo-2", conversation_id: "conv-lote2", telefone: "5517981625486",
    token_hash: tokenHash, estado: "concluida", valor_total_centavos: 7000,
    regra_aplicada: "soma_valores_rocket", criado_em: AGORA, expira_em: AGORA,
  }]);
  seed("tokens_renovacao", [
    { id: "f3", token_hash: "h3", conversation_id: "conv-lote2", public_id: "pub-C", telefone: "5517981625486",
      cliente_nome: "Cliente Teste", servidor_nome: "BLAZE", plano_nome: "Mensal", valor_esperado_centavos: 3500,
      vencimento_atual: AGORA, vencimento_confirmado: "2027-03-08T20:59:00-03:00",
      estado: "renovacao_concluida", criado_em: AGORA, expira_em: AGORA, grupo_id: "grupo-2", tipo: "sigma" },
    { id: "f4", token_hash: "h4", conversation_id: "conv-lote2", public_id: "pub-D", telefone: "5517981625486",
      cliente_nome: "Cliente Teste", servidor_nome: "UNITV", plano_nome: "Mensal", valor_esperado_centavos: 3500,
      vencimento_atual: AGORA, vencimento_confirmado: "2027-04-10T12:00:00-03:00",
      estado: "renovacao_concluida", criado_em: AGORA, expira_em: AGORA, grupo_id: "grupo-2", tipo: "unitv" },
  ]);

  const corpo = await (await handler(reqPost({ token: tokenBruto }))).json();
  ok(corpo.estado === "concluido", "lote concluida: estado concluido");
  ok(corpo.itens.every((i) => i.resultado === "sucesso"), "lote concluida: todos os itens com sucesso");
  ok(corpo.itens.every((i) => typeof i.vencimentoFormatado === "string"), "lote concluida: todos os itens (sigma e unitv) com vencimentoFormatado");
}

// ---------------------------------------------------------------------
// Lote -- 'parcial'.
// ---------------------------------------------------------------------
{
  resetar();
  const tokenBruto = crypto.randomUUID();
  const tokenHash = await hashToken(tokenBruto);
  seed("renovacoes_lote", [{
    grupo_id: "grupo-3", conversation_id: "conv-lote3", telefone: "5517981625486",
    token_hash: tokenHash, estado: "parcial", valor_total_centavos: 7000,
    regra_aplicada: "soma_valores_rocket", criado_em: AGORA, expira_em: AGORA,
  }]);
  seed("tokens_renovacao", [
    { id: "f5", token_hash: "h5", conversation_id: "conv-lote3", public_id: "pub-E", telefone: "5517981625486",
      cliente_nome: "Cliente Teste", servidor_nome: "BLAZE", plano_nome: "Mensal", valor_esperado_centavos: 3500,
      vencimento_atual: AGORA, vencimento_confirmado: "2027-03-08T20:59:00-03:00",
      estado: "renovacao_concluida", criado_em: AGORA, expira_em: AGORA, grupo_id: "grupo-3", tipo: "sigma" },
    { id: "f6", token_hash: "h6", conversation_id: "conv-lote3", public_id: "pub-F", telefone: "5517981625486",
      cliente_nome: "Cliente Teste", servidor_nome: "NewOne", plano_nome: "Mensal", valor_esperado_centavos: 3500,
      vencimento_atual: AGORA, estado: "renovacao_falhou", criado_em: AGORA, expira_em: AGORA, grupo_id: "grupo-3", tipo: "sigma" },
  ]);

  const corpo = await (await handler(reqPost({ token: tokenBruto }))).json();
  ok(corpo.estado === "parcial", "lote parcial: estado parcial");
  const okItem = corpo.itens.find((i) => i.servidor === "BLAZE");
  const falhaItem = corpo.itens.find((i) => i.servidor === "NewOne");
  ok(okItem.resultado === "sucesso" && falhaItem.resultado === "falha", "lote parcial: um sucesso, um falha");
  ok(okItem.vencimentoFormatado === "08/03/2027 às 20:59", "lote parcial: item com sucesso mostra vencimentoFormatado");
  ok(falhaItem.vencimentoFormatado === null, "lote parcial: item com falha mostra vencimentoFormatado null");
}

// ---------------------------------------------------------------------
// Anti-enumeracao / entrada invalida -- tudo cai na mesma resposta
// generica, sem diferenciar o motivo.
// ---------------------------------------------------------------------
{
  resetar();
  const corpo1 = await (await handler(reqPost({ token: "token-que-nao-existe" }))).json();
  ok(corpo1.estado === "nao_encontrado", "token inexistente: resposta generica nao_encontrado");

  const corpo2 = await (await handler(reqPost({}))).json();
  ok(corpo2.estado === "nao_encontrado", "sem token no corpo: resposta generica nao_encontrado");

  const corpo3 = await (await handler(reqPost({ token: 12345 }))).json();
  ok(corpo3.estado === "nao_encontrado", "token nao-string: resposta generica nao_encontrado");

  const respGet = await handler(new Request("https://x.test/renovacao-status", { method: "GET" }));
  const corpo4 = await respGet.json();
  ok(corpo4.estado === "nao_encontrado", "metodo GET: resposta generica nao_encontrado (so' aceita POST)");

  const respCorpoInvalido = await handler(new Request("https://x.test/renovacao-status", { method: "POST", body: "{ nao e json" }));
  const corpo5 = await respCorpoInvalido.json();
  ok(corpo5.estado === "nao_encontrado", "corpo JSON invalido: resposta generica nao_encontrado, sem excecao");
}

// ---------------------------------------------------------------------
// Isolamento -- token de UMA renovacao nunca resolve dados de OUTRA
// (garantia estrutural: busca sempre por token_hash exato).
// ---------------------------------------------------------------------
{
  resetar();
  const tokenA = crypto.randomUUID();
  const tokenB = crypto.randomUUID();
  const hashA = await hashToken(tokenA);
  const hashB = await hashToken(tokenB);
  seed("tokens_renovacao", [
    { id: "a", token_hash: hashA, conversation_id: "c-a", public_id: "pub-a", telefone: "5517900000001",
      cliente_nome: "Cliente A", servidor_nome: "BLAZE", plano_nome: "Mensal", valor_esperado_centavos: 3500,
      vencimento_atual: AGORA, estado: "autorizada", criado_em: AGORA, expira_em: AGORA, grupo_id: null, tipo: "sigma" },
    { id: "b", token_hash: hashB, conversation_id: "c-b", public_id: "pub-b", telefone: "5517900000002",
      cliente_nome: "Cliente B", servidor_nome: "NewOne", plano_nome: "Mensal", valor_esperado_centavos: 3500,
      vencimento_atual: AGORA, estado: "autorizada", criado_em: AGORA, expira_em: AGORA, grupo_id: null, tipo: "sigma" },
  ]);

  const corpoA = await (await handler(reqPost({ token: tokenA }))).json();
  ok(corpoA.itens[0].servidor === "BLAZE" && corpoA.itens[0].servidor !== "NewOne", "isolamento: token A nunca devolve dado do B");
}

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
