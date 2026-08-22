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

import { jsonResponse, errorResponse } from "../_shared/http.ts";
import {
  buscarOuCriarConversa,
  acionarTransferenciaHumana,
  atualizarNomeSnapshot,
} from "../_shared/conversas_estado.ts";
import { inserirMensagem } from "../_shared/mensagens_atendimento.ts";
import {
  chamarMatch,
  chamarStatus,
  type StatusResult,
} from "../_shared/rocket_intermediaria.ts";
import { montarContextoCliente } from "../_shared/contexto.ts";
import { buscarConhecimentoRelevante } from "../_shared/conhecimento.ts";
import { chamarGemini } from "../_shared/gemini_client.ts";
import { validarResposta } from "../_shared/validador.ts";
import { enviarMensagemWhatsApp, enviarTemplateWhatsApp } from "../_shared/whatsapp_client.ts";
import {
  MENSAGEM_TRANSFERENCIA_CLIENTE,
  NOME_TEMPLATE_NOVA_TRANSFERENCIA,
  IDIOMA_TEMPLATE_NOVA_TRANSFERENCIA,
} from "../_shared/mensagens_fixas.ts";
import { normalizarTelefone } from "../_shared/telefone.ts";

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

  // "Regra de ouro" (secao 7 do levantamento): contextoCompleto e' o
  // UNICO texto de contexto a partir daqui -- passado identico para
  // chamarGemini() e para validarResposta() mais abaixo, nunca
  // contextoCliente sozinho por engano.
  const partesContexto = [contextoCliente, contextoConhecimento].filter(
    (parte): parte is string => !!parte,
  );
  const contextoCompleto = partesContexto.length > 0 ? partesContexto.join("\n\n") : null;

  const geminiResult = await chamarGemini(conteudo, contextoCompleto);

  let geminiSaida: unknown = { outcome: "unavailable" };
  let validacaoResultado: { aprovado: boolean; motivo?: string } | undefined;
  let transferenciaResultado: { acionada: boolean; motivo: string } | undefined;
  let envioResultado: { enviado: boolean } | undefined;
  let avisoJoseResultado: { enviado: boolean } | undefined;

  if (geminiResult.outcome === "success") {
    const geminiData = geminiResult.data;
    const validacao = validarResposta(geminiData, contextoCompleto);
    validacaoResultado = validacao.aprovado
      ? { aprovado: true }
      : { aprovado: false, motivo: validacao.motivo };
    geminiSaida = validacao.aprovado
      ? geminiData
      : { outcome: "bloqueado" };

    // Etapa 6, terceira fatia: reprovado, OU aprovado mas o Gemini
    // decidiu transferir -- marca aguardando_humano de verdade e
    // registra as duas mensagens (Componente 1 §16, Componente 5
    // §12). Aprovado + tipo==="responder" nunca entra aqui.
    const deveTransferir = !validacao.aprovado || geminiData.tipo === "transferir";

    if (deveTransferir) {
      const motivoTransferencia = validacao.aprovado
        ? "gemini:transferir"
        : validacao.motivo;
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
    } else {
      // Fatia 2 (Painel de Atendimento, 2026-08-16): fluxo normal,
      // so-IA, sem transferencia -- ninguem mais grava essa troca.
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
    if (validacao.aprovado && geminiData.tipo === "responder") {
      const conversaAtual = await buscarOuCriarConversa(telefone);
      if (conversaAtual.estado === "aguardando_humano") {
        envioResultado = { enviado: false };
      } else {
        const envio = await enviarMensagemWhatsApp(telefone, geminiData.texto);
        envioResultado = { enviado: envio.outcome === "success" };
      }
    } else if (deveTransferir && transferenciaResultado?.acionada) {
      const envio = await enviarMensagemWhatsApp(
        telefone,
        MENSAGEM_TRANSFERENCIA_CLIENTE,
      );
      envioResultado = { enviado: envio.outcome === "success" };

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
  });
});
