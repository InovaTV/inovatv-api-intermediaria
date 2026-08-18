// Aviso de Novas Mensagens, Fatia 3 (inovatv_central, "Planejamento --
// Aviso de Novas Mensagens", 7/7 decisoes aprovadas). Funcoes puras de
// apoio ao destaque/contador/som -- nenhuma fala com Edge Function nem
// Realtime; quem chama (Fatia 4/5) decide quando usar o resultado.
// Web Notification API deliberadamente FORA (decisao 6.3, adiada --
// titulo da aba e' a base ativa da V1, sem permissao de navegador).
"use client";

import type { ConversaEstado } from "./types";

// Decisao 4.2: "nao lida" e' um booleano derivado de dois timestamps
// ja carregados -- nunca uma contagem de mensagens.
export function temNaoLida(conversa: ConversaEstado): boolean {
  if (!conversa.ultima_mensagem_cliente_em) return false;
  if (!conversa.visto_em) return true;
  return conversa.ultima_mensagem_cliente_em > conversa.visto_em;
}

// Contador global (decisao 4.2): numero de CONVERSAS com nao lida, nao
// soma de mensagens -- calculado no cliente, sem query nova no backend
// (listarConversas ja traz os dois campos, so' custa este filter).
export function contarNaoLidas(conversas: ConversaEstado[]): number {
  return conversas.filter(temNaoLida).length;
}

// Som opcional (decisao 6.2) -- toggle liga/desliga persistido em
// localStorage, preferencia pura de cliente, sem coluna no banco.
// Default ligado (assumido a partir de "opcional/desligavel" -- ainda
// nao confirmado explicitamente pelo usuario, ver relatorio da Fatia 3).
const CHAVE_SOM_ATIVO = "painel-atendimento-som-ativo";

export function somEstaAtivo(): boolean {
  if (typeof window === "undefined") return false;
  const valor = window.localStorage.getItem(CHAVE_SOM_ATIVO);
  return valor === null ? true : valor === "true";
}

export function definirSomAtivo(ativo: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CHAVE_SOM_ATIVO, String(ativo));
}

// Asset ainda NAO existe em public/ (pendencia registrada no
// planejamento, secao 12) -- falha de carregamento/play() e' engolida
// deliberadamente (autoplay tambem pode ser bloqueado pelo navegador
// antes de qualquer interacao do usuario na pagina): nunca deve
// quebrar a tela por causa do som.
const CAMINHO_SOM = "/notificacao.mp3";

export function tocarSom(): void {
  if (typeof window === "undefined") return;
  if (!somEstaAtivo()) return;
  const audio = new Audio(CAMINHO_SOM);
  audio.play().catch(() => {
    // Silencioso de proposito -- ver comentario acima.
  });
}
