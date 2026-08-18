// Wrappers de chamada as Edge Functions painel-atendimento-* -- todas
// exigem o access_token da sessao Supabase Auth atual (Componente 5
// §6). Nenhuma logica de negocio aqui, so' o encanamento HTTP.
"use client";

import { supabase } from "./supabase";
import type { ConversaEstado, ConversaEpisodio, MensagemConversa, ClienteAoVivo } from "./types";

const FUNCTIONS_URL = process.env.NEXT_PUBLIC_FUNCTIONS_URL;

async function chamarFuncao<T>(
  nome: string,
  opcoes: { method?: string; query?: Record<string, string>; body?: unknown } = {},
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
    method: opcoes.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: opcoes.body ? JSON.stringify(opcoes.body) : undefined,
  });

  const json = await resp.json().catch(() => ({}));
  if (!resp.ok && resp.status !== 409 && resp.status !== 404) {
    throw new Error(json?.outcome ?? `Erro ${resp.status} ao chamar ${nome}`);
  }
  return json as T;
}

export interface ListarConversasResposta {
  outcome: string;
  pagina: number;
  total: number;
  conversas: ConversaEstado[];
}

export function listarConversas(pagina = 1) {
  return chamarFuncao<ListarConversasResposta>("painel-atendimento-listar", {
    query: { pagina: String(pagina) },
  });
}

export interface AbrirConversaResposta {
  outcome: string;
  conversa?: ConversaEstado;
  episodios?: ConversaEpisodio[];
  mensagens?: MensagemConversa[];
  clienteAoVivo?: ClienteAoVivo[];
}

export function abrirConversa(conversationId: string) {
  return chamarFuncao<AbrirConversaResposta>("painel-atendimento-abrir", {
    query: { conversation_id: conversationId },
  });
}

export interface AcaoConversaResposta {
  outcome: string;
  conversa?: ConversaEstado;
}

export function assumirConversa(conversationId: string) {
  return chamarFuncao<AcaoConversaResposta>("painel-atendimento-assumir", {
    method: "POST",
    body: { conversation_id: conversationId },
  });
}

export function encerrarConversa(conversationId: string) {
  return chamarFuncao<AcaoConversaResposta>("painel-atendimento-encerrar", {
    method: "POST",
    body: { conversation_id: conversationId },
  });
}

export function responderConversa(conversationId: string, texto: string) {
  return chamarFuncao<{ outcome: string }>("painel-atendimento-responder", {
    method: "POST",
    body: { conversation_id: conversationId, texto },
  });
}

// Aviso de Novas Mensagens, Fatia 3 -- endpoint dedicado (decisao 3 do
// planejamento aprovado), nunca chamado como efeito colateral de
// abrirConversa(). Quem decide QUANDO chamar isso e' quem usa o
// wrapper (Fatia 5: ao abrir a tela da conversa, e de novo a cada
// mensagem nova de origem 'cliente' recebida enquanto ela permanece
// aberta) -- este arquivo so' faz o encanamento HTTP, igual as demais
// funcoes acima.
export function marcarVistoConversa(conversationId: string) {
  return chamarFuncao<AcaoConversaResposta>("painel-atendimento-marcar-visto", {
    method: "POST",
    body: { conversation_id: conversationId },
  });
}
