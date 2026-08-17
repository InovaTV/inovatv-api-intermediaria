// Lista de conversas (Componente 5 §8) -- TODAS, qualquer estado,
// mais recente primeiro. Abrir uma conversa nunca assume o
// atendimento (isso e' uma acao separada, dentro da tela de detalhe).
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AuthGuard from "@/components/AuthGuard";
import { supabase } from "@/lib/supabase";
import { listarConversas } from "@/lib/api";
import { assinarRealtime, mesclarConversa } from "@/lib/realtime";
import type { ConversaEstado } from "@/lib/types";

function ListaConversas() {
  const [conversas, setConversas] = useState<ConversaEstado[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(() => {
    return listarConversas(1)
      .then((resp) => {
        if (resp.outcome !== "success") {
          setErro("Nao foi possivel carregar as conversas agora.");
          return;
        }
        setConversas(resp.conversas);
        setErro(null);
      })
      .catch(() => setErro("Nao foi possivel carregar as conversas agora."));
  }, []);

  useEffect(() => {
    carregar().finally(() => setCarregando(false));
  }, [carregar]);

  // Realtime: so sincronizacao visual (Componente 5, etapa aprovada
  // 2026-08-17) -- nenhuma escrita, nenhuma chamada a Edge Function
  // daqui. conversas_estado INSERT/UPDATE move a conversa pro topo da
  // lista local; reconexao dispara um refetch completo (cobre
  // qualquer evento perdido durante a queda).
  useEffect(() => {
    const cancelar = assinarRealtime({
      onConversaChange: (conversa) => {
        setConversas((atual) => mesclarConversa(atual, conversa));
      },
      onReconectar: () => {
        carregar();
      },
    });
    return cancelar;
  }, [carregar]);

  async function sair() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  return (
    <div className="container">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ fontSize: 20 }}>Conversas</h1>
        <button onClick={sair} style={{ background: "none", border: "1px solid #2a2e38", color: "#8a8f9a", borderRadius: 6, padding: "6px 12px" }}>
          Sair
        </button>
      </div>

      {carregando && <p>Carregando...</p>}
      {erro && <p style={{ color: "#e05a5a" }}>{erro}</p>}
      {!carregando && !erro && conversas.length === 0 && <p style={{ color: "#8a8f9a" }}>Nenhuma conversa ainda.</p>}

      <div style={{ display: "grid", gap: 8, marginTop: 16 }}>
        {conversas.map((c) => (
          <Link key={c.conversation_id} href={`/conversas/${c.conversation_id}`} style={{ textDecoration: "none" }}>
            <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 600 }}>{c.nome_snapshot ?? c.telefone}</div>
                <div style={{ fontSize: 13, color: "#8a8f9a" }}>{c.telefone}</div>
              </div>
              <span className={`badge ${c.estado === "aguardando_humano" ? "badge-aguardando" : "badge-normal"}`}>
                {c.estado === "aguardando_humano" ? "aguardando humano" : "normal"}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

export default function ConversasPage() {
  return (
    <AuthGuard>
      <ListaConversas />
    </AuthGuard>
  );
}
