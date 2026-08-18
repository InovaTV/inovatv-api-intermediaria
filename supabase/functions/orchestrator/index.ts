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
// 3) ainda nao existe nesta etapa, chega depois. Formato provisorio,
// so para validar o nucleo:
//   POST { telefone: string, conteudo: string }

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
import { chamarGemini } from "../_shared/gemini_client.ts";
import { validarResposta } from "../_shared/validador.ts";
import { enviarMensagemWhatsApp, enviarTemplateWhatsApp } from "../_shared/whatsapp_client.ts";
import {
  MENSAGEM_TRANSFERENCIA_CLIENTE,
  NOME_TEMPLATE_NOVA_TRANSFERENCIA,
  IDIOMA_TEMPLATE_NOVA_TRANSFERENCIA,
} from "../_shared/mensagens_fixas.ts";

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

  let body: { telefone?: string; conteudo?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Corpo da requisicao precisa ser JSON valido");
  }

  const { telefone, conteudo } = body;
  if (!telefone || !conteudo) {
    return errorResponse("Campos obrigatorios: telefone, conteudo");
  }

  let conversa;
  try {
    conversa = await buscarOuCriarConversa(telefone);
  } catch {
    return jsonResponse(
      { outcome: "unavailable", message: "Falha ao consultar conversas_estado" },
      503,
    );
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
  const matchResult = await chamarMatch(telefone);

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

  // Painel de Atendimento -- previa da lista, Fatia 1 (2026-08-18).
  // Best-effort: statusResults ja foi resolvido de graca acima, sem
  // chamada extra -- uma falha aqui nunca pode atrasar/derrubar o
  // fluxo principal (Gemini, validador, envio ao cliente).
  const nomeReal = statusResults.find((s) => s.cliente?.nome)?.cliente?.nome;
  if (nomeReal) {
    await atualizarNomeSnapshot(conversa.conversation_id, nomeReal).catch(() => {});
  }

  const matchIndisponivel =
    matchResult.outcome === "unavailable" || matchResult.outcome === "invalid_request";

  const contextoCliente = montarContextoCliente(telefone, statusResults, {
    matchIndisponivel,
  });

  const geminiResult = await chamarGemini(conteudo, contextoCliente);

  let geminiSaida: unknown = { outcome: "unavailable" };
  let validacaoResultado: { aprovado: boolean; motivo?: string } | undefined;
  let transferenciaResultado: { acionada: boolean; motivo: string } | undefined;
  let envioResultado: { enviado: boolean } | undefined;
  let avisoJoseResultado: { enviado: boolean } | undefined;

  if (geminiResult.outcome === "success") {
    const geminiData = geminiResult.data;
    const validacao = validarResposta(geminiData, contextoCliente);
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
    // Fatia 2 (Painel de Atendimento, 2026-08-16): Gemini indisponivel
    // (falhou apos retry, Componente 1 §11) -- a mensagem do cliente
    // ainda precisa ficar registrada ("sempre, qualquer estado",
    // Componente 5 §12). episodio_id=null: nenhuma transferencia foi
    // decidida aqui. Transferencia automatica por indisponibilidade do
    // Gemini (Componente 1 §11) permanece fora de escopo desta fatia,
    // gap pre-existente, nao mexido agora.
    try {
      await inserirMensagem(conversa.conversation_id, "cliente", conteudo, null);
    } catch {
      // best-effort, mesma filosofia acima
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
    gemini: geminiSaida,
    ...(validacaoResultado ? { validacao: validacaoResultado } : {}),
    ...(transferenciaResultado ? { transferencia: transferenciaResultado } : {}),
    ...(envioResultado ? { envio: envioResultado } : {}),
    ...(avisoJoseResultado ? { avisoJose: avisoJoseResultado } : {}),
  });
});
