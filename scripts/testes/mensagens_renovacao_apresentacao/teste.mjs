// Testes locais das mensagens de apresentacao da renovacao -- bloco de
// UX de renovacao (2026-08-28, inovatv_central/CLAUDE.md, C1-C5).
// Funcoes puras de _shared/mensagens_fixas.ts, importadas reais, sem
// mock (o arquivo nao usa Deno.env nem I/O nenhum).
//
// Cobre:
//   C1 -> montarMensagemPixRenovacao       (mensagem curta com o LINK
//         da pagina de pagamento da Woovi -- NUNCA mais o BR Code no
//         corpo, sem bloco de codigo, sem QR no WhatsApp)
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
  montarMensagemConfirmacaoLote,
  montarMensagemResultadoLote,
  MENSAGEM_RENOVACAO_UNITV_NAO_INTEGRADA,
  MENSAGEM_RENOVACAO_LOTE_COM_UNITV,
  MENSAGEM_RENOVACAO_UNITV_INSTABILIDADE,
  MENSAGEM_RENOVACAO_UNITV_NAO_IDENTIFICADO,
  MENSAGEM_RENOVACAO_LOTE_UNITV_INSTABILIDADE,
  MENSAGEM_RENOVACAO_LOTE_UNITV_NAO_IDENTIFICADO,
  MENSAGEM_RENOVACAO_INSTABILIDADE,
  mensagemFalhaResolucaoUnitv,
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
// C1 -- PIX curto com o LINK da pagina da Woovi. NUNCA mais o BR Code
// no corpo, sem bloco de codigo, sem QR dentro do WhatsApp.
// =====================================================================
// Layout final aprovado (2026-08-29). O 2o parametro e' a LINHA do 📦
// ja montada pelo chamador ("Plano: Mensal" no individual, "2 acessos"
// no lote) -- este teste passa a linha completa, como producao.
function checarPix(rotulo, valor, linhaPacote, link) {
  const texto = montarMensagemPixRenovacao(valor, linhaPacote, link);
  const linhas = texto.split("\n");

  ok(texto.includes("💳 *PAGAMENTO DA RENOVAÇÃO*"), `${rotulo}: titulo presente`);
  ok(texto.includes(`💰 Valor: R$ ${valor}`), `${rotulo}: valor presente`);
  ok(texto.includes(`📦 ${linhaPacote}`), `${rotulo}: linha do pacote presente (montada pelo chamador)`);
  ok(texto.includes("👇 Toque no link abaixo para realizar o pagamento."), `${rotulo}: instrucao de pagamento`);
  ok(texto.includes("🔗 PAGAR RENOVAÇÃO"), `${rotulo}: rotulo do link presente`);
  ok(
    texto.includes("Não é necessário enviar o comprovante") &&
      texto.includes("sua renovação será processada automaticamente"),
    `${rotulo}: dispensa comprovante + renovacao automatica`,
  );

  // O link aparece EXATAMENTE UMA VEZ, byte a byte, em sua propria
  // linha, LOGO APOS "🔗 PAGAR RENOVAÇÃO" (nao mais a ultima linha do
  // corpo -- o ✅/🔄 vem depois, layout final aprovado).
  ok(texto.split(link).length - 1 === 1, `${rotulo}: link aparece exatamente 1 vez, sem alteracao`);
  const iRotulo = linhas.indexOf("🔗 PAGAR RENOVAÇÃO");
  ok(iRotulo !== -1 && linhas[iRotulo + 1] === link, `${rotulo}: link vem imediatamente apos o rotulo, em linha propria`);
  ok(linhas.indexOf("✅ Não é necessário enviar o comprovante.") > iRotulo, `${rotulo}: dispensa de comprovante vem DEPOIS do link`);

  // NUNCA BR Code / bloco de codigo / QR no corpo.
  ok(!texto.includes("```"), `${rotulo}: sem bloco de codigo (tres crases)`);
  ok(!/br\.gov\.bcb\.pix/i.test(texto), `${rotulo}: sem marcador de BR Code`);
  ok(!texto.includes("00020101"), `${rotulo}: sem prefixo de payload EMV (BR Code)`);
  ok(!/QR ?CODE/i.test(texto), `${rotulo}: "QR CODE" nunca aparece (sem QR dentro do WhatsApp)`);
  ok(texto.length < 1024, `${rotulo}: mensagem curta (bem abaixo do limite)`);
}

checarPix("C1(sandbox real)", "35,00", "Plano: Mensal", "https://woovi-sandbox.com/pay/2d0f2e06-e0b4-4ab7-90a0-7076e63f351b");
checarPix("C1(outro plano)", "49,90", "Plano: Semestral", "https://woovi-sandbox.com/pay/abc123");
checarPix("C1(lote)", "60,00", "2 acessos", "https://woovi-sandbox.com/pay/lote123");

// C1 -- link com query string / caracteres especiais chega intacto
{
  const link = "https://woovi-sandbox.com/pay/xyz?utm=wa&x=1";
  const texto = montarMensagemPixRenovacao("10,00", "Plano: Mensal", link);
  ok(texto.includes(link) && texto.split(link).length - 1 === 1, "C1: link com query string preservado byte a byte, 1x");
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
    // Ordem do bloco: ... Plano -> Vencimento -> Valor (Valor continua
    // sendo a ULTIMA linha). Cada campo e' o DESTE acesso, nunca
    // trocado com outro bloco.
    const iPlano = linhas.indexOf(`Plano: ${a.planoNome}`, iTitulo);
    const linhaVencEsperada = a.vencimentoFormatado
      ? `📅 Vencimento: ${a.vencimentoFormatado}`
      : "📅 Vencimento: não informado";
    ok(linhas[iPlano + 1] === linhaVencEsperada, `${rotulo}: bloco ${i + 1} -- "${linhaVencEsperada}" logo apos o Plano`);
    const linhaValorEsperada = a.valorFormatado
      ? `💰 Valor: R$ ${a.valorFormatado}`
      : "💰 Valor: não informado";
    ok(linhas[iPlano + 2] === linhaValorEsperada, `${rotulo}: bloco ${i + 1} -- "${linhaValorEsperada}" logo apos o Vencimento`);
  });

  const sepCount = texto.split(SEP).length - 1;
  ok(sepCount === acessos.length - 1, `${rotulo}: separador entre blocos, nunca apos o ultimo (${sepCount})`);
  ok(texto.includes("📋 *Seus acessos*"), `${rotulo}: cabecalho da lista`);
  ok(texto.includes("Qual desses acessos você gostaria de renovar?"), `${rotulo}: pergunta de escolha presente`);
  // Etapa 1: a ultima linha e' a instrucao de entrada (numero OU *0*
  // para o lote). "os dois" quando N=2, "todos os N" caso contrario.
  const rotuloTodos = acessos.length === 2 ? "os dois" : `todos os ${acessos.length}`;
  ok(
    texto.trim().endsWith(`Digite o número do acesso, ou *0* para renovar ${rotuloTodos}.`),
    `${rotulo}: termina com a instrucao de entrada (numero do acesso ou 0 = lote)`,
  );
}
checarLista("C3(2 acessos)", [
  { nome: "Meu Uso Testes", usuario: "828667229", servidorNome: "BLAZE", planoNome: "Mensal", valorFormatado: "35,00", vencimentoFormatado: "13/10/2026" },
  { nome: "Js Informática Rp", usuario: "112233", servidorNome: "NewOne", planoNome: "Mensal", valorFormatado: "42,00", vencimentoFormatado: "08/03/2027" },
]);
checarLista("C3(3 acessos)", [
  { nome: "A", usuario: "1", servidorNome: "S1", planoNome: "Mensal", valorFormatado: "19,90", vencimentoFormatado: "01/09/2026" },
  { nome: "B", usuario: "2", servidorNome: "S2", planoNome: "Anual", valorFormatado: "199,00", vencimentoFormatado: "15/12/2026" },
  { nome: "C", usuario: "3", servidorNome: "S3", planoNome: "Semestral", valorFormatado: "99,90", vencimentoFormatado: "20/06/2027" },
]);
// C3 -- vencimento null -> "📅 Vencimento: não informado" (fallback,
// mesmo padrao do valor). Cada bloco mantem o SEU vencimento.
checarLista("C3(venc null)", [
  { nome: "SemVenc", usuario: "7", servidorNome: "BLAZE", planoNome: "Mensal", valorFormatado: "35,00", vencimentoFormatado: null },
  { nome: "ComVenc", usuario: "8", servidorNome: "NewOne", planoNome: "Mensal", valorFormatado: "35,00", vencimentoFormatado: "09/11/2026" },
]);
{
  const texto = montarMensagemMultiplosAcessosRenovacao([
    { nome: "SemVenc", usuario: "7", servidorNome: "BLAZE", planoNome: "Mensal", valorFormatado: "35,00", vencimentoFormatado: null },
    { nome: "ComVenc", usuario: "8", servidorNome: "NewOne", planoNome: "Mensal", valorFormatado: "35,00", vencimentoFormatado: "09/11/2026" },
  ]);
  ok(texto.includes("📅 Vencimento: não informado"), "C3: vencimento null vira '📅 Vencimento: não informado'");
  ok(texto.includes("📅 Vencimento: 09/11/2026"), "C3: o outro acesso mostra o vencimento real");
  ok(!/(undefined|null|NaN|Invalid Date)/.test(texto), "C3: sem undefined/null/Invalid Date no vencimento");
}
// C3 -- o vencimento acompanha o SEU bloco (nao e' trocado entre acessos)
{
  const texto = montarMensagemMultiplosAcessosRenovacao([
    { nome: "Alpha", usuario: "a", servidorNome: "BLAZE", planoNome: "Mensal", valorFormatado: "35,00", vencimentoFormatado: "13/10/2026" },
    { nome: "Beta", usuario: "b", servidorNome: "NewOne", planoNome: "Anual", valorFormatado: "300,00", vencimentoFormatado: "08/03/2027" },
  ]);
  const linhas = texto.split("\n");
  const iAlpha = linhas.indexOf("*1. Alpha*");
  const iBeta = linhas.indexOf("*2. Beta*");
  ok(linhas.slice(iAlpha, iBeta).join("\n").includes("📅 Vencimento: 13/10/2026"), "C3: bloco Alpha carrega seu vencimento");
  ok(!linhas.slice(iAlpha, iBeta).join("\n").includes("08/03/2027"), "C3: vencimento do bloco 2 NAO vaza para o bloco 1");
  ok(linhas.slice(iBeta).join("\n").includes("📅 Vencimento: 08/03/2027"), "C3: bloco Beta carrega seu vencimento");
}

// C3 -- o valor de cada acesso acompanha o SEU bloco (nao e' trocado)
{
  const texto = montarMensagemMultiplosAcessosRenovacao([
    { nome: "Alpha", usuario: "a", servidorNome: "BLAZE", planoNome: "Mensal", valorFormatado: "35,00", vencimentoFormatado: "13/10/2026" },
    { nome: "Beta", usuario: "b", servidorNome: "NewOne", planoNome: "Anual", valorFormatado: "300,00", vencimentoFormatado: "08/03/2027" },
  ]);
  const linhas = texto.split("\n");
  const iAlpha = linhas.indexOf("*1. Alpha*");
  const iBeta = linhas.indexOf("*2. Beta*");
  ok(linhas.slice(iAlpha, iBeta).join("\n").includes("💰 Valor: R$ 35,00"), "C3: bloco Alpha carrega R$ 35,00");
  ok(linhas.slice(iAlpha, iBeta).join("\n").includes("BLAZE") && !linhas.slice(iAlpha, iBeta).join("\n").includes("300,00"), "C3: valor do bloco 2 NAO vaza para o bloco 1");
  ok(linhas.slice(iBeta).join("\n").includes("💰 Valor: R$ 300,00"), "C3: bloco Beta carrega R$ 300,00");
}

// C3 -- valor null -> "💰 Valor: não informado" (sem "R$", sem undefined/null)
{
  const texto = montarMensagemMultiplosAcessosRenovacao([
    { nome: "X", usuario: "não informado", servidorNome: "não informado", planoNome: "não informado", valorFormatado: null, vencimentoFormatado: null },
    { nome: "Y", usuario: "9", servidorNome: "S", planoNome: "Mensal", valorFormatado: "50,00", vencimentoFormatado: "09/11/2026" },
  ]);
  ok(texto.includes("💰 Valor: não informado"), "C3: valor null vira '💰 Valor: não informado'");
  ok(!texto.includes("💰 Valor: R$ não informado"), "C3: sem 'R$' quando o valor e' desconhecido");
  ok(texto.includes("💰 Valor: R$ 50,00"), "C3: o outro acesso ainda mostra o valor certo");
  ok(!/(undefined|null|\[object)/.test(texto), "C3: nunca undefined/null no texto");
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

// =====================================================================
// Etapa 1 -- montarMensagemConfirmacaoLote (confirmacao UNICA do lote)
// =====================================================================
{
  const texto = montarMensagemConfirmacaoLote({
    itens: [
      { nome: "Meu Uso Testes", servidorNome: "BLAZE", planoNome: "Mensal", valorFormatado: "30,00" },
      { nome: "Js Informática Rp", servidorNome: "NewOne", planoNome: "Mensal", valorFormatado: "30,00" },
    ],
    totalFormatado: "60,00",
  });
  ok(texto.includes("📋 *Confira sua renovação*"), "Lote-confirm: cabecalho");
  ok(texto.includes("Você vai renovar 2 acessos:"), "Lote-confirm: quantidade");
  ok(texto.includes("*1. Meu Uso Testes*") && texto.includes("*2. Js Informática Rp*"), "Lote-confirm: nomes numerados em negrito");
  ok(texto.includes("🖥️ BLAZE · 📦 Mensal"), "Lote-confirm: servidor + plano na mesma linha");
  ok((texto.match(/💰 R\$ 30,00/g) ?? []).length === 2, "Lote-confirm: valor final por acesso, 1x cada");
  ok(texto.includes("💰 *Total: R$ 60,00*"), "Lote-confirm: total consolidado");
  ok(texto.includes("Toque em *ACEITO*"), "Lote-confirm: instrucao de ACEITO/CANCELAR");
  ok(!/promo|desconto/i.test(texto), "Lote-confirm: NUNCA cita 'promocao'/'desconto'");
}

// Etapa 1 -- confirmacao do lote com valores DIFERENTES por acesso:
// cada linha mostra o valor real do SEU acesso; o total e' a soma.
{
  const texto = montarMensagemConfirmacaoLote({
    itens: [
      { nome: "Meu Uso Testes", servidorNome: "BLAZE", planoNome: "Mensal", valorFormatado: "35,00" },
      { nome: "Js Informática Rp", servidorNome: "NewOne", planoNome: "Mensal", valorFormatado: "50,00" },
    ],
    totalFormatado: "85,00",
  });
  ok(texto.includes("💰 R$ 35,00") && texto.includes("💰 R$ 50,00"), "Lote-confirm(dif): cada acesso mostra o SEU valor real");
  ok(texto.includes("💰 *Total: R$ 85,00*"), "Lote-confirm(dif): total = soma (35 + 50 = 85), nunca media/desconto");
  ok(!/promo|desconto/i.test(texto), "Lote-confirm(dif): nunca cita promocao/desconto");
}

// =====================================================================
// Etapa 1 -- montarMensagemResultadoLote (resultado consolidado, sem
// nome no cabecalho; "com sucesso" so' quando TODOS renovaram)
// =====================================================================
{
  const todosOk = montarMensagemResultadoLote([
    { nome: "Meu Uso Testes", servidorNome: "BLAZE", sucesso: true, vencimentoFormatado: "14/10/2026" },
    { nome: "Js Informática Rp", servidorNome: "NewOne", sucesso: true, vencimentoFormatado: "08/12/2026" },
  ]);
  ok(todosOk.startsWith("✅ *Pagamento confirmado!*"), "Lote-result: titulo");
  ok(todosOk.includes("Suas renovações foram registradas com sucesso."), "Lote-result: 'com sucesso' quando todos ok");
  ok(!/Olá|Ol[aá],/.test(todosOk.split("\n")[2] ?? ""), "Lote-result: sem nome no cabecalho (evita assumir mesmo cadastro)");
  ok(todosOk.includes("📅 Novo vencimento: 14/10/2026") && todosOk.includes("📅 Novo vencimento: 08/12/2026"), "Lote-result: vencimento por acesso");

  const parcial = montarMensagemResultadoLote([
    { nome: "A", servidorNome: "BLAZE", sucesso: true, vencimentoFormatado: "14/10/2026" },
    { nome: "B", servidorNome: "NewOne", sucesso: false, vencimentoFormatado: null },
  ]);
  ok(parcial.includes("Suas renovações foram registradas.") && !parcial.includes("com sucesso."), "Lote-result: sem 'com sucesso' se algum falhou");
  ok(parcial.includes("⚠️ Um atendente vai concluir esta renovação por aqui."), "Lote-result: acesso que falhou aponta atendente humano");
  ok(!parcial.includes("Novo vencimento:") || parcial.split("Novo vencimento:").length - 1 === 1, "Lote-result: acesso que falhou NAO mostra vencimento novo");
}

// =====================================================================
// Etapa 1.5 (Lacuna A) -- mensagens fixas de roteamento UniTV
// =====================================================================
{
  ok(/uni ?tv/i.test(MENSAGEM_RENOVACAO_UNITV_NAO_INTEGRADA), "UniTV-msg: cita UniTV");
  ok(/atendente/i.test(MENSAGEM_RENOVACAO_UNITV_NAO_INTEGRADA), "UniTV-msg: encaminha para atendente");
  ok(!/pix|pagamento|r\$|cobran/i.test(MENSAGEM_RENOVACAO_UNITV_NAO_INTEGRADA), "UniTV-msg: NUNCA fala de pagamento/PIX/cobranca");

  ok(/uni ?tv/i.test(MENSAGEM_RENOVACAO_LOTE_COM_UNITV), "Lote-UniTV-msg: cita UniTV");
  ok(/atendente/i.test(MENSAGEM_RENOVACAO_LOTE_COM_UNITV), "Lote-UniTV-msg: encaminha para atendente");
  ok(/sigma/i.test(MENSAGEM_RENOVACAO_LOTE_COM_UNITV), "Lote-UniTV-msg: sugere renovar os Sigma um a um");
  ok(!/promo|desconto|r\$/i.test(MENSAGEM_RENOVACAO_LOTE_COM_UNITV), "Lote-UniTV-msg: sem promocao/desconto/valor");
}

// =====================================================================
// UX 2026-08-29 -- distincao INSTABILIDADE TEMPORARIA x NAO IDENTIFICACAO
// segura na falha de resolucao da conta UniTV.
// =====================================================================
{
  const todas = [
    MENSAGEM_RENOVACAO_UNITV_INSTABILIDADE,
    MENSAGEM_RENOVACAO_UNITV_NAO_IDENTIFICADO,
    MENSAGEM_RENOVACAO_LOTE_UNITV_INSTABILIDADE,
    MENSAGEM_RENOVACAO_LOTE_UNITV_NAO_IDENTIFICADO,
  ];
  for (const m of todas) {
    ok(/uni ?tv/i.test(m), `falha-UniTV-msg: cita UniTV (${m.slice(0, 30)}...)`);
    ok(/atendente/i.test(m), `falha-UniTV-msg: encaminha para atendente (${m.slice(0, 30)}...)`);
    ok(!/pix|pagamento|r\$|cobran|promo|desconto/i.test(m), `falha-UniTV-msg: nunca fala de pagamento/promo (${m.slice(0, 30)}...)`);
    ok(!/ainda não está disponível|não está disponível/i.test(m), `falha-UniTV-msg: NUNCA diz que a funcionalidade nao existe (${m.slice(0, 30)}...)`);
  }

  // instabilidade -> convida a tentar de novo; nao-identificacao -> nao convida
  ok(/de novo|minutos|instabilidade/i.test(MENSAGEM_RENOVACAO_UNITV_INSTABILIDADE), "instabilidade (individual): sinaliza temporario / retentar");
  ok(/de novo|minutos|instabilidade/i.test(MENSAGEM_RENOVACAO_LOTE_UNITV_INSTABILIDADE), "instabilidade (lote): sinaliza temporario / retentar");
  ok(/identificar/i.test(MENSAGEM_RENOVACAO_UNITV_NAO_IDENTIFICADO), "nao-identificacao (individual): fala em identificar a conta");
  ok(/identificar/i.test(MENSAGEM_RENOVACAO_LOTE_UNITV_NAO_IDENTIFICADO), "nao-identificacao (lote): fala em identificar a conta");
  ok(/sigma/i.test(MENSAGEM_RENOVACAO_LOTE_UNITV_INSTABILIDADE) && /sigma/i.test(MENSAGEM_RENOVACAO_LOTE_UNITV_NAO_IDENTIFICADO), "lote: mantem a sugestao de renovar os Sigma um a um");

  // roteamento do helper (individual + lote), pelos valores brutos reais
  ok(mensagemFalhaResolucaoUnitv("indisponivel", "individual") === MENSAGEM_RENOVACAO_UNITV_INSTABILIDADE, "helper: 'indisponivel' individual -> instabilidade");
  ok(mensagemFalhaResolucaoUnitv("unitv_conta_indisponivel", "lote") === MENSAGEM_RENOVACAO_LOTE_UNITV_INSTABILIDADE, "helper: 'unitv_conta_indisponivel' lote -> instabilidade");
  ok(mensagemFalhaResolucaoUnitv("nao_encontrado", "individual") === MENSAGEM_RENOVACAO_UNITV_NAO_IDENTIFICADO, "helper: 'nao_encontrado' individual -> nao identificado");
  ok(mensagemFalhaResolucaoUnitv("ambiguo", "individual") === MENSAGEM_RENOVACAO_UNITV_NAO_IDENTIFICADO, "helper: 'ambiguo' individual -> nao identificado");
  ok(mensagemFalhaResolucaoUnitv("unitv_sem_usuario", "individual") === MENSAGEM_RENOVACAO_UNITV_NAO_IDENTIFICADO, "helper: 'unitv_sem_usuario' individual -> nao identificado");
  ok(mensagemFalhaResolucaoUnitv("unitv_conta_ambiguo", "lote") === MENSAGEM_RENOVACAO_LOTE_UNITV_NAO_IDENTIFICADO, "helper: 'unitv_conta_ambiguo' lote -> nao identificado");
  ok(mensagemFalhaResolucaoUnitv("unitv_sem_usuario", "lote") === MENSAGEM_RENOVACAO_LOTE_UNITV_NAO_IDENTIFICADO, "helper: 'unitv_sem_usuario' lote -> nao identificado");

  // Iteracao 1 (2026-08-29) -- MENSAGEM_RENOVACAO_INSTABILIDADE (Sigma /
  // generica). Mesmo PADRAO da instabilidade da UniTV, mas NEUTRA.
  ok(typeof MENSAGEM_RENOVACAO_INSTABILIDADE === "string" && MENSAGEM_RENOVACAO_INSTABILIDADE.length > 0, "instab-geral: constante existe e nao e' vazia");
  ok(/instabilidade tempor/i.test(MENSAGEM_RENOVACAO_INSTABILIDADE), "instab-geral: fala em 'instabilidade temporária'");
  ok(/de novo|minutos/i.test(MENSAGEM_RENOVACAO_INSTABILIDADE), "instab-geral: convida a pedir de novo em alguns minutos (transitorio)");
  ok(/atendente/i.test(MENSAGEM_RENOVACAO_INSTABILIDADE), "instab-geral: informa que ja encaminhou para um atendente");
  ok(!/ainda não está disponível|não está disponível|não existe|nao existe/i.test(MENSAGEM_RENOVACAO_INSTABILIDADE), "instab-geral: NUNCA diz que a renovacao 'nao esta disponivel'/'nao existe'");
  ok(!/uni ?tv/i.test(MENSAGEM_RENOVACAO_INSTABILIDADE), "instab-geral: NEUTRA -- nao nomeia UniTV");
  ok(!/sigma/i.test(MENSAGEM_RENOVACAO_INSTABILIDADE), "instab-geral: NEUTRA -- nao nomeia Sigma (serve pra qualquer acesso)");
  ok(!/pix|r\$|cobran|promo|desconto/i.test(MENSAGEM_RENOVACAO_INSTABILIDADE), "instab-geral: nao fala de pagamento/promo");
  // as constantes UniTV continuam INTOCADAS (ainda nomeiam UniTV)
  ok(/uni ?tv/i.test(MENSAGEM_RENOVACAO_UNITV_INSTABILIDADE), "instab-geral: a constante UniTV segue intocada (ainda nomeia UniTV)");
}

console.log(`\n${falhas === 0 ? "TODOS OS TESTES PASSARAM" : `${falhas} FALHA(S)`}`);
process.exit(falhas === 0 ? 0 : 1);
