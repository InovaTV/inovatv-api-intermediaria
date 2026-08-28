// Testes locais das mensagens de apresentacao da renovacao -- bloco de
// UX de renovacao (2026-08-28, inovatv_central/CLAUDE.md, C1-C5).
// Funcoes puras de _shared/mensagens_fixas.ts, importadas reais, sem
// mock (o arquivo nao usa Deno.env nem I/O nenhum).
//
// Cobre:
//   C1 -> montarMensagemPixRenovacao       (PIX numa unica mensagem,
//         BR Code em bloco de codigo, byte a byte)
//   C2 -> montarMensagemBotoesConfirmacaoRenovacao (proposta, 6 campos)
//   C3 (formato reaproveitado) -> montarMensagemMultiplosAcessosRenovacao
//   C4 -> montarTextoConfirmacaoPagamentoRenovacao (molde do template,
//         so' pra persistir no historico do Painel)
//
// Como rodar: npx tsx scripts/testes/mensagens_renovacao_apresentacao/teste.mjs

import {
  montarMensagemBotoesConfirmacaoRenovacao,
  montarMensagemPixRenovacao,
  montarMensagemMultiplosAcessosRenovacao,
  montarTextoConfirmacaoPagamentoRenovacao,
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

// =====================================================================
// C2 -- proposta de renovacao (6 campos, so' formatacao mudou)
// =====================================================================
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

  ok(texto.includes("*Confira os dados da sua renovação*"), "C2: cabecalho novo presente");
  ok(texto.includes("*Cliente:* Meu Uso Testes"), "C2: campo Cliente presente e em negrito");
  ok(texto.includes("*Usuário:* 828667229"), "C2: usuario REAL aparece (nao ficticio)");
  ok(texto.includes("*Servidor:* BLAZE"), "C2: campo Servidor presente");
  ok(texto.includes("*Plano:* Mensal"), "C2: campo Plano presente");
  ok(texto.includes("*Valor:* R$ 35,00"), "C2: campo Valor presente, formatado em reais");
  ok(texto.includes("*Vencimento atual:* 13/09/2026"), "C2: campo Vencimento atual presente");
  ok(texto.includes("ACEITO") && texto.includes("CANCELAR"), "C2: instrucao dos botoes ACEITO/CANCELAR");
  ok(texto.length <= 1024, "C2: corpo cabe no limite de 1024 chars do interactive.button");

  // Cada campo em sua propria linha, na ordem certa (rotulo pode ter
  // prefixo de emoji -- checamos por includes, nao startsWith).
  const idx = (rotulo) => linhas.findIndex((l) => l.includes(rotulo));
  const iCliente = idx("*Cliente:*");
  const iUsuario = idx("*Usuário:*");
  const iServidor = idx("*Servidor:*");
  const iPlano = idx("*Plano:*");
  const iValor = idx("*Valor:*");
  const iVenc = idx("*Vencimento atual:*");
  ok(
    [iCliente, iUsuario, iServidor, iPlano, iValor, iVenc].every((i) => i !== -1),
    "C2: os 6 campos aparecem cada um em sua propria linha",
  );
  ok(
    iCliente < iUsuario && iUsuario < iServidor && iServidor < iPlano &&
      iPlano < iValor && iValor < iVenc,
    "C2: ordem -- Cliente, Usuario, Servidor, Plano, Valor, Vencimento atual",
  );
}

// C2 -- usuario ausente vira texto honesto, nunca inventado
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
    texto.includes("*Usuário:* não informado") &&
      !/\*Usuário:\*\s*(undefined|null|\[object)/.test(texto),
    "C2: usuario ausente mostra texto honesto, nunca 'undefined'/'null'/ficticio",
  );
}

// =====================================================================
// C1 -- PIX numa unica mensagem, BR Code em bloco de codigo, byte a byte
// =====================================================================
function checarPix(rotulo, valor, codigo) {
  const texto = montarMensagemPixRenovacao(valor, codigo);
  const linhas = texto.split("\n");

  ok(texto.includes("💳 *PAGAMENTO DA RENOVAÇÃO*"), `${rotulo}: titulo presente`);
  ok(texto.includes(`*Valor:* R$ ${valor}`), `${rotulo}: valor no formato novo`);
  ok(texto.includes("📱 *Como pagar*"), `${rotulo}: secao 'Como pagar' presente`);
  ok(
    texto.includes("Abra o aplicativo do seu banco.") &&
      texto.includes("Escolha PIX.") &&
      texto.includes("Escolha PIX Copia e Cola.") &&
      texto.includes("Cole o código abaixo."),
    `${rotulo}: os 4 passos de pagamento presentes`,
  );
  ok(texto.includes("não é necessário enviar o comprovante".toLowerCase()) ||
    texto.includes("Não é necessário enviar o comprovante"), `${rotulo}: dispensa comprovante`);
  ok(texto.includes("processada automaticamente"), `${rotulo}: renovacao automatica apos confirmacao`);

  // O codigo aparece EXATAMENTE UMA VEZ, byte a byte.
  const ocorrencias = texto.split(codigo).length - 1;
  ok(ocorrencias === 1, `${rotulo}: BR Code aparece exatamente 1 vez, sem alteracao`);

  // Disciplina de fence: a linha do codigo e' precedida e seguida por
  // uma linha que e' SO' as tres crases.
  const iCodigo = linhas.indexOf(codigo);
  ok(iCodigo > 0, `${rotulo}: BR Code ocupa uma linha propria`);
  ok(linhas[iCodigo - 1] === "```", `${rotulo}: linha anterior ao codigo e' a abertura do bloco`);
  ok(linhas[iCodigo + 1] === "```", `${rotulo}: linha seguinte ao codigo e' o fechamento do bloco`);

  ok(!texto.includes("…") && !texto.includes(codigo.slice(0, 20) + "..."), `${rotulo}: BR Code nao truncado`);
  ok(texto.length < 4096, `${rotulo}: mensagem inteira cabe no limite de 4096 chars da Cloud API`);
}

checarPix(
  "C1(real)",
  "35,00",
  "00020126580014BR.GOV.BCB.PIX0136a1b2c3d4-e5f6-7890-abcd-ef1234567890520400005303986540535.005802BR5913INOVATV LTDA6009SAO PAULO62070503***6304ABCD",
);
// BR Code longo (400 chars) -- garante que nao ha' logica de tamanho fixo/corte
checarPix("C1(400 chars)", "10,00", "000201" + "A".repeat(394));
// BR Code com caracteres tipo base64 (+ / =) -- nada de escape
checarPix("C1(base64-like)", "10,00", "000201aB+cD/eF=gH+iJ/kL=mN0304ABCD");

// C1 -- o BR Code nunca contem crases (senao quebraria o bloco). Defensivo.
{
  const codigo = "00020101021226990304ABCD";
  const texto = montarMensagemPixRenovacao("1,00", codigo);
  ok(!codigo.includes("```"), "C1: BR Code de teste nao contem crases (pre-condicao)");
  ok(texto.split("```").length - 1 === 2, "C1: exatamente 2 marcadores de bloco (abre + fecha)");
}

// =====================================================================
// C3 (formato) -- montarMensagemMultiplosAcessosRenovacao
// =====================================================================
const SEP = "─────────────────";
function checarLista(rotulo, acessos) {
  const texto = montarMensagemMultiplosAcessosRenovacao(acessos);
  const linhas = texto.split("\n");

  acessos.forEach((a, i) => {
    ok(texto.includes(`*${i + 1}. ${a.nome}*`), `${rotulo}: bloco ${i + 1} -- titulo numerado em negrito`);
    ok(texto.includes(`Usuário: ${a.usuario}`), `${rotulo}: bloco ${i + 1} -- Usuario`);
    ok(texto.includes(`Servidor: ${a.servidorNome}`), `${rotulo}: bloco ${i + 1} -- Servidor`);
    ok(texto.includes(`Plano: ${a.planoNome}`), `${rotulo}: bloco ${i + 1} -- Plano`);
    // Sem linha em branco entre o titulo numerado e "Usuário:".
    const iTitulo = linhas.indexOf(`*${i + 1}. ${a.nome}*`);
    ok(linhas[iTitulo + 1] === `Usuário: ${a.usuario}`, `${rotulo}: bloco ${i + 1} -- Usuario logo apos o titulo, sem linha vazia`);
  });

  const sepCount = texto.split(SEP).length - 1;
  ok(sepCount === acessos.length - 1, `${rotulo}: separador entre blocos, nunca apos o ultimo (${sepCount})`);
  ok(texto.trim().endsWith("Qual desses acessos você gostaria de renovar?"), `${rotulo}: termina com a pergunta de escolha`);
}
checarLista("C3(2 acessos)", [
  { nome: "Meu Uso Testes", usuario: "828667229", servidorNome: "BLAZE", planoNome: "Mensal" },
  { nome: "Js Informática Rp", usuario: "112233", servidorNome: "NewOne", planoNome: "Mensal" },
]);
checarLista("C3(3 acessos)", [
  { nome: "A", usuario: "1", servidorNome: "S1", planoNome: "Mensal" },
  { nome: "B", usuario: "2", servidorNome: "S2", planoNome: "Anual" },
  { nome: "C", usuario: "3", servidorNome: "S3", planoNome: "Semestral" },
]);
// Campo ausente -> "não informado", nunca undefined/null
{
  const texto = montarMensagemMultiplosAcessosRenovacao([
    { nome: "X", usuario: "não informado", servidorNome: "não informado", planoNome: "não informado" },
    { nome: "Y", usuario: "9", servidorNome: "S", planoNome: "Mensal" },
  ]);
  ok(
    texto.includes("Usuário: não informado") && !/(undefined|null|\[object)/.test(texto),
    "C3: campo ausente vira 'não informado', nunca undefined/null",
  );
}

// =====================================================================
// C4 -- molde do texto de confirmacao (so' pra historico do Painel)
// =====================================================================
{
  const texto = montarTextoConfirmacaoPagamentoRenovacao({
    clienteNome: "Meu Uso Testes",
    planoNome: "Mensal",
    servidorNome: "BLAZE",
    vencimentoFormatado: "14/10/2026",
  });
  ok(texto.startsWith("✅ Pagamento confirmado!"), "C4: comeca com o titulo aprovado");
  ok(texto.includes("Olá,Meu Uso Testes!"), "C4: espelha o corpo aprovado byte a byte (sem espaco apos 'Olá,')");
  ok(texto.includes("📋 Plano:Mensal"), "C4: espelha 'Plano:' sem espaco, como aprovado");
  ok(texto.includes("🖥️ Servidor:BLAZE"), "C4: espelha 'Servidor:' sem espaco");
  ok(texto.includes("📅 Novo vencimento:14/10/2026"), "C4: vencimento formatado no lugar certo");
  ok(texto.includes("InovaTV — Sempre pensando em você! 📺"), "C4: assinatura final presente");
}

console.log(`\n${falhas === 0 ? "TODOS OS TESTES PASSARAM" : `${falhas} FALHA(S)`}`);
process.exit(falhas === 0 ? 0 : 1);
