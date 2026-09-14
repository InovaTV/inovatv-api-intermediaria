// Trilha de auditoria da Renovacao Automatica (Fase 2/3, 2026-09-14,
// inovatv-api-intermediaria/CLAUDE.md) -- migration
// 20260914190000_renovacao_eventos.sql. NAO e' acompanhamento em tempo
// real (painel consulta DEPOIS que a renovacao termina) -- e' so'
// historico append-only, aditivo a tokens_renovacao/renovacoes_lote/
// cobrancas_pix (que continuam sendo a fonte de verdade do ESTADO
// ATUAL). Ver Node.js equivalente (scripts/lib/renovacao-eventos.mjs)
// usado SO' pelo renovacao-sigma-workflow.mjs (roda fora do Deno, no
// GitHub Actions) -- os dois catalogos precisam ficar em sincronia
// manual (nenhum import cross-runtime hoje; workflow roda `node` puro,
// sem tsx).
//
// registrarEvento() NUNCA lanca excecao -- best-effort deliberado.
// Regra de ordem, nao negociavel: so' chamar isto DEPOIS que a mutacao
// de estado real (UPDATE em tokens_renovacao/cobrancas_pix/etc.) ja foi
// confirmada com sucesso. Um evento que falha ao gravar nunca pode
// derrubar a renovacao em si.

import { getServiceClient } from "./supabase_client.ts";

export type NivelEvento = "info" | "erro";
export type ServidorRenovacao = "sigma" | "unitv";

export type EtapaRenovacao =
  | "entrada"
  | "identificacao"
  | "acessos"
  | "carrinho"
  | "confirmacao"
  | "cobranca_pix"
  | "pagamento"
  | "disparo_renovacao"
  | "processamento"
  | "vencimento"
  | "callback_resultado"
  | "mensagem_legado"
  | "consulta_portal";

export type CodigoEvento =
  | "portal_acessado"
  | "identificacao_bloqueada_rate_limit"
  | "identificacao_nao_encontrada"
  | "identificacao_rocket_indisponivel"
  | "identificacao_sucesso"
  | "acessos_apresentados"
  | "acessos_indisponiveis"
  | "carrinho_erro_generico"
  | "carrinho_ja_existe_renovacao"
  | "carrinho_erro_unitv"
  | "carrinho_erro_corrida"
  | "carrinho_token_criado"
  | "carrinho_lote_criado"
  | "confirmacao_token_inexistente"
  | "confirmacao_expirada"
  | "confirmacao_ja_decidida"
  | "confirmacao_telefone_nao_confere"
  | "confirmacao_cancelada"
  | "confirmacao_aceita"
  | "cobranca_pix_criada"
  | "cobranca_pix_falhou"
  | "cobranca_pix_registro_falhou"
  | "pagamento_webhook_assinatura_invalida"
  | "pagamento_webhook_evento_ignorado"
  | "pagamento_webhook_sem_correlation_id"
  | "pagamento_reconsulta_falhou"
  | "pagamento_reconsulta_nao_confirma"
  | "pagamento_sem_registro_local"
  | "pagamento_valor_divergente"
  | "pagamento_confirmado"
  | "pagamento_reenvio_ja_processado"
  | "disparo_reivindicacao_falhou"
  | "disparo_solicitado"
  | "disparo_falhou"
  | "disparo_excecao"
  | "processamento_iniciado"
  | "processamento_plano_nao_mapeado"
  | "processamento_cliente_rocket_falhou"
  | "processamento_id_interno_falhou"
  | "processamento_sessao_expirada"
  | "processamento_pacote_vazio"
  | "processamento_painel_indisponivel"
  | "processamento_contexto_invalido"
  | "processamento_clique_executado"
  | "processamento_excecao"
  | "vencimento_confirmado_sucesso"
  | "vencimento_nao_confirmado_ambiguo"
  | "vencimento_nao_confirmado_falha"
  | "vencimento_rocket_desync"
  | "callback_nao_autorizado"
  | "callback_sem_token_correspondente"
  | "callback_ja_processado"
  | "resultado_gravado_sucesso"
  | "resultado_gravado_falha"
  | "transferencia_humana_acionada"
  | "whatsapp_legado_enviado"
  | "whatsapp_legado_falhou"
  | "portal_consultou_resultado";

// etapa e nivel NUNCA sao passados pelo chamador -- nascem daqui, a
// partir do codigo. Evita o codigo A ser gravado com a etapa/nivel de
// B por engano. codigo/etapa ficam como `text` livre no banco (sem
// CHECK) de proposito -- o catalogo cresce por instrumentacao
// incremental (Fase 3, function por function); uma CHECK constraint
// exigiria migration a cada codigo novo. A garantia de consistencia e'
// este mapa + os testes (scripts/testes/renovacao_eventos/), nao o
// schema.
//
// whatsapp_legado_falhou e' 'info', nao 'erro', de proposito: o
// Wasender esta desativado (premissa fixada 2026-09-14) -- uma falha
// de envio por esse canal legado NAO representa falha da renovacao.
export const CATALOGO_EVENTOS: Record<CodigoEvento, { etapa: EtapaRenovacao; nivel: NivelEvento }> = {
  portal_acessado: { etapa: "entrada", nivel: "info" },

  identificacao_bloqueada_rate_limit: { etapa: "identificacao", nivel: "erro" },
  identificacao_nao_encontrada: { etapa: "identificacao", nivel: "info" },
  identificacao_rocket_indisponivel: { etapa: "identificacao", nivel: "erro" },
  identificacao_sucesso: { etapa: "identificacao", nivel: "info" },

  acessos_apresentados: { etapa: "acessos", nivel: "info" },
  acessos_indisponiveis: { etapa: "acessos", nivel: "erro" },

  carrinho_erro_generico: { etapa: "carrinho", nivel: "erro" },
  carrinho_ja_existe_renovacao: { etapa: "carrinho", nivel: "erro" },
  carrinho_erro_unitv: { etapa: "carrinho", nivel: "erro" },
  carrinho_erro_corrida: { etapa: "carrinho", nivel: "erro" },
  carrinho_token_criado: { etapa: "carrinho", nivel: "info" },
  carrinho_lote_criado: { etapa: "carrinho", nivel: "info" },

  confirmacao_token_inexistente: { etapa: "confirmacao", nivel: "erro" },
  confirmacao_expirada: { etapa: "confirmacao", nivel: "erro" },
  confirmacao_ja_decidida: { etapa: "confirmacao", nivel: "erro" },
  confirmacao_telefone_nao_confere: { etapa: "confirmacao", nivel: "erro" },
  confirmacao_cancelada: { etapa: "confirmacao", nivel: "info" },
  confirmacao_aceita: { etapa: "confirmacao", nivel: "info" },

  cobranca_pix_criada: { etapa: "cobranca_pix", nivel: "info" },
  cobranca_pix_falhou: { etapa: "cobranca_pix", nivel: "erro" },
  cobranca_pix_registro_falhou: { etapa: "cobranca_pix", nivel: "erro" },

  pagamento_webhook_assinatura_invalida: { etapa: "pagamento", nivel: "erro" },
  pagamento_webhook_evento_ignorado: { etapa: "pagamento", nivel: "info" },
  pagamento_webhook_sem_correlation_id: { etapa: "pagamento", nivel: "erro" },
  pagamento_reconsulta_falhou: { etapa: "pagamento", nivel: "erro" },
  pagamento_reconsulta_nao_confirma: { etapa: "pagamento", nivel: "erro" },
  pagamento_sem_registro_local: { etapa: "pagamento", nivel: "erro" },
  pagamento_valor_divergente: { etapa: "pagamento", nivel: "erro" },
  pagamento_confirmado: { etapa: "pagamento", nivel: "info" },
  pagamento_reenvio_ja_processado: { etapa: "pagamento", nivel: "info" },

  disparo_reivindicacao_falhou: { etapa: "disparo_renovacao", nivel: "erro" },
  disparo_solicitado: { etapa: "disparo_renovacao", nivel: "info" },
  disparo_falhou: { etapa: "disparo_renovacao", nivel: "erro" },
  disparo_excecao: { etapa: "disparo_renovacao", nivel: "erro" },

  processamento_iniciado: { etapa: "processamento", nivel: "info" },
  processamento_plano_nao_mapeado: { etapa: "processamento", nivel: "erro" },
  processamento_cliente_rocket_falhou: { etapa: "processamento", nivel: "erro" },
  processamento_id_interno_falhou: { etapa: "processamento", nivel: "erro" },
  processamento_sessao_expirada: { etapa: "processamento", nivel: "erro" },
  processamento_pacote_vazio: { etapa: "processamento", nivel: "erro" },
  processamento_painel_indisponivel: { etapa: "processamento", nivel: "erro" },
  processamento_contexto_invalido: { etapa: "processamento", nivel: "erro" },
  processamento_clique_executado: { etapa: "processamento", nivel: "info" },
  processamento_excecao: { etapa: "processamento", nivel: "erro" },

  vencimento_confirmado_sucesso: { etapa: "vencimento", nivel: "info" },
  vencimento_nao_confirmado_ambiguo: { etapa: "vencimento", nivel: "erro" },
  vencimento_nao_confirmado_falha: { etapa: "vencimento", nivel: "erro" },
  vencimento_rocket_desync: { etapa: "vencimento", nivel: "info" },

  callback_nao_autorizado: { etapa: "callback_resultado", nivel: "erro" },
  callback_sem_token_correspondente: { etapa: "callback_resultado", nivel: "erro" },
  callback_ja_processado: { etapa: "callback_resultado", nivel: "info" },
  resultado_gravado_sucesso: { etapa: "callback_resultado", nivel: "info" },
  resultado_gravado_falha: { etapa: "callback_resultado", nivel: "erro" },
  transferencia_humana_acionada: { etapa: "callback_resultado", nivel: "info" },

  whatsapp_legado_enviado: { etapa: "mensagem_legado", nivel: "info" },
  whatsapp_legado_falhou: { etapa: "mensagem_legado", nivel: "info" },

  // Opcional (decisao explicita do usuario, 2026-09-14) -- so' vale a
  // pena instrumentar se sobrar tempo; nao e' requisito central.
  portal_consultou_resultado: { etapa: "consulta_portal", nivel: "info" },
};

// Nunca gravar segredo/dado sensivel em `detalhe` -- lista negativa
// (defesa em profundidade, alem da disciplina no ponto de chamada):
// senha, token bruto/hash, QR Code/BR Code completo, cookies/sessao de
// Rocket-Sigma-UniTV, chaves de API, dealer token. Casada com a mesma
// lista descrita na Fase 2 (secao 7).
const PADRAO_CAMPO_PROIBIDO =
  /senha|password|qrcode|qr[_-]?code|brcode|br[_-]?code|cookie|sessionid|csrftoken|token(?!_id)|chave|api[_-]?key|apikey|service[_-]?role|dealer[_-]?token|authorization|secret/i;

const TAMANHO_MAX_STRING = 500;

export function sanitizarDetalhe(bruto: Record<string, unknown> | undefined | null): Record<string, unknown> {
  const limpo: Record<string, unknown> = {};
  if (!bruto) return limpo;
  for (const [campo, valor] of Object.entries(bruto)) {
    if (PADRAO_CAMPO_PROIBIDO.test(campo)) continue;
    if (valor === undefined) continue;
    if (typeof valor === "string" && valor.length > TAMANHO_MAX_STRING) {
      limpo[campo] = `${valor.slice(0, TAMANHO_MAX_STRING)}...(truncado)`;
      continue;
    }
    limpo[campo] = valor;
  }
  return limpo;
}

export interface RegistrarEventoParams {
  codigo: CodigoEvento;
  // Nome fixo da function que esta gravando (ex.: "openpix-webhook") --
  // rastreabilidade de origem, sempre uma string literal no ponto de
  // chamada, nunca derivada de input do usuario.
  origem: string;
  sessaoId?: string | null;
  tokenId?: string | null;
  grupoId?: string | null;
  operacaoId?: string | null;
  servidor?: ServidorRenovacao | null;
  detalhe?: Record<string, unknown>;
}

const TIMEOUT_MS = 3000;

function comTimeout<T>(promessa: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const temporizador = setTimeout(() => reject(new Error(`registrarEvento: timeout apos ${ms}ms`)), ms);
    Promise.resolve(promessa).then(
      (valor) => {
        clearTimeout(temporizador);
        resolve(valor);
      },
      (erro) => {
        clearTimeout(temporizador);
        reject(erro);
      },
    );
  });
}

// Best-effort, deliberadamente sem retorno de sucesso/falha pro
// chamador -- ele nunca deve ramificar logica no resultado disto (ver
// regra de ordem no cabecalho do arquivo). Qualquer problema (codigo
// desconhecido, sem correlacao, erro de rede/banco, timeout) vira so'
// console.error, nunca excecao propagada.
export async function registrarEvento(params: RegistrarEventoParams): Promise<void> {
  const meta = CATALOGO_EVENTOS[params.codigo];
  if (!meta) {
    console.error(`[renovacao_eventos] codigo desconhecido: ${params.codigo} (origem=${params.origem})`);
    return;
  }
  if (!params.sessaoId && !params.tokenId && !params.grupoId && !params.operacaoId) {
    console.error(
      `[renovacao_eventos] evento ${params.codigo} descartado -- sem sessaoId/tokenId/grupoId/operacaoId (origem=${params.origem})`,
    );
    return;
  }

  try {
    const client = getServiceClient();
    const { error } = await comTimeout(
      client.from("renovacao_eventos").insert({
        sessao_id: params.sessaoId ?? null,
        token_id: params.tokenId ?? null,
        grupo_id: params.grupoId ?? null,
        operacao_id: params.operacaoId ?? null,
        etapa: meta.etapa,
        codigo: params.codigo,
        nivel: meta.nivel,
        servidor: params.servidor ?? null,
        origem: params.origem,
        detalhe: sanitizarDetalhe(params.detalhe),
      }),
      TIMEOUT_MS,
    );
    if (error) {
      console.error(`[renovacao_eventos] falha ao gravar ${params.codigo} (origem=${params.origem})`, error);
    }
  } catch (erro) {
    console.error(
      `[renovacao_eventos] excecao ao gravar ${params.codigo} (origem=${params.origem})`,
      erro instanceof Error ? erro.message : erro,
    );
  }
}
