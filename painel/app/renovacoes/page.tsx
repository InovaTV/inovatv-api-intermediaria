// Tela 1 -- lista historica de tentativas de renovacao (Painel de
// Monitoramento de Renovacoes, 2026-09-14). Consulta sob demanda (ao
// abrir a tela / trocar filtro / trocar pagina) -- SEM WebSocket, SEM
// SSE, SEM polling, SEM atualizacao automatica, conforme decidido.
"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./renovacoes.module.css";
import { listarRenovacoes } from "@/lib/api-renovacoes";
import type { ItemListaRenovacao, ResultadoRenovacao, ListarRenovacoesResposta } from "@/lib/types-renovacoes";

const RESULTADO_LABEL: Record<ResultadoRenovacao, string> = {
  ok: "Concluídas",
  falha: "Não concluídas",
  parcial: "Parciais",
  cancel: "Canceladas",
  espera: "Aguardando pagamento",
};

const ORDEM_FILTROS: ResultadoRenovacao[] = ["ok", "falha", "parcial", "cancel", "espera"];

export default function RenovacoesListaPage() {
  const router = useRouter();
  const [pagina, setPagina] = useState(1);
  const [filtro, setFiltro] = useState<ResultadoRenovacao | null>(null);
  const [resp, setResp] = useState<ListarRenovacoesResposta | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const r = await listarRenovacoes(pagina, filtro ?? undefined);
      if (r.outcome !== "success") {
        setErro("Não foi possível carregar o histórico agora.");
        return;
      }
      setResp(r);
    } catch {
      setErro("Não foi possível carregar o histórico agora.");
    } finally {
      setCarregando(false);
    }
  }, [pagina, filtro]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  function selecionarFiltro(novo: ResultadoRenovacao | null) {
    setFiltro(novo);
    setPagina(1);
  }

  function abrir(item: ItemListaRenovacao) {
    const query = item.tipo === "avulsa" ? `token_id=${item.id}` : `grupo_id=${item.id}`;
    router.push(`/renovacoes/${item.id}?${query}`);
  }

  const totalPaginas = resp ? Math.max(1, Math.ceil(resp.total / 20)) : 1;

  return (
    <>
      <div className={styles.telaCabecalho}>
        <h1>Tentativas de renovação</h1>
        <p>
          Registro histórico do que já aconteceu — consultado sob demanda, não é acompanhamento ao vivo. Cada linha é
          uma tentativa já encerrada ou com um estado conhecido no momento da última atualização.
        </p>
      </div>

      <div className={styles.filtros}>
        <button
          className={`${styles.filtroPill} ${filtro === null ? styles.filtroPillAtivo : ""}`}
          onClick={() => selecionarFiltro(null)}
        >
          Todas <span className={styles.filtroPillN}>{resp?.totalGeral ?? ""}</span>
        </button>
        {ORDEM_FILTROS.map((r) => {
          const qtd = resp?.contagens?.[r] ?? 0;
          if (filtro !== r && qtd === 0) return null;
          return (
            <button
              key={r}
              className={`${styles.filtroPill} ${filtro === r ? styles.filtroPillAtivo : ""}`}
              onClick={() => selecionarFiltro(r)}
            >
              {RESULTADO_LABEL[r]} <span className={styles.filtroPillN}>{qtd}</span>
            </button>
          );
        })}
      </div>

      <div className={styles.listaShell}>
        <div className={styles.listaScroll}>
          <div className={styles.grade}>
            <div className={styles.gradeCab}>
              <div>Quando</div>
              <div>Cliente</div>
              <div>Servidor</div>
              <div>Acessos</div>
              <div>Valor</div>
              <div>Resultado</div>
              <div>Diagnóstico</div>
            </div>

            {carregando && (
              <div className={styles.linhaRenov} style={{ gridColumn: "1 / -1" }}>
                <div className={styles.estadoVazio} style={{ gridColumn: "1 / -1" }}>
                  Carregando...
                </div>
              </div>
            )}

            {!carregando && erro && (
              <div className={styles.estadoVazio} style={{ gridColumn: "1 / -1" }}>
                {erro}
              </div>
            )}

            {!carregando && !erro && resp && resp.itens.length === 0 && (
              <div className={styles.estadoVazio} style={{ gridColumn: "1 / -1" }}>
                Nenhuma tentativa encontrada{filtro ? " neste filtro" : ""}.
              </div>
            )}

            {!carregando &&
              !erro &&
              resp?.itens.map((item) => (
                <button key={`${item.tipo}-${item.id}`} className={styles.linhaRenov} onClick={() => abrir(item)}>
                  <div className={styles.colQuando}>
                    <span>{item.quandoFormatado.split(" às ")[0]}</span>
                    <span className={styles.colQuandoHora}>{item.quandoFormatado.split(" às ")[1]}</span>
                  </div>
                  <div className={styles.colCliente}>
                    <span className={styles.colClienteNome}>{item.clienteNome}</span>
                    <span className={styles.colClienteSub}>
                      {item.telefone}
                      {item.tipo === "lote" ? ` · lote de ${item.qtdAcessos}` : ""}
                    </span>
                  </div>
                  <div>
                    <span className={styles.chipServidor}>{item.servidor}</span>
                  </div>
                  <div className={styles.colAcessos}>{item.qtdAcessos}</div>
                  <div className={styles.colValor}>{item.valorFormatado}</div>
                  <div>
                    <span className={`${styles.badgeResultado} ${styles[item.resultado]}`}>
                      <span className={styles.ponto} />
                      <span>{RESULTADO_LABEL[item.resultado]}</span>
                    </span>
                  </div>
                  <div className={styles.colDiagnostico}>
                    {item.resultado === "ok" ? (
                      <span className={styles.diagOk}>✓ {item.diagnostico}</span>
                    ) : item.resultado === "falha" ? (
                      <span className={styles.diagFalha}>✕ {item.diagnostico}</span>
                    ) : (
                      item.diagnostico
                    )}
                  </div>
                </button>
              ))}
          </div>
        </div>
      </div>

      {!carregando && !erro && resp && resp.total > 20 && (
        <div className={styles.paginacao}>
          <button className={styles.paginacaoBtn} disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>
            ← Anterior
          </button>
          <span>
            Página {pagina} de {totalPaginas}
          </span>
          <button
            className={styles.paginacaoBtn}
            disabled={pagina >= totalPaginas}
            onClick={() => setPagina((p) => p + 1)}
          >
            Próxima →
          </button>
        </div>
      )}
    </>
  );
}
