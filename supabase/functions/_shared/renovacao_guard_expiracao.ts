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
import {
  buscarCobrancaPorOperacaoId,
  buscarCobrancaPendente,
  buscarCobrancaPendentePorGrupo,
  expirarCobrancaPendente,
} from "./cobrancas_pix.ts";
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

// Correcao de cobranca pendente bloqueando nova tentativa (2026-09-15):
// extensao MINIMA do resultado interno -- "manter_bloqueio" vira 2
// variantes (`ativa` carrega o paymentLinkUrl ja obtido na mesma
// consulta, sem chamada nova a Woovi). Nenhum consumidor existente
// (resolverTokenParaGuardExpiracao/resolverLoteParaGuardExpiracao,
// Etapa 4, ja em producao) muda de comportamento: os dois so' tratam
// "fechar" de forma diferente do resto, e "ativa" continua, como
// "manter_bloqueio" sempre foi, um "nao fechar".
type DecisaoCobranca =
  | { tipo: "fechar" }
  | { tipo: "manter_bloqueio" }
  | { tipo: "ativa"; paymentLinkUrl: string | null };

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
  if (!cobranca || cobranca.status !== "pendente") return { tipo: "manter_bloqueio" };

  const consulta = await consultarCobrancaOpenPix(operacaoId);
  // unavailable OU not_found (404) -- respeita exatamente a mesma
  // politica de dupla confirmacao do watchdog para 404: nunca libera
  // na hora, so' o watchdog (2 ciclos diferentes) faz isso.
  if (consulta.outcome !== "success") return { tipo: "manter_bloqueio" };
  if (consulta.status === "ACTIVE") {
    // Correcao de cobranca pendente bloqueando nova tentativa
    // (2026-09-15): reaproveita o paymentLinkUrl JA obtido nesta mesma
    // consulta -- nenhuma chamada nova a Woovi. Etapa 3 (tentarRecuperarPix)
    // continua sendo quem decide a UI de recuperacao no Portal; aqui e'
    // so' o dado bruto pra quem precisar (reconciliarCobrancaPendenteAntesDeNovaCobranca).
    return { tipo: "ativa", paymentLinkUrl: consulta.paymentLinkUrl };
  }

  const statusNorm = (consulta.status ?? "").toUpperCase();
  if (STATUS_WOOVI_TERMINAIS_SEM_PAGAMENTO.has(statusNorm)) return { tipo: "fechar" };

  // COMPLETED / status desconhecido / qualquer outro -> fail-safe,
  // igual a reconciliacao_renovacao.ts: nunca fecha por conta propria.
  return { tipo: "manter_bloqueio" };
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
      if (decisao.tipo !== "fechar") return token; // 'ativa' ou 'manter_bloqueio' -- permanece bloqueando, sem tocar em nada

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
      if (decisao.tipo !== "fechar") return lote; // 'ativa' ou 'manter_bloqueio' -- permanece bloqueando

      const fechado = await expirarLoteAutorizado(lote.operacao_id);
      if (fechado) return null;
      lote = await buscarLoteAtivoParaPublicId(publicId);
      continue;
    }

    return lote; // 'renovacao_em_andamento'
  }

  return lote;
}

// ---------------------------------------------------------------------
// Correcao de cobranca pendente bloqueando nova tentativa (2026-09-15,
// incidente real: cobranca antiga expirada no Woovi mas ainda
// 'pendente' localmente ate' 24h depois -- Peca 3/Caso D -- barra o
// INSERT de uma cobranca nova via cobrancas_pix_pendente_por_acesso_idx/
// cobrancas_pix_pendente_por_lote_idx, criando uma cobranca externa
// orfa na Woovi antes de descobrir o conflito).
//
// Chamada IMEDIATAMENTE ANTES de criarCobrancaOpenPix() no fluxo de
// confirmacao (_shared/renovacao_confirmacao.ts e
// confirmacao-renovacao/index.ts) -- nunca decide se o ACEITO deve
// prosseguir, so' resolve o que fazer com uma cobranca pendente antiga
// do MESMO acesso/grupo, se existir.
//
// Regra critica: se a cobranca antiga estiver ACTIVE, o chamador NUNCA
// deve chegar a chamar criarCobrancaOpenPix() -- por isso o outcome
// 'pendente_ativa' devolve os dados prontos pra reapresentar o Pix
// existente (mesmo formato ja usado pelo outcome 'confirmada' de
// confirmarRenovacao()), garantindo por controle de fluxo (retorno
// antecipado no chamador) que nenhuma cobranca nova e' criada.
export type ResultadoReconciliacaoCobranca =
  | { outcome: "sem_pendente" }
  | { outcome: "pendente_fechada" }
  // COMPLETED / 404 / indisponivel / desconhecido -- fail-safe, nunca
  // fecha nem libera. O chamador segue para criarCobrancaOpenPix() como
  // hoje, com o indice unico como backstop (comportamento inalterado
  // para estes casos).
  | { outcome: "pendente_bloqueando" }
  | { outcome: "pendente_ativa"; operacaoId: string; brCode: string; paymentLinkUrl: string | null };

export async function reconciliarCobrancaPendenteAntesDeNovaCobranca(params: {
  publicId?: string | null;
  grupoId?: string | null;
}): Promise<ResultadoReconciliacaoCobranca> {
  const pendente = params.grupoId
    ? await buscarCobrancaPendentePorGrupo(params.grupoId)
    : params.publicId
      ? await buscarCobrancaPendente(params.publicId)
      : null;
  if (!pendente) return { outcome: "sem_pendente" };

  const decisao = await avaliarCobrancaParaFechamento(pendente.operacao_id);

  if (decisao.tipo === "ativa") {
    return {
      outcome: "pendente_ativa",
      operacaoId: pendente.operacao_id,
      brCode: pendente.qr_code_texto,
      paymentLinkUrl: decisao.paymentLinkUrl,
    };
  }

  if (decisao.tipo === "fechar") {
    await expirarCobrancaPendente(pendente.operacao_id).catch(() => {});
    return { outcome: "pendente_fechada" };
  }

  // 'manter_bloqueio' (COMPLETED / 404 / indisponivel / desconhecido)
  return { outcome: "pendente_bloqueando" };
}
