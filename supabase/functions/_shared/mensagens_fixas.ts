// Textos/config fixos enviados pelo Orquestrador -- nunca gerados
// pelo Gemini nesse momento (Componente 1 §16/§16-A, inovatv_central
// CLAUDE.md, aprovado 2026-08-16).
export const MENSAGEM_TRANSFERENCIA_CLIENTE =
  "🔔 Vou encaminhar seu atendimento para um de nossos atendentes. Em breve, alguém continuará o atendimento por aqui.";

// Aviso ao José (Componente 1 §16-A) -- Message Template submetido a'
// Meta em 2026-08-16, ainda "Em analise" no momento desta escrita.
// Corpo aprovado: "🔔 Nova transferência\nMotivo: {{1}}\nAcesse a
// Interface de Atendimento para assumir a conversa."
export const NOME_TEMPLATE_NOVA_TRANSFERENCIA = "nova_transferencia_humana";
export const IDIOMA_TEMPLATE_NOVA_TRANSFERENCIA = "pt_BR";

// Confirmacao de pagamento/renovacao -- Message Template aprovado pela
// Meta em 2026-08-22 (segunda POC da substituicao do RocketZap, ver
// docs/renovacao_automatica/levantamentos/2026-08-22_desenho_substituicao_rocketzap.md
// deste repositorio -- migrado de inovatv_meta_business_agent em 2026-08-23).
// Corpo aprovado (4 variaveis, sem {VALOR} -- deixado de fora
// deliberadamente desta rodada, nao reenviar/alterar o template por
// causa disso):
// "✅ Pagamento confirmado!\n\nOlá,{{1}}! Sua renovação foi registrada
// com sucesso.\n\n📋 Plano:{{2}}\n🖥️ Servidor:{{3}}\n📅 Novo
// vencimento:{{4}}\n\nQualquer dúvida, estamos à disposição.\nInovaTV
// — Sempre pensando em você! 📺"
export const NOME_TEMPLATE_PAGAMENTO_CONFIRMADO = "pagamento_confirmado";
export const IDIOMA_TEMPLATE_PAGAMENTO_CONFIRMADO = "pt_BR";

// Memoria de sessao (Camada 3, 2026-08-23) -- mensagem fixa, nunca
// gerada pelo Gemini, enviada quando o cliente volta depois de mais
// de 1h de inatividade e a sessao anterior e' encerrada/reiniciada.
// Texto aprovado pelo usuario como referencia de UX, reproduzido aqui
// sem alteracao.
export const MENSAGEM_SESSAO_EXPIRADA =
  "Vi que você ficou um tempo ausente. Como nossa sessão ficou inativa por mais de 1 hora, o contexto anterior foi encerrado para começarmos novamente com segurança. Pode me dizer como posso ajudá-lo?";

// Valor real do plano -- parsing centralizado aqui (2026-08-23, Bloco 1
// do fluxo de renovacao com PagBank real). O campo `valor` do Rocket
// chega em formato variavel (numero ou texto, com virgula ou ponto) --
// parseValorReais normaliza pra um numero em reais; retorna null
// (nunca 0/inventado) quando o dado nao e' um numero positivo valido.
// formatarValorBRL (exibicao) e paraCentavos (payload do PagBank, que
// exige o valor em centavos/inteiro) reaproveitam o mesmo parsing --
// nunca duas logicas de conversao divergentes.
export function parseValorReais(valorBruto: string | number | null | undefined): number | null {
  if (valorBruto === null || valorBruto === undefined) return null;
  const texto = String(valorBruto).trim().replace(",", ".");
  const numero = Number(texto);
  if (!Number.isFinite(numero) || numero <= 0) return null;
  return numero;
}

export function formatarValorBRL(valorBruto: string | number | null | undefined): string | null {
  const numero = parseValorReais(valorBruto);
  if (numero === null) return null;
  return numero.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function paraCentavos(valorBruto: string | number | null | undefined): number | null {
  const numero = parseValorReais(valorBruto);
  if (numero === null) return null;
  return Math.round(numero * 100);
}

// Bloco 1 do fluxo de renovacao com PagBank real (2026-08-23,
// docs/renovacao_automatica/PLANO_MESTRE_IMPLEMENTACAO.md, Lacuna 8).
// Duas mensagens fixas, nunca geradas pelo Gemini -- substituem
// integralmente a orientacao GENERICA de Pix implementada em 23/08
// ("faca um Pix pra nossa chave e envie o comprovante"), que nunca
// vinculava o pagamento a uma cobranca real.
//
// Mensagem 1 -- confirmacao neutra, enviada ANTES de qualquer chamada
// externa (Rocket/PagBank) -- nunca afirma que a cobranca ja existe.
export const MENSAGEM_PREPARANDO_PAGAMENTO_RENOVACAO =
  "Certo! Vou preparar seu pagamento via Pix. Só um momento...";

// Mensagem intermediaria "renovacao em andamento" (2026-08-29) --
// enviada UMA vez pelo openpix-webhook, logo apos o pagamento ser
// confirmado (reivindicarInicioRenovacao/...Lote com sucesso) e ANTES
// do dispatch do GitHub Actions. Elimina o silencio percebido pelo
// cliente durante o processamento assincrono (30s-2min). Vale igual
// para Sigma e UniTV, individual e lote -- caminho unico, sem branch
// por tipo. Best-effort: falha no envio nunca impede o dispatch.
// NAO substitui a mensagem final de sucesso.
export const MENSAGEM_RENOVACAO_EM_ANDAMENTO =
  "🔄 Renovação em andamento...\n\n" +
  "Seu pagamento foi confirmado e estamos processando a renovação dos seus acessos.\n\n" +
  "⏳ Esse processo pode levar até 2 minutos.\n\n" +
  "Por favor, aguarde e não envie novas mensagens. Você receberá a confirmação assim que tudo estiver concluído.";

// Mensagem 2 -- so' enviada DEPOIS que a cobranca real existe (valor e
// codigo Pix vem sempre de dado real: valorFormatado do Rocket,
// codigoPix do provedor -- nunca inventados). Reforca que a renovacao
// so' e' confirmada depois que o provedor reconhecer o pagamento (duas
// confirmacoes, nunca uma so).
//
// UX de renovacao (2026-08-28, inovatv_central/CLAUDE.md) -- REVISADA
// depois do teste real: o BR Code (mesmo isolado em bloco de codigo)
// NAO e' a experiencia desejada. Agora a mensagem e' curta e leva o
// LINK da pagina de pagamento hospedada pela Woovi (uma por cobranca,
// `charge.paymentLinkUrl`, ja retornado pelo POST /charge). Nessa
// pagina o cliente ve o valor, o recebedor, o QR e o botao "COPIAR
// CODIGO QR CODE" -- copia e cola no app do banco.
//   - NUNCA mais o BR Code no corpo da mensagem.
//   - Sem QR Code dentro do WhatsApp.
//   - Sem pagina propria da InovaTV (a pagina da Woovi ja foi aprovada
//     como conceito, mesmo mostrando o recebedor "JS INFORMATICA RP" e
//     a marca Woovi).
// Nenhuma logica de cobranca/webhook/estado muda -- so' o conteudo da
// mensagem e a origem do dado (paymentLinkUrl no lugar do brCode).
// Formato final (2026-08-29) -- serve individual E lote: `linhaPacote`
// e' a linha do 📦 ("Plano: Mensal" no individual, "2 acessos" no
// lote). Link logo apos "🔗 PAGAR RENOVAÇÃO", antes do ✅. Sem BR Code,
// sem instrucao de "copiar QR" (a propria pagina Woovi guia isso).
export function montarMensagemPixRenovacao(
  valorFormatado: string,
  linhaPacote: string,
  linkPagamento: string,
): string {
  return [
    "💳 *PAGAMENTO DA RENOVAÇÃO*",
    "",
    `💰 Valor: R$ ${valorFormatado}`,
    "",
    `📦 ${linhaPacote}`,
    "",
    "👇 Toque no link abaixo para realizar o pagamento.",
    "",
    "🔗 PAGAR RENOVAÇÃO",
    linkPagamento,
    "",
    "✅ Não é necessário enviar o comprovante.",
    "",
    "🔄 Após a confirmação do pagamento, sua renovação será processada automaticamente.",
  ].join("\n");
}

// Ajuste de apresentacao (2026-08-28, inovatv_central/CLAUDE.md) --
// listagem de multiplos acessos no fluxo de renovacao (propor_renovacao
// aprovado, mas o Gemini nao citou um servidor especifico que resolva
// a exatamente 1 acesso). Antes, esse caso caia direto em transferencia
// humana; agora, mensagem fixa deterministica lista os acessos reais
// (dados ja disponiveis em statusResults/matchResult.candidates, sem
// nova consulta) e deixa o cliente escolher -- nunca gerada pelo
// Gemini, mesma disciplina ja usada nas mensagens 2/3 deste arquivo.
// Deliberadamente restrita a este ponto do fluxo (propor_renovacao) --
// nao altera o comportamento geral das respostas do Gemini (tipo
// "responder" continua em prosa livre, sem mudanca).
const SEPARADOR_ACESSOS = "─────────────────";

// `valorFormatado` (2026-08-28): valor de CADA acesso, ja formatado
// pelo CHAMADOR com formatarValorBRL sobre StatusCliente.valor -- o
// campo que o /status passou a expor (dado do cadastro, cru). `null`
// quando o /status nao trouxe valor ou ele nao parseia -> "não
// informado", mesmo fallback dos outros campos. Aqui e' so'
// apresentacao: nenhum calculo, nenhuma consulta por candidato, o
// Gemini nunca determina/infere o valor.
export function montarMensagemMultiplosAcessosRenovacao(
  acessos: {
    nome: string;
    usuario: string;
    servidorNome: string;
    planoNome: string;
    valorFormatado: string | null;
    // Vencimento ja formatado como DD/MM/AAAA pelo chamador (vem do
    // `vencimento` do /status). null quando o /status nao devolveu.
    vencimentoFormatado: string | null;
  }[],
): string {
  const blocos = acessos.map((acesso, indice) =>
    [
      `*${indice + 1}. ${acesso.nome}*`,
      `Usuário: ${acesso.usuario}`,
      `Servidor: ${acesso.servidorNome}`,
      `Plano: ${acesso.planoNome}`,
      acesso.vencimentoFormatado
        ? `📅 Vencimento: ${acesso.vencimentoFormatado}`
        : "📅 Vencimento: não informado",
      acesso.valorFormatado
        ? `💰 Valor: R$ ${acesso.valorFormatado}`
        : "💰 Valor: não informado",
    ].join("\n"),
  );
  const n = acessos.length;
  const rotuloTodos = n === 2 ? "os dois" : `todos os ${n}`;
  return [
    "📋 *Seus acessos*",
    "",
    blocos.join(`\n\n${SEPARADOR_ACESSOS}\n\n`),
    "",
    "Qual desses acessos você gostaria de renovar?",
    "",
    `Digite o número do acesso, ou *0* para renovar ${rotuloTodos}.`,
  ].join("\n");
}

// Renovacao em lote (Etapa 1, 2026-08-29) -- UX aprovada. Confirmacao
// UNICA para N acessos. Valores por acesso e total vem de
// _shared/precos_renovacao.ts (regra comercial INTERNA -- nunca citada
// aqui: sem "promocao", sem "desconto"). Formato compacto: servidor +
// plano numa linha, valor abaixo. Mesma estrutura pra Sigma+Sigma e
// (futuro) Sigma+UniTV -- a linha nao distingue o tipo.
export function montarMensagemConfirmacaoLote(dados: {
  itens: { nome: string; servidorNome: string; planoNome: string; valorFormatado: string }[];
  totalFormatado: string;
}): string {
  const blocos = dados.itens.map((item, indice) =>
    [
      `*${indice + 1}. ${item.nome}*`,
      `🖥️ ${item.servidorNome} · 📦 ${item.planoNome}`,
      `💰 R$ ${item.valorFormatado}`,
    ].join("\n"),
  );
  return [
    "📋 *Confira sua renovação*",
    "",
    `Você vai renovar ${dados.itens.length} acessos:`,
    "",
    blocos.join("\n\n"),
    "",
    `💰 *Total: R$ ${dados.totalFormatado}*`,
    "",
    "Toque em *ACEITO* para gerar o PIX, ou em *CANCELAR* para desistir.",
  ].join("\n");
}

// Renovacao em lote -- resultado UNICO consolidado apos o pagamento.
// Cada item apresenta o SEU resultado: renovado -> "📅 Novo
// vencimento"; falha/indeterminado/unitv pendente -> "⚠️ Um atendente
// vai concluir...". "com sucesso" so' quando TODOS renovaram. Mesma
// mensagem pra Sigma+Sigma e (futuro) Sigma+UniTV. Fora da janela de
// 24h o envio pode falhar (mensagem livre) -- fallback por template
// aprovado e' tarefa separada (NOME_TEMPLATE_RENOVACAO_LOTE_RESULTADO).
export function montarMensagemResultadoLote(
  itens: { nome: string; servidorNome: string; sucesso: boolean; vencimentoFormatado: string | null }[],
): string {
  const todosOk = itens.every((i) => i.sucesso);
  const blocos = itens.map((item, indice) =>
    [
      `*${indice + 1}. ${item.nome}*`,
      `🖥️ ${item.servidorNome}`,
      item.sucesso && item.vencimentoFormatado
        ? `📅 Novo vencimento: ${item.vencimentoFormatado}`
        : "⚠️ Um atendente vai concluir esta renovação por aqui.",
    ].join("\n"),
  );
  return [
    "✅ *Pagamento confirmado!*",
    "",
    todosOk
      ? "Suas renovações foram registradas com sucesso."
      : "Suas renovações foram registradas.",
    "",
    blocos.join("\n\n"),
    "",
    "Qualquer dúvida, estamos à disposição.",
    "InovaTV — Sempre pensando em você! 📺",
  ].join("\n");
}

// Template Meta para o resultado do lote FORA da janela de 24h --
// ainda NAO submetido/aprovado (trilha paralela). Codigo so' referencia
// o nome; enquanto nao existir, enviarTemplateWhatsApp retorna
// "unavailable" como qualquer outra falha da Graph API.
export const NOME_TEMPLATE_RENOVACAO_LOTE_RESULTADO = "renovacao_lote_resultado";
export const IDIOMA_TEMPLATE_RENOVACAO_LOTE_RESULTADO = "pt_BR";

// Bloco 2 (2026-08-24, inovatv_central/CLAUDE.md) -- ACEITO passa a
// acontecer ANTES da cobranca existir (inversao de ordem aprovada
// explicitamente). Mensagem 1 do fluxo novo: buscar os dados reais no
// Rocket pra apresentar (nome/servidor/plano/valor/vencimento), antes
// de qualquer cobranca ser criada. Substitui, NESTE ponto do fluxo, a
// antiga MENSAGEM_PREPARANDO_PAGAMENTO_RENOVACAO -- que continua
// existindo e sendo usada, sem alteracao, no ponto em que sempre foi
// usada (logo apos o ACEITO, antes de criar a cobranca OpenPix).
export const MENSAGEM_BUSCANDO_DADOS_RENOVACAO =
  "Só um momento, vou buscar os dados da sua renovação...";

// Mensagem 2 do fluxo novo -- so' enviada depois que o token existe de
// verdade (dados reais do Rocket, nunca inventados). Apresenta os
// dados pro cliente conferir e o link de confirmacao (ACEITO/CANCELAR).
// Nunca afirma que a cobranca ja existe -- ela so' e' criada DEPOIS do
// clique em ACEITO.
export function montarMensagemLinkConfirmacaoRenovacao(dados: {
  clienteNome: string;
  servidorNome: string;
  planoNome: string;
  valorFormatado: string;
  vencimentoFormatado: string;
  urlConfirmacao: string;
}): string {
  return [
    "Aqui estão os dados da sua renovação, confira antes de confirmar:",
    "",
    `👤 Cliente: ${dados.clienteNome}`,
    `🖥️ Servidor: ${dados.servidorNome}`,
    `📋 Plano: ${dados.planoNome}`,
    `💰 Valor: R$ ${dados.valorFormatado}`,
    `📅 Vencimento atual: ${dados.vencimentoFormatado}`,
    "",
    "Pra confirmar ou cancelar, acesse o link abaixo:",
    dados.urlConfirmacao,
  ].join("\n");
}

// Mesmos dados reais apresentados pelo fluxo legado, sem URL. O texto e'
// usado tanto no corpo da mensagem interativa quanto no historico local.
export function montarMensagemBotoesConfirmacaoRenovacao(dados: {
  clienteNome: string;
  usuario: string;
  servidorNome: string;
  planoNome: string;
  valorFormatado: string;
  vencimentoFormatado: string;
}): string {
  return [
    "📋 *Confira os dados da sua renovação*",
    "",
    `👤 *Cliente:* ${dados.clienteNome}`,
    `🔑 *Usuário:* ${dados.usuario}`,
    `🖥️ *Servidor:* ${dados.servidorNome}`,
    `📦 *Plano:* ${dados.planoNome}`,
    `💰 *Valor:* R$ ${dados.valorFormatado}`,
    `📅 *Vencimento atual:* ${dados.vencimentoFormatado}`,
    "",
    "Toque em *ACEITO* para gerar o PIX, ou em *CANCELAR* para desistir.",
  ].join("\n");
}

// Molde do corpo do Message Template `pagamento_confirmado` (acima) com
// os 4 parametros ja substituidos. NAO e' usado pra enviar nada -- o
// envio real continua sendo enviarTemplateWhatsApp. Serve SO' pra
// gravar no historico do Painel EXATAMENTE o texto que o cliente
// recebeu (bug de historico, bloco de renovacao 2026-08-28, C4): hoje
// a confirmacao chega no WhatsApp mas nao aparece na conversa do
// Painel. Espelha o corpo aprovado pela Meta byte a byte -- inclusive
// a ausencia de espaco depois de "Olá,", "Plano:", "Servidor:" e
// "vencimento:", porque o objetivo e' registrar o que foi enviado, nao
// corrigi-lo (polimento do texto = reenvio do template a Meta, trilha
// separada). Se o template for reenviado/alterado, atualizar aqui
// junto.
export function montarTextoConfirmacaoPagamentoRenovacao(dados: {
  clienteNome: string;
  planoNome: string;
  servidorNome: string;
  vencimentoFormatado: string;
}): string {
  return [
    "✅ Pagamento confirmado!",
    "",
    `Olá,${dados.clienteNome}! Sua renovação foi registrada com sucesso.`,
    "",
    `📋 Plano:${dados.planoNome}`,
    `🖥️ Servidor:${dados.servidorNome}`,
    `📅 Novo vencimento:${dados.vencimentoFormatado}`,
    "",
    "Qualquer dúvida, estamos à disposição.",
    "InovaTV — Sempre pensando em você! 📺",
  ].join("\n");
}

export const MENSAGEM_CANCELAMENTO_RENOVACAO =
  "Ok, cancelado! Se quiser renovar depois, é só me chamar novamente.";

// Peca 3 do gerenciamento de estado (2026-08-29) -- CASO C: o
// watchdog expirou uma solicitacao de renovacao 'autorizada' cujo
// pagamento a Woovi confirmou NAO concluido apos a janela de 2h. O
// acesso e' liberado e o cliente e' avisado (NUNCA transferido para
// humano -- nao ha' nada pra um atendente fazer, e um atendimento
// humano bloquearia o proximo "quero renovar" do proprio cliente).
export const MENSAGEM_RENOVACAO_EXPIRADA_SEM_PAGAMENTO =
  "Sua solicitação de renovação expirou porque o pagamento não foi concluído. Sem problema — é só me chamar de novo quando quiser renovar. 🙂";

// Reaproveitada quando ja existe uma solicitacao ATIVA pro mesmo
// acesso (tokens_renovacao_ativo_unico_por_acesso_idx) -- nunca cria
// uma segunda, so' lembra o cliente do que ja esta em andamento.
export const MENSAGEM_JA_EXISTE_SOLICITACAO_RENOVACAO =
  "Você já tem uma renovação em andamento para este acesso. Se ainda não confirmou, procure os botões que te mandei há pouco -- se precisar, é só pedir de novo que eu reenvio.";

// Etapa 1.5 (Lacuna A, 2026-08-28) -- redacao ORIGINAL, hoje reservada
// exclusivamente a uma eventual condicao de DESLIGAMENTO FUNCIONAL da
// integracao UniTV. NAO e' mais usada no fluxo de falha de resolucao
// da conta (isso passou a ser tratado por mensagemFalhaResolucaoUnitv,
// abaixo -- correcao de UX 2026-08-29: dizer "ainda nao esta
// disponivel" para uma falha transitoria de resolucao era enganoso,
// pois a renovacao UniTV JA e' funcionalidade real desde o Bloco 4).
export const MENSAGEM_RENOVACAO_UNITV_NAO_INTEGRADA =
  "A renovação de acessos UniTV ainda não está disponível por aqui. Já encaminhei seu atendimento para que um de nossos atendentes conclua essa renovação para você.";
export const MENSAGEM_RENOVACAO_LOTE_COM_UNITV =
  "Um dos seus acessos é UniTV, e a renovação em lote com acesso UniTV ainda não está disponível por aqui. Já encaminhei seu atendimento para que um atendente cuide da sua renovação. Se preferir, você também pode renovar os acessos Sigma um a um pelo número de cada um na lista.";

// Correcao de UX (2026-08-29) -- a falha de RESOLUCAO da conta UniTV
// (sn -> id do painel de revenda) tem duas naturezas distintas, que
// NUNCA devem dizer ao cliente que a funcionalidade nao existe:
//   * INSTABILIDADE TEMPORARIA  -- `indisponivel` (falha transitoria
//     do painel / rede). Encaminha + convida a tentar de novo.
//   * NAO IDENTIFICACAO SEGURA  -- `nao_encontrado` / `ambiguo` /
//     `sem_usuario`. Problema de identificacao da conta, nunca
//     "escolher por aproximacao" (regra do projeto). So' encaminha.
// Os MOTIVOS INTERNOS de transferencia (renovacao:unitv_conta_*,
// renovacao:lote_unitv_conta_*) NAO mudam -- so' o texto ao cliente.
export const MENSAGEM_RENOVACAO_UNITV_INSTABILIDADE =
  "Tive uma instabilidade temporária pra preparar a renovação do seu acesso UniTV agora. Já encaminhei para um de nossos atendentes concluir — se preferir, é só me pedir de novo daqui a alguns minutos.";
export const MENSAGEM_RENOVACAO_UNITV_NAO_IDENTIFICADO =
  "Não consegui identificar seu acesso UniTV com segurança para renovar por aqui. Já encaminhei seu atendimento para que um atendente verifique e conclua sua renovação.";
export const MENSAGEM_RENOVACAO_LOTE_UNITV_INSTABILIDADE =
  "Tive uma instabilidade temporária pra preparar a renovação do seu acesso UniTV agora. Já encaminhei para um de nossos atendentes concluir. Se preferir, você também pode renovar os acessos Sigma um a um pelo número de cada um na lista, ou me pedir de novo daqui a alguns minutos.";
export const MENSAGEM_RENOVACAO_LOTE_UNITV_NAO_IDENTIFICADO =
  "Não consegui identificar seu acesso UniTV com segurança para renovar em lote. Já encaminhei seu atendimento para que um atendente conclua. Se preferir, você também pode renovar os acessos Sigma um a um pelo número de cada um na lista.";

// Iteracao 1 (2026-08-29) -- instabilidade transitoria de autenticacao
// do painel Sigma (Rocket -> painel do servidor), depois de esgotadas
// as N tentativas da Camada A. Mesmo PADRAO da mensagem de
// instabilidade da UniTV acima, mas NEUTRA (nao nomeia UniTV nem Sigma)
// -- serve pra qualquer acesso. NUNCA diz que a renovacao "nao
// existe"/"nao esta disponivel": e' transitorio, o cliente pode pedir
// de novo. As mensagens UniTV acima ficam INTOCADAS.
export const MENSAGEM_RENOVACAO_INSTABILIDADE =
  "Tive uma instabilidade temporária pra preparar a renovação do seu acesso agora. Já encaminhei para um de nossos atendentes concluir — se preferir, é só me pedir de novo daqui a alguns minutos.";

// `falha` = valor bruto de `resolucao.outcome` (individual) OU de
// `falhaResolucaoUnitv` (lote). "indisponivel" em qualquer forma
// ("indisponivel", "unitv_conta_indisponivel") -> instabilidade
// temporaria; qualquer outro -> nao identificacao segura.
export function mensagemFalhaResolucaoUnitv(
  falha: string,
  escopo: "individual" | "lote",
): string {
  const instabilidade = falha.includes("indisponivel");
  if (escopo === "lote") {
    return instabilidade
      ? MENSAGEM_RENOVACAO_LOTE_UNITV_INSTABILIDADE
      : MENSAGEM_RENOVACAO_LOTE_UNITV_NAO_IDENTIFICADO;
  }
  return instabilidade
    ? MENSAGEM_RENOVACAO_UNITV_INSTABILIDADE
    : MENSAGEM_RENOVACAO_UNITV_NAO_IDENTIFICADO;
}
