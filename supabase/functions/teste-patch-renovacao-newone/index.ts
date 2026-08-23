// TEMPORARIA E DESCARTAVEL -- renovacao real, autorizada explicitamente
// pelo usuario em 2026-08-21 (ver
// docs/renovacao_automatica/SESSAO_ROCKET_MONITORAMENTO.md deste
// repositorio -- migrado de inovatv_meta_business_agent em 2026-08-23,
// frente "Renovacao Automatica"). Segunda etapa:
// depois de confirmar que o PATCH funciona (teste anterior, so minuto),
// agora aplica uma renovacao de verdade -- soma o periodo real do plano
// "Mensal" (lido do Rocket via /planos/, nao presumido) ao vencimento
// atual (cliente ainda ativo, entao soma a partir do vencimento atual,
// nao de hoje -- preserva os dias restantes).
//
// Correcao de seguranca em relacao ao teste anterior: a resposta desta
// function NUNCA repassa o corpo cru do Rocket -- ele inclui senha e
// device_key_or_OTP_code em texto puro, e isso vazou na resposta da
// primeira versao. Aqui a resposta e' sanitizada antes de devolver.
//
// Apagar esta function depois de usada -- nao e para ficar deployada
// permanentemente, mesmo padrao ja usado antes neste repositorio para
// diagnosticos pontuais (debug-fields, whatsapp-diag).
//
// public_id fixo como constante (nunca por parametro livre) -- alvo
// unico e conhecido, cliente de teste ja usado em toda essa investigacao
// (Js Informatica Rp / NewOne).

const PUBLIC_ID = "019ff025-ae5a-7e96-a037-8cfec84178d1"; // Js Informatica Rp / NewOne
const NOME_ESPERADO = "Js Informática Rp";
const SERVIDOR_ESPERADO = "NewOne";
const PLANO_ESPERADO = "Mensal";

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
    // default: dias
    data.setDate(data.getDate() + periodo);
  }
  return data.toISOString();
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

  // --- 0. GET /planos/ -- ler o periodo REAL do plano Mensal, nao presumir ---
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
      JSON.stringify({ etapa: "GET planos", erro: "Plano Mensal nao encontrado ou sem periodo definido", planosBody }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  // --- 1. GET antes ---
  let getAntesRes: Response;
  try {
    getAntesRes = await fetch(url, { headers });
  } catch (e) {
    return new Response(
      JSON.stringify({ etapa: "GET antes", erro: String(e) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
  const antesBody = await getAntesRes.json();

  if (!getAntesRes.ok) {
    return new Response(
      JSON.stringify({ etapa: "GET antes", status: getAntesRes.status, body: antesBody }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  const clienteAntes = antesBody.cliente;
  const nomeConfere = clienteAntes?.nome === NOME_ESPERADO;
  const servidorConfere = clienteAntes?.servidor?.nome === SERVIDOR_ESPERADO;
  const planoConfere = clienteAntes?.plano?.nome === PLANO_ESPERADO;

  // --- ABORTA se identificacao nao bater, ANTES de qualquer PATCH ---
  if (!nomeConfere || !servidorConfere || !planoConfere) {
    return new Response(
      JSON.stringify(
        {
          abortado: true,
          motivo: "Nome, servidor ou plano nao conferem -- PATCH NAO executado.",
          nomeConfere,
          servidorConfere,
          planoConfere,
          nomeEncontrado: clienteAntes?.nome,
          servidorEncontrado: clienteAntes?.servidor?.nome,
          planoEncontrado: clienteAntes?.plano?.nome,
        },
        null,
        2,
      ),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  const vencimentoAntes = clienteAntes.vencimento;
  const novoVencimento = somarPeriodo(vencimentoAntes, planoMensal.periodo, planoMensal.tipo_de_periodo);

  // --- 2. PATCH real ---
  let patchRes: Response;
  try {
    patchRes = await fetch(url, {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ vencimento: novoVencimento }),
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ etapa: "PATCH", erro: String(e), vencimentoAntes, novoVencimento }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
  const patchBody = await patchRes.json();
  // Sanitizacao: a resposta crua do Rocket inclui senha e
  // device_key_or_OTP_code em texto puro -- nunca repassar.
  const patchClienteSanitizado = patchBody?.cliente
    ? { nome: patchBody.cliente.nome, servidor: patchBody.cliente.servidor?.nome, plano: patchBody.cliente.plano?.nome, vencimento: patchBody.cliente.vencimento }
    : null;

  // --- 3. GET depois ---
  let getDepoisRes: Response;
  let depoisBody: Record<string, unknown> = {};
  try {
    getDepoisRes = await fetch(url, { headers });
    depoisBody = await getDepoisRes.json();
  } catch (e) {
    return new Response(
      JSON.stringify({
        etapa: "GET depois",
        erro: String(e),
        patchStatus: patchRes.status,
        vencimentoAntes,
        novoVencimento,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const clienteDepois = (depoisBody as { cliente?: Record<string, unknown> }).cliente;

  return new Response(
    JSON.stringify(
      {
        identificacao: {
          publicId: PUBLIC_ID,
          nomeConfere,
          servidorConfere,
          planoConfere,
        },
        planoUsadoParaCalculo: { nome: planoMensal.nome, periodo: planoMensal.periodo, tipo_de_periodo: planoMensal.tipo_de_periodo },
        vencimentoAntes,
        novoVencimentoCalculado: novoVencimento,
        patch: {
          status: patchRes.status,
          ok: patchRes.ok,
          clienteSanitizado: patchClienteSanitizado,
        },
        getDepois: {
          status: getDepoisRes.status,
          vencimentoDepois: clienteDepois?.vencimento,
        },
        vencimentoMudouParaOEsperado: clienteDepois?.vencimento === novoVencimento,
      },
      null,
      2,
    ),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
