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

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import AuthGuard from "@/components/AuthGuard";
import { supabase } from "@/lib/supabase";
import { listarConversas } from "@/lib/api";
import { assinarRealtime, mesclarConversa } from "@/lib/realtime";
import {
  temNaoLida,
  contarNaoLidas,
  tocarSom,
  somEstaAtivo,
  definirSomAtivo,
} from "@/lib/notificacoes";
import type { ConversaEstado } from "@/lib/types";

const TITULO_BASE = "Painel de Atendimento -- InovaTV";

// Migrada de app/conversas/page.tsx (Etapa 1) -- mesma logica de
// fetch/realtime, sem nenhuma mudanca de comportamento, só passa a
// viver no layout em vez da pagina. Aviso de Novas Mensagens (Fatia 4,
// inovatv_central, "Planejamento -- Aviso de Novas Mensagens"):
// destaque por linha, contador global, titulo da aba, som -- tudo
// derivado das colunas ja carregadas (visto_em/ultima_mensagem_
// cliente_em), sem assinatura Realtime nova (Fatia 1 ja fez
// atualizado_em/ultima_mensagem_cliente_em fluirem pelo mesmo evento
// UPDATE de conversas_estado que este componente ja escuta).
function ListaConversas({ conversationIdAtual }: { conversationIdAtual?: string }) {
  const [conversas, setConversas] = useState<ConversaEstado[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [somAtivo, setSomAtivo] = useState(true);

  useEffect(() => {
    setSomAtivo(somEstaAtivo());
  }, []);

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

  // Ref pra conversationIdAtual: o handler do Realtime e' registrado
  // uma vez (deps [carregar]) e precisa sempre ler o valor mais
  // recente da conversa aberta, sem precisar recriar a assinatura a
  // cada troca de conversa (evitaria reconectar o canal sem motivo).
  const conversationIdAtualRef = useRef(conversationIdAtual);
  useEffect(() => {
    conversationIdAtualRef.current = conversationIdAtual;
  }, [conversationIdAtual]);

  useEffect(() => {
    const cancelar = assinarRealtime({
      onConversaChange: (conversa) => {
        setConversas((atual) => {
          const anterior = atual.find(
            (c) => c.conversation_id === conversa.conversation_id,
          );
          const mensagemClienteGenuinamenteNova =
            conversa.ultima_mensagem_cliente_em !== null &&
            conversa.ultima_mensagem_cliente_em !== anterior?.ultima_mensagem_cliente_em;

          if (mensagemClienteGenuinamenteNova) {
            const conversaEstaAbertaEComFoco =
              conversa.conversation_id === conversationIdAtualRef.current &&
              !document.hidden;
            if (!conversaEstaAbertaEComFoco) {
              tocarSom();
            }
          }

          return mesclarConversa(atual, conversa);
        });
      },
      onReconectar: () => {
        carregar();
      },
    });
    return cancelar;
  }, [carregar]);

  const naoLidas = contarNaoLidas(conversas);

  useEffect(() => {
    document.title = naoLidas > 0 ? `(${naoLidas}) ${TITULO_BASE}` : TITULO_BASE;
  }, [naoLidas]);

  async function sair() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  function alternarSom() {
    const novoValor = !somAtivo;
    definirSomAtivo(novoValor);
    setSomAtivo(novoValor);
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
        <h1 style={{ fontSize: 20, display: "flex", alignItems: "center", gap: 8 }}>
          Conversas
          {naoLidas > 0 && (
            <span className="badge badge-nao-lida" title={`${naoLidas} conversa(s) com mensagem nao lida`}>
              {naoLidas}
            </span>
          )}
        </h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={alternarSom}
            title={somAtivo ? "Silenciar aviso sonoro" : "Ativar aviso sonoro"}
            style={{
              background: "none",
              border: "1px solid #2a2e38",
              color: "#8a8f9a",
              borderRadius: 6,
              padding: "6px 12px",
            }}
          >
            {somAtivo ? "🔔" : "🔕"}
          </button>
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
      </div>

      {carregando && <p style={{ padding: 16 }}>Carregando...</p>}
      {erro && <p style={{ color: "#e05a5a", padding: 16 }}>{erro}</p>}
      {!carregando && !erro && conversas.length === 0 && (
        <p style={{ color: "#8a8f9a", padding: 16 }}>Nenhuma conversa ainda.</p>
      )}

      <div style={{ display: "grid", gap: 8, padding: 16 }}>
        {conversas.map((c) => {
          const naoLida = temNaoLida(c) && c.conversation_id !== conversationIdAtual;
          return (
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
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {naoLida && <span className="ponto-nao-lida" aria-hidden="true" />}
                  <div>
                    <div style={{ fontWeight: naoLida ? 700 : 600 }}>
                      {c.nome_snapshot ?? c.telefone}
                    </div>
                    <div style={{ fontSize: 13, color: "#8a8f9a" }}>{c.telefone}</div>
                  </div>
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
          );
        })}
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
