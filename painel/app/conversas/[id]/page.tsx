// Conversa aberta: historico completo (Componente 5 §8) + acoes
// assumir/responder/encerrar (Bloco 3). Abrir SEMPRE mostra o
// historico, mesmo sem assumir -- assumir e' um clique explicito.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AuthGuard from "@/components/AuthGuard";
import { usePainelDetalheRef } from "../layout";
import {
  abrirConversa,
  assumirConversa,
  encerrarConversa,
  responderConversa,
  marcarVistoConversa,
} from "@/lib/api";
import {
  assinarRealtime,
  adicionarMensagemSemDuplicar,
} from "@/lib/realtime";
import type {
  ConversaEstado,
  ConversaEpisodio,
  MensagemConversa,
  ClienteAoVivo,
} from "@/lib/types";

// Fatia 3 -- fuso fixo America/Sao_Paulo, nunca o fuso do navegador
// do operador (regra ja validada antes nesta mesma frente). O balao
// mostra so' o horario; a data completa vive no separador do bloco
// do dia (agruparPorDia, abaixo).
const FUSO = "America/Sao_Paulo";

function formatarHorario(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: FUSO,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function diaCalendario(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function rotuloData(diaCal: string, hojeCal: string, ontemCal: string): string {
  if (diaCal === hojeCal) return "Hoje";
  if (diaCal === ontemCal) return "Ontem";
  const [ano, mes, dia] = diaCal.split("-");
  return `${dia}/${mes}/${ano}`;
}

interface GrupoMensagens {
  rotulo: string;
  mensagens: MensagemConversa[];
}

// Fatia 3 -- agrupamento por dia-calendario, 100% frontend, sobre a
// lista ja carregada e ja ordenada ascendente por criado_em (nenhuma
// mudanca de query/schema). A ordem das mensagens nunca muda -- os
// separadores sao so' rotulos entre grupos contiguos da mesma data.
// Nunca "Anteontem"; nunca separador pra dia sem mensagem (so' abre
// um grupo novo quando o dia da proxima mensagem realmente muda).
function agruparPorDia(mensagens: MensagemConversa[]): GrupoMensagens[] {
  if (mensagens.length === 0) return [];

  const agora = new Date();
  const hojeCal = diaCalendario(agora.toISOString());
  // "Ontem" via subtracao de 24h em epoch, nunca aritmetica de data
  // local do navegador -- evita depender do fuso do dispositivo.
  const ontemCal = diaCalendario(
    new Date(agora.getTime() - 24 * 60 * 60 * 1000).toISOString(),
  );

  const grupos: GrupoMensagens[] = [];
  let diaAnterior: string | null = null;

  for (const m of mensagens) {
    const diaAtual = diaCalendario(m.criado_em);
    if (diaAtual !== diaAnterior) {
      grupos.push({ rotulo: rotuloData(diaAtual, hojeCal, ontemCal), mensagens: [] });
      diaAnterior = diaAtual;
    }
    grupos[grupos.length - 1].mensagens.push(m);
  }

  return grupos;
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

      // Aviso de Novas Mensagens, Fatia 5 (decisao 3 do planejamento
      // aprovado): abrirConversa() e' sempre leitura pura -- marcar
      // como visto e' uma chamada SEPARADA, explicita, disparada pelo
      // frontend logo depois do sucesso acima. Best-effort: uma falha
      // aqui nunca deve impedir o operador de ver a conversa (ja
      // carregada com sucesso nas linhas anteriores).
      marcarVistoConversa(conversationId).catch(() => {
        // silencioso de proposito -- ver comentario acima.
      });
    } catch {
      setErro("Nao foi possivel carregar esta conversa.");
    } finally {
      setCarregando(false);
    }
  }, [conversationId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // Realtime: so sincronizacao visual (Componente 5, etapa aprovada
  // 2026-08-17) -- nenhuma escrita, nenhuma chamada a Edge Function
  // daqui. Filtra pelo conversation_id da rota atual -- eventos de
  // outras conversas nao afetam esta tela. mensagens_conversa INSERT
  // e' dedupado por id (idempotente com o refetch que assumir/
  // encerrar/responder ja disparam sozinhos). Reconexao dispara
  // carregar() de novo, cobrindo qualquer evento perdido na queda.
  useEffect(() => {
    const cancelar = assinarRealtime({
      onConversaChange: (atualizada) => {
        if (atualizada.conversation_id !== conversationId) return;
        setConversa(atualizada);
      },
      onMensagemNova: (mensagem) => {
        if (mensagem.conversation_id !== conversationId) return;
        setMensagens((atual) => adicionarMensagemSemDuplicar(atual, mensagem));

        // Fatia 5: a conversa esta aberta nesta tela agora -- toda
        // mensagem nova do cliente marca como vista de novo, senao um
        // reload posterior mostraria "nao lida" uma mensagem que o
        // operador ja viu chegar ao vivo (Componente 5, secao 5 do
        // planejamento). Best-effort, mesmo padrao de carregar() acima.
        if (mensagem.origem === "cliente") {
          marcarVistoConversa(conversationId).catch(() => {
            // silencioso de proposito.
          });
        }
      },
      onReconectar: () => {
        carregar();
      },
    });
    return cancelar;
  }, [conversationId, carregar]);

  // Fatia 3 -- precisa ficar antes de qualquer "return" condicional
  // abaixo (Rules of Hooks: useMemo sempre chamado, nunca so' quando
  // ha' conversa carregada).
  const grupos = useMemo(() => agruparPorDia(mensagens), [mensagens]);

  // Fatia 3 -- posicionamento automatico no final da conversa. Nunca
  // via document.querySelector: usa o ref do elemento que realmente
  // tem o scroll (.painel-detalhe, overflow-y:auto), exposto por
  // layout.tsx via Context (usePainelDetalheRef) -- e' o layout
  // persistente quem e' dono desse elemento, nao esta pagina.
  const detalheRef = usePainelDetalheRef();

  // Atualizado por um listener de scroll real, nunca recalculado a
  // partir de "mensagens" -- por essa altura o scrollHeight ja
  // cresceu com a mensagem nova, entao medir a posicao so' DEPOIS
  // dessa mudanca sempre pareceria "longe do final". O listener
  // captura a posicao de leitura verdadeira do operador, de ANTES de
  // qualquer mensagem nova chegar.
  const pertoDoFinalRef = useRef(true);
  // Detecta troca de conversa (id mudou) sem depender de a pagina
  // remontar ou nao entre uma conversa e outra -- funciona nos dois
  // casos.
  const ultimaConversaRef = useRef<string | null>(null);

  useEffect(() => {
    const el = detalheRef?.current;
    if (!el) return;

    function aoRolar() {
      const distancia = el!.scrollHeight - el!.scrollTop - el!.clientHeight;
      pertoDoFinalRef.current = distancia < 120;
    }

    el.addEventListener("scroll", aoRolar, { passive: true });
    return () => el.removeEventListener("scroll", aoRolar);
  }, [detalheRef]);

  useEffect(() => {
    if (mensagens.length === 0) return;
    const el = detalheRef?.current;
    if (!el) return;

    const conversaMudou = ultimaConversaRef.current !== conversationId;
    ultimaConversaRef.current = conversationId;

    if (conversaMudou) {
      // Abrir uma conversa sempre posiciona no final -- primeira
      // exibicao, sem historico de leitura anterior a respeitar.
      el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
      pertoDoFinalRef.current = true;
      return;
    }

    // Refetch (assumir/encerrar/responder/reconectar) ou mensagem
    // nova via Realtime: so' acompanha se o operador ja estava perto
    // do final. Lendo historico mais acima, o scroll nunca e' puxado
    // pra baixo sozinho.
    if (pertoDoFinalRef.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [mensagens, conversationId, detalheRef]);

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

        {grupos.map((grupo) => (
          <div key={grupo.mensagens[0].id}>
            <div className="separador-data">{grupo.rotulo}</div>
            {grupo.mensagens.map((m) => (
              <div key={m.id} className={`msg msg-${m.origem}`}>
                <div
                  style={{
                    fontSize: 11,
                    opacity: 0.6,
                    marginBottom: 2,
                  }}
                >
                  {formatarHorario(m.criado_em)}
                </div>

                {m.texto}
              </div>
            ))}
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