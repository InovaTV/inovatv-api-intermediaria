// Etapa 4 (2026-09-15, Portal de Renovacao -- robustez do fluxo
// ACEITO/Pix, incidente real Flavio Augusto Da Silva) -- fecha,
// SOB DEMANDA e no mesmo request, um token/lote que ja passou do
// proprio `expira_em` mas cujo `estado` ainda nao foi varrido pelo
// watchdog (cron */5min). Sem isto, `buscarTokenAtivoPorPublicId` /
// `existeLoteAtivoParaPublicId` / `buscarLoteAtivoParaPublicId`
// continuam bloqueando uma tentativa nova por ate' ~10min mesmo
// quando o registro antigo ja' esta' tecnicamente morto.
//
// NAO e' um mecanismo novo -- e' o MESMO par de operacoes que o
// watchdog (renovacao-sigma-watchdog/index.ts) e a Etapa 3
// (tentarRecuperarPix, renovacao-iniciar/index.ts) ja usam,
// antecipado para o momento da decisao:
//   - 'aguardando_confirmacao' vencido: CAS existente
//     (expirarSeVencido/expirarLoteSeVencido) -- nunca ha' cobranca
//     nesse estado, nunca precisa consultar a Woovi.
//   - 'autorizada' vencida + operacao_id: reconsulta a Woovi com o
//     MESMO par ja usado pela Etapa 3 (buscarCobrancaPorOperacaoId +
//     consultarCobrancaOpenPix) -- NUNCA a via de escrita
//     (reconciliarPagamentoRenovacao), que dispara o workflow do
//     GitHub Actions; isso continua sendo exclusividade do
//     webhook/watchdog.
//   - 'renovacao_em_andamento': NUNCA tocado aqui -- continua
//     bloqueando incondicionalmente (janela propria de 15min do
//     workflow, nao a janela de 5min da proposta).
//
// Regra de seguranca (identica ao watchdog): so' fecha quando a
// Woovi confirmar, de forma inequivoca, um status TERMINAL sem
// pagamento. Qualquer outro resultado (ACTIVE, COMPLETED, 404,
// indisponivel, desconhecido) NUNCA fecha -- o bloqueio permanece
// exatamente como e' hoje, e a Etapa 3 (ACTIVE) continua responsavel
// pela recuperacao de Pix.

import {
  type TokenRenovacao,
  buscarTokenAtivoPorPublicId,
  expirarSeVencido,
  expirarAutorizacaoVinculada,
} from "./tokens_renovacao.ts";
import {
  type RenovacaoLote,
  buscarLoteAtivoParaPublicId,
  expirarLoteSeVencido,
  expirarLoteAutorizado,
} from "./renovacoes_lote.ts";
import { buscarCobrancaPorOperacaoId } from "./cobrancas_pix.ts";
import { consultarCobrancaOpenPix } from "./openpix_client.ts";

// Mesmo conjunto de _shared/reconciliacao_renovacao.ts
// (STATUS_WOOVI_TERMINAIS_SEM_PAGAMENTO) -- duplicado aqui de
// proposito, em vez de importar/exportar dali, para NAO tocar naquele
// modulo (dono da reconciliacao usada pelo watchdog/webhook, fora do
// escopo desta etapa). Se a lista oficial mudar um dia, os dois
// lugares precisam ser atualizados juntos -- comentario cruzado nos
// dois arquivos.
const STATUS_WOOVI_TERMINAIS_SEM_PAGAMENTO = new Set([
  "EXPIRED",
  "CANCELLED",
  "CANCELED",
  "REFUNDED",
  "REFUND",
]);

// So' 1 nova tentativa de reavaliacao apos um CAS perdido -- suficiente
// pra "reavaliar de forma segura" sem risco de loop (a proxima leitura
// reflete SEMPRE o vencedor real da corrida, nunca o mesmo estado).
const MAX_REAVALIACOES = 1;

type DecisaoCobranca = "fechar" | "manter_bloqueio";

// `expira_em` e' NOT NULL no banco -- nunca deveria vir ausente/
// invalido em producao. Defensivo mesmo assim: uma data invalida
// (`NaN`) NUNCA e' tratada como "vencida" -- fail-safe, o guard so'
// age quando tem certeza de que a janela realmente passou.
function estaVencido(expiraEm: string): boolean {
  const ms = new Date(expiraEm).getTime();
  return Number.isFinite(ms) && ms <= Date.now();
}

// Mesma consulta que tentarRecuperarPix ja faz (Etapa 3) -- nunca a
// via de escrita (reconciliarPagamentoRenovacao). So' AGE (fechar)
// quando a Woovi confirma, sem ambiguidade, que a cobranca morreu sem
// pagamento. Qualquer outra coisa (incluindo COMPLETED -- nunca deve
// ser fechado por aqui, isso e' 100% do webhook/watchdog) mantem o
// bloqueio como esta' hoje.
async function avaliarCobrancaParaFechamento(operacaoId: string): Promise<DecisaoCobranca> {
  const cobranca = await buscarCobrancaPorOperacaoId(operacaoId).catch(() => null);
  // Mesmo criterio de tentarRecuperarPix: se a cobranca local ja nao
  // esta' 'pendente' (ex.: 'pago', webhook pode estar em voo), nunca
  // mexe -- nunca arrisca fechar por cima de um pagamento.
  if (!cobranca || cobranca.status !== "pendente") return "manter_bloqueio";

  const consulta = await consultarCobrancaOpenPix(operacaoId);
  // unavailable OU not_found (404) -- respeita exatamente a mesma
  // politica de dupla confirmacao do watchdog para 404: nunca libera
  // na hora, so' o watchdog (2 ciclos diferentes) faz isso.
  if (consulta.outcome !== "success") return "manter_bloqueio";
  if (consulta.status === "ACTIVE") return "manter_bloqueio"; // Etapa 3 cuida da recuperacao

  const statusNorm = (consulta.status ?? "").toUpperCase();
  if (STATUS_WOOVI_TERMINAIS_SEM_PAGAMENTO.has(statusNorm)) return "fechar";

  // COMPLETED / status desconhecido / qualquer outro -> fail-safe,
  // igual a reconciliacao_renovacao.ts: nunca fecha por conta propria.
  return "manter_bloqueio";
}

// Token individual (avulso). `publicId` e' usado so' para reavaliacao
// apos um CAS perdido (mesma fonte que o chamador ja usou pra achar
// `tokenInicial`). Retorna o token ainda bloqueando (inalterado, ou
// reavaliado apos corrida), ou `null` quando o fechamento teve
// sucesso -- o chamador trata `null` exatamente como "nenhum token
// ativo", sem nenhuma outra mudanca de fluxo.
export async function resolverTokenParaGuardExpiracao(
  publicId: string,
  tokenInicial: TokenRenovacao | null,
): Promise<TokenRenovacao | null> {
  let token = tokenInicial;

  for (let tentativa = 0; token && tentativa <= MAX_REAVALIACOES; tentativa++) {
    if (!estaVencido(token.expira_em)) return token; // ainda dentro da janela (ou dado invalido) -- nada a fazer

    if (token.estado === "aguardando_confirmacao") {
      const fechado = await expirarSeVencido(token);
      if (fechado.estado === "expirada") return null;
      // CAS perdido (ex.: ACEITO concorrente ganhou) -- reavalia com o
      // estado real atual antes de desistir.
      token = await buscarTokenAtivoPorPublicId(publicId);
      continue;
    }

    if (token.estado === "autorizada" && token.operacao_id) {
      const decisao = await avaliarCobrancaParaFechamento(token.operacao_id);
      if (decisao !== "fechar") return token; // permanece bloqueando, sem tocar em nada

      const fechado = await expirarAutorizacaoVinculada(
        token.id,
        "guard_expiracao: expira_em vencido, Woovi confirmou cobranca terminal sem pagamento",
      );
      if (fechado) return null;
      // CAS perdido (ex.: pagamento chegou/watchdog ganhou nesse
      // instante) -- reavalia com o estado real atual.
      token = await buscarTokenAtivoPorPublicId(publicId);
      continue;
    }

    // 'renovacao_em_andamento' (ou qualquer estado nao-terminal
    // futuro) -- NUNCA fechado aqui, independente de expira_em.
    return token;
  }

  return token;
}

// Espelho lote de resolverTokenParaGuardExpiracao -- mesmo algoritmo,
// mesmas funcoes CAS equivalentes (expirarLoteSeVencido/
// expirarLoteAutorizado).
export async function resolverLoteParaGuardExpiracao(
  publicId: string,
  loteInicial: RenovacaoLote | null,
): Promise<RenovacaoLote | null> {
  let lote = loteInicial;

  for (let tentativa = 0; lote && tentativa <= MAX_REAVALIACOES; tentativa++) {
    if (!estaVencido(lote.expira_em)) return lote;

    if (lote.estado === "aguardando_confirmacao") {
      const fechado = await expirarLoteSeVencido(lote);
      if (fechado.estado === "expirada") return null;
      lote = await buscarLoteAtivoParaPublicId(publicId);
      continue;
    }

    if (lote.estado === "autorizada" && lote.operacao_id) {
      const decisao = await avaliarCobrancaParaFechamento(lote.operacao_id);
      if (decisao !== "fechar") return lote;

      const fechado = await expirarLoteAutorizado(lote.operacao_id);
      if (fechado) return null;
      lote = await buscarLoteAtivoParaPublicId(publicId);
      continue;
    }

    return lote; // 'renovacao_em_andamento'
  }

  return lote;
}
