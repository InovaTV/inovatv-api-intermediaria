// Tela 2 -- detalhe/diagnostico de UMA tentativa de renovacao (Painel
// de Monitoramento de Renovacoes, 2026-09-14). Mesmo conceito aprovado
// no mockup (v4): veredito no topo (CONCLUIDA / NAO CONCLUIDA / PARCIAL
// / CANCELADA / AGUARDANDO PAGAMENTO) + resumo + timeline compartilhada
// + (so' para lote) cards por acesso + informacoes tecnicas discretas.
// So' consulta sob demanda -- sem WebSocket/SSE/polling.
"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import styles from "../renovacoes.module.css";
import { buscarDetalheRenovacao } from "@/lib/api-renovacoes";
import type { DetalheRenovacaoResposta, EtapaRenovacao, EventoRenovacao, ResultadoRenovacao } from "@/lib/types-renovacoes";

const ETAPA_LABEL: Record<EtapaRenovacao, string> = {
  entrada: "Entrada",
  identificacao: "Identificação",
  acessos: "Acessos",
  carrinho: "Carrinho",
  confirmacao: "Confirmação",
  cobranca_pix: "Cobrança Pix",
  pagamento: "Pagamento",
  disparo_renovacao: "Dispatch",
  processamento: "Processamento",
  vencimento: "Novo vencimento",
  callback_resultado: "Callback",
  mensagem_legado: "Mensagem (legado)",
  consulta_portal: "Consulta do Portal",
};

const DETALHE_LABEL: Record<string, string> = {
  qtd_candidatos: "Candidatos encontrados",
  qtd_acessos: "Acessos apresentados",
  plano: "Plano",
  valor_centavos: "Valor",
  servidor: "Servidor",
  valor_esperado_centavos: "Valor esperado",
  esperado_centavos: "Valor esperado",
  pago_centavos: "Valor recebido",
  transaction_id_provedor: "ID na Woovi",
  duracao_meses: "Duração",
  novo_vencimento: "Novo vencimento",
  motivo: "Motivo",
  contexto: "Contexto",
  qtd_itens: "Itens do lote",
  valor_total_centavos: "Valor total",
  tentativas: "Tentativas",
  outcome: "Resultado",
  etapa: "Etapa",
};

const MOTIVOS_CONHECIDOS: Record<string, string> = {
  "sigma:sessao_expirada": "Sessão Sigma expirada",
  "renovacao_sigma:falha": "Falha no processamento Sigma",
  "renovacao_sigma:sessao_expirada": "Sessão Sigma expirada",
  "renovacao_sigma:resultado_ambiguo": "Resultado ambíguo no processamento",
  "renovacao:falha_criar_cobranca_apos_aceite": "Falha ao criar cobrança Pix",
  "renovacao:falha_vincular_operacao_token": "Falha ao vincular pagamento",
  "renovacao_lote:parcial": "Lote parcialmente concluído",
  "renovacao_lote:falha_criar_cobranca_apos_aceite": "Falha ao criar cobrança Pix (lote)",
  "renovacao_lote:falha_vincular_operacao": "Falha ao vincular pagamento (lote)",
};

function fmtDetalheValor(chave: string, valor: unknown): string {
  if (chave.endsWith("_centavos") && typeof valor === "number") {
    return "R$ " + (valor / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return String(valor);
}

// Deriva de qual sistema/etapa real veio uma falha -- so' combina
// campos que ja existem no evento (etapa/servidor/codigo), nunca
// inventa dado novo. Mesma logica do mockup aprovado.
function origemFalha(e: EventoRenovacao): string {
  if (e.etapa === "cobranca_pix" || e.etapa === "pagamento") return "Cobrança/Pagamento (OpenPix · Woovi)";
  if (e.etapa === "disparo_renovacao") return "Disparo do workflow (GitHub Actions)";
  if (e.etapa === "processamento" && e.codigo === "processamento_cliente_rocket_falhou") return "Rocket";
  if ((e.etapa === "processamento" || e.etapa === "vencimento") && e.servidor === "unitv") return "UniTV";
  if (e.etapa === "processamento" && e.servidor === "sigma") return "Sigma";
  if (e.etapa === "callback_resultado") return "Edge Function · callback de resultado";
  return ETAPA_LABEL[e.etapa] || e.etapa;
}

function motivoTexto(e: EventoRenovacao): string {
  const motivo = e.detalhe?.motivo;
  if (typeof motivo === "string") return MOTIVOS_CONHECIDOS[motivo] ?? motivo;
  if (e.codigo === "processamento_sessao_expirada") return "Sessão Sigma expirada antes do clique de renovação";
  if (e.codigo === "processamento_cliente_rocket_falhou") return "Falha ao ler o cliente no Rocket antes da tentativa";
  if (e.codigo === "processamento_painel_indisponivel") return "Painel Sigma indisponível (autenticação) após novas tentativas";
  if (e.codigo === "callback_sem_token_correspondente") {
    return "O callback do workflow chegou, mas não correspondeu a nenhuma renovação em andamento";
  }
  if (e.codigo === "pagamento_valor_divergente" && e.detalhe) {
    const esperado = e.detalhe.esperado_centavos;
    const pago = e.detalhe.pago_centavos;
    if (typeof esperado === "number" && typeof pago === "number") {
      return `Valor pago (${fmtDetalheValor("x_centavos", pago)}) diferente do esperado (${fmtDetalheValor("x_centavos", esperado)})`;
    }
  }
  return e.codigo;
}

// Causa raiz de uma falha: o ultimo evento de erro que NAO e' so' o
// callback registrando o resultado (ex.: processamento_cliente_rocket_falhou
// antes de resultado_gravado_falha) -- se so' existir o erro do proprio
// callback (ex.: callback_sem_token_correspondente), ele mesmo E' a
// causa raiz.
function encontrarRaiz(eventos: EventoRenovacao[]): EventoRenovacao | null {
  const falhas = eventos.filter((e) => e.nivel === "erro");
  if (falhas.length === 0) return null;
  const semCallback = [...falhas].reverse().find((e) => e.etapa !== "callback_resultado");
  return semCallback ?? falhas[falhas.length - 1];
}

function IconeOk() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M5 12.5l4.5 4.5L19 7" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconeX() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M6 6l12 12M18 6L6 18" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}
function IconeAlerta() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M12 4.5L21.5 20h-19L12 4.5Z" stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
      <path d="M12 10v4.5" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="12" cy="17.3" r="1.1" fill="#fff" />
    </svg>
  );
}
function IconeMenos() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="#fff" strokeWidth="2" />
      <path d="M8 12h8" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
function IconeRelogio() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="#fff" strokeWidth="2" />
      <path d="M12 7v5.3l3.5 2" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function iconeEvento(nivel: EventoRenovacao["nivel"]) {
  if (nivel === "erro") {
    return (
      <svg viewBox="0 0 16 16" fill="none">
        <path d="M4 4l8 8M12 4l-8 8" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" fill="none">
      <path d="M3 8.5L6.2 11.5L13 4.5" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LinhaTempo({ eventos }: { eventos: EventoRenovacao[] }) {
  return (
    <div className={styles.linhaTempo}>
      {eventos.map((e) => {
        const classe = e.nivel === "erro" ? "erro" : "info";
        const metaTags: React.ReactNode[] = [];
        if (e.origem) metaTags.push(<span key="o" className={`${styles.tagMeta} ${styles.tagMetaOrigem}`}>{e.origem}</span>);
        if (e.servidor) metaTags.push(<span key="s" className={styles.tagMeta}>{e.servidor}</span>);
        const detalheEntradas = Object.entries(e.detalhe ?? {});
        return (
          <div key={e.id} className={`${styles.evento} ${styles[classe]}`}>
            <div className={styles.eventoMarcador}>{iconeEvento(e.nivel)}</div>
            <div className={styles.eventoCorpo}>
              <div className={styles.eventoLinha1}>
                <div className={styles.eventoTitulo}>
                  <span className={styles.eventoEtapa}>{ETAPA_LABEL[e.etapa] || e.etapa}</span>
                  <span className={styles.eventoCodigo}>{e.codigo}</span>
                </div>
                <span className={styles.eventoHora}>
                  {new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(e.criado_em))}
                </span>
              </div>
              {metaTags.length > 0 && <div className={styles.eventoMeta}>{metaTags}</div>}
              {detalheEntradas.length > 0 && (
                <div className={styles.eventoDetalhe}>
                  <dl>
                    {detalheEntradas.map(([k, v]) => (
                      <span key={k} style={{ display: "contents" }}>
                        <dt>{DETALHE_LABEL[k] || k}</dt>
                        <dd>{fmtDetalheValor(k, v)}</dd>
                      </span>
                    ))}
                  </dl>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function RenovacaoDetalhePage() {
  const params = useSearchParams();
  const router = useRouter();
  const tokenId = params.get("token_id") ?? undefined;
  const grupoId = params.get("grupo_id") ?? undefined;

  const [resp, setResp] = useState<DetalheRenovacaoResposta | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!tokenId && !grupoId) {
      setErro("Identificador da renovação ausente na URL.");
      setCarregando(false);
      return;
    }
    setCarregando(true);
    setErro(null);
    buscarDetalheRenovacao({ tokenId, grupoId })
      .then((r) => setResp(r))
      .catch(() => setErro("Não foi possível carregar esta renovação agora."))
      .finally(() => setCarregando(false));
  }, [tokenId, grupoId]);

  // Agrupamento por acesso (so' existe pra lote): eventos sem token_id
  // sao compartilhados (1 pagamento pro lote inteiro, etc.); eventos
  // COM token_id pertencem a UM filho especifico -- nunca misturados
  // na mesma linha do tempo.
  const { compartilhados, grupos } = useMemo(() => {
    if (!resp || resp.outcome !== "success") return { compartilhados: [] as EventoRenovacao[], grupos: [] as { tokenId: string; servidor: string; eventos: EventoRenovacao[] }[] };
    if (resp.tipo === "avulsa") return { compartilhados: resp.eventos, grupos: [] };

    const filhosOrdem = resp.filhos.map((f) => f.tokenId);
    const porFilho = new Map<string, EventoRenovacao[]>();
    const semFilho: EventoRenovacao[] = [];
    for (const e of resp.eventos) {
      if (e.token_id && filhosOrdem.includes(e.token_id)) {
        if (!porFilho.has(e.token_id)) porFilho.set(e.token_id, []);
        porFilho.get(e.token_id)!.push(e);
      } else {
        semFilho.push(e);
      }
    }
    const grupos = filhosOrdem
      .filter((id) => porFilho.has(id))
      .map((id) => {
        const filho = resp.filhos.find((f) => f.tokenId === id)!;
        return { tokenId: id, servidor: filho.servidorNome, eventos: porFilho.get(id)! };
      });
    return { compartilhados: semFilho, grupos };
  }, [resp]);

  if (carregando) return <p className={styles.carregando}>Carregando...</p>;
  if (erro) return <p className={styles.erroCarregar}>{erro}</p>;
  if (!resp || resp.outcome === "nao_encontrado") return <p className={styles.erroCarregar}>Renovação não encontrada.</p>;
  if (resp.outcome === "unavailable") return <p className={styles.erroCarregar}>Não foi possível carregar esta renovação agora.</p>;

  const resultado: ResultadoRenovacao = resp.resumo.resultado;
  const raiz = resultado === "falha" || resultado === "parcial" ? encontrarRaiz(resp.eventos) : null;
  const ultimoVencimento = [...resp.eventos].reverse().find((e) => e.codigo === "vencimento_confirmado_sucesso");

  return (
    <>
      <button className={styles.voltarLink} onClick={() => router.push("/renovacoes")}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
          <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Voltar para a lista
      </button>

      <div className={`${styles.veredito} ${styles[resultado]}`}>
        <div className={styles.veredicoIcone}>
          {resultado === "ok" && <IconeOk />}
          {resultado === "falha" && <IconeX />}
          {resultado === "parcial" && <IconeAlerta />}
          {resultado === "cancel" && <IconeMenos />}
          {resultado === "espera" && <IconeRelogio />}
        </div>
        <div className={styles.veredicoCorpo}>
          <p className={styles.veredicoTitulo}>
            {resultado === "ok" && "RENOVAÇÃO CONCLUÍDA"}
            {resultado === "falha" && "RENOVAÇÃO NÃO CONCLUÍDA"}
            {resultado === "parcial" && "RENOVAÇÃO PARCIAL"}
            {resultado === "cancel" && "RENOVAÇÃO CANCELADA"}
            {resultado === "espera" && "AGUARDANDO PAGAMENTO"}
          </p>
          <p className={styles.veredicoSub}>
            {resultado === "ok" && "A tentativa percorreu todo o fluxo e foi confirmada de ponta a ponta."}
            {resultado === "falha" && "A tentativa não chegou a um resultado de sucesso."}
            {resultado === "parcial" && resp.resumo.qtdAcessos > 0 &&
              `${resp.tipo === "lote" ? resp.filhos.filter((f) => f.resultado === "ok").length : 0} de ${resp.resumo.qtdAcessos} acessos concluídos — pelo menos um acesso do lote não foi concluído.`}
            {resultado === "cancel" && "O cliente cancelou antes de qualquer cobrança ser paga. Nenhum valor foi movimentado."}
            {resultado === "espera" && "Estado registrado na última consulta — a cobrança Pix foi criada, mas o pagamento ainda não havia sido confirmado."}
          </p>
          {resultado === "ok" && ultimoVencimento && typeof ultimoVencimento.detalhe.novo_vencimento === "string" && (
            <div className={styles.veredicoLinhas}>
              <div className={styles.veredicoLinha}>
                <span className={styles.veredicoRotulo}>Novo vencimento:</span>
                <span className={styles.veredicoValor}>{ultimoVencimento.detalhe.novo_vencimento as string}</span>
              </div>
            </div>
          )}
          {(resultado === "falha" || resultado === "parcial") && raiz && (
            <div className={styles.veredicoLinhas}>
              <div className={styles.veredicoLinha}>
                <span className={styles.veredicoRotulo}>Ponto da falha:</span>
                <span className={styles.chipOrigem}>{origemFalha(raiz)}</span>
                {resultado === "falha" && (
                  <span className={styles.veredicoValor}>
                    ({ETAPA_LABEL[raiz.etapa] || raiz.etapa} · <code>{raiz.codigo}</code>)
                  </span>
                )}
              </div>
              <div className={styles.veredicoLinha}>
                <span className={styles.veredicoRotulo}>Motivo:</span>
                <span className={`${styles.veredicoValor} ${styles.veredicoDestaque}`}>{motivoTexto(raiz)}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className={styles.resumoDetalhe}>
        <div className={styles.resumoTopo}>
          <div>
            <h1 className={styles.resumoNome}>{resp.resumo.clienteNome}</h1>
            <div className={styles.resumoSub}>
              Tentativa iniciada em {resp.resumo.quandoFormatado} · {resp.resumo.telefone}
            </div>
          </div>
        </div>
        <div className={styles.resumoGrade}>
          {resp.tipo === "avulsa" && (
            <>
              <div>
                <div className={styles.resumoCampoRotulo}>Servidor</div>
                <div className={styles.resumoCampoValor}>{resp.resumo.servidor}</div>
              </div>
              <div>
                <div className={styles.resumoCampoRotulo}>Plano</div>
                <div className={styles.resumoCampoValor}>{resp.resumo.plano}</div>
              </div>
            </>
          )}
          <div>
            <div className={styles.resumoCampoRotulo}>Valor</div>
            <div className={styles.resumoCampoValor}>{resp.resumo.valorFormatado}</div>
          </div>
          <div>
            <div className={styles.resumoCampoRotulo}>Acessos</div>
            <div className={styles.resumoCampoValor}>{resp.resumo.qtdAcessos}</div>
          </div>
        </div>

        <details className={styles.tecnico}>
          <summary>Informações técnicas</summary>
          <div className={styles.tecnicoCorpo}>
            {resp.ids.tokenId && (
              <div className={styles.idInterno}>
                Token
                <b>{resp.ids.tokenId}</b>
              </div>
            )}
            {resp.ids.grupoId && (
              <div className={styles.idInterno}>
                Lote
                <b>{resp.ids.grupoId}</b>
              </div>
            )}
            {resp.ids.operacaoId && (
              <div className={styles.idInterno}>
                Operação
                <b>{resp.ids.operacaoId}</b>
              </div>
            )}
          </div>
        </details>
      </div>

      <div className={styles.timelineCabecalho}>
        <h2>Histórico de eventos</h2>
        <div className={styles.timelineLegenda}>
          <span>
            <i className={styles.legendaPonto} style={{ background: "var(--ren-verde)" }} /> Registrado
          </span>
          <span>
            <i className={styles.legendaPonto} style={{ background: "var(--ren-erro)" }} /> Erro
          </span>
        </div>
      </div>
      <LinhaTempo eventos={compartilhados} />

      {grupos.length > 0 && (
        <>
          <div className={styles.blocoTitulo}>Processamento por acesso ({grupos.length})</div>
          <div className={styles.acessosGrade}>
            {grupos.map((g, i) => {
              const falhaDoAcesso = [...g.eventos].reverse().find((e) => e.nivel === "erro");
              const falhou = !!falhaDoAcesso;
              return (
                <div key={g.tokenId} className={`${styles.acessoCard} ${falhou ? styles.falhou : ""}`}>
                  <div className={styles.acessoCardCab}>
                    <span className={styles.acessoCardTitulo}>
                      Acesso {i + 1} de {grupos.length} · {g.servidor}
                    </span>
                  </div>
                  <div className={styles.acessoChain}>
                    {g.eventos.map((e, idx) => (
                      <span key={e.id} style={{ display: "contents" }}>
                        <span className={`${styles.acessoPasso} ${e.nivel === "erro" ? styles.acessoPassoErro : styles.acessoPassoOk}`}>
                          <span className={styles.pt} />
                          {ETAPA_LABEL[e.etapa] || e.etapa}
                        </span>
                        {idx < g.eventos.length - 1 && <span className={styles.acessoSeta}>→</span>}
                      </span>
                    ))}
                  </div>
                  <div className={`${styles.acessoResultado} ${falhou ? styles.falha : styles.ok}`}>
                    {falhou ? `✕ Falha — ${motivoTexto(falhaDoAcesso!)}` : "✓ Renovado"}
                  </div>
                  <details className={styles.acessoDetalhes}>
                    <summary>Ver eventos deste acesso</summary>
                    <LinhaTempo eventos={g.eventos} />
                  </details>
                </div>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
