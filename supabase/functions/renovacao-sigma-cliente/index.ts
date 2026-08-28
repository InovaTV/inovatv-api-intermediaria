// Leitura interna do cliente no Rocket, exclusiva para o workflow
// renovacao-sigma.yml (GitHub Actions) -- substitui a chamada direta
// que o runner fazia a app.rocketgestor.com, bloqueada pela borda/
// Cloudflare especificamente para trafego do GitHub Actions
// (investigado e caracterizado em 2026-08-27/28,
// inovatv-api-intermediaria/NEXT_SESSION.md).
//
// So embrulha consultarClienteCompletoRocket (_shared/rocket_valor_cliente.ts,
// ja existente, ja usado por renovacao-confirmar) -- nenhuma logica
// nova de chamada ao Rocket, nenhuma duplicacao.
//
// Autenticacao: X-Internal-Token dedicado (RENOVACAO_SIGMA_CALLBACK_TOKEN)
// -- mesmo secret ja compartilhado entre este workflow e o Supabase
// para o callback de resultado (renovacao-sigma-resultado), reaproveitado
// aqui para a direcao de leitura. Nenhum secret novo.
//
// Contrato deliberadamente minimo -- nunca um endpoint publico de
// consulta generica: token obrigatorio checado antes de tudo, so' POST,
// so' publicId por corpo JSON (unico campo aceito/lido), so' devolve
// vencimento (unico campo que o chamador real usa hoje).

import { errorResponse, jsonResponse } from "../_shared/http.ts";
import { consultarClienteCompletoRocket } from "../_shared/rocket_valor_cliente.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  const tokenInterno = Deno.env.get("RENOVACAO_SIGMA_CALLBACK_TOKEN");
  const tokenRecebido = req.headers.get("X-Internal-Token");
  if (!tokenInterno || !tokenRecebido || tokenRecebido !== tokenInterno) {
    return errorResponse("Nao autorizado", 401);
  }

  if (req.method !== "POST") {
    return errorResponse("Metodo nao suportado, use POST", 405);
  }

  let body: { publicId?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Corpo da requisicao precisa ser JSON valido");
  }

  const publicId = body.publicId ?? "";
  if (!UUID_PATTERN.test(publicId)) {
    return errorResponse("Campo obrigatorio: publicId (uuid valido)");
  }

  const resultado = await consultarClienteCompletoRocket(publicId);

  if (resultado.outcome === "unavailable") {
    return jsonResponse({ outcome: "unavailable" });
  }

  return jsonResponse({
    outcome: "success",
    cliente: { vencimento: resultado.vencimento },
  });
});
