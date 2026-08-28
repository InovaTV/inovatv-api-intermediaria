// Testes locais das mensagens de apresentacao da renovacao (ajuste
// de UX, 2026-08-28, inovatv_central/CLAUDE.md) -- funcoes puras de
// _shared/mensagens_fixas.ts, importadas reais, sem mock (o arquivo
// nao usa Deno.env nem I/O nenhum).
//
// Cobre so' as mensagens 2 (proposta de renovacao) e 3 (pagamento
// Pix) -- a mensagem 1 (listagem de multiplos acessos) fica de fora
// desta rodada porque nao e' construida por nenhuma funcao fixa aqui
// (e' texto gerado pelo Gemini a partir do contexto, ver relatorio
// desta sessao) -- pendente de decisao de arquitetura separada.
//
// Como rodar: npx tsx scripts/testes/mensagens_renovacao_apresentacao/teste.mjs

import {
  montarMensagemBotoesConfirmacaoRenovacao,
  montarMensagemPixRenovacao,
} from "../../../supabase/functions/_shared/mensagens_fixas.ts";

let falhas = 0;
function ok(condicao, mensagem) {
  if (!condicao) {
    falhas++;
    console.error(`FALHA: ${mensagem}`);
  } else {
    console.log(`ok: ${mensagem}`);
  }
}

// --- Mensagem 2: proposta de renovacao (dados empilhados, com usuario) ---
{
  const texto = montarMensagemBotoesConfirmacaoRenovacao({
    clienteNome: "Meu Uso Testes",
    usuario: "828667229",
    servidorNome: "BLAZE",
    planoNome: "Mensal",
    valorFormatado: "35,00",
    vencimentoFormatado: "13/09/2026",
  });

  const linhas = texto.split("\n");

  ok(texto.includes("*Cliente:* Meu Uso Testes"), "Msg2: campo Cliente presente e em negrito");
  ok(texto.includes("*Usuário:* 828667229"), "Msg2: usuario REAL aparece na mensagem (nao fictício)");
  ok(texto.includes("*Servidor:* BLAZE"), "Msg2: campo Servidor presente");
  ok(texto.includes("*Plano:* Mensal"), "Msg2: campo Plano presente");
  ok(texto.includes("*Valor:* R$ 35,00"), "Msg2: campo Valor presente, formatado em reais");
  ok(texto.includes("*Vencimento atual:* 13/09/2026"), "Msg2: campo Vencimento atual presente");

  // "Empilhado" = cada campo em sua propria linha, nunca corridos na
  // mesma linha separados por espaco/virgula.
  const idxCliente = linhas.findIndex((l) => l.startsWith("*Cliente:*"));
  const idxUsuario = linhas.findIndex((l) => l.startsWith("*Usuário:*"));
  const idxServidor = linhas.findIndex((l) => l.startsWith("*Servidor:*"));
  const idxPlano = linhas.findIndex((l) => l.startsWith("*Plano:*"));
  const idxValor = linhas.findIndex((l) => l.startsWith("*Valor:*"));
  const idxVencimento = linhas.findIndex((l) => l.startsWith("*Vencimento atual:*"));

  ok(
    [idxCliente, idxUsuario, idxServidor, idxPlano, idxValor, idxVencimento].every((i) => i !== -1),
    "Msg2: os 6 campos aparecem cada um em sua propria linha (formato empilhado)",
  );
  ok(
    idxCliente < idxUsuario && idxUsuario < idxServidor && idxServidor < idxPlano &&
      idxPlano < idxValor && idxValor < idxVencimento,
    "Msg2: ordem correta -- Cliente, Usuario, Servidor, Plano, Valor, Vencimento atual",
  );
}

// --- Mensagem 2: usuario ausente vira texto honesto, nunca inventado ---
{
  const texto = montarMensagemBotoesConfirmacaoRenovacao({
    clienteNome: "Cliente Teste",
    usuario: "não informado",
    servidorNome: "NewOne",
    planoNome: "Mensal",
    valorFormatado: "35,00",
    vencimentoFormatado: "08/12/2026",
  });
  ok(
    texto.includes("*Usuário:* não informado") && !/\*Usuário:\*\s*(undefined|null|\[object)/.test(texto),
    "Msg2: usuario ausente mostra texto honesto, nunca 'undefined'/'null'/valor fictício",
  );
}

// --- Mensagem 3: pagamento Pix (linguagem simples + codigo integral) ---
{
  const codigoPixReal =
    "00020126580014BR.GOV.BCB.PIX0136a1b2c3d4-e5f6-7890-abcd-ef1234567890520400005303986540535.005802BR5913INOVATV LTDA6009SAO PAULO62070503***6304ABCD";
  const texto = montarMensagemPixRenovacao("35,00", codigoPixReal);

  ok(texto.includes("PAGAMENTO DA RENOVAÇÃO"), "Msg3: titulo presente");
  ok(texto.includes("*Valor: R$ 35,00*"), "Msg3: valor em destaque");
  ok(texto.includes("PIX Copia e Cola"), "Msg3: explica em linguagem simples como pagar (Copia e Cola)");
  ok(texto.includes("não precisa enviar o comprovante"), "Msg3: informa que nao precisa enviar comprovante");
  ok(texto.includes("processada automaticamente"), "Msg3: informa que a renovacao e' automatica apos confirmacao");

  // O requisito mais critico: o codigo Pix tem que estar EXATAMENTE
  // igual ao payload recebido -- nunca truncado, resumido ou alterado.
  ok(texto.includes(codigoPixReal), "Msg3: codigo Pix aparece exatamente igual ao payload (integral)");
  const linhaComCodigo = texto.split("\n").find((l) => l === codigoPixReal);
  ok(!!linhaComCodigo, "Msg3: codigo Pix ocupa sua propria linha, sem texto extra colado");
  ok(
    !texto.includes(codigoPixReal.slice(0, 20) + "...") && !texto.includes("…"),
    "Msg3: codigo Pix nao foi truncado com reticencias",
  );
}

// --- Mensagem 3: um codigo Pix diferente continua preservado integralmente ---
// (garante que nao ha' nenhuma logica escondida de tamanho fixo/corte)
{
  const codigoPixCurto = "PIXTESTECURTO123";
  const codigoPixLongo = "PIX" + "X".repeat(300);
  const t1 = montarMensagemPixRenovacao("10,00", codigoPixCurto);
  const t2 = montarMensagemPixRenovacao("10,00", codigoPixLongo);
  ok(t1.includes(codigoPixCurto), "Msg3: codigo curto preservado integralmente");
  ok(t2.includes(codigoPixLongo), "Msg3: codigo longo (300+ chars) preservado integralmente, sem corte");
}

console.log(`\n${falhas === 0 ? "TODOS OS TESTES PASSARAM" : `${falhas} FALHA(S)`}`);
process.exit(falhas === 0 ? 0 : 1);
