// Cliente Supabase (service_role) compartilhado. SUPABASE_URL e
// SUPABASE_SERVICE_ROLE_KEY sao injetados automaticamente pela
// plataforma em toda Edge Function -- nao sao secrets configurados a
// mao (diferente de ROCKET_BASE_URL/ROCKET_API_KEY, usados por
// match/status).
//
// service_role ignora RLS por padrao -- e' exatamente por isso que
// conversas_estado/mensagens_atendimento_humano nao tem nenhuma policy
// para anon/authenticated (Componente 1 §17, inovatv_central): o
// isolamento e' "so quem tem a service_role key acessa", nao uma
// policy de linha.

import { createClient } from "npm:@supabase/supabase-js@2";

export function getServiceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausente");
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });
}
