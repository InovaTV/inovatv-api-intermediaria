// Shell de duas colunas (Etapa 2, layout estilo WhatsApp, aprovada
// 2026-08-17). Persistente entre navegacoes dentro de /conversas --
// a lista (abaixo) nunca remonta ao trocar de conversa selecionada,
// diferente do padrao anterior de paginas cheias separadas.
//
// Selecao de conversa e' representada EXCLUSIVAMENTE pela URL
// (params.id) -- nenhum estado novo pra isso. Um layout no App
// Router enxerga os params de rotas filhas via useParams(), mesmo
// nao sendo ele quem declara o segmento [id].
//
// lib/api.ts, lib/realtime.ts, lib/types.ts, lib/supabase.ts e
// components/AuthGuard.tsx NAO foram alterados -- só reaproveitados
// exatamente como ja estavam.
"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import AuthGuard from "@/components/AuthGuard";
import { supabase } from "@/lib/supabase";
import { listarConversas } from "@/lib/api";
import { assinarRealtime, mesclarConversa } from "@/lib/realtime";
import type { ConversaEstado } from "@/lib/types";

// Migrada de app/conversas/page.tsx (Etapa 1) -- mesma logica de
// fetch/realtime, sem nenhuma mudanca de comportamento, só passa a
// viver no layout em vez da pagina.
function ListaConversas({ conversationIdAtual }: { conversationIdAtual?: string }) {
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
    <div className={`painel-lista ${conversationIdAtual ? "painel-lista-oculta-mobile" : ""}`}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "16px 16px 0",
        }}
      >
        <h1 style={{ fontSize: 20 }}>Conversas</h1>
        <button
          onClick={sair}
          style={{
            background: "none",
            border: "1px solid #2a2e38",
            color: "#8a8f9a",
            borderRadius: 6,
            padding: "6px 12px",
          }}
        >
          Sair
        </button>
      </div>

      {carregando && <p style={{ padding: 16 }}>Carregando...</p>}
      {erro && <p style={{ color: "#e05a5a", padding: 16 }}>{erro}</p>}
      {!carregando && !erro && conversas.length === 0 && (
        <p style={{ color: "#8a8f9a", padding: 16 }}>Nenhuma conversa ainda.</p>
      )}

      <div style={{ display: "grid", gap: 8, padding: 16 }}>
        {conversas.map((c) => (
          <Link
            key={c.conversation_id}
            href={`/conversas/${c.conversation_id}`}
            style={{ textDecoration: "none" }}
          >
            <div
              className="card"
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                borderColor:
                  c.conversation_id === conversationIdAtual ? "#3a6fd8" : undefined,
              }}
            >
              <div>
                <div style={{ fontWeight: 600 }}>{c.nome_snapshot ?? c.telefone}</div>
                <div style={{ fontSize: 13, color: "#8a8f9a" }}>{c.telefone}</div>
              </div>
              <span
                className={`badge ${
                  c.estado === "aguardando_humano" ? "badge-aguardando" : "badge-normal"
                }`}
              >
                {c.estado === "aguardando_humano" ? "aguardando humano" : "normal"}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

export default function ConversasLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ id?: string }>();
  const conversationIdAtual = params?.id;

  return (
    <div className="painel-shell">
      <AuthGuard>
        <ListaConversas conversationIdAtual={conversationIdAtual} />
      </AuthGuard>
      <div
        className={`painel-detalhe ${
          conversationIdAtual ? "" : "painel-detalhe-oculta-mobile"
        }`}
      >
        {children}
      </div>
    </div>
  );
}
