// Leitura do "contexto Sigma" de um cliente -- id_cliente interno
// (numerico), pacote atual e expires_at -- a partir da sessao
// autenticada do Rocket (cookie do Vault). Extraido para um modulo
// proprio para (a) ser reutilizado pela Edge Function
// renovacao-sigma-contexto sem duplicar logica e (b) ter a parte pura
// (resolverIdInterno) testavel isoladamente com fixtures de HTML.
//
// Somente leitura -- nenhuma destas funcoes escreve nada no Rocket,
// nunca toca /pagamento/add/. Nenhuma delas retorna cookie, sessao,
// senha, device_key/OTP ou HTML bruto -- quem chama recebe so' os
// campos ja extraidos.
//
// Contexto: o runner do GitHub Actions nao consegue falar direto com
// app.rocketgestor.com (bloqueio de borda/Cloudflare -- mesmo motivo
// que criou renovacao-sigma-cliente, commit d528377). Rodando estas
// funcoes DENTRO do Supabase (Edge Function), a resposta e' a pagina
// real, nao um desafio da borda.

export const ROCKET_BASE_URL = "https://app.rocketgestor.com";
export const ROCKET_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export function montarCookieHeader(sessionid: string, csrftoken: string): string {
  return `sessionid=${sessionid}; csrftoken=${csrftoken}`;
}

function normalizarTelefone(telefoneBruto: string | null | undefined): string {
  return String(telefoneBruto ?? "").replace(/\D/g, "");
}

export interface ResolucaoIdInterno {
  // ids internos (string de digitos) que casam nome + telefone; exige
  // exatamente 1 para o fluxo prosseguir. Nunca escolhe por posicao/
  // ordem.
  ids: string[];
  // contadores seguros (so inteiros) -- unico "diagnostico" que a
  // Edge Function devolve quando ids.length === 0. Nenhum nome,
  // telefone ou trecho de HTML.
  totalBotoes: number;
  botoesComNomeAlvo: number;
}

// Resolve o id_cliente interno pela pagina autenticada do cliente.
// O id numerico interno NAO existe em nenhum schema da API publica do
// Rocket (verificado no rocket_gestor_openapi.json inteiro -- todo
// `id` de cliente e' o UUID public_id) -- so' aparece no HTML
// autenticado por sessao, como atributo do botao "Adicionar
// pagamento" (id="btn_add_pagamento_{cliente_id}"). Correlacionado
// deterministicamente por nome + telefone reais (a pagina renderiza
// esse botao para varios clientes; alem disso, dois cadastros reais
// distintos podem compartilhar o mesmo telefone -- por isso nome+
// telefone, nunca so' um). `telefone` e' o atributo mais proximo
// ANTES do botao, dentro da mesma linha/grupo de acoes.
//
// Aceita `id="..."` e `nome="..."` em qualquer ordem dentro da mesma
// tag <button> (a versao anterior, dentro de renovacao-sigma-workflow,
// exigia `id` antes de `nome` -- endurecido aqui: qualquer diferenca
// de ordem no HTML real zerava o resultado para todos os clientes).
export function resolverIdInterno(
  html: string,
  nomeAlvo: string,
  telefoneAlvo: string,
): ResolucaoIdInterno {
  const telefoneAlvoNormalizado = normalizarTelefone(telefoneAlvo);
  const regexTagBotao = /<button\b[^>]*>/gi;
  const regexTelefone = /\btelefone="([^"]*)"/g;
  const ids = new Set<string>();
  let totalBotoes = 0;
  let botoesComNomeAlvo = 0;

  let m: RegExpExecArray | null;
  while ((m = regexTagBotao.exec(html)) !== null) {
    const tag = m[0];
    const idMatch = tag.match(/\bid="btn_add_pagamento_(\d+)"/);
    if (!idMatch) continue;
    totalBotoes++;

    const nomeMatch = tag.match(/\bnome="([^"]*)"/);
    const nome = nomeMatch ? nomeMatch[1] : null;
    if (nome !== nomeAlvo) continue;
    botoesComNomeAlvo++;

    const janelaAntes = html.slice(Math.max(0, m.index - 3000), m.index);
    regexTelefone.lastIndex = 0;
    let ultimoTelefone: string | null = null;
    let mt: RegExpExecArray | null;
    while ((mt = regexTelefone.exec(janelaAntes)) !== null) ultimoTelefone = mt[1];

    if (ultimoTelefone && normalizarTelefone(ultimoTelefone) === telefoneAlvoNormalizado) {
      ids.add(idMatch[1]);
    }
  }

  return { ids: [...ids], totalBotoes, botoesComNomeAlvo };
}

export type PaginaClienteResultado =
  | { ok: true; status: number; html: string }
  | { ok: false; status: number };

export async function lerPaginaClienteHtml(
  cookieHeader: string,
  publicId: string,
): Promise<PaginaClienteResultado> {
  try {
    const res = await fetch(
      `${ROCKET_BASE_URL}/gerenciador/cliente/info/${encodeURIComponent(publicId)}/`,
      { headers: { Cookie: cookieHeader, "User-Agent": ROCKET_USER_AGENT } },
    );
    if (!res.ok) return { ok: false, status: res.status };
    const html = await res.text();
    return { ok: true, status: res.status, html };
  } catch {
    return { ok: false, status: 0 };
  }
}

export type SigmaInfoResultado =
  | { outcome: "success"; package: string; expiresAt: string | null }
  | { outcome: "pacote_vazio" }
  | { outcome: "unavailable" };

// GET /gerenciador/cliente/sigma/info/?cliente_id={id} -- so' extrai
// data.package (trim) e data.expires_at. O corpo bruto nunca sai
// daqui. Distingue:
//   - resposta nao-JSON / !ok            -> "unavailable"
//   - JSON valido mas package vazio       -> "pacote_vazio"
export async function lerSigmaInfo(
  cookieHeader: string,
  idClienteInterno: string,
): Promise<SigmaInfoResultado> {
  try {
    const res = await fetch(
      `${ROCKET_BASE_URL}/gerenciador/cliente/sigma/info/?cliente_id=${encodeURIComponent(idClienteInterno)}`,
      {
        headers: {
          Cookie: cookieHeader,
          "User-Agent": ROCKET_USER_AGENT,
          Referer: `${ROCKET_BASE_URL}/gerenciador/`,
          "X-Requested-With": "XMLHttpRequest",
        },
      },
    );
    if (!res.ok) return { outcome: "unavailable" };

    const body = await res.json().catch(() => null);
    if (!body || typeof body !== "object") return { outcome: "unavailable" };

    const data = (body as { data?: { package?: unknown; expires_at?: unknown } }).data;
    const pacote = String(data?.package ?? "").trim();
    if (!pacote) return { outcome: "pacote_vazio" };

    const expiresAtBruto = data?.expires_at;
    const expiresAt =
      expiresAtBruto === null || expiresAtBruto === undefined ? null : String(expiresAtBruto);

    return { outcome: "success", package: pacote, expiresAt };
  } catch {
    return { outcome: "unavailable" };
  }
}
