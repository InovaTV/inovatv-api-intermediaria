// Monitoramento periodico da sessao do Rocket -- SOMENTE LEITURA,
// nunca renova nada, nunca tenta logar, nunca contorna o Turnstile.
// Acionado pelo cron job "monitorar-sessao-rocket" (pg_net, a cada
// 4h) -- ver migration 20260821150000_rocket_session_monitoramento.sql.
//
// Regras explicitas do usuario, implementadas aqui:
// - Falha de rede NUNCA marca a sessao como invalida (so a evidencia
//   inequivoca de redirect/HTML de login conta -- ver
//   _shared/rocket_session_check.ts).
// - Alerta (issue no GitHub) so na transicao valida -> invalida --
//   nunca um novo enquanto continuar invalida.
// - Quando uma nova sessao valida for gravada (por
//   atualizar-sessao-rocket) e confirmada aqui, o estado volta
//   automaticamente pra 'valida' e fica pronto pra alertar de novo no
//   futuro.
// - Nao mexe no mecanismo de renovacao ja comprovado.

import { getServiceClient } from "../_shared/supabase_client.ts";
import { verificarSessaoRocket } from "../_shared/rocket_session_check.ts";
import { criarIssueSessaoRocketExpirada } from "../_shared/github_alert.ts";
import { jsonResponse, errorResponse } from "../_shared/http.ts";

interface RocketSessionEstado {
  id: number;
  status: "valida" | "invalida";
  ultima_verificacao_bem_sucedida_em: string | null;
  sessao_capturada_em: string | null;
  sessao_invalidada_em: string | null;
  alerta_issue_numero: number | null;
  alerta_issue_criado_em: string | null;
}

Deno.serve(async (req: Request) => {
  const tokenInterno = Deno.env.get("SESSAO_ROCKET_MONITOR_TOKEN");
  const tokenRecebido = req.headers.get("X-Internal-Token");
  if (!tokenInterno || !tokenRecebido || tokenRecebido !== tokenInterno) {
    return errorResponse("Nao autorizado", 401);
  }

  const client = getServiceClient();

  const { data: sessao, error: erroLer } = await client.rpc("rocket_sessao_ler");
  if (erroLer) {
    console.error("Falha ao ler sessao do Vault:", erroLer.message);
    return errorResponse("Falha ao ler a sessao", 500);
  }

  const linhaSessao = Array.isArray(sessao) ? sessao[0] : sessao;
  const sessionid: string | null = linhaSessao?.sessionid ?? null;
  const csrftoken: string | null = linhaSessao?.csrftoken ?? null;

  const { data: estadoAtual, error: erroEstado } = await client
    .from("rocket_session_estado")
    .select("*")
    .eq("id", 1)
    .single<RocketSessionEstado>();
  if (erroEstado || !estadoAtual) {
    console.error("Falha ao ler estado atual:", erroEstado?.message);
    return errorResponse("Falha ao ler o estado", 500);
  }

  if (!sessionid || !csrftoken) {
    // Nenhuma sessao foi capturada ainda -- nao ha nada pra checar.
    // Nao gera alerta (nunca houve uma sessao valida antes disso).
    return jsonResponse({ outcome: "sem_sessao_configurada" });
  }

  const resultado = await verificarSessaoRocket(sessionid, csrftoken);
  const agora = new Date().toISOString();

  if ("erroRede" in resultado) {
    // Falha transitoria -- nao muda status, so registra que tentamos.
    return jsonResponse({ outcome: "erro_rede_ignorado" });
  }

  if (resultado.valida) {
    const eraInvalida = estadoAtual.status === "invalida";
    const { error } = await client
      .from("rocket_session_estado")
      .update({
        status: "valida",
        ultima_verificacao_bem_sucedida_em: agora,
        sessao_invalidada_em: null,
        alerta_issue_numero: null,
        alerta_issue_criado_em: null,
        atualizado_em: agora,
      })
      .eq("id", 1);
    if (error) console.error("Falha ao atualizar estado (valida):", error.message);

    return jsonResponse({
      outcome: "valida",
      transicaoRecuperada: eraInvalida,
    });
  }

  // resultado.valida === false -- sessao invalida.
  const jaEstavaInvalida = estadoAtual.status === "invalida";

  if (jaEstavaInvalida) {
    // Ja alertado nesta ocorrencia -- so confirma, nao gera issue nova.
    return jsonResponse({ outcome: "invalida_ja_alertada" });
  }

  // Transicao real valida -> invalida: aqui, e so aqui, cria o alerta.
  const { error: erroTransicao } = await client
    .from("rocket_session_estado")
    .update({
      status: "invalida",
      sessao_invalidada_em: agora,
      atualizado_em: agora,
    })
    .eq("id", 1);
  if (erroTransicao) {
    console.error("Falha ao registrar transicao pra invalida:", erroTransicao.message);
  }

  const issue = await criarIssueSessaoRocketExpirada({
    detectadoEm: agora,
    ultimaVerificacaoBemSucedidaEm: estadoAtual.ultima_verificacao_bem_sucedida_em,
  });

  if (issue) {
    await client
      .from("rocket_session_estado")
      .update({
        alerta_issue_numero: issue.numero,
        alerta_issue_criado_em: agora,
      })
      .eq("id", 1);
  }

  return jsonResponse({
    outcome: "invalida_alerta_criado",
    issueNumero: issue?.numero ?? null,
  });
});
