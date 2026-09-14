// Trilha de auditoria da Renovacao Automatica (Fase 2/3, 2026-09-14,
// inovatv-api-intermediaria/CLAUDE.md) -- equivalente Node.js de
// supabase/functions/_shared/renovacao_eventos.ts, usado SO' por
// scripts/renovacao-sigma-workflow.mjs (roda no GitHub Actions, node
// puro, sem tsx -- nao pode importar o .ts do lado Deno). O CATALOGO
// abaixo precisa ficar em sincronia manual com o do lado Deno -- os
// testes de scripts/testes/renovacao_eventos/ cobrem os dois lados e
// falham se um codigo existir so' de um lado.
//
// registrarEvento() NUNCA lanca excecao -- best-effort deliberado,
// mesma regra de ordem do lado Deno: so' chamar isto DEPOIS que o
// callback real (reportarResultado/reportarResultadoLote) ou a mutacao
// de estado ja aconteceu. Insert direto via REST ao Supabase, mesmo
// padrao ja usado neste arquivo por lerTokenRenovacao/lerSessaoRocket.

export const CATALOGO_EVENTOS = {
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

  portal_consultou_resultado: { etapa: "consulta_portal", nivel: "info" },
};

const PADRAO_CAMPO_PROIBIDO =
  /senha|password|qrcode|qr[_-]?code|brcode|br[_-]?code|cookie|sessionid|csrftoken|token(?!_id)|chave|api[_-]?key|apikey|service[_-]?role|dealer[_-]?token|authorization|secret/i;

const TAMANHO_MAX_STRING = 500;

export function sanitizarDetalhe(bruto) {
  const limpo = {};
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

const TIMEOUT_MS = 3000;

// Fabrica -- recebe SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY explicitos
// (nao le process.env direto aqui) pra ficar testavel sem mock de
// ambiente global, mesmo padrao das outras funcoes de
// renovacao-sigma-workflow.mjs que recebem essas mesmas constantes por
// closure no arquivo principal.
export function criarRegistradorDeEventos({ supabaseUrl, supabaseServiceRoleKey, origem }) {
  return async function registrarEvento(params) {
    const meta = CATALOGO_EVENTOS[params.codigo];
    if (!meta) {
      console.error(`[renovacao_eventos] codigo desconhecido: ${params.codigo} (origem=${origem})`);
      return;
    }
    if (!params.sessaoId && !params.tokenId && !params.grupoId && !params.operacaoId) {
      console.error(
        `[renovacao_eventos] evento ${params.codigo} descartado -- sem sessaoId/tokenId/grupoId/operacaoId (origem=${origem})`,
      );
      return;
    }

    const corpo = {
      sessao_id: params.sessaoId ?? null,
      token_id: params.tokenId ?? null,
      grupo_id: params.grupoId ?? null,
      operacao_id: params.operacaoId ?? null,
      etapa: meta.etapa,
      codigo: params.codigo,
      nivel: meta.nivel,
      servidor: params.servidor ?? null,
      origem,
      detalhe: sanitizarDetalhe(params.detalhe),
    };

    try {
      const controlador = new AbortController();
      const temporizador = setTimeout(() => controlador.abort(), TIMEOUT_MS);
      try {
        const resp = await fetch(`${supabaseUrl}/rest/v1/renovacao_eventos`, {
          method: "POST",
          headers: {
            apikey: supabaseServiceRoleKey,
            Authorization: `Bearer ${supabaseServiceRoleKey}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify(corpo),
          signal: controlador.signal,
        });
        if (!resp.ok) {
          const texto = await resp.text().catch(() => "");
          console.error(`[renovacao_eventos] falha ao gravar ${params.codigo} -- HTTP ${resp.status} ${texto}`);
        }
      } finally {
        clearTimeout(temporizador);
      }
    } catch (erro) {
      console.error(`[renovacao_eventos] excecao ao gravar ${params.codigo} (origem=${origem})`, erro?.message ?? erro);
    }
  };
}
