// Testes locais de supabase/functions/_shared/renovacao_eventos.ts (REAL)
// -- Fase 3 da trilha de auditoria da Renovacao Automatica.
//
// So' o supabase_client e' fake (estado em memoria) -- renovacao_eventos.ts
// e' o modulo REAL, exatamente como usado em producao.
//
// Como rodar: npx tsx scripts/testes/renovacao_eventos/teste.mjs

import { register } from "node:module";
register("./mock-loader.mjs", import.meta.url);

const { resetar, configurarFalha, lerLinhas } = await import("./fake_supabase_client.mjs");
const { registrarEvento, sanitizarDetalhe, CATALOGO_EVENTOS } = await import(
  "../../../supabase/functions/_shared/renovacao_eventos.ts"
);

let falhas = 0;
let total = 0;
function ok(cond, msg) {
  total++;
  if (!cond) { falhas++; console.error(`FALHA: ${msg}`); }
  else console.log(`ok: ${msg}`);
}

// ---------------------------------------------------------------------
// Catalogo -- integridade estrutural.
// ---------------------------------------------------------------------
{
  const codigos = Object.keys(CATALOGO_EVENTOS);
  ok(codigos.length >= 50, `catalogo tem pelo menos 50 codigos (tem ${codigos.length})`);
  const todosValidos = codigos.every((c) => {
    const m = CATALOGO_EVENTOS[c];
    return m && typeof m.etapa === "string" && (m.nivel === "info" || m.nivel === "erro");
  });
  ok(todosValidos, "todo codigo do catalogo tem etapa (string) e nivel ('info'|'erro')");

  ok(
    CATALOGO_EVENTOS.whatsapp_legado_falhou.nivel === "info",
    "whatsapp_legado_falhou e' nivel info (Wasender desativado -- falha de envio nao e' falha da renovacao)",
  );
  ok(
    CATALOGO_EVENTOS.identificacao_nao_encontrada.nivel === "info",
    "identificacao_nao_encontrada e' info (desfecho normal, nao falha de infra)",
  );
  ok(
    CATALOGO_EVENTOS.identificacao_rocket_indisponivel.nivel === "erro",
    "identificacao_rocket_indisponivel e' erro (falha real de infra, distinta de nao encontrado)",
  );
}

// ---------------------------------------------------------------------
// sanitizarDetalhe -- campos proibidos e truncamento.
// ---------------------------------------------------------------------
{
  const limpo = sanitizarDetalhe({
    senha: "abc123",
    password: "abc123",
    token_bruto: "uuid-secreto",
    tokenBruto: "uuid-secreto",
    qrCodeTexto: "00020126...",
    qr_code: "00020126...",
    brCode: "00020126...",
    cookie: "sessionid=abc",
    sessionid: "abc",
    csrftoken: "xyz",
    chave: "algo",
    api_key: "sk-...",
    apikey: "sk-...",
    service_role_key: "eyJ...",
    dealer_token: "eyJ...",
    Authorization: "Bearer eyJ...",
    algum_secret: "x",
    token_id: "uuid-1234", // NAO deve ser removido -- excecao explicita no regex
    plano: "Trimestral",
    valor_centavos: 9000,
  });

  ok(Object.keys(limpo).length === 3, `sanitizarDetalhe mantem so' os campos permitidos (tem ${JSON.stringify(limpo)})`);
  ok(limpo.token_id === "uuid-1234", "sanitizarDetalhe preserva token_id (excecao explicita ao filtro de 'token')");
  ok(limpo.plano === "Trimestral", "sanitizarDetalhe preserva campo de negocio (plano)");
  ok(limpo.valor_centavos === 9000, "sanitizarDetalhe preserva campo de negocio (valor_centavos)");
  ok(limpo.senha === undefined, "sanitizarDetalhe remove senha");
  ok(limpo.qrCodeTexto === undefined, "sanitizarDetalhe remove qrCodeTexto");
  ok(limpo.Authorization === undefined, "sanitizarDetalhe remove Authorization");

  const longa = "x".repeat(600);
  const truncado = sanitizarDetalhe({ motivo: longa });
  ok(truncado.motivo.length < longa.length, "sanitizarDetalhe trunca string longa");
  ok(truncado.motivo.endsWith("...(truncado)"), "sanitizarDetalhe marca string truncada");

  ok(Object.keys(sanitizarDetalhe(undefined)).length === 0, "sanitizarDetalhe(undefined) devolve objeto vazio, nao lanca");
  ok(Object.keys(sanitizarDetalhe(null)).length === 0, "sanitizarDetalhe(null) devolve objeto vazio, nao lanca");
}

// ---------------------------------------------------------------------
// registrarEvento -- insert bem-sucedido, individual (tokenId).
// ---------------------------------------------------------------------
{
  resetar();
  await registrarEvento({
    codigo: "carrinho_token_criado",
    origem: "renovacao-iniciar",
    tokenId: "tok-1",
    detalhe: { plano: "Trimestral", valor_centavos: 9000, senha: "nao_deveria_ir" },
  });
  const linhas = lerLinhas();
  ok(linhas.length === 1, "registrarEvento grava 1 linha");
  ok(linhas[0].codigo === "carrinho_token_criado", "grava o codigo correto");
  ok(linhas[0].etapa === "carrinho", "deriva a etapa do catalogo, nao do chamador");
  ok(linhas[0].nivel === "info", "deriva o nivel do catalogo, nao do chamador");
  ok(linhas[0].token_id === "tok-1", "grava token_id");
  ok(linhas[0].grupo_id === null, "grupo_id null quando nao e' lote");
  ok(linhas[0].sessao_id === null, "sessao_id null quando nao informado");
  ok(linhas[0].detalhe.senha === undefined, "detalhe sanitizado antes de gravar (senha removida)");
  ok(linhas[0].detalhe.plano === "Trimestral", "detalhe preserva campo de negocio");
}

// ---------------------------------------------------------------------
// registrarEvento -- filho de lote grava token_id E grupo_id juntos.
// ---------------------------------------------------------------------
{
  resetar();
  await registrarEvento({
    codigo: "processamento_iniciado",
    origem: "renovacao-sigma-workflow",
    tokenId: "tok-filho-1",
    grupoId: "grupo-1",
    servidor: "sigma",
  });
  const linhas = lerLinhas();
  ok(linhas[0].token_id === "tok-filho-1" && linhas[0].grupo_id === "grupo-1", "filho de lote grava token_id e grupo_id juntos");
  ok(linhas[0].servidor === "sigma", "grava servidor quando informado");
}

// ---------------------------------------------------------------------
// registrarEvento -- pre-token, so' sessaoId.
// ---------------------------------------------------------------------
{
  resetar();
  await registrarEvento({ codigo: "portal_acessado", origem: "renovacao-iniciar", sessaoId: "sessao-1" });
  const linhas = lerLinhas();
  ok(linhas.length === 1 && linhas[0].sessao_id === "sessao-1", "evento pre-token grava so' com sessaoId");
  ok(linhas[0].token_id === null && linhas[0].grupo_id === null, "sem token_id/grupo_id no evento pre-token");
}

// ---------------------------------------------------------------------
// registrarEvento -- nunca lanca, mesmo em cenario invalido/de erro.
// ---------------------------------------------------------------------
{
  resetar();
  let lancou = false;
  try {
    // codigo inexistente no catalogo.
    await registrarEvento({ codigo: "codigo_que_nao_existe", origem: "teste", tokenId: "tok-x" });
  } catch {
    lancou = true;
  }
  ok(!lancou, "registrarEvento nao lanca para codigo desconhecido");
  ok(lerLinhas().length === 0, "codigo desconhecido nao grava linha nenhuma");
}
{
  resetar();
  let lancou = false;
  try {
    // sem nenhuma correlacao (nem sessaoId, nem tokenId, nem grupoId).
    await registrarEvento({ codigo: "portal_acessado", origem: "teste" });
  } catch {
    lancou = true;
  }
  ok(!lancou, "registrarEvento nao lanca quando falta toda correlacao");
  ok(lerLinhas().length === 0, "evento sem correlacao nao grava linha nenhuma");
}
{
  resetar();
  configurarFalha("erro_banco");
  let lancou = false;
  try {
    await registrarEvento({ codigo: "pagamento_confirmado", origem: "openpix-webhook", operacaoId: "op-1", tokenId: "tok-1" });
  } catch {
    lancou = true;
  }
  ok(!lancou, "registrarEvento nao lanca quando o insert falha no banco (erro simulado)");
}
{
  resetar();
  configurarFalha("trava");
  const inicio = Date.now();
  let lancou = false;
  try {
    await registrarEvento({ codigo: "pagamento_confirmado", origem: "openpix-webhook", operacaoId: "op-1", tokenId: "tok-1" });
  } catch {
    lancou = true;
  }
  const duracaoMs = Date.now() - inicio;
  ok(!lancou, "registrarEvento nao lanca quando o insert trava (timeout)");
  ok(duracaoMs < 4000, `registrarEvento respeita o timeout de 3s em vez de travar pra sempre (levou ${duracaoMs}ms)`);
}

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
