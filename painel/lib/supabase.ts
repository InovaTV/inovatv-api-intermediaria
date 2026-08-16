// Cliente Supabase do navegador -- so' pra autenticacao (login/sessao).
// Nenhuma tabela e' consultada direto por aqui (Componente 5 §5:
// "nunca acesso direto de tabela via RLS solto para o cliente") --
// toda leitura/escrita de conversa passa pelas Edge Functions
// painel-atendimento-*, ver lib/api.ts.
//
// Inicializacao preguicosa (so' na primeira chamada real, nunca no
// carregamento do modulo) -- descoberto durante o build: lancar erro
// direto no escopo do modulo quebra a pre-renderizacao estatica do
// Next mesmo em paginas que nenhum usuario chegou a abrir ainda.
"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cliente: SupabaseClient | null = null;

function criarCliente(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY ausentes -- copie .env.local.example para .env.local e preencha",
    );
  }

  return createClient(url, anonKey);
}

// Proxy: qualquer acesso a uma propriedade (ex.: supabase.auth) so
// cria o cliente real nesse momento, nunca antes.
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    if (!cliente) cliente = criarCliente();
    return Reflect.get(cliente, prop, receiver);
  },
});
