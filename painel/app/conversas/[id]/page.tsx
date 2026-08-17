// Conversa aberta: historico completo (Componente 5 §8) + acoes
// assumir/responder/encerrar (Bloco 3). Abrir SEMPRE mostra o
// historico, mesmo sem assumir -- assumir e' um clique explicito.
"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import {
  abrirConversa,
  assumirConversa,
  encerrarConversa,
  responderConversa,
} from "@/lib/api";
import type {
  ConversaEstado,
  ConversaEpisodio,
  MensagemConversa,
  ClienteAoVivo,
} from "@/lib/types";

function formatarData(iso: string) {
  return new Date(iso).toLocaleString("pt-BR");
}

function ConversaDetalhe() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const conversationId = params.id;

  const [conversa, setConversa] = useState<ConversaEstado | null>(null);
  const [episodios, setEpisodios] = useState<ConversaEpisodio[]>([]);
  const [mensagens, setMensagens] = useState<MensagemConversa[]>([]);
  const [clienteAoVivo, setClienteAoVivo] = useState<ClienteAoVivo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [textoResposta, setTextoResposta] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [acaoEmAndamento, setAcaoEmAndamento] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const resp = await abrirConversa(conversationId);

      if (resp.outcome !== "success" || !resp.conversa) {
        setErro(
          resp.outcome === "nao_encontrada"
            ? "Conversa nao encontrada."
            : "Nao foi possivel carregar esta conversa.",
        );
        return;
      }

      setConversa(resp.conversa);
      setEpisodios(resp.episodios ?? []);
      setMensagens(resp.mensagens ?? []);
      setClienteAoVivo(resp.clienteAoVivo ?? []);
      setErro(null);
    } catch {
      setErro("Nao foi possivel carregar esta conversa.");
    } finally {
      setCarregando(false);
    }
  }, [conversationId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function handleAssumir() {
    setAcaoEmAndamento(true);

    try {
      await assumirConversa(conversationId);
      await carregar();
    } catch {
      setErro("Nao foi possivel assumir a conversa.");
    } finally {
      setAcaoEmAndamento(false);
    }
  }

  async function handleEncerrar() {
    setAcaoEmAndamento(true);

    try {
      await encerrarConversa(conversationId);
      await carregar();
    } catch {
      setErro("Nao foi possivel encerrar a conversa.");
    } finally {
      setAcaoEmAndamento(false);
    }
  }

  async function handleResponder() {
    if (!textoResposta.trim()) return;

    setEnviando(true);

    try {
      const resp = await responderConversa(
        conversationId,
        textoResposta.trim(),
      );

      if (resp.outcome === "enviada") {
        setTextoResposta("");
        await carregar();
      } else {
        setErro("Nao foi possivel enviar a resposta.");
      }
    } catch {
      setErro("Nao foi possivel enviar a resposta.");
    } finally {
      setEnviando(false);
    }
  }

  if (carregando) {
    return (
      <div className="container">
        <p>Carregando...</p>
      </div>
    );
  }

  if (erro && !conversa) {
    return (
      <div className="container">
        <button onClick={() => router.push("/conversas")}>
          &larr; Voltar
        </button>
        <p style={{ color: "#e05a5a" }}>{erro}</p>
      </div>
    );
  }

  if (!conversa) return null;

  const clienteInfo = clienteAoVivo.find((c) => c.cliente)?.cliente;
  const aguardandoHumano = conversa.estado === "aguardando_humano";
  const episodioAtual = episodios.find(
    (e) => e.id === conversa.episodio_atual_id,
  );

  return (
    <div className="container">
      <button
        onClick={() => router.push("/conversas")}
        style={{
          background: "none",
          border: "none",
          color: "#8a8f9a",
          padding: 0,
          marginBottom: 12,
        }}
      >
        &larr; Voltar
      </button>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 8,
        }}
      >
        <div>
          <h1 style={{ fontSize: 20, margin: 0 }}>
            {conversa.nome_snapshot ?? conversa.telefone}
          </h1>
          <div style={{ color: "#8a8f9a", fontSize: 13 }}>
            {conversa.telefone}
          </div>
        </div>

        <span
          className={`badge ${
            aguardandoHumano ? "badge-aguardando" : "badge-normal"
          }`}
        >
          {aguardandoHumano ? "aguardando humano" : "normal"}
        </span>
      </div>

      {clienteInfo && (
        <div
          className="card"
          style={{
            fontSize: 13,
            marginBottom: 16,
            display: "grid",
            gap: 4,
          }}
        >
          <div style={{ color: "#8a8f9a" }}>Dado ao vivo (Rocket)</div>
          <div>
            {clienteInfo.planoNome ?? "-"} &middot;{" "}
            {clienteInfo.servidorNome ?? "-"} &middot; vence{" "}
            {clienteInfo.vencimento ?? "-"}
          </div>
        </div>
      )}

      {episodioAtual && (
        <div
          className="card"
          style={{
            fontSize: 13,
            marginBottom: 16,
            borderColor: "#e0a95a",
          }}
        >
          Episódio em aberto -- motivo:{" "}
          {episodioAtual.motivo ?? "assumido manualmente"}
          {episodioAtual.assumido_por
            ? ` -- assumido por ${episodioAtual.assumido_por}`
            : " -- ninguém assumiu ainda"}
        </div>
      )}

      <div style={{ marginBottom: 16 }}>
        {mensagens.length === 0 && (
          <p style={{ color: "#8a8f9a" }}>Sem mensagens ainda.</p>
        )}

        {mensagens.map((m) => (
          <div key={m.id} className={`msg msg-${m.origem}`}>
            <div
              style={{
                fontSize: 11,
                opacity: 0.6,
                marginBottom: 2,
              }}
            >
              {m.origem} &middot; {formatarData(m.criado_em)}
            </div>

            {m.texto}
          </div>
        ))}
      </div>

      {erro && <p style={{ color: "#e05a5a" }}>{erro}</p>}

      <div
        style={{
          display: "flex",
          gap: 8,
          marginBottom: 16,
        }}
      >
        <button
          onClick={handleAssumir}
          disabled={acaoEmAndamento}
          style={{
            padding: "8px 16px",
            borderRadius: 6,
            border: "none",
            background: "#3a6fd8",
            color: "#fff",
          }}
        >
          Assumir conversa
        </button>

        {aguardandoHumano && (
          <button
            onClick={handleEncerrar}
            disabled={acaoEmAndamento}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              border: "1px solid #2a2e38",
              background: "none",
              color: "#e6e6e6",
            }}
          >
            Encerrar atendimento
          </button>
        )}
      </div>

      {aguardandoHumano && (
        <div style={{ display: "flex", gap: 8 }}>
          <textarea
            value={textoResposta}
            onChange={(e) => setTextoResposta(e.target.value)}
            placeholder="Responder ao cliente..."
            rows={2}
            style={{
              flex: 1,
              padding: 8,
              borderRadius: 6,
              border: "1px solid #2a2e38",
              background: "#1a1d24",
              color: "#e6e6e6",
              resize: "vertical",
            }}
          />

          <button
            onClick={handleResponder}
            disabled={enviando || !textoResposta.trim()}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              border: "none",
              background: "#3a6fd8",
              color: "#fff",
            }}
          >
            {enviando ? "Enviando..." : "Enviar"}
          </button>
        </div>
      )}
    </div>
  );
}

export default function ConversaPage() {
  return (
    <AuthGuard>
      <ConversaDetalhe />
    </AuthGuard>
  );
}