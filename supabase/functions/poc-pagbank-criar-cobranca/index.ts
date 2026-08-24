// PoC ISOLADA E TEMPORARIA -- valida o UNICO ponto ainda nao comprovado
// do Bloco 1 (fluxo de renovacao PagBank): POST /orders (criacao de
// cobranca) no Sandbox. Reproduz EXATAMENTE o payload de
// _shared/pagbank_client.ts::criarCobrancaPagBank (revisado antes de
// escrever este arquivo, nada foi alterado la) -- nao reinventa nada,
// so devolve a resposta CRUA (status + corpo completo) para inspecao,
// coisa que a funcao de producao nao faz (ela ja normaliza/descarta
// detalhe em caso de erro).
//
// NUNCA toca em producao: usa exclusivamente PAGBANK_SANDBOX_TOKEN
// (mesmo secret que a producao vai usar, mas contra
// https://sandbox.api.pagseguro.com) e um reference_id prefixado
// para nunca colidir com nenhuma cobranca real.
//
// Depois do teste: esta function deve ser REMOVIDA (mesmo padrao ja
// usado neste repositorio para functions temporarias como
// `debug-fields`/`poc-pagbank-unitv-renew`) -- nao e para ficar
// deployada permanentemente.

const SANDBOX_BASE_URL = "https://sandbox.api.pagseguro.com";

Deno.serve(async (_req: Request) => {
  const token = Deno.env.get("PAGBANK_SANDBOX_TOKEN");
  if (!token) {
    return new Response(JSON.stringify({ erro: "PAGBANK_SANDBOX_TOKEN ausente" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // UUID puro, SEM prefixo -- reproduz exatamente o que
  // criarCobrancaPagBank (_shared/pagbank_client.ts) envia em producao
  // (operacaoId = crypto.randomUUID(), usado como reference_id tal
  // qual). Achado da 1a tentativa (prefixo de teste estourou o limite
  // real de 64 caracteres do reference_id) descartado aqui de proposito
  // -- esta chamada testa o payload REAL, nao mais um payload de teste
  // com prefixo.
  const operacaoId = crypto.randomUUID();
  const valorCentavos = 100; // R$ 1,00 -- valor minimo, so para provar o mecanismo

  // Payload IDENTICO ao de criarCobrancaPagBank (_shared/pagbank_client.ts).
  const payload = {
    reference_id: operacaoId,
    items: [
      {
        reference_id: `${operacaoId}-item`,
        name: "TESTE POC - Renovacao InovaTV (Sandbox)",
        quantity: 1,
        unit_amount: valorCentavos,
      },
    ],
    qr_codes: [{ amount: { value: valorCentavos } }],
  };

  let resp: Response;
  try {
    resp = await fetch(`${SANDBOX_BASE_URL}/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
  } catch (erro) {
    return new Response(JSON.stringify({ erro: "excecao na chamada", detalhe: String(erro), payloadEnviado: payload }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  const bodyText = await resp.text();
  let bodyJson: unknown = null;
  try {
    bodyJson = JSON.parse(bodyText);
  } catch {
    // resposta nao era JSON -- devolve o texto cru mesmo assim
  }

  return new Response(
    JSON.stringify({
      payloadEnviado: payload,
      httpStatus: resp.status,
      httpOk: resp.ok,
      corpoResposta: bodyJson ?? bodyText,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
