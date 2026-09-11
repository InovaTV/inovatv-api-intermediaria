// wasender_media.ts -- Fase 4, Checkpoint B (aprovado 2026-09-11).
//
// Helper ISOLADO, ainda NAO chamado por nenhum fluxo de atendimento.
// webhook-wasender/index.ts continua EXATAMENTE como estava (midia
// ainda termina no mesmo `return` de sempre, ver Checkpoint A) -- este
// arquivo nao e importado por ele, nem por orchestrator/index.ts, nem
// por gemini_client.ts, nem por nada da Base Evolutiva. So existe pra
// ser exercitado por testes isolados nesta etapa.
//
// Objetivo: provar que da pra transformar uma midia recebida do
// Wasender em bytes de imagem validos usando a API oficial deles de
// decriptacao (POST /api/decrypt-media -> publicUrl temporaria de 1h,
// documentado em https://wasenderapi.com/api-docs/messages/decrypt-media-file),
// sem implementar HKDF/AES/Baileys por conta propria.
//
// Escopo desta etapa: SOMENTE imagem (image/jpeg, image/png,
// image/webp). Audio/video/documento ficam de fora, deliberadamente
// (proxima decisao, se houver, e' separada).
//
// NUNCA persiste em Supabase Storage, Hostinger, disco ou banco --
// bytes e base64 existem so' em memoria durante a chamada, descartados
// (GC normal do runtime) assim que o chamador solta a referencia ao
// resultado. Nenhum arquivo temporario e criado em nenhum ponto.
//
// SEGURANCA -- nunca loga: token, URL original, publicUrl, mediaKey,
// base64, conteudo da imagem, telefone. So loga: sucesso/falha, status
// HTTP, mimetype declarado, tamanho em bytes, tipo de arquivo validado
// (por magic bytes, nunca so pelo campo mimetype recebido) e tempo de
// processamento.

export interface ObjetoMidiaWasender {
  url: string;
  mediaKey: string;
  mimetype: string;
}

export interface MidiaProcessadaSucesso {
  outcome: "success";
  mimeType: string;
  dadosBase64: string;
  tamanhoBytes: number;
}

export type ResultadoProcessarMidia =
  | MidiaProcessadaSucesso
  | { outcome: "mime_nao_permitido" }
  | { outcome: "decrypt_falhou" }
  | { outcome: "download_falhou" }
  | { outcome: "tamanho_excedido" }
  | { outcome: "magic_bytes_invalidos" }
  | { outcome: "unavailable" };

// Allowlist inicial -- so os 3 tipos de imagem autorizados nesta etapa.
const MIME_PERMITIDOS: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

// Mesmo limite documentado pelo proprio Wasender pra envio de imagem
// (https://wasenderapi.com/api-docs/messages/send-image-message:
// "Maximum file size: 5MB") -- reaproveitado aqui como teto defensivo
// pro caminho de recepcao, nao inventado.
const TAMANHO_MAXIMO_BYTES = 5 * 1024 * 1024;

const TIMEOUT_MS = 20000;

function logDiagnostico(evento: string, detalhe: Record<string, unknown>): void {
  console.log(`[wasender_media] ${evento}`, JSON.stringify(detalhe));
}

// Confere a ASSINATURA REAL dos bytes contra o mimetype declarado --
// nunca confia so no campo mimetype do payload (dado externo, nao
// verificado). Um mimetype "image/jpeg" com bytes que nao comecam com
// FF D8 FF e' rejeitado, independente do que o Wasender/WhatsApp
// declararam.
function magicBytesBatem(bytes: Uint8Array, mimetype: string): boolean {
  if (bytes.length < 12) return false;
  switch (mimetype) {
    case "image/jpeg":
      return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case "image/png":
      return (
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4e &&
        bytes[3] === 0x47 &&
        bytes[4] === 0x0d &&
        bytes[5] === 0x0a &&
        bytes[6] === 0x1a &&
        bytes[7] === 0x0a
      );
    case "image/webp":
      // RIFF <4 bytes de tamanho> WEBP
      return (
        bytes[0] === 0x52 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x46 &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
      );
    default:
      return false;
  }
}

// Conversao chunked -- evita estourar o limite de argumentos de
// String.fromCharCode(...bytes) com imagens grandes (ate' 5MB aqui).
function base64DeBytes(bytes: Uint8Array): string {
  let binario = "";
  const TAMANHO_BLOCO = 0x8000;
  for (let i = 0; i < bytes.length; i += TAMANHO_BLOCO) {
    binario += String.fromCharCode(...bytes.subarray(i, i + TAMANHO_BLOCO));
  }
  return btoa(binario);
}

// ----------------------------------------------------------------------------
// Pipeline completo -- ordem fixa, cada etapa so roda se a anterior
// passou: allowlist de mimetype -> decrypt-media -> download -> tamanho
// -> magic bytes -> base64 (SO' apos toda validacao ter passado).
// ----------------------------------------------------------------------------
export async function processarMidiaWasender(
  midia: ObjetoMidiaWasender,
  messageId: string,
): Promise<ResultadoProcessarMidia> {
  const inicio = Date.now();

  // 0) Allowlist de mimetype -- antes de qualquer rede.
  if (!MIME_PERMITIDOS.has(midia.mimetype)) {
    logDiagnostico("mime_nao_permitido", { mimetypeDeclarado: midia.mimetype });
    return { outcome: "mime_nao_permitido" };
  }

  const apiToken = Deno.env.get("WASENDER_API_TOKEN");
  const baseUrl = Deno.env.get("WASENDER_BASE_URL") ?? "https://wasenderapi.com";
  if (!apiToken) {
    logDiagnostico("indisponivel", { motivo: "config ausente (WASENDER_API_TOKEN)" });
    return { outcome: "unavailable" };
  }

  // 1) POST /api/decrypt-media -- formato exato conforme doc oficial
  // (https://wasenderapi.com/api-docs/messages/decrypt-media-file).
  let publicUrl: string;
  try {
    const respDecrypt = await fetch(`${baseUrl}/api/decrypt-media`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiToken}`,
      },
      body: JSON.stringify({
        data: {
          messages: {
            key: { id: messageId },
            message: {
              imageMessage: {
                url: midia.url,
                mediaKey: midia.mediaKey,
                mimetype: midia.mimetype,
              },
            },
          },
        },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!respDecrypt.ok) {
      logDiagnostico("decrypt_falhou", { status: respDecrypt.status });
      return { outcome: "decrypt_falhou" };
    }

    const corpo = await respDecrypt.json().catch(() => null);
    if (typeof corpo?.publicUrl !== "string" || corpo.publicUrl.length === 0) {
      logDiagnostico("decrypt_falhou", { status: respDecrypt.status, motivo: "publicUrl ausente na resposta" });
      return { outcome: "decrypt_falhou" };
    }
    publicUrl = corpo.publicUrl;
  } catch (erro) {
    logDiagnostico("decrypt_falhou", {
      motivo: "excecao",
      nome: erro instanceof Error ? erro.name : typeof erro,
    });
    return { outcome: "decrypt_falhou" };
  }

  // 2) Download do arquivo ja decriptado.
  let bytes: Uint8Array;
  try {
    const respDownload = await fetch(publicUrl, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!respDownload.ok) {
      logDiagnostico("download_falhou", { status: respDownload.status });
      return { outcome: "download_falhou" };
    }
    const buffer = await respDownload.arrayBuffer();
    bytes = new Uint8Array(buffer);
  } catch (erro) {
    logDiagnostico("download_falhou", {
      motivo: "excecao",
      nome: erro instanceof Error ? erro.name : typeof erro,
    });
    return { outcome: "download_falhou" };
  }

  // 3) Tamanho -- antes de magic bytes (mais barato, corta cedo).
  if (bytes.length > TAMANHO_MAXIMO_BYTES) {
    logDiagnostico("tamanho_excedido", {
      tamanhoBytes: bytes.length,
      limiteBytes: TAMANHO_MAXIMO_BYTES,
    });
    return { outcome: "tamanho_excedido" };
  }

  // 4) Magic bytes -- nunca confia so no mimetype declarado.
  if (!magicBytesBatem(bytes, midia.mimetype)) {
    logDiagnostico("magic_bytes_invalidos", {
      mimetypeDeclarado: midia.mimetype,
      tamanhoBytes: bytes.length,
    });
    return { outcome: "magic_bytes_invalidos" };
  }

  // 5) Base64 -- SO' depois de toda validacao ter passado.
  const dadosBase64 = base64DeBytes(bytes);
  const tempoMs = Date.now() - inicio;
  logDiagnostico("sucesso", {
    mimetype: midia.mimetype,
    tamanhoBytes: bytes.length,
    tipoValidado: midia.mimetype,
    tempoMs,
  });

  return { outcome: "success", mimeType: midia.mimetype, dadosBase64, tamanhoBytes: bytes.length };
}
