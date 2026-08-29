// Orquestrador da IA (Componente 1, inovatv_central CLAUDE.md, frente
// "IA propria"). Etapas 4+5 da sequencia de implementacao
// (docs/IMPLEMENTATION.md).
//
// Passo 0 (Componente 1 §6, revisado 2026-08-15, Etapa 4): identifica
// a conversa pelo telefone, consulta conversas_estado, decide entre
// registrar mensagem (aguardando_humano, para ali) ou seguir fluxo
// normal.
//
// Fluxo normal: encadeia /match -> /status -> contexto minimo ->
// Gemini (Etapa 5, 2026-08-16) -> Validador Deterministico (Etapa 6,
// segunda fatia, 2026-08-16) antes de liberar a resposta. Reprovado
// => resposta original nunca sai, so o motivo (gemini vira
// {outcome:"bloqueado"}).
//
// Etapa 6, terceira fatia (2026-08-16, Componente 1 §16, so' a parte
// de ESTADO): valida => reprova, OU aprova mas tipo==="transferir" =>
// marca aguardando_humano de verdade + registra mensagem do cliente e
// o texto estruturado do Gemini em mensagens_conversa (renomeada de
// mensagens_atendimento_humano, Painel de Atendimento Fatia 1).
// Aprovado + tipo==="responder" segue liberando normalmente. Gemini
// indisponivel mantem o comportamento anterior, sem transferencia.
//
// Etapa 6, quinta fatia (2026-08-16, Componente 1 §16, a parte de
// ENVIO): aprovado + tipo==="responder" -> envia o texto real do
// Gemini ao cliente via WhatsApp Cloud API. deveTransferir E a RPC
// realmente acionou agora (nao "ja_transferida"/erro) -> envia a
// mensagem fixa MENSAGEM_TRANSFERENCIA_CLIENTE (nunca o texto do
// Gemini sobre a transferencia). "ja_transferida"/erro na RPC ->
// NAO envia de novo (mesma disciplina do aviso ao Jose, §16-A).
//
// Componente 1 §16-A (2026-08-16, implementado tecnicamente,
// aguardando aprovacao do Message Template pela Meta): mesmo bloco
// "acionou agora" acima -- se WHATSAPP_JOSE_NUMERO estiver
// configurado, envia o template nova_transferencia_humana ao Jose.
// Best-effort: falha no aviso nunca desfaz a transferencia nem afeta
// o envio ao cliente, ja concluidos antes deste passo. NAO implementa
// Webhook (Componente 3) -- fatia/frente futura.
//
// Painel de Atendimento, Fatia 1+2+3 (2026-08-16, Componente 5 §12 e
// Componente 1 §15-A):
//   - Passo 0 (aguardando_humano): a mensagem do cliente agora carrega
//     o episodio_id certo (conversa.episodio_atual_id), nao mais null.
//   - Fluxo normal, tipo==="responder" sem transferencia: ninguem mais
//     loga essa troca sozinho -- o Orquestrador grava cliente+ia aqui,
//     episodio_id=null (fluxo so-IA, fora de qualquer episodio).
//   - Fluxo normal, deveTransferir: a RPC acionar_transferencia_humana
//     ja grava cliente+ia com o episodio_id certo -- NAO duplicar aqui.
//   - Gemini indisponivel: ainda assim loga a mensagem do cliente
//     (episodio_id=null) -- "sempre, qualquer estado" (Componente 5
//     §12). Transferencia automatica por indisponibilidade do Gemini
//     (Componente 1 §11) permanece fora de escopo desta fatia, gap
//     pre-existente, nao mexido agora.
//   - Antes de enviar a resposta real da IA (so no caminho
//     tipo==="responder"), reconsulta conversas_estado -- se um
//     operador assumiu manualmente enquanto este fluxo estava em
//     andamento, NAO envia (evita IA e humano respondendo ao mesmo
//     tempo). A resposta ja computada permanece registrada como
//     contexto (linha acima), nunca e' descartada de verdade.
//
// Entrada temporaria para teste direto -- o Webhook real (Componente
// 3) ja existe e e' o caminho normal de producao; esta entrada segue
// disponivel so' para teste manual. Formato:
//   POST { telefone: string, conteudo: string, nomeContato?: string }
//
// nome_snapshot (evolucao arquitetural aprovada, 2026-08-21/22,
// inovatv_central CLAUDE.md): passa a vir sempre de nomeContato
// (contacts[].profile.name da Meta, repassado pelo Webhook) -- nunca
// mais de um acesso do Rocket. Ver bloco logo apos buscarOuCriarConversa.
// Entrada de teste direto sem nomeContato continua funcionando, so'
// nao atualiza nome_snapshot nessa chamada.
//
// Etapa 1 do fluxo de renovacao automatica (tipo === "propor_renovacao").
// Dividida em 1a e 1b (docs/propor_renovacao/LEVANTAMENTO_ETAPA1.md,
// secoes 6 e 9 -- achado real de 2026-08-23: "comprovado tecnicamente"
// nao e' o mesmo que "concluido").
//
// Etapa 1a (comprovada, diagnostico): Aprovado pelo Validador -> resolve
// o acesso/public_id a partir dos dados ESTRUTURADOS ja em memoria
// (statusResults), nunca por parsing livre do texto atras de um UUID
// (Lacuna 3) -- expoe o resultado na resposta JSON de retorno (campo
// "renovacao"), mesmo padrao ja usado para match/gemini/conhecimento.
//
// Etapa 1b (secao 9, Opcao 1 aprovada 2026-08-23): o proprio texto do
// Gemini (ja validado pelo Validador, mesmo caminho de
// tipo === "responder") agora e' realmente enviado ao cliente, com a
// mesma re-checagem de concorrencia (Componente 1 §15-A). Isolamento
// estrito, sem excecao: NESTA ETAPA nunca cria cobranca PagBank, nunca
// gera token, nunca chama Sigma/Rocket para renovar, nunca altera
// vencimento, nunca cria estado de pagamento, nunca envia a mensagem
// intermediaria da Etapa 4, nunca antecipa decisao da Etapa 2 -- so' a
// confirmacao de reconhecimento. Regra de persistencia (ajustada
// 2026-08-23, revisao do usuario): origem="ia" so' e' gravada quando o
// envio efetivamente teve sucesso -- nunca por antecipacao, nunca se a
// re-checagem detectar humano, nunca se o envio falhar.
// Reprovado (Validador) continua caindo em deveTransferir, sem
// nenhuma mudanca -- so' aprovado + tipo==="propor_renovacao" e' novo.
//
// Memoria de sessao -- extensao com intencao_atual (2026-08-23): achado
// real de teste no WhatsApp, cliente com 2 acessos mandou "quero
// renovar meu plano" (tipo=responder, pergunta qual acesso) seguido de
// "2" -- a intencao ja estabelecida na primeira mensagem se perdia,
// porque so' acesso_selecionado existia na sessao ate entao. Mesma
// Camada 3, mesmo TTL/invalidacao ja existentes (sessao_atividade_em,
// Passo 0-B, e as 3 RPCs de atendimento humano) -- nunca decide
// sozinha o "tipo" da resposta (isso continua sendo julgamento do
// Gemini, dentro do SYSTEM_PROMPT ja congelado), so' entra como pista
// em [CONTEXTO DA CONVERSA] (montarContextoConversa).
//
// Bloco 1 -- fluxo de renovacao com Pix real (2026-08-23,
// docs/renovacao_automatica/PLANO_MESTRE_IMPLEMENTACAO.md, Etapas 2/3).
// Substitui INTEIRAMENTE a orientacao generica de Pix implementada mais
// cedo no mesmo dia (nunca vinculada a uma cobranca real).
//
// Provedor trocado de PagBank para OpenPix em 2026-08-24 (ver
// inovatv_central/CLAUDE.md) -- PagBank exige CPF/CNPJ do cliente
// pagador em toda modalidade de Pix avulso, incompativel com o
// requisito de nao coletar nenhum dado do cliente; OpenPix confirmou
// isso em POC real de Sandbox. Codigo PagBank (_shared/pagbank_client.ts,
// poc-pagbank-criar-cobranca/) preservado, nao apagado -- decisao
// explicita do usuario, limpeza fica para depois da renovacao completa
// funcionar.
//
// Bloco 2 (2026-08-24) -- MUDA a responsabilidade de
// processarCobrancaRenovacao: com o acesso resolvido
// (propostaRenovacaoComAcesso), a funcao agora reaproveita uma
// SOLICITACAO ativa existente pro mesmo acesso (tokens_renovacao,
// nunca duplica -- indice unico parcial no banco); senao, envia
// mensagem 1 fixa -> consulta dados completos DIRETO no Rocket (nunca
// via /status) -> cria tokens_renovacao -> envia mensagem 2 fixa com
// o LINK de confirmacao (ACEITO/CANCELAR). Isolamento estrito, ainda
// mais restrito que antes: NAO cria cobranca aqui (isso so' acontece
// depois do ACEITO, dentro de confirmacao-renovacao/index.ts), NAO
// chama Sigma, NAO altera vencimento. Inversao de ordem aprovada
// explicitamente -- ACEITO acontece ANTES da cobranca existir, nao
// depois do pagamento como no desenho original das Lacunas 1-9.

import { jsonResponse, errorResponse } from "../_shared/http.ts";
import {
  buscarOuCriarConversa,
  acionarTransferenciaHumana,
  atualizarNomeSnapshot,
  atualizarSessao,
  expirarSessaoAtomicamente,
} from "../_shared/conversas_estado.ts";
import { inserirMensagem } from "../_shared/mensagens_atendimento.ts";
import {
  chamarMatch,
  chamarStatus,
  type StatusResult,
} from "../_shared/rocket_intermediaria.ts";
import { montarContextoCliente, montarContextoConversa } from "../_shared/contexto.ts";
import { buscarConhecimentoRelevante } from "../_shared/conhecimento.ts";
import { chamarGemini } from "../_shared/gemini_client.ts";
import { validarResposta } from "../_shared/validador.ts";
import { enviarMensagemWhatsApp, enviarMensagemInterativaWhatsApp, enviarTemplateWhatsApp } from "../_shared/whatsapp_client.ts";
import {
  MENSAGEM_TRANSFERENCIA_CLIENTE,
  NOME_TEMPLATE_NOVA_TRANSFERENCIA,
  IDIOMA_TEMPLATE_NOVA_TRANSFERENCIA,
  MENSAGEM_SESSAO_EXPIRADA,
  MENSAGEM_BUSCANDO_DADOS_RENOVACAO,
  MENSAGEM_JA_EXISTE_SOLICITACAO_RENOVACAO,
  MENSAGEM_RENOVACAO_UNITV_NAO_INTEGRADA,
  MENSAGEM_RENOVACAO_LOTE_COM_UNITV,
  formatarValorBRL,
  paraCentavos,
  montarMensagemBotoesConfirmacaoRenovacao,
  montarMensagemMultiplosAcessosRenovacao,
  montarMensagemConfirmacaoLote,
} from "../_shared/mensagens_fixas.ts";
import { normalizarTelefone } from "../_shared/telefone.ts";
import { nomeApareceComoPalavra } from "../_shared/rotulo_acesso.ts";
import { consultarClienteCompletoRocket } from "../_shared/rocket_valor_cliente.ts";
import { buscarTokenAtivoPorPublicId, criarTokenRenovacao } from "../_shared/tokens_renovacao.ts";
// Renovacao em lote (Etapa 1, 2026-08-29) -- entrada "0" na lista de
// multiplos acessos = renovar todos de uma vez. Precificacao e
// criacao do lote sao deterministicas; UniTV entra como tipo desde ja
// (executor stub, sem chamada real -- Etapa 2).
import { resolverPrecoLote } from "../_shared/precos_renovacao.ts";
import { criarRenovacaoLote, existeLoteAtivoParaPublicId } from "../_shared/renovacoes_lote.ts";
// Etapa 1.5 (Lacuna A, 2026-08-28) -- roteamento por tipo de acesso.
// UniTV nunca segue o fluxo Sigma (nao cria token tipo='sigma', nao
// cobra). Ate a Etapa 2, acesso UniTV -> tratamento explicito
// "UniTV ainda nao integrada" + transferencia humana, sem cobranca.
import { classificarTipoAcesso } from "../_shared/tipo_acesso.ts";

// Memoria de sessao (Camada 3, 2026-08-23 -- ver
// docs/propor_renovacao/ACHADO_SELECAO_ACESSO_NAO_PERSISTE.md, secao
// 8). 1h de inatividade, contada exclusivamente a partir de
// sessao_atividade_em (timestamp UNICO da sessao inteira, nunca por
// campo) -- checagem em leitura, sem pg_cron, sem aviso automatico de
// expiracao iminente, sem processo em segundo plano (decisao
// explicita do usuario). Escopo desta implementacao: SOMENTE sessao
// ativa -- sem memoria persistente entre sessoes (Camada 2), sem
// Redis, sem antecipar campos das Etapas 2-4.
const SESSAO_TTL_MS = 60 * 60 * 1000;

// Etapa 1 (propor_renovacao) -- resolve qual StatusResult corresponde
// ao acesso citado no texto do Gemini, usando os MESMOS dados
// estruturados (statusResults) ja montados mais abaixo para o
// contexto -- nunca reconsulta nada, nunca faz parsing livre atras de
// um UUID (Lacuna 3). Chamada de forma INDEPENDENTE da checagem
// equivalente que o Validador ja fez (validarPropostaRenovacao,
// _shared/validador.ts) -- nunca reaproveita o resultado interno dele
// (Componente 4 §5: Validador nunca decide dado de negocio).
//
// Contrato de identificacao -- FECHADO apos achado real do Caso 1
// (docs/propor_renovacao/ACHADO_CASO1_RESOLUCAO_ACESSO.md, secao 6):
// SO' o nome do SERVIDOR, como palavra/token inteiro, resolve o
// acesso -- nunca nome de plano isolado (protege o Caso 9). A mesma
// regra do Validador (validarPropostaRenovacao), aplicada aqui de
// forma independente contra StatusResult[] em vez de
// ContextoParseado.acessos[].
// Memoria de sessao (2026-08-23): acessoSelecionadoServidor e' o nome
// do servidor ja resolvido a partir de conversas_estado.acesso_selecionado
// (public_id), reconferido pelo CHAMADOR contra o mesmo statusResults
// desta chamada -- so' entra como fallback quando a mensagem atual, por
// si so', nao resolveu nada (0 correspondencias). Nunca sobrepoe um
// rotulo explicito da mensagem atual, nunca decide em caso de
// ambiguidade genuina (2+ correspondencias na mensagem atual).
function resolverAcessoRenovacao(
  texto: string,
  statusResults: StatusResult[],
  acessoSelecionadoServidor: string | null,
): StatusResult | null {
  if (statusResults.length === 1) return statusResults[0];

  const correspondencias = statusResults.filter((s) =>
    nomeApareceComoPalavra(texto, s.cliente?.servidorNome ?? ""),
  );
  if (correspondencias.length === 1) return correspondencias[0];

  if (correspondencias.length === 0 && acessoSelecionadoServidor) {
    const viaSessao = statusResults.filter(
      (s) => s.cliente?.servidorNome?.toLowerCase() === acessoSelecionadoServidor.toLowerCase(),
    );
    if (viaSessao.length === 1) return viaSessao[0];
  }

  return null;
}

// Etapa 1.5 (2026-08-28) -- ordem DETERMINISTICA dos acessos de um
// cliente com multiplos acessos. A lista numerada
// (montarMensagemMultiplosAcessosRenovacao, "*1. ...*") e a selecao
// numerica ("1"/"2") sao computadas em REQUISICOES DIFERENTES (a lista
// numa mensagem, a escolha na seguinte) -- cada uma refaz o /match, e
// o Rocket nao garante por contrato devolver os clientes na mesma
// ordem nas duas chamadas. Ordenando pelos MESMOS campos nas duas
// pontas, a posicao N e' sempre o mesmo acesso enquanto o CONJUNTO de
// acessos nao muda -- independente da ordem que o Rocket devolveu.
// Chave estavel dentro de uma conversa: servidorNome -> nome do
// cliente -> publicId. Usada na lista, na selecao numerica e no lote,
// pra que as tres vejam exatamente a mesma ordem.
function ordenarAcessosMultiplos(
  statusResults: StatusResult[],
): (StatusResult & { cliente: NonNullable<StatusResult["cliente"]> })[] {
  return statusResults
    .filter(
      (s): s is StatusResult & { cliente: NonNullable<StatusResult["cliente"]> } =>
        s.outcome === "success" && !!s.cliente,
    )
    .sort((a, b) => {
      const porServidor = (a.cliente.servidorNome ?? "").localeCompare(b.cliente.servidorNome ?? "");
      if (porServidor !== 0) return porServidor;
      const porNome = (a.cliente.nome ?? "").localeCompare(b.cliente.nome ?? "");
      if (porNome !== 0) return porNome;
      return (a.publicId ?? "").localeCompare(b.publicId ?? "");
    });
}

// Memoria de sessao (2026-08-23): grava acesso_selecionado SO' quando
// a resposta EFETIVAMENTE ENVIADA (chamador so' invoca isto apos
// confirmar envioResultado.enviado === true, nunca por antecipacao)
// citar exatamente um servidor do conjunto atual como palavra inteira
// -- mesma disciplina de ambiguidade ja usada no Validador/resolucao
// de acesso (0 ou 2+ correspondencias nunca gravam nada). Objetivo
// documentado: "cliente escolhe 2 -> sistema identifica NewOne ->
// cliente depois diz 'esse acesso'". Best-effort: falha ao gravar
// nunca desfaz o envio ja concluido.
async function gravarAcessoSelecionadoSeCitado(
  conversationId: string,
  texto: string,
  statusResults: StatusResult[],
): Promise<void> {
  if (statusResults.length <= 1) return;

  const citados = statusResults.filter((s) =>
    s.cliente?.servidorNome ? nomeApareceComoPalavra(texto, s.cliente.servidorNome) : false,
  );
  if (citados.length !== 1) return;

  await atualizarSessao(conversationId, { acessoSelecionado: citados[0].publicId }).catch(
    () => {},
  );
}

// Memoria de sessao (extensao 2026-08-23) -- grava intencao_atual
// SO' quando a mensagem ATUAL do cliente contem "renovar" (ou
// variacao morfologica direta) como palavra inteira. Sinal
// deliberadamente conservador: nao tenta capturar intencao indireta
// (ex.: "meu plano venceu, quero continuar usando", "quanto fica pra
// renovar?") -- esses casos ficam fora desta implementacao, sem
// mudar o comportamento ja existente (continuam dependendo de uma
// mensagem explicita seguinte, ou resolvendo em uma unica mensagem
// quando ha' so' 1 acesso). Escopo restrito a mais de 1 acesso -- com
// 1 so' acesso, propor_renovacao ja resolve numa unica mensagem
// (Caso 1), sem precisar de sessao. Mesma disciplina de
// acesso_selecionado: so' chamada pelo chamador apos confirmar
// envioResultado.enviado === true (nunca por antecipacao). Nao
// participa de nenhuma checagem do Validador (Componente 4 §5
// preservado) -- so' influencia o que o Gemini VE no proximo turno,
// via [CONTEXTO DA CONVERSA] (montarContextoConversa).
const REGEX_INTENCAO_RENOVACAO = /\brenova(r|ç[aã]o|cao|ndo|d[ao])\b/i;

// Renovacao em lote (Etapa 1, 2026-08-29) -- resposta do cliente a
// lista de multiplos acessos pedindo pra renovar TODOS de uma vez.
// "0" e' a entrada canonica (a propria mensagem da lista instrui
// "digite ... ou *0* para renovar os dois"); as variacoes por extenso
// cobrem o cliente que responde em palavras. Deliberadamente NAO
// captura intencao vaga ("renova tudo ai") sem ser resposta direta a
// lista -- so' dispara quando ja ha' 2+ acessos E intencao de renovar
// registrada (mesma guarda de interceptarListaMultiplosAcessos).
const REGEX_SELECAO_LOTE = /^\s*0\s*$|\b(os dois|as duas|ambos|ambas|todos(?: os \d+)?|todas(?: as \d+)?)\b/i;

async function gravarIntencaoRenovacaoSeDemonstrada(
  conversationId: string,
  textoClienteAtual: string,
  statusResults: StatusResult[],
): Promise<void> {
  if (statusResults.length <= 1) return;
  if (!REGEX_INTENCAO_RENOVACAO.test(textoClienteAtual)) return;

  await atualizarSessao(conversationId, { intencaoAtual: "renovacao" }).catch(() => {});
}

// Bloco 2 do fluxo de renovacao automatica (2026-08-24,
// inovatv_central/CLAUDE.md, desenho aprovado). So' chamada quando
// propostaRenovacao foi aprovada E o acesso ja foi resolvido com
// certeza (acessoResolvido != null) -- nunca decide isso sozinha.
// Isolamento estrito: NAO cria cobranca aqui (isso so' acontece
// depois do ACEITO, em confirmacao-renovacao/index.ts), NAO trata
// imagem/comprovante, NAO gera token de renovacao Sigma, NAO chama
// Sigma, NAO altera vencimento -- so' leva a conversa ate' o cliente
// ter o link de confirmacao em maos.
//
// Ordem: (1) reaproveita SOLICITACAO ativa existente pro mesmo acesso
// (tokens_renovacao), nunca duplica -- reforcado por unique index
// parcial no banco; (2) senao, envia a mensagem 1 (fixa, neutra, ANTES
// de qualquer chamada externa lenta); (3) consulta os dados completos
// direto no Rocket (nunca via /status); (4) cria tokens_renovacao
// (estado inicial 'aguardando_confirmacao'); (5) envia a mensagem 2
// (fixa, com os dados + link ACEITO/CANCELAR). Falha em (3) -> transfere
// pra humano, reaproveitando O MESMO mecanismo generico ja usado no
// resto do arquivo (acionarTransferenciaHumana + MENSAGEM_TRANSFERENCIA_CLIENTE
// + aviso ao Jose) -- nenhum mecanismo novo de transferencia.
async function processarCobrancaRenovacao(
  conversa: { conversation_id: string },
  telefone: string,
  conteudo: string,
  geminiTexto: string,
  acessoResolvido: StatusResult,
  usuarioResolvido: string | null,
): Promise<{
  envioResultado: { enviado: boolean };
  transferenciaResultado?: { acionada: boolean; motivo: string };
  avisoJoseResultado?: { enviado: boolean };
  textoEnviado: string | null;
}> {
  const publicId = acessoResolvido.publicId as string;

  // Mesmo mecanismo generico de transferencia ja usado no resto do
  // arquivo (motivoTransferencia + acionarTransferenciaHumana +
  // MENSAGEM_TRANSFERENCIA_CLIENTE + aviso ao Jose) -- so' reaproveitado
  // aqui dentro, para os 2 casos de falha que so' sao descobertos DEPOIS
  // de a mensagem 1 (fixa) ja ter sido enviada (por isso nao passam pelo
  // deveTransferir calculado antes, no corpo principal).
  // mensagemCliente (Etapa 1.5, 2026-08-28): por padrao a frase generica
  // de transferencia. Casos com mensagem propria (ex.: acesso UniTV nao
  // integrado) passam o texto especifico -- o resto do mecanismo
  // (acionarTransferenciaHumana + persistencia + aviso ao Jose) e'
  // identico.
  async function transferirPorFalha(
    motivo: string,
    mensagemCliente: string = MENSAGEM_TRANSFERENCIA_CLIENTE,
  ) {
    let transferenciaResultado: { acionada: boolean; motivo: string };
    try {
      const resultado = await acionarTransferenciaHumana(
        conversa.conversation_id,
        motivo,
        conteudo,
        geminiTexto,
      );
      transferenciaResultado =
        resultado.outcome === "acionada"
          ? { acionada: true, motivo }
          : { acionada: false, motivo: "ja_transferida_por_outra_requisicao" };
    } catch {
      transferenciaResultado = { acionada: false, motivo: "falha_ao_registrar" };
    }

    let envioResultado = { enviado: false };
    let avisoJoseResultado: { enviado: boolean } | undefined;
    if (transferenciaResultado.acionada) {
      const envio = await enviarMensagemWhatsApp(telefone, mensagemCliente);
      envioResultado = { enviado: envio.outcome === "success" };
      if (envioResultado.enviado) {
        // C5 (bloco de renovacao 2026-08-28): grava no historico do
        // Painel a frase fixa que o cliente efetivamente recebeu. A RPC
        // acionar_transferencia_humana ja gravou cliente + texto de
        // contexto; isto adiciona o que foi de fato enviado. Best-effort.
        await inserirMensagem(conversa.conversation_id, "ia", mensagemCliente, null).catch(() => {});
      }

      const numeroJose = Deno.env.get("WHATSAPP_JOSE_NUMERO");
      if (numeroJose) {
        const aviso = await enviarTemplateWhatsApp(
          numeroJose,
          NOME_TEMPLATE_NOVA_TRANSFERENCIA,
          IDIOMA_TEMPLATE_NOVA_TRANSFERENCIA,
          [transferenciaResultado.motivo],
        );
        avisoJoseResultado = { enviado: aviso.outcome === "success" };
      }
    }
    return { envioResultado, transferenciaResultado, avisoJoseResultado, textoEnviado: null };
  }

  // Disciplina de log (2026-08-23): a mensagem do CLIENTE e' gravada
  // EXATAMENTE UMA VEZ em cada caminho -- ou pela RPC
  // acionar_transferencia_humana (transferirPorFalha, que ja' grava
  // cliente+ia+sistema sozinha), ou explicitamente aqui, so' nos
  // caminhos que NAO vao transferir. Nunca as duas coisas juntas (isso
  // duplicaria a mensagem do cliente no historico).

  // Re-checagem de concorrencia (Componente 1 §15-A) -- feita 1x aqui,
  // no inicio: se um operador ja assumiu a conversa antes mesmo de
  // comecarmos, nao envia nada. Simplificacao deliberada do Bloco 1
  // (nao re-checa de novo entre a mensagem 1 e a mensagem 2, ja que
  // nenhum dinheiro real e' confirmado nesta etapa -- so' mostrar um
  // Pix) -- pode ser revisto no Bloco 2, onde a confirmacao real
  // acontece.
  const conversaAtual = await buscarOuCriarConversa(telefone);
  if (conversaAtual.estado === "aguardando_humano") {
    try {
      await inserirMensagem(conversa.conversation_id, "cliente", conteudo, null);
    } catch {
      // best-effort, mesma filosofia do aviso ao Jose (§16-A)
    }
    return { envioResultado: { enviado: false }, textoEnviado: null };
  }

  // 0-A) Roteamento por TIPO de acesso (Etapa 1.5, Lacuna A, 2026-08-28).
  // Feito ANTES de qualquer coisa (guard de lote, consulta ao Rocket,
  // criacao de token, "buscando dados..."). Se o acesso for UniTV, o
  // fluxo Sigma nunca e' seguido: nao cria tokens_renovacao tipo='sigma',
  // nao consulta valor, nao cria cobranca. Envia a mensagem fixa de
  // "UniTV ainda nao integrada" e aciona atendimento humano (mesmo
  // mecanismo generico -- transferirPorFalha, com texto proprio). A
  // execucao real da UniTV e' Etapa 2.
  if (classificarTipoAcesso(acessoResolvido.cliente?.servidorNome) === "unitv") {
    return await transferirPorFalha(
      "renovacao:unitv_nao_integrada",
      MENSAGEM_RENOVACAO_UNITV_NAO_INTEGRADA,
    );
  }

  // 0) Renovacao em lote (Etapa 1, 2026-08-29): se este acesso ja faz
  // parte de um LOTE ativo, ele pertence EXCLUSIVAMENTE ao fluxo de
  // lote -- o fluxo individual nunca cria token novo nem opera sobre um
  // token de lote (grupo_id != null). Apenas informa "ja ha' uma
  // renovacao em andamento" e para -- mesmo texto/comportamento de
  // quando ja existe um token individual ativo (passo 1 abaixo). Feito
  // ANTES de qualquer consulta ao Rocket / criacao de token.
  let temLoteAtivo = false;
  try {
    temLoteAtivo = await existeLoteAtivoParaPublicId(publicId);
  } catch {
    // best-effort: se a checagem falhar, segue o fluxo normal -- o
    // indice unico parcial do banco ainda barra um token duplicado.
  }
  if (temLoteAtivo) {
    try {
      await inserirMensagem(conversa.conversation_id, "cliente", conteudo, null);
    } catch {
      // best-effort
    }
    const envio = await enviarMensagemWhatsApp(telefone, MENSAGEM_JA_EXISTE_SOLICITACAO_RENOVACAO);
    if (envio.outcome === "success") {
      try {
        await inserirMensagem(conversa.conversation_id, "ia", MENSAGEM_JA_EXISTE_SOLICITACAO_RENOVACAO, null);
      } catch {
        // best-effort
      }
    }
    return {
      envioResultado: { enviado: envio.outcome === "success" },
      textoEnviado: envio.outcome === "success" ? MENSAGEM_JA_EXISTE_SOLICITACAO_RENOVACAO : null,
    };
  }

  // 1) Solicitacao ATIVA ja existe pra este acesso? (nunca duplica --
  // unique index parcial em tokens_renovacao)
  let tokenExistente;
  try {
    tokenExistente = await buscarTokenAtivoPorPublicId(publicId);
  } catch {
    return await transferirPorFalha("renovacao:falha_consultar_token");
  }

  if (tokenExistente) {
    try {
      await inserirMensagem(conversa.conversation_id, "cliente", conteudo, null);
    } catch {
      // best-effort
    }
    const envio = await enviarMensagemWhatsApp(telefone, MENSAGEM_JA_EXISTE_SOLICITACAO_RENOVACAO);
    if (envio.outcome === "success") {
      try {
        await inserirMensagem(conversa.conversation_id, "ia", MENSAGEM_JA_EXISTE_SOLICITACAO_RENOVACAO, null);
      } catch {
        // best-effort
      }
    }
    return {
      envioResultado: { enviado: envio.outcome === "success" },
      textoEnviado: envio.outcome === "success" ? MENSAGEM_JA_EXISTE_SOLICITACAO_RENOVACAO : null,
    };
  }

  // 2) Mensagem 1 (fixa) -- confirmacao neutra, antes de qualquer
  // chamada externa lenta (Rocket). Ainda NAO grava "cliente" aqui --
  // se a consulta falhar logo abaixo, o fluxo termina em
  // transferirPorFalha, que grava cliente+ia+sistema sozinho; gravar
  // agora duplicaria. O log desta mensagem 1 especifica (se enviada)
  // so' acontece mais abaixo, apos confirmar que NAO vamos transferir.
  const envioMsg1 = await enviarMensagemWhatsApp(telefone, MENSAGEM_BUSCANDO_DADOS_RENOVACAO);

  // 3) Dados completos, direto no Rocket -- NUNCA via /status. Ausente/
  // invalido -> transfere, nunca inventa.
  const dadosResultado = await consultarClienteCompletoRocket(publicId);
  const valorCentavos =
    dadosResultado.outcome === "success" ? paraCentavos(dadosResultado.valor) : null;
  if (dadosResultado.outcome !== "success" || !valorCentavos) {
    return await transferirPorFalha("renovacao:valor_nao_cadastrado");
  }

  // 4) Cria tokens_renovacao -- estado inicial 'aguardando_confirmacao',
  // expira em 2h (decisao aprovada). Nenhuma cobranca criada ainda --
  // so' acontece depois do ACEITO (confirmacao-renovacao/index.ts).
  //
  // Corrida real possivel (correcao de risco, 2026-08-24, revisao do
  // Bloco 2): duas mensagens quase simultaneas do mesmo cliente pra
  // este acesso podem passar as duas pelo passo 1 (SELECT nao e'
  // atomico com este INSERT) -- o indice unico parcial do banco
  // (tokens_renovacao_ativo_unico_por_acesso_idx) corretamente barra a
  // segunda insercao, mas precisa deste try/catch pra nao subir como
  // excecao nao tratada. Deliberadamente feito AINDA ANTES do "commit
  // point" de gravar a mensagem do cliente (movido pra baixo desta
  // criacao, ver comentario abaixo) -- assim, se cair aqui, ainda e'
  // seguro reaproveitar transferirPorFalha/o padrao do passo 1 sem
  // duplicar nenhum log.
  let criacaoToken: Awaited<ReturnType<typeof criarTokenRenovacao>>;
  try {
    criacaoToken = await criarTokenRenovacao({
      conversationId: conversa.conversation_id,
      publicId,
      telefone,
      clienteNome: dadosResultado.nome,
      servidorNome: dadosResultado.servidorNome,
      planoNome: dadosResultado.planoNome,
      valorEsperadoCentavos: valorCentavos,
      vencimentoAtual: dadosResultado.vencimento,
    });
  } catch (erro) {
    console.log(
      "[orchestrator] falha ao criar tokens_renovacao -- verificando se e' corrida com solicitacao ja existente",
      JSON.stringify({ publicId, erro: String(erro) }),
    );

    let tokenAtivoAposFalha = null;
    try {
      tokenAtivoAposFalha = await buscarTokenAtivoPorPublicId(publicId);
    } catch {
      // ignora -- cai no fallback generico abaixo
    }

    if (tokenAtivoAposFalha) {
      // Confirma: foi a corrida do INSERT com outra requisicao pro
      // mesmo acesso -- mesmo texto/comportamento do passo 1.
      try {
        await inserirMensagem(conversa.conversation_id, "cliente", conteudo, null);
      } catch {
        // best-effort
      }
      const envio = await enviarMensagemWhatsApp(telefone, MENSAGEM_JA_EXISTE_SOLICITACAO_RENOVACAO);
      if (envio.outcome === "success") {
        try {
          await inserirMensagem(conversa.conversation_id, "ia", MENSAGEM_JA_EXISTE_SOLICITACAO_RENOVACAO, null);
        } catch {
          // best-effort
        }
      }
      return {
        envioResultado: { enviado: envio.outcome === "success" },
        textoEnviado: envio.outcome === "success" ? MENSAGEM_JA_EXISTE_SOLICITACAO_RENOVACAO : null,
      };
    }

    // Falha genuinamente inesperada (nao a corrida) -- ainda antes do
    // "commit point", reaproveita o mesmo mecanismo generico de
    // transferencia de sempre, sem risco de duplicar log.
    return await transferirPorFalha("renovacao:falha_criar_token");
  }
  const { registro } = criacaoToken;

  // 5) Mensagem 2 interativa (dados reais do Rocket, sem URL/token bruto).
  const valorFormatado = formatarValorBRL(valorCentavos / 100) ?? "0,00";
  const vencimentoFormatado = new Date(registro.vencimento_atual).toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });
  const texto2 = montarMensagemBotoesConfirmacaoRenovacao({
    clienteNome: registro.cliente_nome,
    usuario: usuarioResolvido ?? "não informado",
    servidorNome: registro.servidor_nome,
    planoNome: registro.plano_nome,
    valorFormatado,
    vencimentoFormatado,
  });
  const envio2 = await enviarMensagemInterativaWhatsApp(telefone, texto2, [
    { id: `renovacao:aceitar:${registro.token_hash}`, titulo: "ACEITO" },
    { id: `renovacao:cancelar:${registro.token_hash}`, titulo: "CANCELAR" },
  ]);
  if (envio2.outcome !== "success") {
    // O token ja existe, mas a proposta nao chegou ao cliente. O helper
    // registra cliente+contexto uma unica vez e aciona o atendimento
    // humano, sem inventar fallback por link.
    return await transferirPorFalha("renovacao:falha_enviar_botoes_confirmacao");
  }

  try {
    await inserirMensagem(conversa.conversation_id, "cliente", conteudo, null);
  } catch {
    // best-effort
  }
  if (envioMsg1.outcome === "success") {
    try {
      await inserirMensagem(conversa.conversation_id, "ia", MENSAGEM_BUSCANDO_DADOS_RENOVACAO, null);
    } catch {
      // best-effort
    }
  }
  try {
    await inserirMensagem(conversa.conversation_id, "ia", texto2, null);
  } catch {
    // best-effort
  }

  return {
    envioResultado: { enviado: true },
    textoEnviado: texto2,
  };
}

Deno.serve(async (req: Request) => {
  // Componente 3, decisao arquitetural 2 (2026-08-17): unica fonte de
  // autenticacao real desta function -- verify_jwt fica desligado no
  // deploy (nao e' codigo, e' flag de deploy). Checagem simples e
  // segura (sem exigir resistencia a timing attack, decisao ja
  // aprovada), antes de qualquer outra coisa -- inclusive antes do
  // metodo e de req.json(). Nunca reflete o token recebido/esperado
  // em log ou resposta, so a decisao (autorizado ou nao).
  const tokenInterno = Deno.env.get("ORCHESTRATOR_INTERNAL_TOKEN");
  const tokenRecebido = req.headers.get("X-Internal-Token");
  if (!tokenInterno || !tokenRecebido || tokenRecebido !== tokenInterno) {
    return errorResponse("Nao autorizado", 401);
  }

  if (req.method !== "POST") {
    return errorResponse("Metodo nao suportado, use POST", 405);
  }

  let body: { telefone?: string; conteudo?: string; nomeContato?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Corpo da requisicao precisa ser JSON valido");
  }

  const { telefone: telefoneBruto, conteudo, nomeContato } = body;
  if (!telefoneBruto || !conteudo) {
    return errorResponse("Campos obrigatorios: telefone, conteudo");
  }

  // Bug 3 (achado real, bateria de testes reais pelo Webhook,
  // 2026-08-21): normaliza aqui, no topo, antes de qualquer uso --
  // cobre os dois pontos de entrada do Orquestrador (Webhook real e a
  // entrada de teste direto) com uma unica regra de identidade
  // interna (conversas_estado, contexto do Gemini, envio ao cliente).
  // NAO decide o formato enviado ao Rocket -- chamarMatch, mais
  // abaixo, usa deliberadamente telefoneBruto, nao este valor
  // canonico (decisao separada, ainda em aberto, ver _shared/telefone.ts).
  const telefone = normalizarTelefone(telefoneBruto);

  let conversa;
  try {
    conversa = await buscarOuCriarConversa(telefone);
  } catch {
    return jsonResponse(
      { outcome: "unavailable", message: "Falha ao consultar conversas_estado" },
      503,
    );
  }

  // Identidade do contato (evolucao arquitetural aprovada, 2026-08-21/22,
  // inovatv_central CLAUDE.md): nome_snapshot passa a vir SEMPRE do
  // proprio WhatsApp (contacts[].profile.name, repassado pelo Webhook
  // como nomeContato), nunca mais de um acesso do Rocket -- o Rocket
  // identifica cadastro/acessos, o WhatsApp identifica a pessoa/
  // conversa. Atualiza sempre que vier nome (decisao explicita do
  // usuario, item 7: nome_snapshot e' campo de exibicao/conveniencia,
  // nao fonte historica -- reflete sempre o nome de perfil mais
  // recente). Sem nome (Meta nao mandou / entrada de teste direto) =>
  // nao escreve nada, nome_snapshot existente permanece intocado.
  if (nomeContato) {
    await atualizarNomeSnapshot(conversa.conversation_id, nomeContato).catch(() => {});
  }

  // Passo 0 (Componente 1 §6): aguardando_humano -- so registra e para,
  // nunca chama Gemini enquanto um humano estiver cuidando da conversa
  // (Arquitetura Formal §11).
  if (conversa.estado === "aguardando_humano") {
    try {
      const mensagem = await inserirMensagem(
        conversa.conversation_id,
        "cliente",
        conteudo,
        conversa.episodio_atual_id,
      );
      return jsonResponse({
        outcome: "aguardando_humano",
        conversation_id: conversa.conversation_id,
        mensagem_registrada: mensagem.id,
      });
    } catch {
      return jsonResponse(
        { outcome: "unavailable", message: "Falha ao registrar mensagem" },
        503,
      );
    }
  }

  // Passo 0-B -- memoria de sessao (2026-08-23): so' dispara quando ha'
  // uma sessao anterior de verdade (sessao_atividade_em preenchido) --
  // a primeira mensagem de uma conversa nova nunca aciona isto. Tambem
  // nunca aciona logo apos um atendimento humano: as RPCs
  // acionar_transferencia_humana/assumir_atendimento (entrada em
  // aguardando_humano) e encerrar_atendimento_humano (saida) ja zeram
  // acesso_selecionado/sessao_atividade_em (migration
  // 20260823140000_sessao_ia_invalidada_por_atendimento_humano.sql,
  // decisao arquitetural: nenhum contexto operacional da IA atravessa
  // um atendimento humano) -- entao a primeira mensagem apos o humano
  // encerrar sempre ve sessao_atividade_em null, mesmo caso de "sessao
  // nova" acima, nunca "expirada". Mais de
  // 1h desde a ultima atividade -> limpa o contexto de sessao (so'
  // acesso_selecionado hoje), envia o aviso fixo (nunca gerado pelo
  // Gemini, mesmo padrao de MENSAGEM_TRANSFERENCIA_CLIENTE), e PARA --
  // a mensagem atual do cliente nunca chega ao Gemini nesta chamada
  // (mesmo espirito do Passo 0 acima: um "reinicio" e' tratado como
  // situacao propria, nao como conteudo pra responder). A proxima
  // mensagem do cliente processa normalmente, com sessao ja renovada.
  const agora = Date.now();
  const sessaoAnteriorEm = conversa.sessao_atividade_em
    ? new Date(conversa.sessao_atividade_em).getTime()
    : null;
  const sessaoExpirada = sessaoAnteriorEm !== null && agora - sessaoAnteriorEm > SESSAO_TTL_MS;

  if (sessaoExpirada) {
    try {
      await inserirMensagem(conversa.conversation_id, "cliente", conteudo, null);
    } catch {
      // best-effort, mesma filosofia do aviso ao Jose (§16-A)
    }

    // Achado da auditoria de concorrencia (2026-08-23): claim atomico
    // (CAS -- compare-and-swap) via expirarSessaoAtomicamente. So' a
    // requisicao que "vencer" (WHERE bateu com o valor antigo lido)
    // segue pra enviar o aviso fixo. A que perder ("ja_expirada_por_outra_requisicao")
    // ja teve a mensagem do cliente registrada acima (nunca perdida),
    // mas NAO envia nada -- outra requisicao concorrente ja enviou.
    // sessao_atividade_em nunca e' null aqui (garantido por
    // sessaoAnteriorEm !== null acima).
    const claim = await expirarSessaoAtomicamente(
      conversa.conversation_id,
      conversa.sessao_atividade_em as string,
    );

    if (claim.outcome === "ja_expirada_por_outra_requisicao") {
      return jsonResponse({
        outcome: "sessao_expirada",
        conversation_id: conversa.conversation_id,
        envio: { enviado: false },
        concorrencia: "ja_tratada_por_outra_requisicao",
      });
    }

    const envio = await enviarMensagemWhatsApp(telefone, MENSAGEM_SESSAO_EXPIRADA);
    if (envio.outcome === "success") {
      try {
        await inserirMensagem(conversa.conversation_id, "ia", MENSAGEM_SESSAO_EXPIRADA, null);
      } catch {
        // best-effort
      }
    }

    return jsonResponse({
      outcome: "sessao_expirada",
      conversation_id: conversa.conversation_id,
      envio: { enviado: envio.outcome === "success" },
    });
  }

  // Sessao valida (ou primeira mensagem desta conversa) -- renova a
  // atividade agora, ANTES de seguir o resto do fluxo. Client-driven:
  // a propria chegada da mensagem renova, independente do que
  // acontecer depois no processamento (Gemini indisponivel,
  // transferencia, etc.) -- "cada nova mensagem do cliente dentro da
  // janela mantem/renova a sessao" (decisao do usuario, sem excecao).
  await atualizarSessao(conversa.conversation_id, {
    sessaoAtividadeEm: new Date().toISOString(),
  }).catch(() => {});

  // estado === 'normal': encadeia /match, /status, contexto minimo,
  // Gemini (Etapa 5), validador (Etapa 6, segunda fatia), se
  // reprovado ou tipo==="transferir" marca aguardando_humano (Etapa
  // 6, terceira fatia), e envia a mensagem real ao cliente via
  // WhatsApp (Etapa 6, quinta fatia). NAO envia aviso ao Jose --
  // fatia futura.
  //
  // Bug 3 (2026-08-21): chamarMatch recebe deliberadamente
  // telefoneBruto (nao o telefone canonico) -- decisao explicita do
  // usuario de NAO alterar ainda o formato enviado ao Rocket, so
  // reaproveitar exatamente o comportamento ja validado ate aqui.
  const matchResult = await chamarMatch(telefoneBruto);

  let statusResults: StatusResult[] = [];
  if (matchResult.outcome === "single_match") {
    const candidato = matchResult.candidates[0];
    if (candidato?.publicId) {
      statusResults = [await chamarStatus(candidato.publicId)];
    }
  } else if (matchResult.outcome === "multiple_matches") {
    statusResults = await Promise.all(
      matchResult.candidates
        .filter((c) => !!c.publicId)
        .map((c) => chamarStatus(c.publicId as string)),
    );
  }

  const matchIndisponivel =
    matchResult.outcome === "unavailable" || matchResult.outcome === "invalid_request";

  const contextoCliente = montarContextoCliente(telefone, statusResults, {
    matchIndisponivel,
  });

  // Componente 2 (Camada de Conhecimento Empresarial, PROPOSTA_
  // INTEGRACAO_ORQUESTRADOR.md secao 1/3): busca so pelo texto da
  // mensagem do cliente, nunca dado de cliente. Roda sempre que o
  // fluxo chega aqui, independente de matchIndisponivel -- fontes
  // desacopladas por desenho (Arquitetura Formal §7).
  const conhecimentoResult = await buscarConhecimentoRelevante(conteudo);
  const contextoConhecimento =
    conhecimentoResult.outcome === "encontrado"
      ? `[CONHECIMENTO INSTITUCIONAL - ${conhecimentoResult.titulo}]\n${conhecimentoResult.conteudo}`
      : null;

  // Memoria de sessao (2026-08-23): resolve conversa.acesso_selecionado
  // (public_id guardado) contra o conjunto FRESCO de statusResults
  // desta chamada -- nunca confia no valor guardado sem reconferir. Se
  // o public_id nao existir mais no conjunto atual (acesso sumiu/
  // mudou), e' tratado como se nao houvesse selecao nenhuma -- sem
  // erro, sem aviso ao cliente.
  const acessoSelecionadoServidor = conversa.acesso_selecionado
    ? (statusResults.find((s) => s.publicId === conversa.acesso_selecionado)?.cliente
        ?.servidorNome ?? null)
    : null;
  // Memoria de sessao (extensao 2026-08-23): leitura direta, sem
  // reconferencia adicional -- intencao_atual nao e' um ponteiro pra
  // dado do Rocket (diferente de acesso_selecionado), so' um sinal de
  // continuidade conversacional, ja coberto pelo mesmo TTL/invalidacao
  // que zera esta e as outras 2 colunas juntas (Passo 0-B, e as 3 RPCs
  // de atendimento humano).
  const intencaoRenovacaoEstabelecida = conversa.intencao_atual === "renovacao";
  const contextoConversa = montarContextoConversa(
    acessoSelecionadoServidor,
    intencaoRenovacaoEstabelecida,
  );

  // "Regra de ouro" (secao 7 do levantamento): contextoCompleto e' o
  // UNICO texto de contexto a partir daqui -- passado identico para
  // chamarGemini() e para validarResposta() mais abaixo, nunca
  // contextoCliente sozinho por engano.
  const partesContexto = [contextoCliente, contextoConhecimento, contextoConversa].filter(
    (parte): parte is string => !!parte,
  );
  const contextoCompleto = partesContexto.length > 0 ? partesContexto.join("\n\n") : null;

  const geminiResult = await chamarGemini(conteudo, contextoCompleto);

  let geminiSaida: unknown = { outcome: "unavailable" };
  let validacaoResultado: { aprovado: boolean; motivo?: string } | undefined;
  let transferenciaResultado: { acionada: boolean; motivo: string } | undefined;
  let envioResultado: { enviado: boolean } | undefined;
  let avisoJoseResultado: { enviado: boolean } | undefined;
  // Etapa 1 (propor_renovacao) -- so' diagnostico, nunca enviado ao
  // cliente. acessoResolvido null quando o Validador aprovou mas a
  // resolucao por rotulo nao achou exatamente 1 correspondencia (nao
  // deveria acontecer, ja que o Validador ja checou isso -- mas esta
  // funcao nunca confia cegamente no resultado interno dele).
  let renovacaoDiagnostico:
    | {
        tipo: "propor_renovacao";
        acessoResolvido: {
          publicId: string | null;
          planoNome: string | null;
          servidorNome: string | null;
        } | null;
      }
    | undefined;

  if (geminiResult.outcome === "success") {
    const geminiData = geminiResult.data;
    const validacao = validarResposta(geminiData, contextoCompleto, acessoSelecionadoServidor);
    validacaoResultado = validacao.aprovado
      ? { aprovado: true }
      : { aprovado: false, motivo: validacao.motivo };
    geminiSaida = validacao.aprovado
      ? geminiData
      : { outcome: "bloqueado" };

    // Etapa 1 (propor_renovacao): so' entra aqui quando o Validador
    // APROVOU e o tipo e' propor_renovacao -- reprovado cai direto em
    // deveTransferir abaixo, sem nenhuma mudanca.
    const propostaRenovacao =
      validacao.aprovado && geminiData.tipo === "propor_renovacao";

    // Resolve o acesso JA' AQUI, antes de decidir o que enviar -- Etapa
    // 1a, sem nenhuma mudanca nela. A checagem de VALOR real (Bloco 1,
    // fluxo PagBank, 2026-08-23) deixou de acontecer aqui -- agora vem
    // de consultarValorClienteRocket (direto no Rocket, nunca via
    // /status, revertido nesta mesma etapa), dentro de
    // processarCobrancaRenovacao, mais abaixo -- so' depois que ja'
    // sabemos que o acesso foi resolvido com certeza.
    const acessoResolvidoRenovacao = propostaRenovacao
      ? resolverAcessoRenovacao(geminiData.texto, statusResults, acessoSelecionadoServidor)
      : null;
    const propostaRenovacaoComAcesso = propostaRenovacao && !!acessoResolvidoRenovacao;
    const propostaRenovacaoSemAcesso = propostaRenovacao && !propostaRenovacaoComAcesso;

    // Ajuste de apresentacao (2026-08-28, extensao aprovada apos achado
    // real): o caso COMUM de "multiplos acessos, cliente demonstrou
    // intencao de renovar mas nao citou qual" e' rejeitado pelo proprio
    // Validador (validarPropostaRenovacao, _shared/validador.ts) com
    // motivo "renovacao:acesso_nao_determinado" -- ANTES de chegar em
    // propostaRenovacaoSemAcesso (que e' so' o caso defensivo/raro, ja
    // pos-aprovacao). So' este motivo especifico de reprovacao sai do
    // caminho de transferencia -- todos os outros motivos do Validador
    // (credencial, telefone de outro cliente, valor/data inventados,
    // contagem de acessos divergente, plano/servidor rotulado errado,
    // "gemini:transferir") continuam transferindo exatamente como
    // sempre.
    const acessoNaoDeterminado =
      !validacao.aprovado && validacao.motivo === "renovacao:acesso_nao_determinado";
    // Uniao dos dois casos onde a resposta certa e' listar os acessos e
    // esperar a escolha do cliente, nunca transferir nem prosseguir com
    // cobranca -- mutuamente exclusivos por construcao (um exige
    // aprovado=false, o outro aprovado=true).
    const multiplosAcessosParaEscolher = acessoNaoDeterminado || propostaRenovacaoSemAcesso;

    // C3 (bloco de UX de renovacao, 2026-08-28, inovatv_central/CLAUDE.md)
    // -- interceptor DETERMINISTICO. O prompt congelado do Gemini
    // instrui a listar os acessos em prosa livre (tipo "responder")
    // quando o cliente demonstra intencao de renovar com 2+ acessos e
    // nao diz qual (gemini_client.ts). O Ciclo 3 mostrou esse caso ao
    // vivo. Aqui, em vez de deixar a prosa do Gemini ir ao cliente,
    // trocamos pela MESMA lista fixa deterministica ja usada no caminho
    // propor_renovacao (montarMensagemMultiplosAcessosRenovacao) --
    // quando, e SO' quando: Validador aprovou + tipo "responder" + 2+
    // acessos + cliente demonstrou intencao de renovar (palavra na
    // mensagem atual OU intencao_atual ja' na sessao) + nenhum acesso
    // citado na mensagem atual. Fora dessa condicao, "responder" segue
    // 100% inalterado. NAO toca prompt do Gemini, maquina de estados,
    // cobranca, webhook, Sigma nem Validador.
    const clienteDemonstrouIntencaoRenovar =
      REGEX_INTENCAO_RENOVACAO.test(conteudo) || conversa.intencao_atual === "renovacao";
    const haMultiplosAcessos =
      statusResults.filter((s) => s.outcome === "success" && !!s.cliente).length >= 2;
    const interceptarListaMultiplosAcessos =
      validacao.aprovado &&
      geminiData.tipo === "responder" &&
      haMultiplosAcessos &&
      clienteDemonstrouIntencaoRenovar &&
      resolverAcessoRenovacao(conteudo, statusResults, acessoSelecionadoServidor) === null;

    // Renovacao em lote (Etapa 1, 2026-08-29) -- cliente respondeu "0"
    // (ou "os dois"/"ambos"/...) a lista de multiplos acessos. Guarda
    // igual a do interceptor C3: 2+ acessos reais + intencao de renovar
    // ja demonstrada (palavra na mensagem atual OU intencao_atual na
    // sessao, gravada quando a lista foi enviada). NAO depende do tipo
    // que o Gemini classificou -- e' uma selecao deterministica do
    // cliente, tem precedencia sobre "responder"/"transferir". A
    // precificacao real (resolverPrecoLote) decide se o lote e'
    // oferecido pra esse N; se nao houver regra, cai no fallback de
    // pedir 1 acesso.
    const selecaoLoteMultiplosAcessos =
      haMultiplosAcessos &&
      clienteDemonstrouIntencaoRenovar &&
      REGEX_SELECAO_LOTE.test(conteudo.trim());

    // Renovacao em lote (Etapa 1, 2026-08-29) -- selecao INDIVIDUAL por
    // numero. A lista fixa (montarMensagemMultiplosAcessosRenovacao) e'
    // numerada ("*1. Nome*", "*2. Nome*", ...) e instrui "Digite o
    // numero do acesso". Aqui interpretamos essa resposta: um numero
    // isolado (mesmo formato ancorado de "0") entre 1 e N seleciona o
    // acesso naquela posicao da lista -- a MESMA ordem de statusResults
    // usada pra montar a lista. Nome de servidor continua funcionando
    // como antes (resolverAcessoRenovacao); isto so' ADICIONA a via
    // numerica. Mesma guarda das outras selecoes deterministicas (2+
    // acessos + intencao de renovar ja demonstrada). Numero fora de
    // 1..N -> null (nao e' selecao; segue o fluxo normal). O acesso
    // escolhido entra no MESMO caminho individual de
    // propostaRenovacaoComAcesso (processarCobrancaRenovacao) -- sem
    // nenhuma logica de cobranca nova.
    // ordem DETERMINISTICA (ordenarAcessosMultiplos): "2" e' sempre a
    // posicao 2 apresentada na lista, mesmo que o /match desta requisicao
    // tenha devolvido os acessos em ordem diferente da anterior.
    const acessosSucessoOrdenados = ordenarAcessosMultiplos(statusResults);
    const matchNumeroAcesso = conteudo.trim().match(/^\s*([1-9]\d*)\s*$/);
    const indiceAcessoSelecionado = matchNumeroAcesso ? Number(matchNumeroAcesso[1]) : null;
    const selecaoAcessoPorNumero: (StatusResult & {
      cliente: NonNullable<StatusResult["cliente"]>;
    }) | null =
      haMultiplosAcessos &&
      clienteDemonstrouIntencaoRenovar &&
      !selecaoLoteMultiplosAcessos &&
      indiceAcessoSelecionado !== null &&
      indiceAcessoSelecionado >= 1 &&
      indiceAcessoSelecionado <= acessosSucessoOrdenados.length
        ? acessosSucessoOrdenados[indiceAcessoSelecionado - 1]
        : null;

    // Etapa 6, terceira fatia: reprovado (exceto acessoNaoDeterminado,
    // tratado a parte acima), Gemini decidiu transferir -- marca
    // aguardando_humano de verdade e registra as duas mensagens
    // (Componente 1 §16, Componente 5 §12). Aprovado + tipo==="responder"
    // nunca entra aqui. Falha na criacao da cobranca/valor ausente
    // (Bloco 1) sao tratadas DENTRO de processarCobrancaRenovacao, mais
    // abaixo -- nao passam por aqui, porque so' sao descobertas depois
    // de a mensagem 1 (fixa) ja ter sido enviada.
    const deveTransferir =
      (!validacao.aprovado && !acessoNaoDeterminado) || geminiData.tipo === "transferir";

    if (selecaoLoteMultiplosAcessos) {
      // Renovacao em lote (Etapa 1): selecao deterministica do cliente
      // ("0"/"os dois"). Nada e' pre-gravado aqui -- o texto final (fixo)
      // so' existe depois de montado no bloco de envio abaixo, que grava
      // cliente+ia so' apos confirmar o envio, mesmo padrao dos demais
      // branches de renovacao.
    } else if (selecaoAcessoPorNumero) {
      // Selecao individual por numero -- mesmo tratamento de
      // propostaRenovacaoComAcesso: a mensagem do cliente NAO e'
      // pre-gravada aqui porque processarCobrancaRenovacao (bloco de
      // envio) pode terminar chamando acionarTransferenciaHumana, que
      // ja grava cliente+ia+sistema sozinha.
    } else if (deveTransferir) {
      // acessoNaoDeterminado ja' excluido de deveTransferir acima --
      // validacao.motivo aqui nunca e' "renovacao:acesso_nao_determinado".
      const motivoTransferencia = !validacao.aprovado
        ? validacao.motivo
        : "gemini:transferir";
      try {
        const resultado = await acionarTransferenciaHumana(
          conversa.conversation_id,
          motivoTransferencia,
          conteudo,
          geminiData.texto,
        );
        transferenciaResultado =
          resultado.outcome === "acionada"
            ? { acionada: true, motivo: motivoTransferencia }
            : { acionada: false, motivo: "ja_transferida_por_outra_requisicao" };
      } catch {
        transferenciaResultado = { acionada: false, motivo: "falha_ao_registrar" };
      }
      // A RPC acionar_transferencia_humana ja grava cliente+ia com o
      // episodio_id certo quando aciona de verdade (Componente 5 §12)
      // -- nao duplicar aqui, mesmo se "ja_transferida"/erro (nesses
      // casos outra requisicao ja gravou, ou nada foi transferido).
    } else if (multiplosAcessosParaEscolher || interceptarListaMultiplosAcessos) {
      // Ajuste de apresentacao (2026-08-28): nada aqui de proposito --
      // mesmo padrao de propostaRenovacaoComAcesso logo abaixo. O texto
      // final (mensagem fixa de multiplos acessos) so' existe depois de
      // montado no bloco de envio, e o log de cliente+ia acontece la',
      // so' depois de confirmar que o envio funcionou. Cobre os dois
      // casos (acessoNaoDeterminado e propostaRenovacaoSemAcesso) e o
      // interceptor C3 (Gemini "responder" + intencao + 2+ acessos) --
      // nos tres, a mensagem fixa e' quem vai ao cliente, entao a
      // prosa do Gemini nunca e' pre-gravada aqui.
    } else if (propostaRenovacaoComAcesso) {
      // Bloco 1 do fluxo de renovacao com PagBank real (2026-08-23):
      // AO CONTRARIO dos outros branches, a mensagem do cliente NAO e'
      // pre-gravada aqui. Motivo: este fluxo pode terminar chamando
      // acionarTransferenciaHumana (valor ausente/falha ao criar a
      // cobranca, descobertos so' DEPOIS da mensagem 1 fixa ja ter sido
      // enviada) -- essa RPC ja' grava cliente+ia+sistema sozinha
      // (Componente 5 §12); gravar o cliente aqui TAMBEM duplicaria a
      // mensagem. processarCobrancaRenovacao (mais abaixo) e' quem
      // decide, caso a caso, se grava direto ou deixa a RPC gravar.
    } else {
      // Fatia 2 (Painel de Atendimento, 2026-08-16): fluxo normal,
      // so-IA, sem transferencia -- so' tipo==="responder" chega aqui
      // (deveTransferir e propostaRenovacao ja tratados acima).
      // episodio_id=null (nao pertence a nenhum episodio de
      // atendimento humano). Best-effort: falha ao logar nunca
      // derruba a resposta ao cliente.
      try {
        await inserirMensagem(conversa.conversation_id, "cliente", conteudo, null);
        await inserirMensagem(conversa.conversation_id, "ia", geminiData.texto, null);
      } catch {
        // best-effort, mesma filosofia do aviso ao Jose (§16-A)
      }
    }

    // Etapa 6, quinta fatia + Fatia 3 do Painel de Atendimento
    // (Componente 1 §15-A, 2026-08-16): envio real ao cliente.
    // Aprovado + responder -> reconsulta o estado imediatamente antes
    // de enviar -- se um operador assumiu manualmente enquanto este
    // fluxo estava em andamento (conversa passou pra
    // aguardando_humano nesse meio-tempo), NAO envia a resposta da IA
    // por cima do humano; a resposta ja foi registrada como mensagem
    // de contexto acima, nunca e' descartada de verdade. deveTransferir
    // e a RPC acionou AGORA (nunca em "ja_transferida"/erro, decisao
    // confirmada 2026-08-16) -> mensagem fixa, nunca o texto do
    // Gemini sobre a transferencia.
    if (selecaoLoteMultiplosAcessos) {
      // Renovacao em lote (Etapa 1, 2026-08-29). Cliente escolheu
      // renovar TODOS os acessos ("0"/"os dois"). Dados 100% ja
      // disponiveis nesta mesma requisicao (statusResults) -- nenhuma
      // nova consulta ao Rocket/match/status. Precificacao interna
      // (resolverPrecoLote) NUNCA vai ao cliente -- ele so' ve o valor
      // final por acesso + total.
      // Mesma ordem DETERMINISTICA da lista/selecao numerica
      // (ordenarAcessosMultiplos) -- o lote ve exatamente os mesmos
      // acessos, na mesma ordem, que o cliente viu numerados.
      const acessosLote = ordenarAcessosMultiplos(statusResults);
      // Etapa 1.5 (Lacuna A, 2026-08-28): classifica CADA acesso do lote
      // pelo servidor -- nunca hardcoda 'sigma'. Enquanto a UniTV nao
      // esta integrada (Etapa 2), um lote que inclua QUALQUER acesso
      // UniTV nao pode ser criado (nao ha' preco BRL, nao ha' executor,
      // e o CHECK do banco exige unitv_sn/unitv_id que so' a Etapa 2
      // fornece). Nesse caso: nenhum lote, nenhuma cobranca -- mensagem
      // fixa + atendimento humano. Os acessos Sigma continuam
      // renovaveis um a um pelo numero.
      const tiposLote = acessosLote.map((s) => classificarTipoAcesso(s.cliente.servidorNome));
      const loteTemUnitv = tiposLote.includes("unitv");

      if (loteTemUnitv) {
        let acionada = false;
        try {
          const r = await acionarTransferenciaHumana(
            conversa.conversation_id,
            "renovacao:lote_com_unitv_nao_integrado",
            conteudo,
            "(cliente pediu renovar todos -- ha' acesso UniTV no lote)",
          );
          acionada = r.outcome === "acionada";
        } catch {
          // best-effort
        }
        transferenciaResultado = acionada
          ? { acionada: true, motivo: "renovacao:lote_com_unitv_nao_integrado" }
          : { acionada: false, motivo: "ja_transferida_ou_falha" };
        if (acionada) {
          const env = await enviarMensagemWhatsApp(telefone, MENSAGEM_RENOVACAO_LOTE_COM_UNITV);
          envioResultado = { enviado: env.outcome === "success" };
          if (env.outcome === "success") {
            await inserirMensagem(
              conversa.conversation_id,
              "ia",
              MENSAGEM_RENOVACAO_LOTE_COM_UNITV,
              null,
            ).catch(() => {});
          }
          const numeroJose = Deno.env.get("WHATSAPP_JOSE_NUMERO");
          if (numeroJose) {
            const aviso = await enviarTemplateWhatsApp(
              numeroJose,
              NOME_TEMPLATE_NOVA_TRANSFERENCIA,
              IDIOMA_TEMPLATE_NOVA_TRANSFERENCIA,
              ["renovacao:lote_com_unitv_nao_integrado"],
            );
            avisoJoseResultado = { enviado: aviso.outcome === "success" };
          }
        }
        renovacaoDiagnostico = { tipo: "propor_renovacao", acessoResolvido: null };
        // NAO cria lote, NAO chama resolverPrecoLote/criarRenovacaoLote.
      } else {
        // Preco do lote = SOMA dos valores reais de cada acesso no
        // Rocket (paraCentavos(s.cliente.valor), o mesmo `valor` que a
        // lista mostrou ao cliente). Sem constante fixa, sem desconto,
        // sem recalculo. resolverPrecoLote so' devolve null se algum
        // acesso nao tiver valor real utilizavel.
        const preco = resolverPrecoLote(
          acessosLote.map((s, i) => ({
            tipo: tiposLote[i],
            servidorNome: s.cliente.servidorNome ?? null,
            planoNome: s.cliente.planoNome ?? null,
            valorCentavos: paraCentavos(s.cliente.valor),
          })),
        );
        // Escopo atual do lote: exatamente 2 acessos (limite operacional,
        // NAO regra de preco -- a soma acima ja generaliza pra N>2). Sem
        // preco confiavel ou fora do escopo -> fallback de pedir 1.
        if (!preco || acessosLote.length !== 2) {
          // Nao oferece o lote agora, pede pra escolher 1. Nunca
          // transfere so' por isso.
          const msgFallback =
            "No momento consigo renovar 2 acessos de uma vez. Me diga o número do acesso que você quer renovar primeiro.";
          const envioFb = await enviarMensagemWhatsApp(telefone, msgFallback);
          envioResultado = { enviado: envioFb.outcome === "success" };
          if (envioResultado.enviado) {
            try {
              await inserirMensagem(conversa.conversation_id, "cliente", conteudo, null);
              await inserirMensagem(conversa.conversation_id, "ia", msgFallback, null);
            } catch {
              // best-effort
            }
          }
          renovacaoDiagnostico = { tipo: "propor_renovacao", acessoResolvido: null };
        } else {
          const filhos = acessosLote.map((s, i) => ({
            // tipo derivado do servidor -- nao hardcoda 'sigma'. Neste
            // ramo todos sao 'sigma' (loteTemUnitv ja barrou o resto).
            tipo: tiposLote[i],
            // public_id mantido tambem para filho UniTV (id do cliente
            // no Rocket -- necessario pro sync de vencimento e pro
            // indice "1 ativa por acesso"). No-op hoje: o guard
            // loteTemUnitv ainda impede lote com UniTV. A resolucao de
            // unitv_sn/unitv_id por filho + a remocao do guard entram
            // no Bloco 4 (junto da fiacao do executor).
            publicId: s.publicId,
            unitvSn: null,
            unitvId: null,
            clienteNome: s.cliente.nome ?? "não informado",
            servidorNome: s.cliente.servidorNome ?? "não informado",
            planoNome: s.cliente.planoNome ?? "não informado",
            valorEsperadoCentavos: preco.valorPorAcessoCentavos[i],
            vencimentoAtual: s.cliente.vencimento ?? new Date().toISOString(),
          }));
          let loteCriado: Awaited<ReturnType<typeof criarRenovacaoLote>> | null = null;
          try {
            loteCriado = await criarRenovacaoLote({
              conversationId: conversa.conversation_id,
              telefone,
              valorTotalCentavos: preco.totalCentavos,
              regraAplicada: preco.regraAplicada,
              filhos,
            });
          } catch (erro) {
            console.log(
              "[orchestrator] falha ao criar renovacoes_lote",
              JSON.stringify({ erro: String(erro) }),
            );
            loteCriado = null;
          }
          if (!loteCriado) {
            const msgErro =
              "Tive um problema ao preparar a renovação dos dois acessos. Me diga o número do acesso que você quer renovar primeiro.";
            const envioErr = await enviarMensagemWhatsApp(telefone, msgErro);
            envioResultado = { enviado: envioErr.outcome === "success" };
            if (envioResultado.enviado) {
              try {
                await inserirMensagem(conversa.conversation_id, "cliente", conteudo, null);
                await inserirMensagem(conversa.conversation_id, "ia", msgErro, null);
              } catch {
                // best-effort
              }
            }
            renovacaoDiagnostico = { tipo: "propor_renovacao", acessoResolvido: null };
          } else {
            const textoConfirmLote = montarMensagemConfirmacaoLote({
              itens: filhos.map((f, i) => ({
                nome: f.clienteNome,
                servidorNome: f.servidorNome,
                planoNome: f.planoNome,
                valorFormatado: formatarValorBRL(preco.valorPorAcessoCentavos[i] / 100) ?? "0,00",
              })),
              totalFormatado: formatarValorBRL(preco.totalCentavos / 100) ?? "0,00",
            });
            const envioConfirm = await enviarMensagemInterativaWhatsApp(telefone, textoConfirmLote, [
              { id: `renovacao:aceitar:${loteCriado.lote.token_hash}`, titulo: "ACEITO" },
              { id: `renovacao:cancelar:${loteCriado.lote.token_hash}`, titulo: "CANCELAR" },
            ]);
            envioResultado = { enviado: envioConfirm.outcome === "success" };
            if (envioResultado.enviado) {
              try {
                await inserirMensagem(conversa.conversation_id, "cliente", conteudo, null);
                await inserirMensagem(conversa.conversation_id, "ia", textoConfirmLote, null);
              } catch {
                // best-effort
              }
            }
            renovacaoDiagnostico = { tipo: "propor_renovacao", acessoResolvido: null };
          }
        }
      } // fim do ramo "todos sigma" (else de loteTemUnitv)
    } else if (selecaoAcessoPorNumero) {
      // Selecao individual por numero -- o acesso escolhido entra no
      // MESMO caminho de propostaRenovacaoComAcesso (processarCobrancaRenovacao):
      // nenhuma logica de cobranca/persistencia/mensagem nova, so' um
      // ponto de entrada a mais (numero em vez de nome de servidor).
      const usuarioResolvido =
        matchResult.candidates.find((c) => c.publicId === selecaoAcessoPorNumero.publicId)
          ?.usuario ?? null;
      const resultado = await processarCobrancaRenovacao(
        conversa,
        telefone,
        conteudo,
        geminiData.texto,
        selecaoAcessoPorNumero,
        usuarioResolvido,
      );
      envioResultado = resultado.envioResultado;
      if (resultado.transferenciaResultado) transferenciaResultado = resultado.transferenciaResultado;
      if (resultado.avisoJoseResultado) avisoJoseResultado = resultado.avisoJoseResultado;
      if (resultado.textoEnviado) {
        await atualizarSessao(conversa.conversation_id, {
          acessoSelecionado: selecaoAcessoPorNumero.publicId,
        }).catch(() => {});
      }
      renovacaoDiagnostico = {
        tipo: "propor_renovacao",
        acessoResolvido: {
          publicId: selecaoAcessoPorNumero.publicId,
          planoNome: selecaoAcessoPorNumero.cliente?.planoNome ?? null,
          servidorNome: selecaoAcessoPorNumero.cliente?.servidorNome ?? null,
        },
      };
    } else if (validacao.aprovado && geminiData.tipo === "responder" && !interceptarListaMultiplosAcessos) {
      const conversaAtual = await buscarOuCriarConversa(telefone);
      if (conversaAtual.estado === "aguardando_humano") {
        envioResultado = { enviado: false };
      } else {
        const envio = await enviarMensagemWhatsApp(telefone, geminiData.texto);
        envioResultado = { enviado: envio.outcome === "success" };
        if (envioResultado.enviado) {
          await gravarAcessoSelecionadoSeCitado(
            conversa.conversation_id,
            geminiData.texto,
            statusResults,
          );
          // Memoria de sessao (extensao 2026-08-23): a mensagem que
          // demonstra intencao e' a do CLIENTE (conteudo), nunca a
          // resposta do Gemini -- e' a intencao dele que precisa ser
          // preservada, nao o que a IA disse de volta.
          await gravarIntencaoRenovacaoSeDemonstrada(
            conversa.conversation_id,
            conteudo,
            statusResults,
          );
        }
      }
    } else if (deveTransferir && transferenciaResultado?.acionada) {
      const envio = await enviarMensagemWhatsApp(
        telefone,
        MENSAGEM_TRANSFERENCIA_CLIENTE,
      );
      envioResultado = { enviado: envio.outcome === "success" };
      if (envioResultado.enviado) {
        // C5 (bloco de renovacao 2026-08-28): a RPC ja gravou cliente +
        // texto do Gemini como "ia"; esta linha adiciona a frase fixa
        // que o cliente de fato recebeu, pra o historico do Painel bater
        // com a conversa real. Best-effort.
        await inserirMensagem(conversa.conversation_id, "ia", MENSAGEM_TRANSFERENCIA_CLIENTE, null).catch(() => {});
      }

      // Aviso ao Jose (Componente 1 §16-A) -- so' quando a RPC
      // realmente acionou agora (nunca em "ja_transferida"/erro, ja
      // garantido por estar dentro deste mesmo bloco). Best-effort:
      // falha aqui nunca desfaz a transferencia ja confirmada acima.
      const numeroJose = Deno.env.get("WHATSAPP_JOSE_NUMERO");
      if (numeroJose) {
        const aviso = await enviarTemplateWhatsApp(
          numeroJose,
          NOME_TEMPLATE_NOVA_TRANSFERENCIA,
          IDIOMA_TEMPLATE_NOVA_TRANSFERENCIA,
          [transferenciaResultado.motivo],
        );
        avisoJoseResultado = { enviado: aviso.outcome === "success" };
      }
    } else if (multiplosAcessosParaEscolher || interceptarListaMultiplosAcessos) {
      // Ajuste de apresentacao (2026-08-28): multiplos acessos, nenhum
      // resolvido com certeza (via rejeicao do Validador -- caso
      // comum -- ou via resolverAcessoRenovacao pos-aprovacao -- caso
      // defensivo/raro) -- em vez de transferir pra humano so' por
      // ambiguidade (comportamento antigo), lista os acessos reais e
      // deixa o cliente escolher. Dados 100% ja disponiveis nesta
      // mesma requisicao (statusResults + matchResult.candidates) --
      // nenhuma nova consulta ao Rocket/match/status. A proxima
      // mensagem do cliente citando um servidor resolve via
      // resolverAcessoRenovacao/gravarAcessoSelecionadoSeCitado, sem
      // nenhuma mudanca nelas. Nunca texto gerado pelo Gemini aqui --
      // mesma disciplina das mensagens 2/3 (mensagens_fixas.ts).
      // Ordem DETERMINISTICA (ordenarAcessosMultiplos) -- a numeracao
      // "*1. ...*", "*2. ...*" desta lista tem que casar exatamente com
      // a posicao que a selecao numerica ("1"/"2") vai resolver na
      // requisicao seguinte, mesmo que o /match devolva os acessos em
      // outra ordem la'.
      const acessosParaSelecao = ordenarAcessosMultiplos(statusResults)
        .map((s) => ({
          nome: s.cliente.nome ?? "não informado",
          usuario:
            matchResult.candidates.find((c) => c.publicId === s.publicId)?.usuario ??
            "não informado",
          servidorNome: s.cliente.servidorNome ?? "não informado",
          planoNome: s.cliente.planoNome ?? "não informado",
          // Vencimento do PROPRIO acesso, direto do /status, formatado
          // DD/MM/AAAA (mesmo padrao ja usado na mensagem 2 -- fuso
          // America/Sao_Paulo). null -> a mensagem usa "não informado".
          vencimentoFormatado: s.cliente.vencimento
            ? new Date(s.cliente.vencimento).toLocaleDateString("pt-BR", {
                timeZone: "America/Sao_Paulo",
              })
            : null,
          // Valor do PROPRIO acesso, direto do /status (campo agora
          // exposto). formatarValorBRL e' so' formatacao de exibicao
          // (mesma de C2), nunca recalculo; sem consulta por candidato.
          valorFormatado: formatarValorBRL(s.cliente.valor),
        }));
      const textoMultiplosAcessos = montarMensagemMultiplosAcessosRenovacao(acessosParaSelecao);
      const envioLista = await enviarMensagemWhatsApp(telefone, textoMultiplosAcessos);
      envioResultado = { enviado: envioLista.outcome === "success" };
      if (envioResultado.enviado) {
        try {
          await inserirMensagem(conversa.conversation_id, "cliente", conteudo, null);
          await inserirMensagem(conversa.conversation_id, "ia", textoMultiplosAcessos, null);
        } catch {
          // best-effort, mesma filosofia do resto do arquivo
        }
        // Renovacao em lote (Etapa 1, 2026-08-29): a lista de multiplos
        // acessos agora instrui explicitamente "digite ... ou *0* para
        // renovar os dois". Pra que essa proxima mensagem "0" seja
        // reconhecida como selecao de lote (selecaoLoteMultiplosAcessos,
        // que exige clienteDemonstrouIntencaoRenovar), a intencao de
        // renovar precisa estar gravada na sessao SEMPRE que a lista foi
        // enviada -- nao so' quando a palavra "renovar" apareceu nesta
        // mensagem. Escrita direta (nao via
        // gravarIntencaoRenovacaoSeDemonstrada, que exige a palavra no
        // texto atual). Best-effort. Cobre tambem o caso C3
        // (interceptarListaMultiplosAcessos), que antes so' gravava
        // quando a palavra estava na mensagem atual.
        await atualizarSessao(conversa.conversation_id, { intencaoAtual: "renovacao" }).catch(
          () => {},
        );
      }
      renovacaoDiagnostico = { tipo: "propor_renovacao", acessoResolvido: null };
    } else if (propostaRenovacaoComAcesso) {
      // Bloco 1 do fluxo de renovacao com PagBank real (2026-08-23) --
      // substitui integralmente a orientacao GENERICA de Pix de 23/08
      // (nunca vinculada a uma cobranca real). Toda a logica de
      // cobranca/persistencia/mensagens fica em processarCobrancaRenovacao
      // (module-level, acima) -- aqui so' encaminha e usa o resultado.
      // usuario real do acesso resolvido -- resolvido a partir de
      // matchResult.candidates (chamarMatch, mesma requisicao, sem
      // segunda consulta). Desde o Bloco 2 o /status tambem devolve
      // `usuario`; a resolucao aqui continua usando /match como fonte
      // (inalterado).
      const usuarioResolvido =
        matchResult.candidates.find((c) => c.publicId === acessoResolvidoRenovacao?.publicId)
          ?.usuario ?? null;
      const resultado = await processarCobrancaRenovacao(
        conversa,
        telefone,
        conteudo,
        geminiData.texto,
        acessoResolvidoRenovacao,
        usuarioResolvido,
      );
      envioResultado = resultado.envioResultado;
      if (resultado.transferenciaResultado) transferenciaResultado = resultado.transferenciaResultado;
      if (resultado.avisoJoseResultado) avisoJoseResultado = resultado.avisoJoseResultado;

      // processarCobrancaRenovacao ja' cuida de TODO o log (cliente+ia,
      // em qualquer caminho -- concorrencia, cobranca reaproveitada,
      // cobranca nova, ou transferencia via RPC) -- nao duplicar aqui.
      // textoEnviado != null so' quando uma mensagem de fato chegou ao
      // cliente (usado so' para as escritas de memoria de sessao abaixo).
      if (resultado.textoEnviado) {
        // acesso_selecionado gravado diretamente do acesso ja' resolvido
        // com certeza -- mais preciso que reconferir por citacao de
        // texto (gravarAcessoSelecionadoSeCitado), ja que aqui nao ha'
        // ambiguidade nenhuma restante.
        await atualizarSessao(conversa.conversation_id, {
          acessoSelecionado: acessoResolvidoRenovacao.publicId,
        }).catch(() => {});
        await gravarIntencaoRenovacaoSeDemonstrada(
          conversa.conversation_id,
          conteudo,
          statusResults,
        );
      }

      renovacaoDiagnostico = {
        tipo: "propor_renovacao",
        acessoResolvido: {
          publicId: acessoResolvidoRenovacao.publicId,
          planoNome: acessoResolvidoRenovacao.cliente?.planoNome ?? null,
          servidorNome: acessoResolvidoRenovacao.cliente?.servidorNome ?? null,
        },
      };
    }
  } else {
    // Correcao do gap pre-existente (Bug 2, achado na bateria de testes
    // reais pelo Webhook, 2026-08-21): Gemini indisponivel mesmo apos o
    // retry (Componente 1 §11) agora aciona transferencia humana de
    // verdade, reaproveitando o MESMO mecanismo do branch deveTransferir
    // acima -- nenhum mecanismo novo (Alternativa A do levantamento,
    // aprovada pelo usuario). TEXTO_IA_INDISPONIVEL e' só um valor de
    // log/auditoria (grafado explicitamente como placeholder, nunca
    // enviado ao cliente nem ao Jose) -- exigido pela assinatura da RPC,
    // que sempre grava um par cliente+ia.
    const TEXTO_IA_INDISPONIVEL = "(Gemini indisponível)";
    try {
      const resultado = await acionarTransferenciaHumana(
        conversa.conversation_id,
        "sistema:gemini_indisponivel",
        conteudo,
        TEXTO_IA_INDISPONIVEL,
      );
      transferenciaResultado =
        resultado.outcome === "acionada"
          ? { acionada: true, motivo: "sistema:gemini_indisponivel" }
          : { acionada: false, motivo: "ja_transferida_por_outra_requisicao" };
    } catch {
      transferenciaResultado = { acionada: false, motivo: "falha_ao_registrar" };
    }
    // Mesma disciplina do branch deveTransferir: so envia mensagem ao
    // cliente/aviso ao Jose quando a RPC realmente acionou AGORA (nunca
    // em "ja_transferida"/erro -- evita duplicar envio sob concorrencia).
    if (transferenciaResultado.acionada) {
      const envio = await enviarMensagemWhatsApp(telefone, MENSAGEM_TRANSFERENCIA_CLIENTE);
      envioResultado = { enviado: envio.outcome === "success" };
      if (envioResultado.enviado) {
        // C5 (bloco de renovacao 2026-08-28): mesma disciplina do branch
        // deveTransferir -- grava a frase fixa recebida pelo cliente no
        // historico do Painel. Best-effort.
        await inserirMensagem(conversa.conversation_id, "ia", MENSAGEM_TRANSFERENCIA_CLIENTE, null).catch(() => {});
      }

      const numeroJose = Deno.env.get("WHATSAPP_JOSE_NUMERO");
      if (numeroJose) {
        const aviso = await enviarTemplateWhatsApp(
          numeroJose,
          NOME_TEMPLATE_NOVA_TRANSFERENCIA,
          IDIOMA_TEMPLATE_NOVA_TRANSFERENCIA,
          [transferenciaResultado.motivo],
        );
        avisoJoseResultado = { enviado: aviso.outcome === "success" };
      }
    }
  }

  return jsonResponse({
    outcome: "normal",
    conversation_id: conversa.conversation_id,
    match: {
      outcome: matchResult.outcome,
      candidatos_consultados: statusResults.length,
    },
    status: statusResults.map((s) => ({
      publicId: s.publicId,
      outcome: s.outcome,
      linkState: s.linkState,
    })),
    conhecimento:
      conhecimentoResult.outcome === "encontrado"
        ? { outcome: conhecimentoResult.outcome, titulo: conhecimentoResult.titulo }
        : { outcome: conhecimentoResult.outcome },
    gemini: geminiSaida,
    ...(validacaoResultado ? { validacao: validacaoResultado } : {}),
    ...(transferenciaResultado ? { transferencia: transferenciaResultado } : {}),
    ...(envioResultado ? { envio: envioResultado } : {}),
    ...(avisoJoseResultado ? { avisoJose: avisoJoseResultado } : {}),
    ...(renovacaoDiagnostico ? { renovacao: renovacaoDiagnostico } : {}),
  });
});
