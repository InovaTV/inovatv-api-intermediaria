// Shell do Painel de Monitoramento de Renovacoes (2026-09-14) -- rota
// nova e paralela a /conversas, NUNCA aninhada nela (aquele layout tem
// Realtime/contexto de scroll que nao fazem sentido aqui). AuthGuard
// reaproveitado sem edicao -- mesmo componente generico que /conversas
// e /unitv-token ja usam.
//
// Fonte Inter via next/font/google, escopada so' a esta subarvore
// (className no wrapper, nunca no <html>/<body> do layout raiz) --
// identica ao Portal de Renovacao, sem tocar em app/layout.tsx.
"use client";

import Link from "next/link";
import { Inter } from "next/font/google";
import AuthGuard from "@/components/AuthGuard";
import styles from "./renovacoes.module.css";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"] });

export default function RenovacoesLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <div className={`${styles.pagina} ${inter.className}`}>
        <header className={styles.topo}>
          <div className={`${styles.largura} ${styles.topoFaixa}`}>
            <div className={styles.topoMarca}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className={styles.topoLogo} src="/logo-topetv.jpg" alt="Tope TV" />
              <div className={styles.topoTitulo}>
                <strong>Tope TV · Painel Interno</strong>
                <span>Histórico e diagnóstico de tentativas de renovação</span>
              </div>
            </div>
            <nav className={styles.topoNav}>
              <span className={`${styles.navPill} ${styles.navPillAtivo}`}>Renovações</span>
              <Link
                href="/unitv-token"
                className={styles.navPill}
                title="Status e atualização do token UniTV"
              >
                🔑 Token UniTV
              </Link>
            </nav>
          </div>
        </header>

        <div className={styles.largura}>
          <main className={styles.conteudo}>{children}</main>
        </div>

        <footer className={styles.rodape}>
          Painel de Renovações — Tope TV · dados sanitizados, sem senha, token bruto, QR/BR Code ou credenciais
        </footer>
      </div>
    </AuthGuard>
  );
}
