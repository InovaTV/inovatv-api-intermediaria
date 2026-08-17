// Realtime (Componente 5, Painel de Atendimento -- etapa "Realtime
// como fundacao tecnica", aprovada 2026-08-17). SO mecanismo de
// sincronizacao visual -- nenhuma operacao de negocio passa por
// aqui. Assumir/responder/encerrar continuam exclusivamente via
// lib/api.ts (Edge Functions); este modulo nunca escreve nada.
"use client";

import { supabase } from "./supabase";
import type { ConversaEstado, MensagemConversa } from "./types";

export interface RealtimeCallbacks {
  onConversaChange?: (conversa: ConversaEstado) => void;
  onMensagemNova?: (mensagem: MensagemConversa) => void;
  // So dispara a partir da SEGUNDA vez que o canal fica "SUBSCRIBED"
  // -- a primeira vez coincide com o fetch inicial que a propria tela
  // ja faz sozinha; isso e' especificamente pra cobrir reconexao
  // depois de uma queda (eventos perdidos nesse meio-tempo nunca sao
  // reenviados retroativamente pelo Realtime).
  onReconectar?: () => void;
}

// Retorna a funcao de limpeza (chamar no cleanup do useEffect).
export function assinarRealtime(callbacks: RealtimeCallbacks): () => void {
  let jaConectouAntes = false;

  const channel = supabase
    .channel(`painel-atendimento-realtime-${crypto.randomUUID()}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "conversas_estado" },
      (payload) => callbacks.onConversaChange?.(payload.new as ConversaEstado),
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "conversas_estado" },
      (payload) => callbacks.onConversaChange?.(payload.new as ConversaEstado),
    )
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "mensagens_conversa" },
      (payload) => callbacks.onMensagemNova?.(payload.new as MensagemConversa),
    )
    .subscribe((status) => {
      if (status !== "SUBSCRIBED") return;
      if (!jaConectouAntes) {
        jaConectouAntes = true;
        return;
      }
      callbacks.onReconectar?.();
    });

  return () => {
    supabase.removeChannel(channel);
  };
}

// Conversa nova/atualizada vai pro topo (reflete "mais recente
// primeiro", mesma ordenacao que a API ja usa) -- sem duplicar por
// conversation_id.
export function mesclarConversa(
  lista: ConversaEstado[],
  nova: ConversaEstado,
): ConversaEstado[] {
  const semAntiga = lista.filter(
    (c) => c.conversation_id !== nova.conversation_id,
  );
  return [nova, ...semAntiga];
}

// Mensagem nova vai pro final (ordem cronologica) -- dedup por id,
// idempotente independente de vir de um refetch manual ou do evento
// Realtime, em qualquer ordem de chegada.
export function adicionarMensagemSemDuplicar(
  lista: MensagemConversa[],
  nova: MensagemConversa,
): MensagemConversa[] {
  if (lista.some((m) => m.id === nova.id)) return lista;
  return [...lista, nova];
}
