// Painel/Admin -- "Atualizar e Validar Token UniTV" (decisao aprovada
// 2026-09-07, inovatv_central/CLAUDE.md, "Frente -- Fluxo de Renovacao
// Automatica" / autocura UniTV).
//
// Trata UNITV_DEALER_TOKEN como SESSAO TEMPORARIA: quando ela morre
// (returnCode 300 "Login information has been lost" -- ver historico da
// frente), o operador captura um token novo na sessao logada do painel
// de revenda e cola aqui. Este modulo valida e grava, reaproveitando
// EXATAMENTE:
//   * unitv_dealer_token_definir  (a mesma RPC do bootstrap / da SOP §15)
//   * a validacao read-only POST /api/account  (a mesma que a Fase 1 da
//     autocura, renovacao-unitv-conta e diagnosticarTokenUnitv usam)
//
// O QUE ESTE MODULO NAO FAZ (fora de escopo desta etapa, por decisao):
//   * NAO faz login, NAO resolve CAPTCHA, NAO ativa F4/F5.
//   * NAO chama /api/account/renew, NAO cria cobranca.
//   * NAO altera a logica de renovacao (orchestrator / renovacao-sigma-*
//     / unitv-renovar.mjs -- intocados).
//   * NAO toca o Edge secret UNITV_DEALER_TOKEN (invariante I4 do doc da
//     autocura) -- so' o Vault, via unitv_dealer_token_definir.
//
// NUCLEO PURO -- zero `Deno.env`, zero supabase-js, zero import de
// _shared. Toda dependencia externa (sonda /api/account, RPCs do Vault,
// insert de diagnostico) e' INJETADA. As Edge Functions
// painel-unitv-token-* ligam as deps reais; os testes ligam fakes
// (mesmo padrao de executarHealer, scripts/lib/autocura-unitv-healer.mjs).
//
// NUNCA retorna nem loga o valor do token (invariante I6 do doc da
// autocura).

// dealer_token do painel de revenda: 32 hex (formato MD5). Mesma regra
// de shape usada pelo healer (SHAPE_TOKEN em autocura-unitv-healer.mjs)
// e pela recaptura manual (NEXT_SESSION.md, "recaptura passiva").
export const SHAPE_DEALER_TOKEN = /^[0-9a-f]{32}$/;

export function normalizarTokenBruto(
  bruto: unknown,
): { ok: true; token: string } | { ok: false } {
  if (typeof bruto !== "string") return { ok: false };
  const t = bruto.trim().toLowerCase();
  return SHAPE_DEALER_TOKEN.test(t) ? { ok: true, token: t } : { ok: false };
}

// ---------------------------------------------------------------------
// Probe read-only /api/account -- a `classe` espelha `classificarProbe`
// de _shared/unitv_token_diag.ts (nao exportada la; e' contrato do dep,
// nao logica nova). O dep injetado recebe o token e devolve um
// ProbeResultado ja classificado.
// ---------------------------------------------------------------------
export type ClasseProbe = "ok" | "auth_reject" | "transport_fail";

export interface ProbeResultado {
  classe: ClasseProbe;
  returnCode?: number;
  httpStatus?: number;
  // true  -> a conta ancora resolveu p/ exatamente 1 (token autenticou
  //          E dado consistente)
  // false -> o token AUTENTICOU mas a ancora nao resolveu (drift de dado
  //          na conta ancora) -- ainda e' `classe: "ok"`
  ancoraResolveu?: boolean;
}

// Converte o resultado bruto de resolverContaUnitv (unitv_conta.ts) em
// ProbeResultado. Puro -- tipo do parametro deliberadamente frouxo para
// nao importar a union de unitv_conta.ts neste modulo dep-free.
export function classificarResolucao(r: {
  ok: boolean;
  reason?: string;
  returnCode?: number;
  httpStatus?: number;
}): ProbeResultado {
  if (r.ok) return { classe: "ok", ancoraResolveu: true };
  // returnCode 0, mas a ancora nao resolveu p/ exatamente 1: o token
  // AUTENTICOU. Nao e' morte de token -- e' drift de dado na ancora.
  if (
    r.reason === "nao_encontrado" ||
    r.reason === "ambiguo" ||
    r.reason === "customer_inesperado"
  ) {
    return { classe: "ok", ancoraResolveu: false };
  }
  if (r.reason === "unavailable" && typeof r.returnCode === "number") {
    return { classe: "auth_reject", returnCode: r.returnCode };
  }
  // unavailable sem returnCode (excecao/transporte), credenciais_ausentes,
  // sn_invalido -> nunca sao "token morto" nem "token valido".
  return {
    classe: "transport_fail",
    ...(typeof r.httpStatus === "number" ? { httpStatus: r.httpStatus } : {}),
  };
}

export type Veredicto =
  | "token_vivo"
  | "token_morto"
  | "indeterminado_outage"
  | "indeterminado";

// Veredito a partir de UMA sonda (o Painel faz 1 sonda por acao, nao as
// 3 do diagnostico continuo). Mapeamento conservador.
export function veredictoDeProbe(p: ProbeResultado): Veredicto {
  if (p.classe === "ok") return "token_vivo";
  if (p.classe === "auth_reject") return "token_morto";
  if (p.classe === "transport_fail") return "indeterminado_outage";
  return "indeterminado";
}

export type Badge = "verde" | "vermelho" | "alerta" | "sem_dado";

export interface StatusResumo {
  badge: Badge;
  titulo: string;
  detalhe: string;
}

// Texto persistente do status (requisito da decisao 2026-09-07). O caso
// `token_morto` diz explicitamente ao operador que precisa fazer uma
// NOVA CAPTURA.
export function derivarBadge(veredito: Veredicto | null): StatusResumo {
  switch (veredito) {
    case "token_vivo":
      return {
        badge: "verde",
        titulo: "🟢 Token válido",
        detalhe: "As renovações UniTV estão operando normalmente.",
      };
    case "token_morto":
      return {
        badge: "vermelho",
        titulo: "🔴 Token inválido — renovações UniTV indisponíveis",
        detalhe:
          "O token da sessão do painel de revenda morreu. Faça uma nova " +
          "captura no painel de revenda e atualize aqui para restabelecer " +
          "as renovações UniTV.",
      };
    case "indeterminado_outage":
      return {
        badge: "alerta",
        titulo: "⚠️ Não foi possível confirmar",
        detalhe:
          "O painel de revenda pode estar fora do ar. Tente validar de " +
          "novo em alguns minutos antes de trocar o token.",
      };
    case "indeterminado":
      return {
        badge: "alerta",
        titulo: "⚠️ Estado indeterminado",
        detalhe: "A última verificação foi inconclusiva. Valide de novo.",
      };
    default:
      return {
        badge: "sem_dado",
        titulo: "Sem verificação registrada",
        detalhe:
          'Nenhuma validação do token foi registrada ainda. Clique em ' +
          '"Validar agora".',
      };
  }
}

// ---------------------------------------------------------------------
// Linha de unitv_token_diagnostico gravada pelo Painel.
//
// `probe_return_code` fica SEMPRE null: essa coluna so' e' preenchida
// pela regra ">=2 probes, mesmo codigo" do monitor -- uma unica sonda
// do Painel NUNCA deve poder servir de batida de confirmacao do healer
// (autocura_monitor.ts filtra batida-1 por `.eq("probe_return_code",C)`).
// O codigo observado vai em `origem_return_code` (o proposito
// documentado dessa coluna). `painel_msg` fica null (o Painel nao
// guarda texto livre vindo do painel de revenda).
// ---------------------------------------------------------------------
export interface LinhaDiagnosticoPainel {
  veredito: Veredicto;
  motivo_origem: string;
  origem_return_code: number | null;
  origem_http_status: number | null;
  probe_total: number;
  probe_ok: number;
  probe_auth_reject: number;
  probe_transport_fail: number;
  probe_return_code: null;
  ancora_status: "ok" | "nao_resolveu" | "ausente";
  painel_msg: null;
  alertado_jose: false;
}

export function montarLinhaDiagnostico(
  veredito: Veredicto,
  motivoOrigem: string,
  p: ProbeResultado | null,
): LinhaDiagnosticoPainel {
  const cl = p?.classe;
  return {
    veredito,
    motivo_origem: motivoOrigem,
    origem_return_code: typeof p?.returnCode === "number" ? p.returnCode : null,
    origem_http_status: typeof p?.httpStatus === "number" ? p.httpStatus : null,
    probe_total: p ? 1 : 0,
    probe_ok: cl === "ok" ? 1 : 0,
    probe_auth_reject: cl === "auth_reject" ? 1 : 0,
    probe_transport_fail: cl === "transport_fail" ? 1 : 0,
    probe_return_code: null,
    ancora_status: !p
      ? "ausente"
      : p.ancoraResolveu === true
      ? "ok"
      : "nao_resolveu",
    painel_msg: null,
    alertado_jose: false,
  };
}

// =====================================================================
//  validarTokenAtual -- sonda o token que ESTA no Vault agora (botao
//  "Validar agora"). Read-only; grava 1 linha de diagnostico p/ manter
//  "ultima validacao" fresca.
// =====================================================================
export interface ValidarDeps {
  // token vivo do Vault -> fallback do secret (obterDealerToken).
  obterTokenAtual: () => Promise<string>;
  probar: (token: string) => Promise<ProbeResultado>;
  gravarDiagnostico: (linha: LinhaDiagnosticoPainel) => Promise<void>;
  agora?: () => number;
  motivoOrigem?: string;
}

export type ValidarResultado =
  | {
      outcome: "validado";
      veredito: Veredicto;
      resumo: StatusResumo;
      origem_return_code: number | null;
      criado_em: string;
    }
  | { outcome: "sem_token"; resumo: StatusResumo };

export async function validarTokenAtual(
  deps: ValidarDeps,
): Promise<ValidarResultado> {
  const agora = deps.agora ?? (() => Date.now());
  const motivoOrigem = deps.motivoOrigem ?? "painel:validar";

  let token = "";
  try {
    token = (await deps.obterTokenAtual()) ?? "";
  } catch {
    token = "";
  }
  if (!token) {
    // Sem token no Vault nem no secret -> renovacoes UniTV param. Trata
    // como vermelho (precisa capturar/atualizar).
    return { outcome: "sem_token", resumo: derivarBadge("token_morto") };
  }

  let p: ProbeResultado;
  try {
    p = await deps.probar(token);
  } catch {
    p = { classe: "transport_fail" };
  }

  const veredito = veredictoDeProbe(p);
  try {
    await deps.gravarDiagnostico(montarLinhaDiagnostico(veredito, motivoOrigem, p));
  } catch {
    // best-effort -- nao derruba a validacao se o insert falhar
  }

  return {
    outcome: "validado",
    veredito,
    resumo: derivarBadge(veredito),
    origem_return_code: typeof p.returnCode === "number" ? p.returnCode : null,
    criado_em: new Date(agora()).toISOString(),
  };
}

// =====================================================================
//  atualizarTokenUnitv -- FLUXO OBRIGATORIO (decisao 2026-09-07):
//
//    formato  ->  /api/account read-only (token NOVO)  ->
//    [SO' se valido] gravar Vault  ->  reler Vault  ->
//    revalidar /api/account (valor RELIDO)  ->  sucesso
//
//  Falha de validacao em QUALQUER passo antes da gravacao NUNCA modifica
//  o token atual (o Vault so' e' escrito depois do passo /api/account
//  do token novo passar).
// =====================================================================
export interface AtualizarDeps {
  probar: (token: string) => Promise<ProbeResultado>;
  // unitv_dealer_token_definir(token, 'recaptura_manual', <email do operador>)
  gravarVault: (token: string) => Promise<void>;
  // unitv_dealer_token_ler
  lerVault: () => Promise<string | null>;
  gravarDiagnostico: (linha: LinhaDiagnosticoPainel) => Promise<void>;
  agora?: () => number;
  log?: (evento: string, dados?: Record<string, unknown>) => void;
}

export type AtualizarResultado =
  | {
      outcome: "sucesso";
      veredito: "token_vivo";
      resumo: StatusResumo;
      criado_em: string;
    }
  | { outcome: "formato_invalido" }
  | {
      outcome: "token_novo_invalido";
      classe: ClasseProbe;
      origem_return_code: number | null;
    }
  | { outcome: "erro_gravar" }
  | {
      outcome: "revalidacao_falhou";
      motivo: "vault_diferente" | "api_account";
      classe?: ClasseProbe;
    };

export async function atualizarTokenUnitv(
  tokenBruto: unknown,
  deps: AtualizarDeps,
): Promise<AtualizarResultado> {
  const log = deps.log ?? (() => {});
  const agora = deps.agora ?? (() => Date.now());

  // 1) FORMATO -- 32 hex. So' isto falhar -> nada e' tocado.
  const fmt = normalizarTokenBruto(tokenBruto);
  if (!fmt.ok) {
    log("formato_invalido");
    return { outcome: "formato_invalido" };
  }
  const token = fmt.token;

  // 2) VALIDAR /api/account read-only com o token NOVO. Falhou -> Vault
  //    INTOCADO. `classe: "ok"` inclui o caso ancoraResolveu=false (o
  //    token autenticou, so' a conta ancora nao resolveu) -- isso E'
  //    token valido (mesma regra de classificarProbe / unitv_token_diag).
  let p1: ProbeResultado;
  try {
    p1 = await deps.probar(token);
  } catch (e) {
    log("probar_novo_excecao", { erro: String(e) });
    return {
      outcome: "token_novo_invalido",
      classe: "transport_fail",
      origem_return_code: null,
    };
  }
  if (p1.classe !== "ok") {
    log("token_novo_invalido", {
      classe: p1.classe,
      return_code: p1.returnCode ?? null,
    });
    return {
      outcome: "token_novo_invalido",
      classe: p1.classe,
      origem_return_code: typeof p1.returnCode === "number" ? p1.returnCode : null,
    };
  }

  // 3) SO' AGORA gravar -- e SO' o Vault (origem 'recaptura_manual').
  try {
    await deps.gravarVault(token);
    log("vault_gravado");
  } catch (e) {
    log("vault_gravar_erro", { erro: String(e) });
    return { outcome: "erro_gravar" };
  }

  // 4) RELER o Vault e conferir que == token gravado.
  let lido: string | null = null;
  try {
    lido = await deps.lerVault();
  } catch (e) {
    log("vault_ler_erro", { erro: String(e) });
  }
  if (typeof lido !== "string" || lido.trim().toLowerCase() !== token) {
    log("revalidacao_falhou", { motivo: "vault_diferente" });
    return { outcome: "revalidacao_falhou", motivo: "vault_diferente" };
  }

  // 5) REVALIDAR /api/account com o valor RELIDO do Vault.
  let p2: ProbeResultado;
  try {
    p2 = await deps.probar(lido.trim().toLowerCase());
  } catch (e) {
    log("revalidar_excecao", { erro: String(e) });
    p2 = { classe: "transport_fail" };
  }
  if (p2.classe !== "ok") {
    log("revalidacao_falhou", { motivo: "api_account", classe: p2.classe });
    // O token relido do Vault nao autentica -> observacao real de saude.
    try {
      await deps.gravarDiagnostico(
        montarLinhaDiagnostico(
          veredictoDeProbe(p2),
          "painel:atualizar-revalidacao",
          p2,
        ),
      );
    } catch {
      // best-effort
    }
    return { outcome: "revalidacao_falhou", motivo: "api_account", classe: p2.classe };
  }

  // 6) SUCESSO -- grava diagnostico token_vivo (mantem "ultima
  //    validacao" fresca e faz o status virar 🟢 imediatamente).
  try {
    await deps.gravarDiagnostico(
      montarLinhaDiagnostico("token_vivo", "painel:atualizar", p2),
    );
  } catch {
    // best-effort
  }
  log("sucesso");
  return {
    outcome: "sucesso",
    veredito: "token_vivo",
    resumo: derivarBadge("token_vivo"),
    criado_em: new Date(agora()).toISOString(),
  };
}
