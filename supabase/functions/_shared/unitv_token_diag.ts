// Fase 1 da autocura do UNITV_DEALER_TOKEN -- CONFIRMACAO + OBSERVABILIDADE
// (2026-08-29, inovatv_central/CLAUDE.md). Read-only ponta a ponta.
//
// O QUE FAZ:
//   * Disparado FORA DA BANDA (EdgeRuntime.waitUntil) por
//     renovacao-unitv-conta quando ela ia devolver {outcome:"indisponivel"}
//     por 'unavailable' (token rejeitado OU painel fora).
//   * Roda ate 3 probes read-only (POST /api/account resolvendo o SN
//     ancora, via resolverContaUnitv -- MESMO caminho ja comprovado),
//     espacados ~20s, teto total 90s.
//   * Classifica: token_vivo | token_morto | indeterminado_outage |
//     indeterminado.
//   * Grava 1 linha em unitv_token_diagnostico (append-only) e loga
//     estruturado. Em 'token_morto', avisa o Jose via template (dedupe 6h).
//
// O QUE NAO FAZ (garantido por desenho):
//   * NAO faz login. NAO le/escreve nenhum secret. NAO chama
//     /api/account/renew. NAO cria cobranca. NAO altera estado de
//     renovacao (tokens_renovacao / renovacoes_lote / cobrancas_pix).
//   * NAO altera a resposta nem o tempo de resposta de
//     renovacao-unitv-conta (roda depois do return; excecao aqui JAMAIS
//     propaga).
//   * NAO registra o SN ancora, o dealer_token, o dealer_name, telefone,
//     e-mail, nome ou qualquer identificador -- nem no log nem na tabela.
//     `painel_msg` (unico texto livre) passa por higienizarMsgPainel():
//     redacao do SN + mascaramento de e-mail/numero + PORTAO que troca o
//     texto inteiro pelo marcador MSG_PAINEL_OMITIDA se sobrar '@', 4+
//     digitos, char nao-conservador, > 60 chars ou nome proprio. O log
//     estruturado nem inclui o texto -- so' um status.
//
// 'credenciais_ausentes' e 'sn_invalido' continuam SEPARADOS de
// 'unavailable' -- o gatilho em renovacao-unitv-conta so' dispara este
// diagnostico quando reason === "unavailable".
//
// UNITV_DIAG_ANCHOR_SN e' uma ANCORA OPERACIONAL TEMPORARIA de V1, NAO
// uma dependencia arquitetural permanente. A Fase 2 (C8) escolhe o
// health check definitivo (ex.: getDealerInfo, sem conta especifica).
// Aposentar/trocar a ancora = so' mudar o secret; nada aqui (nem a
// tabela unitv_token_diagnostico) referencia a conta. Ausente -> o
// diagnostico degrada para ancora_status='ausente' sem quebrar nada.

import { resolverContaUnitv } from "./unitv_conta.ts";
import { getServiceClient } from "./supabase_client.ts";
import { obterDealerToken as obterDealerTokenPadrao } from "./unitv_dealer_token.ts";
import { enviarTemplateWhatsApp } from "./whatsapp_client.ts";
import {
  NOME_TEMPLATE_NOVA_TRANSFERENCIA,
  IDIOMA_TEMPLATE_NOVA_TRANSFERENCIA,
} from "./mensagens_fixas.ts";

const N_PROBES = 3;
const ESPACO_MS = 20_000;
const TETO_MS = 90_000;
const DEDUPE_HORAS = 6;
// Reaproveita o template ja aprovado (nova_transferencia_humana): o
// slot de corpo recebe este texto fixo. Um template proprio e' melhoria
// futura, nao Fase 1.
export const MOTIVO_ALERTA_JOSE = "UNITV_DEALER_TOKEN invalido - recapturar (autocura fase 1)";

export type VeredictoDiagnostico =
  | "token_vivo"
  | "token_morto"
  | "indeterminado_outage"
  | "indeterminado";

export interface OrigemErroDiagnostico {
  returnCode?: number;
  httpStatus?: number;
  painelMsg?: string;
}

// deno-lint-ignore no-explicit-any
type SupaLike = { from: (t: string) => any };

export interface DiagnosticoOpts {
  // Slug fixo do sinal interno que disparou (Fase 1: sempre
  // "renovacao-unitv-conta:indisponivel"). Constante, sem PII.
  motivoOrigem: string;
  // Detalhe da chamada /api/account que falhou e causou o 'indisponivel'
  // (do CallErr enriquecido de unitv_conta.ts).
  origemErro?: OrigemErroDiagnostico;
  // --- injecoes para teste (producao usa os defaults) ---
  fetchImpl?: typeof fetch;
  agora?: () => number;
  dormir?: (ms: number) => Promise<void>;
  supa?: SupaLike;
  enviarTemplate?: typeof enviarTemplateWhatsApp;
  numeroJose?: string;
  ancoraSn?: string;
  // Fase 2A: se `dealerToken` nao for injetado, o token vem de
  // `obterToken()` (default = Vault -> fallback secret).
  dealerToken?: string;
  obterToken?: () => Promise<string>;
  dealerName?: string;
}

type ClasseProbe = "ok" | "auth_reject" | "transport_fail";
interface ResultadoProbe {
  classe: ClasseProbe;
  returnCode?: number;
  painelMsg?: string;
  httpStatus?: number;
  ancoraResolveu?: boolean;
}

function classificarProbe(r: Awaited<ReturnType<typeof resolverContaUnitv>>): ResultadoProbe {
  if (r.ok) return { classe: "ok", ancoraResolveu: true };
  // returnCode 0, mas o SN ancora nao resolveu pra exatamente 1: o token
  // AUTENTICOU (nao e' morte de token) -- e' drift de dado na ancora.
  if (r.reason === "nao_encontrado" || r.reason === "ambiguo" || r.reason === "customer_inesperado") {
    return { classe: "ok", ancoraResolveu: false };
  }
  if (r.reason === "unavailable") {
    if (typeof r.returnCode === "number") {
      return { classe: "auth_reject", returnCode: r.returnCode, painelMsg: r.painelMsg };
    }
    return { classe: "transport_fail", httpStatus: r.httpStatus };
  }
  // 'credenciais_ausentes' / 'sn_invalido' nao deveriam chegar aqui (pre-
  // checados antes do loop). Se chegarem, contam como transporte (nunca
  // produzem 'token_morto').
  return { classe: "transport_fail" };
}

// Marcador fixo gravado quando a errorMessage do painel nao passa no
// portao de allowlist -- nunca guardamos texto livre que nao possamos
// atestar como generico.
export const MSG_PAINEL_OMITIDA = "[mensagem do painel omitida]";

// Conjunto conservador de chars aceitos numa errorMessage "generica" de
// painel de auth (ex.: "Unauthenticated.", "Invalid token", "Access
// denied (code 5)"). Qualquer coisa fora disto -> a msg inteira e'
// substituida por MSG_PAINEL_OMITIDA.
const MSG_PAINEL_SEGURA_RE = /^[\p{L}\p{N} .,:;!?_()/'"[\]{}=+*%#-]*$/u;
const RE_EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const RE_NUM = /\+?\d[\d ()\-]{4,}\d/g;
// Limite curto do texto livre aceito (o CHECK do banco, 120, e' so'
// rede final). Frases de erro de auth reais sao curtas ("Unauthenticated.").
const MSG_PAINEL_MAX = 60;

// Conta palavras que comecam com maiuscula (>=2 letras). Erro de auth
// tipico tem 0-1 (inicial de frase). >=2 e' sinal de nome proprio
// ("Joao Silva") -> na duvida, descarta a mensagem inteira.
function contarPalavrasCapitalizadas(s: string): number {
  const m = s.match(/\b\p{Lu}\p{L}+/gu);
  return m ? m.length : 0;
}

// Higieniza a errorMessage do painel antes de gravar. Devolve: uma
// frase curta comprovadamente generica, o marcador fixo
// MSG_PAINEL_OMITIDA, ou null. NUNCA o texto original.
//
// CONTEXTO DE SEGURANCA: `painel_msg` so' e' populada a partir de uma
// resposta returnCode != 0 do /api/account -- erro da CAMADA DE AUTH,
// gerado ANTES de qualquer lookup de conta, sem nome/dados de titular.
// O unico identificador que ESTE probe poderia fazer o painel ecoar e'
// o proprio SN ancora (unico dado enviado, via `keyword`). Ainda assim,
// defesa em profundidade:
//   1. redige TODAS as ocorrencias do SN ancora (case-insensitive) -> [sn]
//   2. mascara e-mail -> [email] e sequencias numericas longas -> [num]
//      (2 passadas, em volta da truncagem)
//   3. PORTAO: se sobrar '@', 4+ digitos seguidos, char fora do conjunto
//      conservador, > 60 chars, ou >= 2 palavras capitalizadas (sinal de
//      nome proprio) -> descarta o texto inteiro -> MSG_PAINEL_OMITIDA.
export function higienizarMsgPainel(msg: unknown, ancoraSn?: string): string | null {
  if (typeof msg !== "string" || msg.trim() === "") return null;

  let s = msg;

  // 1. SN ancora -- todas as ocorrencias, case-insensitive, escapado.
  const sn = (ancoraSn ?? "").trim();
  if (sn.length >= 3) {
    const re = new RegExp(sn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    s = s.replace(re, "[sn]");
  }

  // 2. e-mail / numeros longos, colapsa espacos, trunca, re-mascara.
  s = s.replace(RE_EMAIL, "[email]").replace(RE_NUM, "[num]");
  s = s.replace(/\s+/g, " ").trim().slice(0, 120);
  s = s.replace(RE_EMAIL, "[email]").replace(RE_NUM, "[num]").trim();

  if (s === "") return null;

  // 3. portao. `\d{4,}` e capitalizadas checados no texto SEM os
  //    placeholders ([sn]/[num]/[email] nao contam).
  const semPlaceholders = s.replace(/\[(?:sn|num|email)\]/g, "");
  if (
    semPlaceholders.includes("@") ||
    /\d{4,}/.test(semPlaceholders) ||
    !MSG_PAINEL_SEGURA_RE.test(s) ||
    s.length > MSG_PAINEL_MAX ||
    contarPalavrasCapitalizadas(semPlaceholders) >= 2
  ) {
    return MSG_PAINEL_OMITIDA;
  }
  return s;
}

export async function diagnosticarTokenUnitv(opts: DiagnosticoOpts): Promise<void> {
  try {
    const fetchImpl = opts.fetchImpl ?? fetch;
    const agora = opts.agora ?? (() => Date.now());
    const dormir = opts.dormir ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const supa: SupaLike = opts.supa ?? getServiceClient();
    const enviarTemplate = opts.enviarTemplate ?? enviarTemplateWhatsApp;
    const numeroJose = opts.numeroJose ?? Deno.env.get("WHATSAPP_JOSE_NUMERO") ?? "";
    // Ancora operacional TEMPORARIA de V1 (ver cabecalho). Nunca
    // gravada/logada. Ausente -> ancora_status='ausente', sem probes.
    const ancoraSn = (opts.ancoraSn ?? Deno.env.get("UNITV_DIAG_ANCHOR_SN") ?? "").trim();
    // Fase 2A: token do Vault (fonte viva) -> fallback secret, via
    // obterDealerToken. `dealerName` continua so' do env (a Fase 2A move
    // so' o token). `?? ""` cobre um obterToken que devolva undefined.
    const dealerToken = opts.dealerToken ?? (await (opts.obterToken ?? obterDealerTokenPadrao)()) ?? "";
    const dealerName = opts.dealerName ?? Deno.env.get("UNITV_DEALER_NAME") ?? "";

    const probes: ResultadoProbe[] = [];
    let ancoraAusente = false;

    if (!ancoraSn || !dealerToken || !dealerName) {
      // Sem com o que sondar. Nao e' 'credenciais_ausentes' do fluxo
      // (aquele nem chega aqui) -- e' o SN ancora nao configurado.
      ancoraAusente = true;
    } else {
      const inicio = agora();
      for (let i = 0; i < N_PROBES; i++) {
        if (i > 0) {
          if (agora() - inicio >= TETO_MS) break;
          await dormir(ESPACO_MS);
          if (agora() - inicio >= TETO_MS) break;
        }
        const r = await resolverContaUnitv(ancoraSn, { fetchImpl, dealerToken, dealerName });
        probes.push(classificarProbe(r));
      }
    }

    const probeOk = probes.filter((p) => p.classe === "ok").length;
    const probeAuthReject = probes.filter((p) => p.classe === "auth_reject").length;
    const probeTransportFail = probes.filter((p) => p.classe === "transport_fail").length;
    const probeTotal = probes.length;

    // returnCode que aparece em >=2 probes auth_reject (o valor que
    // decide 'token_morto').
    let probeReturnCode: number | null = null;
    if (probeAuthReject >= 2) {
      const cont = new Map<number, number>();
      for (const p of probes) {
        if (p.classe === "auth_reject" && typeof p.returnCode === "number") {
          cont.set(p.returnCode, (cont.get(p.returnCode) ?? 0) + 1);
        }
      }
      for (const [code, n] of cont) {
        if (n >= 2) { probeReturnCode = code; break; }
      }
    }

    let veredito: VeredictoDiagnostico;
    if (probeTotal === 0) {
      veredito = "indeterminado";
    } else if (probeOk >= 2) {
      veredito = "token_vivo";
    } else if (probeReturnCode !== null) {
      veredito = "token_morto";
    } else if (probeTransportFail >= 2) {
      veredito = "indeterminado_outage";
    } else {
      veredito = "indeterminado";
    }

    let ancoraStatus: "ok" | "nao_resolveu" | "ausente";
    if (ancoraAusente) ancoraStatus = "ausente";
    else if (probes.some((p) => p.classe === "ok" && p.ancoraResolveu === true)) ancoraStatus = "ok";
    else ancoraStatus = "nao_resolveu";

    // painel_msg: preferir a de um probe auth_reject (mais fresca);
    // senao a da chamada de origem.
    const msgProbe = probes.find((p) => p.classe === "auth_reject" && p.painelMsg)?.painelMsg;
    const painelMsg = higienizarMsgPainel(msgProbe ?? opts.origemErro?.painelMsg, ancoraSn);

    // --- aviso ao Jose (so' token_morto, com dedupe de 6h) ---
    let alertadoJose = false;
    if (veredito === "token_morto") {
      let jaAlertou = false;
      try {
        const limite = new Date(agora() - DEDUPE_HORAS * 3_600_000).toISOString();
        const res = await supa
          .from("unitv_token_diagnostico")
          .select("id")
          .eq("veredito", "token_morto")
          .eq("alertado_jose", true)
          .gte("criado_em", limite)
          .limit(1);
        jaAlertou = Array.isArray(res?.data) && res.data.length > 0;
      } catch (e) {
        // Falha na consulta de dedupe -> nao suprime o aviso (um aviso
        // duplicado e' inofensivo; perder um aviso de token morto nao e').
        console.log("[unitv-token-diag] falha na consulta de dedupe", String(e));
      }

      if (!jaAlertou && numeroJose) {
        try {
          const env = await enviarTemplate(
            numeroJose,
            NOME_TEMPLATE_NOVA_TRANSFERENCIA,
            IDIOMA_TEMPLATE_NOVA_TRANSFERENCIA,
            [MOTIVO_ALERTA_JOSE],
          );
          alertadoJose = env.outcome === "success";
        } catch (e) {
          console.log("[unitv-token-diag] falha ao avisar Jose", String(e));
        }
      }
    }

    const linha = {
      veredito,
      motivo_origem: opts.motivoOrigem,
      origem_return_code: opts.origemErro?.returnCode ?? null,
      origem_http_status: opts.origemErro?.httpStatus ?? null,
      probe_total: probeTotal,
      probe_ok: probeOk,
      probe_auth_reject: probeAuthReject,
      probe_transport_fail: probeTransportFail,
      probe_return_code: probeReturnCode,
      ancora_status: ancoraStatus,
      painel_msg: painelMsg,
      alertado_jose: alertadoJose,
    };

    try {
      const res = await supa.from("unitv_token_diagnostico").insert(linha);
      if (res?.error) {
        console.log("[unitv-token-diag] erro ao gravar diagnostico", JSON.stringify({ erro: String(res.error?.message ?? res.error) }));
      }
    } catch (e) {
      console.log("[unitv-token-diag] excecao ao gravar diagnostico", String(e));
    }

    // Log estruturado: NUNCA inclui o texto de `painel_msg` -- so' um
    // status (o log e' visivel a qualquer um com `functions logs`; a
    // tabela e' service_role). `painel_msg` ja e' higienizado, mas
    // minimizacao > redundancia.
    const { painel_msg: _pm, ...linhaSemMsg } = linha;
    const painelMsgStatus = painelMsg === null
      ? "ausente"
      : (painelMsg === MSG_PAINEL_OMITIDA ? "omitida" : "presente");
    console.log(
      "[unitv-token-diag] diagnostico concluido",
      JSON.stringify({ evento: "diagnostico_token", ...linhaSemMsg, painel_msg_status: painelMsgStatus }),
    );
  } catch (e) {
    // Ultima linha de defesa -- este diagnostico NUNCA propaga excecao
    // pro chamador (renovacao-unitv-conta ja respondeu).
    console.log("[unitv-token-diag] excecao no diagnostico", String(e));
  }
}
