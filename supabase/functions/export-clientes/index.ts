// REMOVIDA DO DEPLOY em 2026-08-23 (supabase functions delete) --
// unico consumidor real era gerar-clientes-xlsx.mjs, script da
// arquitetura Meta Business Agent abandonada, isolado em
// scripts/meta_business_agent/. Nenhum outro consumidor foi
// encontrado (Orquestrador, Painel de Atendimento, Renovacao
// Automatica -- confirmado por auditoria antes da remocao). Codigo
// preservado aqui so como historico -- nao reimplantar sem novo
// consumidor real e decisao explicita.
//
// Fase 5 -- exportacao em massa sanitizada para a automacao
// Rocket -> Google Drive -> Meta AI (ver ARQUITETURA_IDENTIDADE_SINCRONIZACAO.md,
// inovatv_central, e o registro da decisao na conversa da frente WhatsApp AI).
// GET /gerenciador/api/v1/clientes/ no Rocket -- listagem paginada, sem
// filtros (varre o catalogo inteiro, um cliente de cada vez nao serve
// aqui -- isso ja e' o `/match`). Nunca escreve nada no Rocket (sem
// POST/PATCH/DELETE, em nenhuma hipotese).
//
// Este endpoint e' de uso interno da automacao (chamado pela peca que
// gera CLIENTES_INOVATV.xlsx), nunca exposto a Meta -- ela so enxerga
// o arquivo resultante no Google Drive, nunca esta API. Protegido pela
// mesma verificacao de autenticacao padrao das Edge Functions desta
// intermediaria (nenhuma excecao adicionada para esta funcao).
//
// `page_size` fixo em 100 (nunca vindo de quem chama) -- mantem o
// comportamento previsivel e dentro do limite de 60 req/min do Rocket
// (por chave de API do revendedor inteiro, compartilhado com
// `/match` e `/status`).
//
// Nunca repassa `senha` nem `device_key_or_OTP_code` (campos reais do
// Rocket). `publicId` e' mantido na resposta deste endpoint -- serve
// somente para a logica de comparacao/diff da automacao saber que esta
// olhando para o mesmo cliente entre uma execucao e outra; quem gerar
// o CLIENTES_INOVATV.xlsx a partir desta resposta NAO deve incluir
// `publicId` como coluna do arquivo (a Meta nao usa esse campo).
// Nunca repassa o `detail` cru de erro do Rocket para quem chamou.
//
// `ROCKET_BASE_URL` e `ROCKET_API_KEY` vem exclusivamente de secrets
// desta funcao -- nunca aparecem em codigo, nunca sao devolvidos em
// nenhuma resposta.

const PAGE_SIZE = 100;

function normalizeCliente(cliente: Record<string, unknown>) {
  const plano = cliente.plano as Record<string, unknown> | null;
  const servidor = cliente.servidor as Record<string, unknown> | null;
  const aplicativo = cliente.aplicativo as Record<string, unknown> | null;
  const dispositivo = cliente.dispositivo as Record<string, unknown> | null;

  return {
    publicId: cliente.id ?? null,
    nome: cliente.nome ?? null,
    telefone: cliente.telefone ?? null,
    usuario: cliente.usuario ?? null,
    planoNome: plano?.nome ?? null,
    servidorNome: servidor?.nome ?? null,
    valor: cliente.valor ?? null,
    vencimento: cliente.vencimento ?? null,
    telas: cliente.telas ?? null,
    aplicativoNome: aplicativo?.nome ?? null,
    dispositivoNome: dispositivo?.nome ?? null,
  };
}

Deno.serve(async (req: Request) => {
  const rocketBaseUrl = Deno.env.get("ROCKET_BASE_URL");
  const rocketApiKey = Deno.env.get("ROCKET_API_KEY");

  if (!rocketBaseUrl || !rocketApiKey) {
    return new Response(
      JSON.stringify({
        outcome: "unavailable",
        page: 1,
        totalPages: null,
        clientes: [],
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  const url = new URL(req.url);
  const pageParam = url.searchParams.get("page") ?? "1";
  const page = Number(pageParam);

  if (!Number.isInteger(page) || page < 1) {
    return new Response(
      JSON.stringify({
        outcome: "invalid_request",
        page: null,
        totalPages: null,
        clientes: [],
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const forwarded = new URLSearchParams({
    page: String(page),
    page_size: String(PAGE_SIZE),
  });

  let rocketResponse: Response;
  try {
    rocketResponse = await fetch(
      `${rocketBaseUrl}/gerenciador/api/v1/clientes/?${forwarded.toString()}`,
      { headers: { "X-API-Key": rocketApiKey } },
    );
  } catch {
    return new Response(
      JSON.stringify({
        outcome: "unavailable",
        page,
        totalPages: null,
        clientes: [],
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  if (!rocketResponse.ok) {
    return new Response(
      JSON.stringify({
        outcome: "unavailable",
        page,
        totalPages: null,
        clientes: [],
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  const data = await rocketResponse.json();
  const totalPages = data?.paginacao?.total_pages ?? null;
  const itens = Array.isArray(data?.itens) ? data.itens : [];

  return new Response(
    JSON.stringify({
      outcome: "success",
      page,
      totalPages,
      clientes: itens.map(normalizeCliente),
    }),
    { headers: { "Content-Type": "application/json" } },
  );
});
