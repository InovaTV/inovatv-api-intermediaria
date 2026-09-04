// webhook-wasender/index.ts
// Receptor de webhook do WasenderAPI -- LABORATORIO (repositorio
// inovatv-wasender-lab, Supabase uleklqdlwyofnkcsdigz). NAO e producao.
//
// Adaptacao do webhook/index.ts (Meta Cloud API) para o formato do
// WasenderAPI, seguindo o plano tecnico de 2026-09-04 registrado no
// NEXT_SESSION.md deste repositorio. O webhook/index.ts (Meta) permanece
// INTOCADO como referencia -- este arquivo e uma funcao NOVA e separada.
//
// O QUE FAZ NESTA ETAPA:
// - messages.received (texto): normaliza -> chama o Orquestrador com o
//   MESMO contrato de sempre ({ telefone, conteudo, nomeContato? }).
// - messages.update: branch separado, SO loga (nao encaminha, nao persiste).
// - messages.upsert: ignorado DE PROPOSITO (traz entrada e saida -- se
//   processado junto de messages.received, cada mensagem seria tratada 2x).
// - demais eventos (session.status, qrcode.updated, poll results, etc.):
//   reconhecidos com 200 e apenas logados, nunca processados nesta etapa.
// - deduplicacao atomica por key.id (reaproveita _shared/webhook_dedup.ts),
//   sincrona ANTES do 200 -- retry do Wasender nunca dispara o downstream 2x.
// - resposta HTTP 200 rapida; processamento pos-dedup em EdgeRuntime.waitUntil.
//
// O QUE NAO FAZ (fora de escopo por instrucao explicita):
// - midia (image/audio/document/video): so detecta e loga, nunca baixa/decrypta.
// - botoes/interativos e fluxo de renovacao ACEITO/CANCELAR: sem equivalente
//   nativo no WasenderAPI, decisao a parte.
// - envio de mensagem; API Access Token do WasenderAPI; configuracao de
//   webhook no painel deles; conexao/desconexao de sessao.
//
// SECRETS (Edge Function do LAB uleklqdlwyofnkcsdigz -- NUNCA em codigo ou
// arquivo versionado):
// - WASENDER_WEBHOOK_SECRET     -> valida o header X-Webhook-Signature.
// - ORCHESTRATOR_INTERNAL_TOKEN -> header X-Internal-Token da chamada interna.
// - SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY -> auto-injetados pelo Supabase.
// Nenhum e obrigatorio para a funcao CARREGAR: a ausencia degrada em
// silencio (POST sem segredo -> 401), mesmo padrao do webhook Meta.

import { registrarMensagemSeNova } from "../_shared/webhook_dedup.ts";
import { normalizarTelefone } from "../_shared/telefone.ts";
import { enviarMensagemWhatsApp } from "../_shared/wasender_client.ts";
import {
  detectarComandoAtendimento,
  executarComandoAtendimento,
} from "../_shared/comando_atendimento.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

// ----------------------------------------------------------------------------
// Tipos do payload do WasenderAPI (doc atual -- ver "AUDITORIA DOCUMENTAL DO
// WASENDERAPI -- 2026-09-04" no NEXT_SESSION.md). Campos marcados
// [NAO CONFIRMADO] nao aparecem em nenhum exemplo da doc acessivel.
// ----------------------------------------------------------------------------
interface WasenderKey {
  id?: string;
  fromMe?: boolean;
  remoteJid?: string;
  addressingMode?: string;
  senderPn?: string;
  cleanedSenderPn?: string;
  senderLid?: string;
}

interface WasenderMidia {
  url?: string;
  mediaKey?: string;
  mimetype?: string;
  fileName?: string;
}

interface WasenderMessageContent {
  conversation?: string;
  imageMessage?: WasenderMidia;
  audioMessage?: WasenderMidia;
  documentMessage?: WasenderMidia;
  videoMessage?: WasenderMidia;
}

interface WasenderMensagem {
  key?: WasenderKey;
  messageBody?: string;
  message?: WasenderMessageContent;
  // [NAO CONFIRMADO] -- nenhum exemplo da doc mostra este campo. Lido
  // defensivamente; se nao vier, nomeContato simplesmente e omitido.
  pushName?: string;
}

interface WasenderUpdate {
  status?: number;
}

interface WasenderPayload {
  event?: string;
  timestamp?: number;
  sessionId?: string;
  data?: {
    // messages.received / messages.upsert: a doc mostra um OBJETO unico,
    // mas o padrao Baileys costuma ser array -- tratamos as duas formas.
    messages?: WasenderMensagem | WasenderMensagem[];
    // messages.update:
    update?: WasenderUpdate;
    key?: WasenderKey;
  };
}

// ----------------------------------------------------------------------------
// X-Webhook-Signature -- BLOCO ISOLADO DE PROPOSITO.
//
// A auditoria documental de 2026-09-04 (NEXT_SESSION.md) classificou a
// especificacao de assinatura do WasenderAPI como INCOMPLETA. O unico
// exemplo de verificacao na doc oficial e comparacao de STRING SIMPLES:
//
//     if (signature !== webhookSecret) return false;
//
// ou seja: o header X-Webhook-Signature carrega o PROPRIO SEGREDO em texto
// puro -- NAO e um HMAC do corpo. NAO inventamos HMAC aqui.
//
// Se um payload real chegar com assinatura que NAO bate com o segredo em
// texto puro, investigar se o WasenderAPI passou a usar HMAC (lacuna
// registrada na auditoria, item de teste real).
//
// Unico reforco sobre o sample da doc: comparacao de tempo aproximadamente
// constante, para nao vazar o segredo por timing. Continua sendo, em
// essencia, igualdade de string.
// ----------------------------------------------------------------------------
function comparacaoTempoConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function assinaturaWasenderValida(headerAssinatura: string | null): boolean {
  const segredo = Deno.env.get("WASENDER_WEBHOOK_SECRET");
  // Sem segredo configurado (fase de preparacao) OU sem header -> rejeita.
  if (!segredo || !headerAssinatura) return false;
  // Comportamento documentado: header == segredo em texto puro.
  return comparacaoTempoConstante(headerAssinatura, segredo);
}

// ----------------------------------------------------------------------------
// Contrato com o Orquestrador -- IDENTICO ao webhook Meta. NAO muda nada
// aqui: mesmo endpoint, mesmo header X-Internal-Token, mesmo body de 3
// campos. O trabalho do receptor e SO normalizar o payload do WasenderAPI
// para este shape. SUPABASE_URL resolve para o proprio projeto (o lab).
// ----------------------------------------------------------------------------
async function chamarOrquestrador(
  telefone: string,
  conteudo: string,
  nomeContato?: string,
): Promise<void> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const tokenInterno = Deno.env.get("ORCHESTRATOR_INTERNAL_TOKEN");

  if (!supabaseUrl || !tokenInterno) {
    console.log(
      "[webhook-wasender] chamada ao orquestrador abortada -- configuracao ausente",
      JSON.stringify({ supabaseUrlPresente: !!supabaseUrl, tokenPresente: !!tokenInterno }),
    );
    return;
  }

  try {
    const resp = await fetch(`${supabaseUrl}/functions/v1/orchestrator`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Token": tokenInterno,
      },
      body: JSON.stringify(
        nomeContato ? { telefone, conteudo, nomeContato } : { telefone, conteudo },
      ),
      signal: AbortSignal.timeout(60000),
    });

    if (!resp.ok) {
      const corpo = await resp.text().catch(() => "");
      console.log(
        "[webhook-wasender] chamada ao orquestrador falhou",
        JSON.stringify({ status: resp.status, corpo }),
      );
    }
  } catch (erro) {
    console.log("[webhook-wasender] excecao ao chamar orquestrador", String(erro));
  }
}

// ----------------------------------------------------------------------------
// Resolucao de telefone a partir da key do WasenderAPI.
// Prioridade: cleanedSenderPn -> senderPn (strip @s.whatsapp.net) ->
//             remoteJid @s.whatsapp.net -> null.
// remoteJid @lid NUNCA e telefone. remoteJid @g.us = grupo (fora de escopo).
// Retorna string SO de digitos, ou null se nao der para resolver. O
// normalizarTelefone() do proprio Orquestrador cuida do prefixo 55.
// ----------------------------------------------------------------------------
function soDigitos(s: string): string {
  return s.replace(/\D/g, "");
}

function resolverTelefone(key: WasenderKey): string | null {
  if (key.cleanedSenderPn) {
    const d = soDigitos(key.cleanedSenderPn);
    return d.length > 0 ? d : null;
  }
  if (key.senderPn) {
    const d = soDigitos(key.senderPn.split("@")[0]);
    return d.length > 0 ? d : null;
  }
  // Sem cleanedSenderPn nem senderPn: so tenta se remoteJid for a forma
  // de telefone. Se for @lid, e' LID (nao telefone) -> nao resolve.
  if (key.remoteJid && key.remoteJid.endsWith("@s.whatsapp.net")) {
    const d = soDigitos(key.remoteJid.split("@")[0]);
    return d.length > 0 ? d : null;
  }
  return null;
}

function ehGrupo(key: WasenderKey): boolean {
  return !!key.remoteJid && key.remoteJid.endsWith("@g.us");
}

function ehMidia(msg: WasenderMensagem): boolean {
  const m = msg.message;
  return !!(m?.imageMessage || m?.audioMessage || m?.documentMessage || m?.videoMessage);
}

// Prioriza message.conversation (texto puro); messageBody serve para texto
// e tambem como legenda de midia (por isso vem depois).
function extrairTexto(msg: WasenderMensagem): string | null {
  const conv = msg.message?.conversation;
  if (typeof conv === "string" && conv.length > 0) return conv;
  const body = msg.messageBody;
  if (typeof body === "string" && body.length > 0) return body;
  return null;
}

// ----------------------------------------------------------------------------
// Processamento POS-DEDUP de UMA mensagem recebida. Roda dentro de
// EdgeRuntime.waitUntil -- ja fora do ciclo de resposta HTTP. Os guards
// baratos (sem id / fromMe / grupo) e a deduplicacao ja rodaram sincronos
// no handler antes do 200.
// ----------------------------------------------------------------------------
async function processarMensagemRecebidaPosDedup(msg: WasenderMensagem): Promise<void> {
  const key = msg.key ?? {};
  const id = key.id ?? "(sem id)";

  // Midia -- so detecta e loga, NAO baixa/decrypta (fora de escopo).
  if (ehMidia(msg)) {
    console.log(
      "[webhook-wasender] mensagem de midia -- pendencia, nao processada nesta etapa",
      JSON.stringify({ id }),
    );
    return;
  }

  const telefone = resolverTelefone(key);
  if (!telefone) {
    // Provavelmente so veio remoteJid @lid, sem cleanedSenderPn/senderPn.
    console.log(
      "[webhook-wasender] nao foi possivel resolver telefone (provavel @lid) -- ignorada",
      JSON.stringify({ id, remoteJid: key.remoteJid, addressingMode: key.addressingMode }),
    );
    return;
  }

  const texto = extrairTexto(msg);
  if (!texto) {
    console.log(
      "[webhook-wasender] mensagem sem texto processavel -- ignorada",
      JSON.stringify({ id }),
    );
    return;
  }

  // pushName defensivo -- [NAO CONFIRMADO] pela doc. So passa se vier.
  const nomeContato =
    typeof msg.pushName === "string" && msg.pushName.length > 0 ? msg.pushName : undefined;

  await chamarOrquestrador(telefone, texto, nomeContato);
}

// ----------------------------------------------------------------------------
// Branch separado: messages.update (status de envio/entrega/leitura).
// SO loga -- nao encaminha, nao persiste. O WasenderAPI nao traz
// errors[].code (status 0 = ERROR, sem motivo) -- capacidade de
// diagnostico menor que a da Cloud API.
// ----------------------------------------------------------------------------
const MAPA_STATUS: Record<number, string> = {
  0: "error",
  1: "pending",
  2: "sent",
  3: "delivered",
  4: "read",
  5: "played",
};

function processarStatusUpdate(payload: WasenderPayload): void {
  const codigo = payload.data?.update?.status;
  console.log(
    "[webhook-wasender] wasender_delivery_status",
    JSON.stringify({
      evento: "wasender_delivery_status",
      messageId: payload.data?.key?.id,
      remoteJid: payload.data?.key?.remoteJid,
      status: typeof codigo === "number" ? (MAPA_STATUS[codigo] ?? String(codigo)) : undefined,
      statusCodigo: codigo,
      timestamp: payload.timestamp,
    }),
  );
}

// ----------------------------------------------------------------------------
// Comandos de atendimento humano (#humano / #ia) digitados no proprio
// WhatsApp Business do 2415. Teste real 2026-09-04: chegam como
// messages.upsert + key.fromMe === true, com o telefone do CLIENTE em
// key.cleanedSenderPn (remoteJid vem como @lid, inutil). A deteccao e a
// deduplicacao por key.id ja rodaram sincronas no handler; aqui so
// executa a RPC de estado e envia a confirmacao curta na propria
// conversa.
//
// LOOP: a confirmacao NAO e "#humano"/"#ia" -- o eco dela como
// messages.upsert cai no ramo "mensagem fromMe normal" e e ignorado.
// ----------------------------------------------------------------------------
async function processarComandoUpsertPosDedup(
  keyId: string,
  comando: "assumir" | "encerrar",
  telefoneCanonico: string,
): Promise<void> {
  try {
    const resultado = await executarComandoAtendimento(comando, telefoneCanonico);
    console.log(
      "[webhook-wasender] comando de atendimento humano processado",
      JSON.stringify({ id: keyId, comando, outcome: resultado.outcome }),
    );
    if (resultado.confirmacao) {
      // best-effort: falha de envio nao desfaz a mudanca de estado.
      const envio = await enviarMensagemWhatsApp(telefoneCanonico, resultado.confirmacao);
      if (envio.outcome !== "success") {
        console.log(
          "[webhook-wasender] falha ao enviar confirmacao do comando",
          JSON.stringify({ id: keyId, comando }),
        );
      }
    }
  } catch (erro) {
    console.log(
      "[webhook-wasender] excecao ao processar comando de atendimento",
      JSON.stringify({ id: keyId, comando }),
      String(erro),
    );
  }
}

// ----------------------------------------------------------------------------
// Normaliza data.messages para array (a doc mostra objeto unico; Baileys
// costuma usar array -- tratamos as duas formas).
// ----------------------------------------------------------------------------
function normalizarMensagens(data: WasenderPayload["data"]): WasenderMensagem[] {
  const m = data?.messages;
  if (!m) return [];
  return Array.isArray(m) ? m : [m];
}

// ----------------------------------------------------------------------------
// Servidor HTTP. Resposta 200 rapida; dedup sincrona antes do 200;
// processamento pos-dedup em EdgeRuntime.waitUntil. Sem handshake GET (o
// WasenderAPI nao tem verificacao GET -- o webhook e configurado no painel
// deles, que NAO recebeu nenhuma URL ainda).
// ----------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  if (req.method === "GET") {
    // WasenderAPI nao usa handshake GET. Responde 200 vazio.
    return new Response("OK", { status: 200 });
  }

  if (req.method !== "POST") {
    return new Response("Metodo nao suportado", { status: 405 });
  }

  const corpoBruto = await req.text();

  // Assinatura -- ver bloco isolado acima. Comportamento documentado:
  // header X-Webhook-Signature == WASENDER_WEBHOOK_SECRET (texto puro).
  if (!assinaturaWasenderValida(req.headers.get("X-Webhook-Signature"))) {
    return new Response("Assinatura invalida", { status: 401 });
  }

  let payload: WasenderPayload;
  try {
    payload = JSON.parse(corpoBruto);
  } catch {
    return new Response("Corpo nao e JSON valido", { status: 400 });
  }

  const evento = payload.event ?? "";

  if (evento === "messages.received") {
    // Guards baratos + deduplicacao ATOMICA rodam SINCRONOS aqui, antes do
    // 200 -- retry do WasenderAPI do mesmo evento nunca dispara o
    // downstream duas vezes. So o processamento pesado vai para o
    // waitUntil.
    const novas: WasenderMensagem[] = [];
    try {
      for (const msg of normalizarMensagens(payload.data)) {
        const key = msg.key ?? {};
        if (!key.id) {
          console.log("[webhook-wasender] mensagem sem key.id -- ignorada");
          continue;
        }
        if (key.fromMe === true) continue; // eco da propria saida
        if (ehGrupo(key)) {
          console.log(
            "[webhook-wasender] mensagem de grupo -- ignorada",
            JSON.stringify({ id: key.id }),
          );
          continue;
        }
        const resultado = await registrarMensagemSeNova(key.id);
        if (resultado === "nova") novas.push(msg);
      }
    } catch (erro) {
      // Erro real de deduplicacao (banco/conexao) -- NUNCA tratado como
      // duplicata. Responde != 200 para o WasenderAPI reenviar.
      console.log(
        "[webhook-wasender] erro real ao registrar deduplicacao -- evento NAO confirmado",
        String(erro),
      );
      return new Response("Erro interno ao processar deduplicacao", { status: 500 });
    }

    for (const msg of novas) {
      EdgeRuntime.waitUntil(processarMensagemRecebidaPosDedup(msg));
    }
    return new Response("EVENT_RECEIVED", { status: 200 });
  }

  if (evento === "messages.update") {
    processarStatusUpdate(payload); // so log, rapido
    return new Response("EVENT_RECEIVED", { status: 200 });
  }

  // messages.upsert traz entrada E saida. Continua IGNORADO para o fluxo
  // normal (evita processar cada mensagem 2x junto de messages.received).
  // UNICA excecao: comandos de atendimento humano (#humano / #ia)
  // digitados no proprio WhatsApp do 2415 -- so' chegam por este evento,
  // com key.fromMe === true. Detecta e executa ANTES de ignorar o resto.
  if (evento === "messages.upsert") {
    try {
      for (const msg of normalizarMensagens(payload.data)) {
        const key = msg.key ?? {};
        if (key.fromMe !== true) continue; // so mensagem do proprio numero
        if (!key.id) continue;
        if (ehGrupo(key)) continue; // nunca comando de grupo
        const comando = detectarComandoAtendimento(extrairTexto(msg));
        if (!comando) continue; // mensagem fromMe normal -> segue ignorada

        const cleaned =
          typeof key.cleanedSenderPn === "string" ? soDigitos(key.cleanedSenderPn) : "";
        if (!cleaned) {
          // So veio remoteJid @lid, sem cleanedSenderPn -- nao da para
          // identificar o cliente destinatario. Ignora o comando.
          console.log(
            "[webhook-wasender] comando sem cleanedSenderPn -- ignorado",
            JSON.stringify({ id: key.id }),
          );
          continue;
        }

        // Dedup atomica por key.id -- retry / upsert duplicado nao
        // executa a RPC 2x. So os comandos passam por aqui; mensagens
        // fromMe normais nunca sao registradas (comportamento inalterado).
        const dedup = await registrarMensagemSeNova(key.id);
        if (dedup !== "nova") {
          console.log(
            "[webhook-wasender] comando duplicado (dedup) -- ignorado",
            JSON.stringify({ id: key.id }),
          );
          continue;
        }

        const telefoneCanonico = normalizarTelefone(cleaned);
        EdgeRuntime.waitUntil(
          processarComandoUpsertPosDedup(key.id, comando, telefoneCanonico),
        );
      }
    } catch (erro) {
      // Erro real de dedup (banco) -- nao confirma o evento, WasenderAPI
      // reenvia. Mesmo padrao do ramo messages.received.
      console.log(
        "[webhook-wasender] erro ao deduplicar comando upsert -- evento NAO confirmado",
        String(erro),
      );
      return new Response("Erro interno ao processar comando", { status: 500 });
    }

    console.log("[webhook-wasender] messages.upsert ignorado de proposito (evita duplicidade)");
    return new Response("EVENT_RECEIVED", { status: 200 });
  }

  // Demais eventos (session.status, qrcode.updated, poll results, etc.):
  // reconhecidos com 200, apenas logados, nunca processados nesta etapa.
  console.log(
    "[webhook-wasender] evento nao processado nesta etapa",
    JSON.stringify({ evento }),
  );
  return new Response("EVENT_RECEIVED", { status: 200 });
});
