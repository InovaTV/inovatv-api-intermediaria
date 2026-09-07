// Suite: renovacao_wasender_confirmacao (2026-09-07).
//
// Alvo: _shared/renovacao_wasender_resolver.ts, apos remover o gate
// `conversas_estado.intencao_atual === "renovacao"` no caso de
// CANDIDATO UNICO. Com exatamente 1 token/lote 'aguardando_confirmacao',
// "1" = ACEITO e "2" = CANCELAR sao aceitos direto. A protecao para
// 2+ candidatos, a resposta composta e o fluxo de PALAVRA continuam
// exatamente como antes.
//
// Roda o modulo REAL (via mock-loader.mjs). So' supabase_client.ts e
// renovacoes_lote.ts sao fakes; telefone.ts e mensagens_fixas.ts (puros)
// sao reais. Nenhuma cobranca, nenhum Woovi/OpenPix, nenhuma renovacao.
//
// Como rodar: npx tsx scripts/testes/renovacao_wasender_confirmacao/teste.mjs

import { register } from "node:module";
register("./mock-loader.mjs", import.meta.url);

const DB = await import("./fake_supabase_client.mjs");
const { resolverRoteamentoConfirmacaoRenovacao } = await import(
  "../../../supabase/functions/_shared/renovacao_wasender_resolver.ts"
);

const TEL = "5511999998888"; // 13 digitos, comeca com 55 -> normalizarTelefone devolve igual
const H_TK = "1".repeat(64); // token_hash do candidato individual (64 hex)
const H_LOTE = "3".repeat(64); // token_hash da linha-capa do lote (64 hex)

function tokenPendente(hash, extra = {}) {
  return {
    telefone: TEL,
    estado: "aguardando_confirmacao",
    grupo_id: null,
    token_hash: hash,
    conversation_id: "conv-1",
    public_id: "pub-1",
    criado_em: "2026-09-07T22:40:45.000Z",
    cliente_nome: "Cliente Teste",
    servidor_nome: "BLAZE",
    plano_nome: "Mensal",
    valor_esperado_centavos: 3500,
    vencimento_atual: "2026-11-13T20:59:00-03:00",
    ...extra,
  };
}
function lotePendente(hash, extra = {}) {
  return {
    telefone: TEL,
    estado: "aguardando_confirmacao",
    grupo_id: "grp-1",
    token_hash: hash,
    conversation_id: "conv-1",
    // depois do token -> na ordenacao (criado_em asc) o TOKEN e' a posicao 1
    criado_em: "2026-09-07T22:41:00.000Z",
    valor_total_centavos: 7000,
    ...extra,
  };
}

let falhas = 0;
let total = 0;
function ok(cond, msg) {
  total++;
  if (cond) {
    console.log("ok:", msg);
  } else {
    falhas++;
    console.error("FALHA:", msg);
  }
}
const j = (v) => JSON.stringify(v);

// ── 1. 1 acesso + token aguardando_confirmacao + "1" -> aceitar ────────
{
  DB._seed({ tokens_renovacao: [tokenPendente(H_TK)] });
  const r = await resolverRoteamentoConfirmacaoRenovacao(TEL, "1");
  ok(
    r.outcome === "roteado" &&
      r.telefone === TEL &&
      r.buttonReplyId === `renovacao:aceitar:${H_TK}`,
    `C1: 1 candidato + "1" -> roteado ACEITO  (${j(r)})`,
  );
}

// ── 2. 1 acesso + token aguardando_confirmacao + "2" -> cancelar ───────
{
  DB._seed({ tokens_renovacao: [tokenPendente(H_TK)] });
  const r = await resolverRoteamentoConfirmacaoRenovacao(TEL, "2");
  ok(
    r.outcome === "roteado" && r.buttonReplyId === `renovacao:cancelar:${H_TK}`,
    `C2: 1 candidato + "2" -> roteado CANCELAR  (${j(r)})`,
  );
}

// ── 3. 1 acesso + palavra ACEITO -> continua funcionando ──────────────
{
  DB._seed({ tokens_renovacao: [tokenPendente(H_TK)] });
  const r1 = await resolverRoteamentoConfirmacaoRenovacao(TEL, "ACEITO");
  ok(
    r1.outcome === "roteado" && r1.buttonReplyId === `renovacao:aceitar:${H_TK}`,
    `C3a: 1 candidato + "ACEITO" -> roteado ACEITO  (${j(r1)})`,
  );
  DB._seed({ tokens_renovacao: [tokenPendente(H_TK)] });
  const r2 = await resolverRoteamentoConfirmacaoRenovacao(TEL, "  aceito  ");
  ok(
    r2.outcome === "roteado" && r2.buttonReplyId === `renovacao:aceitar:${H_TK}`,
    `C3b: 1 candidato + "  aceito  " (trim/lowercase) -> roteado ACEITO  (${j(r2)})`,
  );
}

// ── 4. 1 acesso + palavra CANCELAR -> continua funcionando ────────────
{
  DB._seed({ tokens_renovacao: [tokenPendente(H_TK)] });
  const r = await resolverRoteamentoConfirmacaoRenovacao(TEL, "CANCELAR");
  ok(
    r.outcome === "roteado" && r.buttonReplyId === `renovacao:cancelar:${H_TK}`,
    `C4: 1 candidato + "CANCELAR" -> roteado CANCELAR  (${j(r)})`,
  );
}

// ── 5. 2+ candidatos + "1" (digito puro) -> proteccao preservada ──────
{
  DB._seed({
    tokens_renovacao: [tokenPendente(H_TK)],
    renovacoes_lote: [lotePendente(H_LOTE)],
  });
  const r = await resolverRoteamentoConfirmacaoRenovacao(TEL, "1");
  ok(
    r.outcome === "resposta_nao_reconhecida",
    `C5: 2 candidatos + "1" (digito puro) -> resposta_nao_reconhecida (nao intercepta)  (${j(r)})`,
  );
}

// ── 6. nenhum token pendente + "1" -> nao reconhecer como confirmacao ─
{
  DB._seed({});
  const r = await resolverRoteamentoConfirmacaoRenovacao(TEL, "1");
  ok(
    r.outcome === "sem_pendencia",
    `C6: 0 candidatos + "1" -> sem_pendencia (webhook repassa ao orquestrador, como hoje)  (${j(r)})`,
  );
}

// ── 7. (regressao) 1 candidato + "1 ACEITO" (composta) -> nao intercepta
{
  DB._seed({ tokens_renovacao: [tokenPendente(H_TK)] });
  const r = await resolverRoteamentoConfirmacaoRenovacao(TEL, "1 ACEITO");
  ok(
    r.outcome === "resposta_nao_reconhecida",
    `C7: 1 candidato + "1 ACEITO" (composta sem lista apresentada) -> resposta_nao_reconhecida (inalterado)  (${j(r)})`,
  );
}

// ── 8. (regressao) 2+ candidatos + "1 ACEITO" (composta) -> roteia #1 ─
{
  DB._seed({
    tokens_renovacao: [tokenPendente(H_TK)], // criado_em mais antigo -> posicao 1
    renovacoes_lote: [lotePendente(H_LOTE)],
  });
  const r = await resolverRoteamentoConfirmacaoRenovacao(TEL, "1 ACEITO");
  ok(
    r.outcome === "roteado" && r.buttonReplyId === `renovacao:aceitar:${H_TK}`,
    `C8: 2 candidatos + "1 ACEITO" -> roteado ACEITO no candidato ordenado #1 (o token)  (${j(r)})`,
  );
}

// ── 9. (regressao) 2+ candidatos + palavra "aceito" -> apresentar_opcoes
{
  DB._seed({
    tokens_renovacao: [tokenPendente(H_TK)],
    renovacoes_lote: [lotePendente(H_LOTE)],
  });
  const r = await resolverRoteamentoConfirmacaoRenovacao(TEL, "aceito");
  ok(
    r.outcome === "apresentar_opcoes" &&
      r.telefone === TEL &&
      typeof r.mensagem === "string" &&
      r.mensagem.length > 0,
    `C9: 2 candidatos + "aceito" (palavra pura) -> apresentar_opcoes com mensagem (inalterado)  (${j({ outcome: r.outcome, telefone: r.telefone, temMensagem: typeof r.mensagem })})`,
  );
}

// ── 10. 1 candidato + "1" COM intencao_atual="renovacao" -> ainda roteia
//        (prova: remover o gate nao quebra o caso que ja funcionava; e o
//         resolver nem le mais conversas_estado)
{
  DB._seed({
    tokens_renovacao: [tokenPendente(H_TK)],
    conversas_estado: [{ telefone: TEL, intencao_atual: "renovacao" }],
  });
  const r = await resolverRoteamentoConfirmacaoRenovacao(TEL, "1");
  ok(
    r.outcome === "roteado" && r.buttonReplyId === `renovacao:aceitar:${H_TK}`,
    `C10: 1 candidato + "1" (com intencao_atual=renovacao) -> roteado ACEITO  (${j(r)})`,
  );
}

// ── 11. (regressao) 1 candidato + texto qualquer "oi" -> nao reconhece ─
{
  DB._seed({ tokens_renovacao: [tokenPendente(H_TK)] });
  const r = await resolverRoteamentoConfirmacaoRenovacao(TEL, "oi");
  ok(
    r.outcome === "resposta_nao_reconhecida",
    `C11: 1 candidato + "oi" -> resposta_nao_reconhecida (inalterado)  (${j(r)})`,
  );
}

console.log(`\nResultado: ${total - falhas}/${total} passando`);
process.exit(falhas === 0 ? 0 : 1);
