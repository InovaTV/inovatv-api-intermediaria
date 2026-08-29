// Sincronizacao do `vencimento` no Rocket depois de uma renovacao
// UniTV bem-sucedida no painel de revenda -- Etapa 2, Renovacao
// Automatica UniTV (inovatv_central/CLAUDE.md).
//
// PORQUE existe: a renovacao UniTV (POST /api/account/renew) atualiza
// so' o painel de revenda; o `vencimento` do cliente no Rocket
// continua o antigo, e a IA le o Rocket (/status). Esta funcao espelha
// o novo vencimento (ja confirmado pela reconsulta no painel UniTV)
// para o Rocket, de forma isolada e idempotente.
//
// CONTRATO:
//   POST { publicId: <uuid>, vencimentoAlvo: <ISO> }
//   -> { outcome: "sincronizado", vencimentoAntes, vencimentoDepois, tentativas }
//   -> { outcome: "rocket_desync", etapa, vencimentoAntes?, vencimentoDepois?, tentativas }
//
// FLUXO (ate 2 tentativas, ~3s entre elas -- decisao C):
//   GET antes -> PATCH vencimento -> GET depois -> comparacao POR INSTANTE
//   sincronizado sse: depois >= antes (getTime) E depois alcancou o alvo
//   dentro de uma margem que cobre o bug conhecido de dupla conversao
//   de fuso do proprio Rocket (<=3h) -- NUNCA por igualdade de string,
//   NUNCA exigindo igualdade exata com o alvo (decisao D).
//
// REGRA CRITICA: esta funcao NUNCA toca /api/account/renew. A renovacao
// UniTV ja aconteceu e e' irreversivel -- uma falha aqui e' apenas
// dessincronia de cadastro, tratada pelo chamador como `rocketDesync`
// (nota de sistema + aviso ao Jose, sem `aguardando_humano`, sem 2a
// mensagem ao cliente -- decisao B). O chamador so' invoca esta funcao
// DEPOIS de renovarUmAcessoUniTV ter retornado "sucesso", e nunca
// re-renova por causa do resultado daqui.
//
// SEGURANCA: a resposta so' contem outcome/etapa/vencimento(datas)/
// tentativas. Nenhum campo sensivel do cadastro (nome, servidor, plano,
// valor, senha, device_key) e' lido, logado ou repassado.
//   - o PATCH nao le o corpo da resposta do Rocket (rocket_vencimento.ts);
//   - o GET usa consultarClienteCompletoRocket, do qual SO' o campo
//     `vencimento` e' consumido.
//
// AUTENTICACAO: X-Internal-Token == RENOVACAO_SIGMA_CALLBACK_TOKEN --
// o mesmo secret ja compartilhado entre o workflow e o Supabase
// (renovacao-sigma-cliente / -contexto / -resultado). Nenhum secret novo.

import { errorResponse, jsonResponse } from "../_shared/http.ts";
import { consultarClienteCompletoRocket } from "../_shared/rocket_valor_cliente.ts";
import { atualizarVencimentoRocket } from "../_shared/rocket_vencimento.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TENTATIVAS = 2;
const INTERVALO_MS = 3000;
// Cobre o bug real de dupla conversao de fuso do Rocket (diferenca de
// exatamente 3h ja observada entre Sigma e Rocket na mesma renovacao,
// SESSAO_ROCKET_MONITORAMENTO.md) -- nos dois sentidos, com folga.
const MARGEM_DRIFT_MS = 6 * 60 * 60 * 1000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

Deno.serve(async (req: Request) => {
  const tokenInterno = Deno.env.get("RENOVACAO_SIGMA_CALLBACK_TOKEN");
  const tokenRecebido = req.headers.get("X-Internal-Token");
  if (!tokenInterno || !tokenRecebido || tokenRecebido !== tokenInterno) {
    return errorResponse("Nao autorizado", 401);
  }

  if (req.method !== "POST") {
    return errorResponse("Metodo nao suportado, use POST", 405);
  }

  let body: { publicId?: string; vencimentoAlvo?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Corpo da requisicao precisa ser JSON valido");
  }

  const publicId = body.publicId ?? "";
  if (!UUID_PATTERN.test(publicId)) {
    return errorResponse("Campo obrigatorio: publicId (uuid valido)");
  }

  const vencimentoAlvo = typeof body.vencimentoAlvo === "string" ? body.vencimentoAlvo.trim() : "";
  const tAlvo = new Date(vencimentoAlvo).getTime();
  if (!vencimentoAlvo || !Number.isFinite(tAlvo)) {
    return errorResponse("Campo obrigatorio: vencimentoAlvo (data ISO valida)");
  }

  let vencimentoAntes: string | null = null;
  let ultimaEtapa: string | null = null;
  let ultimoDepois: string | null = null;

  for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
    // --- GET antes ---
    const antes = await consultarClienteCompletoRocket(publicId);
    if (antes.outcome !== "success" || !antes.vencimento) {
      ultimaEtapa = "get_antes";
      if (tentativa < TENTATIVAS) await sleep(INTERVALO_MS);
      continue;
    }
    if (vencimentoAntes === null) vencimentoAntes = antes.vencimento;
    const tAntes = new Date(antes.vencimento).getTime();

    // --- PATCH (idempotente: setar o mesmo vencimento de novo e' no-op) ---
    const patch = await atualizarVencimentoRocket(publicId, vencimentoAlvo);
    if (patch.outcome !== "success") {
      ultimaEtapa = "patch";
      if (tentativa < TENTATIVAS) await sleep(INTERVALO_MS);
      continue;
    }

    // --- GET depois (reconsulta independente, recarregada do zero) ---
    const depois = await consultarClienteCompletoRocket(publicId);
    if (depois.outcome !== "success" || !depois.vencimento) {
      ultimaEtapa = "get_depois";
      if (tentativa < TENTATIVAS) await sleep(INTERVALO_MS);
      continue;
    }
    ultimoDepois = depois.vencimento;
    const tDepois = new Date(depois.vencimento).getTime();

    // --- comparacao POR INSTANTE ---
    const avancou = Number.isFinite(tAntes) && Number.isFinite(tDepois) && tDepois >= tAntes;
    const alcancouAlvo = Number.isFinite(tDepois) && tDepois >= tAlvo - MARGEM_DRIFT_MS;
    if (avancou && alcancouAlvo) {
      return jsonResponse({
        outcome: "sincronizado",
        vencimentoAntes,
        vencimentoDepois: depois.vencimento,
        tentativas: tentativa,
      });
    }

    ultimaEtapa = "nao_avancou";
    if (tentativa < TENTATIVAS) await sleep(INTERVALO_MS);
  }

  return jsonResponse({
    outcome: "rocket_desync",
    etapa: ultimaEtapa ?? "desconhecida",
    vencimentoAntes,
    vencimentoDepois: ultimoDepois,
    tentativas: TENTATIVAS,
  });
});
