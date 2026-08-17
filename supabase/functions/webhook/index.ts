// Webhook WhatsApp Cloud API (Componente 3, inovatv_central CLAUDE.md).
// Primeira fatia: so a function do Webhook + deduplicacao -- o
// Orquestrador ainda NAO foi alterado (nao checa X-Internal-Token
// ainda), fica pra uma fatia seguinte. Mensagens de midia (type !=
// "text") sao deliberadamente NAO processadas nesta etapa -- pendencia
// separada, vinculada ao achado de multimidia do gemini_client.ts
// (nao decidido, nao implementado por instrucao explicita).
//
// As 7 decisoes arquiteturais aprovadas (2026-08-17) implementadas
// aqui:
// 1. Function separada do Orquestrador, chamada HTTP entre elas.
// 2. Autenticacao Meta->Webhook via HMAC-SHA256 do corpo bruto
//    (WHATSAPP_APP_SECRET); autenticacao Webhook->Orquestrador via
//    ORCHESTRATOR_INTERNAL_TOKEN num header proprio (o Orquestrador
//    ainda nao valida isso -- fatia futura).
// 3. Deduplicacao atomica por message_id (_shared/webhook_dedup.ts).
// 4. Agnostico ao numero -- phone_number_id extraido do payload
//    (value.metadata), nunca hardcoded; nao usado pra decidir nada
//    nesta fatia, so disponivel se algum dia precisar.
// 5. Processamento assincrono via EdgeRuntime.waitUntil() -- responde
//    200 antes da chamada ao Orquestrador terminar. Falha na chamada
//    interna gera log estruturado, NUNCA loga o
//    ORCHESTRATOR_INTERNAL_TOKEN.
// 6. Contrato de dados ao Orquestrador inalterado: {telefone, conteudo}.
// 7. Reconhecimento de eventos: so value.messages processa;
//    value.statuses/value.errors reconhecidos e descartados (errors
//    com log); value.contacts ignorado.

import {
  registrarMensagemSeNova,
  type ResultadoDedup,
} from "../_shared/webhook_dedup.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

interface MetaMensagem {
  id: string;
  from: string;
  type: string;
  text?: { body?: string };
}

interface MetaValue {
  metadata?: { phone_number_id?: string };
  messages?: MetaMensagem[];
  statuses?: unknown[];
  errors?: unknown[];
  contacts?: unknown[];
}

interface MetaPayload {
  entry?: { changes?: { value?: MetaValue }[] }[];
}

async function calcularHmacSha256Hex(
  corpo: string,
  chave: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(chave),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const assinatura = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    encoder.encode(corpo),
  );
  return Array.from(new Uint8Array(assinatura))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function assinaturaValida(
  corpoBruto: string,
  headerAssinatura: string | null,
): Promise<boolean> {
  const appSecret = Deno.env.get("WHATSAPP_APP_SECRET");
  if (!appSecret || !headerAssinatura) return false;

  const prefixo = "sha256=";
  if (!headerAssinatura.startsWith(prefixo)) return false;
  const assinaturaRecebida = headerAssinatura.slice(prefixo.length);

  const assinaturaCalculada = await calcularHmacSha256Hex(corpoBruto, appSecret);
  return assinaturaCalculada === assinaturaRecebida;
}

// Componente 1 §16 (futuro): Webhook->Orquestrador via
// ORCHESTRATOR_INTERNAL_TOKEN. Disparado dentro de EdgeRuntime.waitUntil
// -- nunca bloqueia a resposta 200 pra Meta. Falha aqui e' best-effort:
// loga estruturado, nunca lanca pra fora (ja estamos fora do ciclo de
// resposta HTTP quando isso roda).
async function chamarOrquestrador(
  telefone: string,
  conteudo: string,
): Promise<void> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const tokenInterno = Deno.env.get("ORCHESTRATOR_INTERNAL_TOKEN");

  if (!supabaseUrl || !tokenInterno) {
    console.log(
      "[webhook] chamada ao orquestrador abortada -- configuracao ausente",
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
      body: JSON.stringify({ telefone, conteudo }),
      signal: AbortSignal.timeout(60000),
    });

    if (!resp.ok) {
      const corpo = await resp.text().catch(() => "");
      console.log(
        "[webhook] chamada ao orquestrador falhou",
        JSON.stringify({ status: resp.status, corpo }),
      );
    }
  } catch (erro) {
    console.log("[webhook] excecao ao chamar orquestrador", String(erro));
  }
}

// Dedup roda SEMPRE de forma sincrona (awaited pelo handler principal,
// antes do 200) -- e' a parte atomica que precisa terminar antes de
// decidir o que fazer. Só a chamada ao Orquestrador (lenta, Gemini +
// Rocket + WhatsApp) e' adiada via EdgeRuntime.waitUntil, depois que o
// dedup ja confirmou "e' novo".
async function processarValue(value: MetaValue): Promise<void> {
  if (value.errors) {
    console.log("[webhook] evento de erro recebido da Meta", JSON.stringify(value.errors));
    return;
  }

  if (value.statuses) {
    // Atualizacao de status (enviada/entregue/lida/falhou) -- reconhecida,
    // descartada, sem log (nao e' sinal de problema).
    return;
  }

  if (!value.messages) return;

  for (const mensagem of value.messages) {
    if (!mensagem.id || !mensagem.from) continue;

    let resultado: ResultadoDedup;
    try {
      resultado = await registrarMensagemSeNova(mensagem.id);
    } catch (erro) {
      // Erro real de dedup (banco/conexao) -- NUNCA tratado como
      // duplicata. Propaga pro handler principal, que responde algo
      // diferente de 200 -- a Meta deve reenviar este evento.
      console.log(
        "[webhook] erro real ao registrar deduplicacao -- mensagem NAO confirmada",
        JSON.stringify({ messageId: mensagem.id, erro: String(erro) }),
      );
      throw erro;
    }

    if (resultado === "duplicada") continue;

    if (mensagem.type === "text" && mensagem.text?.body) {
      EdgeRuntime.waitUntil(chamarOrquestrador(mensagem.from, mensagem.text.body));
      continue;
    }

    // Mensagem de midia (image/audio/document/etc.) -- pendencia
    // separada (multimidia do gemini_client.ts), NAO implementada
    // nesta etapa. Nao descarta silenciosamente (fica logado) e nao
    // fabrica texto artificial -- so nao repassa ainda.
    console.log(
      "[webhook] tipo de mensagem ainda nao suportado, pendencia de multimidia",
      JSON.stringify({ tipo: mensagem.type }),
    );
  }
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  if (req.method === "GET") {
    const modo = url.searchParams.get("hub.mode");
    const tokenRecebido = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    const tokenEsperado = Deno.env.get("WHATSAPP_VERIFY_TOKEN");

    if (modo === "subscribe" && tokenEsperado && tokenRecebido === tokenEsperado && challenge) {
      return new Response(challenge, { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method !== "POST") {
    return new Response("Metodo nao suportado", { status: 405 });
  }

  const corpoBruto = await req.text();

  if (!(await assinaturaValida(corpoBruto, req.headers.get("X-Hub-Signature-256")))) {
    return new Response("Assinatura invalida", { status: 401 });
  }

  let payload: MetaPayload;
  try {
    payload = JSON.parse(corpoBruto);
  } catch {
    return new Response("Corpo nao e JSON valido", { status: 400 });
  }

  try {
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.value) await processarValue(change.value);
      }
    }
  } catch (erro) {
    // Erro real de deduplicacao propagado de processarValue -- nao
    // confirma 200 (a mensagem nao foi de fato registrada como
    // processada), deixa a Meta reenviar naturalmente.
    console.log("[webhook] evento nao confirmado por erro real de dedup", String(erro));
    return new Response("Erro interno ao processar deduplicacao", { status: 500 });
  }

  return new Response("EVENT_RECEIVED", { status: 200 });
});
