// Wrappers de chamada as Edge Functions renovacao-eventos-* -- arquivo
// isolado de lib/api.ts de proposito (decisao registrada na auditoria
// desta frente: "se houver duvida entre reutilizar algo da validacao
// UniTV ou criar algo separado, prefira criar separado" -- lib/api.ts
// tambem serve o Token UniTV, entao o encanamento HTTP generico
// (equivalente a chamarFuncao() de lib/api.ts) e' duplicado aqui, nao
// importado de la. lib/api.ts continua byte a byte como estava.
"use client";

import { supabase } from "./supabase";
import type { ListarRenovacoesResposta, DetalheRenovacaoResposta, ResultadoRenovacao } from "./types-renovacoes";

const FUNCTIONS_URL = process.env.NEXT_PUBLIC_FUNCTIONS_URL;

async function chamarFuncaoRenovacoes<T>(
  nome: string,
  opcoes: { query?: Record<string, string> } = {},
): Promise<T> {
  if (!FUNCTIONS_URL) {
    throw new Error("NEXT_PUBLIC_FUNCTIONS_URL ausente");
  }

  const { data: sessao } = await supabase.auth.getSession();
  const token = sessao.session?.access_token;
  if (!token) {
    throw new Error("Sessao ausente -- faca login novamente");
  }

  const query = opcoes.query ? `?${new URLSearchParams(opcoes.query).toString()}` : "";
  const resp = await fetch(`${FUNCTIONS_URL}/${nome}${query}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });

  const json = await resp.json().catch(() => ({}));
  if (!resp.ok && resp.status !== 404) {
    throw new Error(json?.outcome ?? `Erro ${resp.status} ao chamar ${nome}`);
  }
  return json as T;
}

export function listarRenovacoes(pagina = 1, resultado?: ResultadoRenovacao) {
  const query: Record<string, string> = { pagina: String(pagina) };
  if (resultado) query.resultado = resultado;
  return chamarFuncaoRenovacoes<ListarRenovacoesResposta>("renovacao-eventos-listar", { query });
}

export function buscarDetalheRenovacao(params: { tokenId?: string; grupoId?: string }) {
  const query: Record<string, string> = {};
  if (params.tokenId) query.token_id = params.tokenId;
  if (params.grupoId) query.grupo_id = params.grupoId;
  return chamarFuncaoRenovacoes<DetalheRenovacaoResposta>("renovacao-eventos-detalhe", { query });
}
