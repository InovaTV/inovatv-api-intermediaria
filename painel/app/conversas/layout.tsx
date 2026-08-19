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

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import { apresentarMensagemSistema } from "@/lib/mensagens";
import type { ConversaEstado } from "@/lib/types";

const TITULO_BASE = "Painel de Atendimento -- InovaTV";

// Fatia 3 -- .painel-detalhe (o elemento com scroll de verdade,
// flex:1 + overflow-y:auto) e' renderizado aqui no layout, mas quem
// precisa posicionar o scroll (conversa aberta) e' [id]/page.tsx,
// renderizado como children. Context e' o mecanismo React correto
// pra essa comunicacao entre um layout persistente e a rota filha --
// nunca document.querySelector alcancando DOM de outro componente.
// Mesmo lugar (arquivo do layout) por ser o dono natural do ref.
const PainelDetalheRefContext = createContext<React.RefObject<HTMLDivElement | null> | null>(
  null,
);

export function usePainelDetalheRef() {
  return useContext(PainelDetalheRefContext);
}

type Filtro = "todas" | "nao_lidas" | "aguardando";

export function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  const primeira = partes[0][0];
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] : "";
  return (primeira + ultima).toUpperCase();
}

// Fatia 2 -- avatar usa foto real se uma fonte existir; fotoUrl fica
// pronto para receber isso quando houver, sem inventar chamada nova
// agora. Hoje sempre cai em iniciais: nao existe campo de foto em
// lugar nenhum (Rocket/`/status`/`/match`, confirmado nas
// investigacoes anteriores desta frente), e a lista deliberadamente
// nao consulta dado ao vivo do cliente por conversa (Componente 5
// SS8, minimizacao -- so' painel-atendimento-abrir faz isso, por
// conversa unica, quando o operador abre uma conversa especifica).
export function Avatar({
  nome,
  fotoUrl,
  grande,
}: {
  nome: string;
  fotoUrl?: string | null;
  // Coluna 3 -- Dados do Contato (2026-08-19): mesmo componente da
  // lista, so' com um modificador de tamanho opcional (.avatar-grande,
  // globals.css) -- sem duplicar Avatar/iniciais() pra isso.
  grande?: boolean;
}) {
  const classeBase = `avatar${grande ? " avatar-grande" : ""}`;
  if (fotoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={fotoUrl} alt={nome} className={classeBase} />;
  }
  return (
    <div className={`${classeBase} avatar-iniciais`} aria-hidden="true">
      {iniciais(nome)}
    </div>
  );
}

// Fatia 2 -- data/hora da lista: hoje mostra so' o horario, qualquer
// outro dia mostra a data. Fuso fixo America/Sao_Paulo, nunca o fuso
// do navegador do operador (mesma regra ja decidida para os
// separadores de data da conversa, Fatia 3 -- ainda nao implementada,
// mas o fuso fixo e' o mesmo principio).
const FUSO = "America/Sao_Paulo";

function diaCalendario(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function formatarDataLista(iso: string): string {
  const data = new Date(iso);
  const ehHoje = diaCalendario(iso) === diaCalendario(new Date().toISOString());
  if (ehHoje) {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: FUSO,
      hour: "2-digit",
      minute: "2-digit",
    }).format(data);
  }
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: FUSO,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(data);
}

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
  const [filtro, setFiltro] = useState<Filtro>("todas");

  useEffect(() => {
    setSomAtivo(somEstaAtivo());
  }, []);

  // Fatia 2 -- regra de produto: toda conversa que ja teve dialogo
  // permanece na lista, e os 3 filtros (Todas/Nao lidas/Aguardando
  // humano) precisam funcionar sobre a lista inteira, nao so' a
  // primeira pagina. Solucao mais simples usando a infraestrutura de
  // paginacao ja existente (listarConversas(pagina), que ja devolve
  // "total"): percorre as paginas em sequencia e acumula em memoria,
  // sem nenhum parametro novo nem mudanca no backend. No volume atual
  // do projeto (poucas dezenas de conversas) isso e' 1-2 chamadas.
  const carregar = useCallback(async () => {
    try {
      let pagina = 1;
      let acumulado: ConversaEstado[] = [];
      for (;;) {
        const resp = await listarConversas(pagina);
        if (resp.outcome !== "success") {
          setErro("Nao foi possivel carregar as conversas agora.");
          return;
        }
        acumulado = acumulado.concat(resp.conversas);
        if (resp.conversas.length === 0 || acumulado.length >= resp.total) break;
        pagina += 1;
      }
      setConversas(acumulado);
      setErro(null);
    } catch {
      setErro("Nao foi possivel carregar as conversas agora.");
    }
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

  // Fatia 2 -- os 3 filtros reaproveitam exatamente a mesma regra que
  // ja alimenta o contador/badge (temNaoLida) e o mesmo campo que ja
  // alimenta o badge de estado (c.estado) -- nenhuma logica nova,
  // nenhuma query nova, uma unica fonte de verdade.
  const conversasFiltradas = useMemo(() => {
    if (filtro === "nao_lidas") return conversas.filter(temNaoLida);
    if (filtro === "aguardando") {
      return conversas.filter((c) => c.estado === "aguardando_humano");
    }
    return conversas;
  }, [conversas, filtro]);

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

      <div className="filtros">
        <button
          className={`filtro-btn ${filtro === "todas" ? "filtro-btn-ativo" : ""}`}
          onClick={() => setFiltro("todas")}
        >
          Todas
        </button>
        <button
          className={`filtro-btn ${filtro === "nao_lidas" ? "filtro-btn-ativo" : ""}`}
          onClick={() => setFiltro("nao_lidas")}
        >
          Nao lidas{naoLidas > 0 ? ` (${naoLidas})` : ""}
        </button>
        <button
          className={`filtro-btn ${filtro === "aguardando" ? "filtro-btn-ativo" : ""}`}
          onClick={() => setFiltro("aguardando")}
        >
          Aguardando humano
        </button>
      </div>

      {carregando && <p style={{ padding: 16 }}>Carregando...</p>}
      {erro && <p style={{ color: "#e05a5a", padding: 16 }}>{erro}</p>}
      {!carregando && !erro && conversas.length === 0 && (
        <p style={{ color: "#8a8f9a", padding: 16 }}>Nenhuma conversa ainda.</p>
      )}
      {!carregando && !erro && conversas.length > 0 && conversasFiltradas.length === 0 && (
        <p style={{ color: "#8a8f9a", padding: 16 }}>Nenhuma conversa neste filtro.</p>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr)",
          gap: 8,
          padding: 16,
        }}
      >
        {conversasFiltradas.map((c) => {
          const naoLida = temNaoLida(c) && c.conversation_id !== conversationIdAtual;
          const nomeExibido = c.nome_snapshot ?? c.telefone;
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
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 8,
                    minWidth: 0,
                    flex: 1,
                  }}
                >
                  {naoLida && <span className="ponto-nao-lida" aria-hidden="true" />}
                  <Avatar nome={nomeExibido} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <div
                        style={{
                          fontWeight: naoLida ? 700 : 600,
                          minWidth: 0,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {nomeExibido}
                      </div>
                      <span className="data-hora">{formatarDataLista(c.atualizado_em)}</span>
                    </div>
                    {c.ultima_mensagem_texto && (
                      <div className="previa-mensagem">
                        {apresentarMensagemSistema(c.ultima_mensagem_texto)}
                      </div>
                    )}
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
  const detalheRef = useRef<HTMLDivElement>(null);

  return (
    <div className="painel-shell">
      <AuthGuard>
        <ListaConversas conversationIdAtual={conversationIdAtual} />
      </AuthGuard>
      <div
        ref={detalheRef}
        className={`painel-detalhe ${
          conversationIdAtual ? "" : "painel-detalhe-oculta-mobile"
        }`}
      >
        <PainelDetalheRefContext.Provider value={detalheRef}>
          {children}
        </PainelDetalheRefContext.Provider>
      </div>
    </div>
  );
}
