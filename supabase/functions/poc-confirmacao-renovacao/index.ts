// POC TEMPORARIA E DESCARTAVEL -- prova do mecanismo "renovacao no
// Rocket -> nossa infraestrutura -> WhatsApp Cloud API -> numero de
// TESTE" (2026-08-22, autorizado explicitamente pelo usuario). NAO e'
// o fluxo de producao. Apagar esta function depois de usada, mesmo
// padrao ja usado neste repositorio para diagnosticos pontuais
// (debug-fields, whatsapp-diag, teste-patch-renovacao-newone).
//
// SEGUNDA POC (2026-08-22, mesma sessao/dia): dispara via Message
// Template `pagamento_confirmado`, ja aprovado pela Meta -- nao mais
// texto livre, nao depende mais de janela de 24h aberta manualmente
// (autorizado explicitamente pelo usuario). Template tem 4 variaveis
// (nome/plano/servidor/vencimento) -- {VALOR} nao existe no template
// aprovado, deixado de fora deliberadamente desta rodada; nunca
// inventado nem acrescentado por fora do template.
//
// Generaliza o PATCH ja comprovado em teste-patch-renovacao-newone
// (GET /planos/ -> GET cliente -> PATCH vencimento -> GET de
// confirmacao) e acrescenta o passo novo: disparar o template
// aprovado com os dados confirmados via enviarTemplateWhatsApp
// (_shared/whatsapp_client.ts, ja testado, usa os secrets do numero
// de TESTE ja configurados no projeto).
//
// Autenticacao: NENHUMA -- mesmo padrao ja aceito neste repositorio
// para diagnosticos unicos e descartaveis (teste-patch-renovacao-newone,
// sem checagem de token). Seguro aqui porque: alvo fixo (nunca por
// parametro livre, nunca le nada do corpo da requisicao), efeito
// sempre o mesmo (renova o MESMO cliente de teste, nunca um cliente
// arbitrario), e a function e' apagada logo depois de usada.
//
// Alvo fixo (nunca por parametro livre): mesmo cliente de teste ja
// usado em toda essa investigacao (Js Informatica Rp / NewOne).

import { enviarTemplateWhatsApp } from "../_shared/whatsapp_client.ts";
import {
  NOME_TEMPLATE_PAGAMENTO_CONFIRMADO,
  IDIOMA_TEMPLATE_PAGAMENTO_CONFIRMADO,
} from "../_shared/mensagens_fixas.ts";

const PUBLIC_ID = "01a026ef-8bdd-7641-a4f2-2ae37b184ac0"; // Js Informatica Rp / NewOne (publicId reconfirmado via /match em 2026-08-22)
const NOME_ESPERADO = "Js Informática Rp";
const SERVIDOR_ESPERADO = "NewOne";
const PLANO_ESPERADO = "Mensal";
const TELEFONE_CLIENTE_TESTE = "5517981625486"; // mesmo numero real ja usado em toda a investigacao

function somarPeriodo(vencimentoIso: string, periodo: number, tipoDePeriodo: string): string {
  const data = new Date(vencimentoIso);
  const tipo = tipoDePeriodo.toLowerCase();
  if (tipo.includes("mes")) {
    data.setMonth(data.getMonth() + periodo);
  } else if (tipo.includes("ano")) {
    data.setFullYear(data.getFullYear() + periodo);
  } else if (tipo.includes("hora")) {
    data.setHours(data.getHours() + periodo);
  } else {
    data.setDate(data.getDate() + periodo);
  }
  return data.toISOString();
}

function formatarDataBr(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

Deno.serve(async (_req: Request) => {
  const rocketBaseUrl = Deno.env.get("ROCKET_BASE_URL");
  const rocketApiKey = Deno.env.get("ROCKET_API_KEY");
  if (!rocketBaseUrl || !rocketApiKey) {
    return new Response(
      JSON.stringify({ etapa: "config", erro: "ROCKET_BASE_URL ou ROCKET_API_KEY ausentes" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const headers = { "X-API-Key": rocketApiKey };
  const url = `${rocketBaseUrl}/gerenciador/api/v1/cliente/${PUBLIC_ID}`;

  // --- 0. GET /planos/ -- periodo real do plano Mensal ---
  const planosRes = await fetch(`${rocketBaseUrl}/gerenciador/api/v1/planos/?page_size=100`, { headers });
  const planosBody = await planosRes.json();
  if (!planosRes.ok) {
    return new Response(
      JSON.stringify({ etapa: "GET planos", status: planosRes.status, body: planosBody }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
  const planoMensal = (planosBody.itens ?? planosBody.planos ?? []).find(
    (p: { nome?: string }) => p.nome === PLANO_ESPERADO,
  );
  if (!planoMensal || planoMensal.periodo == null || !planoMensal.tipo_de_periodo) {
    return new Response(
      JSON.stringify({ etapa: "GET planos", erro: "Plano Mensal nao encontrado" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  // --- 1. GET antes + verificacao de identidade ---
  const getAntesRes = await fetch(url, { headers });
  const antesBody = await getAntesRes.json();
  if (!getAntesRes.ok) {
    return new Response(
      JSON.stringify({ etapa: "GET antes", status: getAntesRes.status }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
  const clienteAntes = antesBody.cliente;
  const nomeConfere = clienteAntes?.nome === NOME_ESPERADO;
  const servidorConfere = clienteAntes?.servidor?.nome === SERVIDOR_ESPERADO;
  const planoConfere = clienteAntes?.plano?.nome === PLANO_ESPERADO;
  if (!nomeConfere || !servidorConfere || !planoConfere) {
    return new Response(
      JSON.stringify({ abortado: true, motivo: "Identificacao nao confere -- PATCH e envio NAO executados." }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  const vencimentoAntes = clienteAntes.vencimento;
  const novoVencimento = somarPeriodo(vencimentoAntes, planoMensal.periodo, planoMensal.tipo_de_periodo);

  // --- 2. PATCH real (confirmacao da renovacao -- Rocket) ---
  const patchRes = await fetch(url, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ vencimento: novoVencimento }),
  });
  const patchBody = await patchRes.json();
  if (!patchRes.ok) {
    return new Response(
      JSON.stringify({ etapa: "PATCH", status: patchRes.status, erro: "PATCH falhou -- mensagem NAO enviada" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  // --- 3. GET depois -- confirma de verdade antes de disparar a mensagem ---
  const getDepoisRes = await fetch(url, { headers });
  const depoisBody = await getDepoisRes.json();
  const clienteDepois = depoisBody?.cliente;
  // Compara o INSTANTE, nao a string -- Rocket devolve com offset
  // "-03:00", nosso calculo usa toISOString() ("Z"). Mesmo instante,
  // formato diferente -- achado real desta POC (2026-08-22).
  const confirmado =
    !!clienteDepois?.vencimento &&
    new Date(clienteDepois.vencimento).getTime() === new Date(novoVencimento).getTime();

  if (!confirmado) {
    return new Response(
      JSON.stringify({
        etapa: "GET depois",
        erro: "Vencimento nao confirmou o valor esperado -- mensagem NAO enviada, por seguranca.",
        vencimentoEsperado: novoVencimento,
        vencimentoEncontrado: clienteDepois?.vencimento,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  // --- 4. Disparador -- so dispara DEPOIS de confirmar o PATCH de verdade ---
  // Template pagamento_confirmado, 4 variaveis na ordem exata aprovada
  // pela Meta: {{1}} nome, {{2}} plano, {{3}} servidor, {{4}} vencimento.
  // Sem {VALOR} -- nao existe no template aprovado, nunca inventado aqui.
  const parametrosTemplate = [
    clienteDepois.nome,
    clienteDepois.plano?.nome,
    clienteDepois.servidor?.nome,
    formatarDataBr(clienteDepois.vencimento),
  ];

  const envio = await enviarTemplateWhatsApp(
    TELEFONE_CLIENTE_TESTE,
    NOME_TEMPLATE_PAGAMENTO_CONFIRMADO,
    IDIOMA_TEMPLATE_PAGAMENTO_CONFIRMADO,
    parametrosTemplate,
  );

  return new Response(
    JSON.stringify({
      resultado: "poc_concluida",
      identificacao: { nomeConfere, servidorConfere, planoConfere },
      vencimentoAntes,
      novoVencimentoConfirmado: clienteDepois.vencimento,
      templateUsado: NOME_TEMPLATE_PAGAMENTO_CONFIRMADO,
      parametrosTemplate,
      mensagemEnviada: envio.outcome === "success",
      envioOutcome: envio.outcome,
    }, null, 2),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
