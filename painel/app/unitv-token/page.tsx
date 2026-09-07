// Tela "Token UniTV" (decisao aprovada 2026-09-07, inovatv_central/
// CLAUDE.md "Frente -- Fluxo de Renovacao Automatica"). Uso interno da
// equipe InovaTV.
//
// UNITV_DEALER_TOKEN e' a sessao do painel de revenda que as renovacoes
// UniTV usam. Ela morre de tempos em tempos (returnCode 300, sem
// refresh). Esta tela mostra o status persistente e deixa o operador
// COLAR uma nova captura -- que so' e' gravada se validar contra o
// painel antes e depois.
//
// NAO faz login/CAPTCHA/autocura -- so' o caminho manual (SOP §15 do
// doc da autocura), movido do SQL Editor para ca'. O valor do token
// NUNCA vem do servidor (as respostas so' tem status/metadados); o que
// o operador digita e' limpo do campo assim que a atualizacao da certo.
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AuthGuard from "@/components/AuthGuard";
import {
  tokenUnitvAtualizar,
  tokenUnitvStatus,
  tokenUnitvValidar,
  type TokenUnitvStatusResposta,
} from "@/lib/api";

const FUSO = "America/Sao_Paulo";
const SHAPE = /^[0-9a-fA-F]{32}$/;

function fmtData(iso?: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: FUSO,
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(iso));
}

// Capturador canônico do dealer_token do painel de revenda UniTV.
//
// MÉTODO (definido pela investigação já feita — ver
// docs/unitv/UNITV_RENOVACAO_INVESTIGACAO.md §1/§2 e
// UNITV_RENOVACAO_TESTE_REAL.md §7): interceptor PASSIVO de fetch/XHR que
// observa o POST /api/account da consulta "Consultar", decifra o CORPO da
// requisição (AES-128-CBC, chave/IV fixos do bundle do painel, os mesmos
// de supabase/functions/_shared/unitv_conta.ts) e lê o campo
// `dealer_token`. É o valor que a nossa automação de fato usa (corpo da
// requisição), e é imune à divergência registrada sobre o formato dos
// headers do painel (header ora traz o mesmo 32-hex, ora um valor de 34
// chars separado).
//
// SEGURANÇA: só observa, nunca altera requisições; nenhuma rede própria;
// nenhum localStorage; restaura fetch/XHR ao terminar; só mostra o valor
// no Console (e copia p/ a área de transferência) para o operador colar.
// Não guarda o token em lugar nenhum.
const SNIPPET_CAPTURA = `/* Capturador do dealer_token UniTV -- InovaTV. Passivo: so' observa
   POST /api/account, decifra o corpo AES (chave/IV fixos do painel) e
   mostra o dealer_token. Nao altera requisicoes, nao faz rede propria,
   nao usa localStorage, restaura fetch/XHR ao terminar. */
(async () => {
  const KEY = "93403d3aa2ec48b4", IV = "7cf0127d190cb909";
  const enc = new TextEncoder(), dec = new TextDecoder();
  const RE_HEX = /^[0-9a-fA-F]{32,}$/;
  const RE_TOKEN = /^[0-9a-f]{32}$/i;
  const key = await crypto.subtle.importKey("raw", enc.encode(KEY), { name: "AES-CBC" }, false, ["decrypt"]);
  const hexToBytes = (h) => { h = h.trim(); const o = new Uint8Array(h.length / 2); for (let i = 0; i < o.length; i++) o[i] = parseInt(h.substr(i * 2, 2), 16); return o; };

  async function acharToken(body) {
    if (typeof body !== "string" || !RE_HEX.test(body.trim())) return null;
    try {
      const pt = await crypto.subtle.decrypt({ name: "AES-CBC", iv: enc.encode(IV) }, key, hexToBytes(body));
      const obj = JSON.parse(dec.decode(pt));
      return obj && typeof obj.dealer_token === "string" ? obj.dealer_token.trim() : null;
    } catch (e) { return null; }
  }

  const origFetch = window.fetch;
  const XHR = XMLHttpRequest.prototype;
  const origOpen = XHR.open, origSend = XHR.send;
  let pronto = false;
  function restaurar() { window.fetch = origFetch; XHR.open = origOpen; XHR.send = origSend; }
  function mostrar(t) {
    if (pronto) return;
    pronto = true; restaurar();
    if (RE_TOKEN.test(t)) {
      t = t.toLowerCase();
      console.log("%c  dealer_token capturado  ", "background:#1f5c37;color:#fff;font-weight:bold;padding:3px 8px;border-radius:3px");
      console.log("%c" + t, "font-size:18px;font-family:monospace;color:#6ee7a0;letter-spacing:1px");
      try { copy(t); console.log('Copiado para a area de transferencia. Cole em "Novo token" no Painel InovaTV.'); }
      catch (e) { console.log("Selecione o valor acima e copie (Ctrl+C)."); }
    } else {
      console.warn("Peguei um POST /api/account mas sem dealer_token de 32 hex. Rode o capturador de novo e clique em Consultar.");
    }
  }

  window.fetch = function (input, init) {
    try {
      const url = typeof input === "string" ? input : (input && input.url) || "";
      if (/\\/api\\/account(\\?|$)/.test(url)) {
        const body = init && init.body;
        if (typeof body === "string") acharToken(body).then((t) => { if (t) mostrar(t); });
        else if (input instanceof Request) input.clone().text().then(acharToken).then((t) => { if (t) mostrar(t); }).catch(() => {});
      }
    } catch (e) {}
    return origFetch.apply(this, arguments);
  };
  XHR.open = function (m, u) { this.__u = u; return origOpen.apply(this, arguments); };
  XHR.send = function (body) {
    try {
      if (this.__u && /\\/api\\/account(\\?|$)/.test(this.__u) && typeof body === "string") {
        acharToken(body).then((t) => { if (t) mostrar(t); });
      }
    } catch (e) {}
    return origSend.apply(this, arguments);
  };

  console.log("%c Capturador armado ", "background:#3a6fd8;color:#fff;padding:3px 8px;border-radius:3px");
  console.log('Agora clique em "Consultar" no painel UniTV (qualquer busca serve).');
  setTimeout(() => { if (!pronto) { restaurar(); console.warn("Nenhuma chamada /api/account em 2 min. Recarregue a pagina e rode o capturador de novo."); } }, 120000);
})();`;

type MsgAcao = { tipo: "ok" | "erro" | "critico"; texto: string } | null;

function TokenUnitvConteudo() {
  const [status, setStatus] = useState<TokenUnitvStatusResposta | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erroStatus, setErroStatus] = useState<string | null>(null);
  const [validando, setValidando] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [atualizando, setAtualizando] = useState(false);
  const [msg, setMsg] = useState<MsgAcao>(null);
  const [copiadoSnippet, setCopiadoSnippet] = useState(false);

  async function copiarSnippet() {
    try {
      await navigator.clipboard.writeText(SNIPPET_CAPTURA);
      setCopiadoSnippet(true);
      setTimeout(() => setCopiadoSnippet(false), 2500);
    } catch {
      // clipboard indisponível: o operador seleciona o texto do bloco
      setCopiadoSnippet(false);
    }
  }

  const carregar = useCallback(async () => {
    setErroStatus(null);
    try {
      setStatus(await tokenUnitvStatus());
    } catch {
      setErroStatus("Não foi possível carregar o status agora.");
    }
  }, []);

  useEffect(() => {
    carregar().finally(() => setCarregando(false));
  }, [carregar]);

  async function validarAgora() {
    setValidando(true);
    setMsg(null);
    try {
      await tokenUnitvValidar();
      await carregar();
    } catch {
      setErroStatus("Falha ao validar agora. Tente novamente em instantes.");
    } finally {
      setValidando(false);
    }
  }

  async function atualizar() {
    const t = tokenInput.trim();
    if (!SHAPE.test(t)) {
      setMsg({
        tipo: "erro",
        texto:
          "O token precisa ter exatamente 32 caracteres hexadecimais (0-9, a-f). " +
          "O token atual NÃO foi alterado.",
      });
      return;
    }
    if (
      !window.confirm(
        "Confirmar atualização do token UniTV?\n\nO sistema valida o token no " +
          "painel de revenda ANTES de gravar. Se falhar, o token atual não é alterado.",
      )
    ) {
      return;
    }
    setAtualizando(true);
    setMsg(null);
    try {
      const r = await tokenUnitvAtualizar(t);
      if (r.outcome === "sucesso") {
        setMsg({
          tipo: "ok",
          texto:
            "Token atualizado e validado com sucesso. Renovações UniTV restabelecidas.",
        });
        setTokenInput("");
      } else if (r.outcome === "formato_invalido") {
        setMsg({
          tipo: "erro",
          texto:
            "Formato inválido (precisa ser 32 caracteres hexadecimais). O token atual NÃO foi alterado.",
        });
      } else if (r.outcome === "token_novo_invalido") {
        const cod = r.origem_return_code ? `, código ${r.origem_return_code}` : "";
        setMsg({
          tipo: "erro",
          texto:
            `O token informado não autenticou no painel de revenda (${r.classe}${cod}). ` +
            "Confira a captura e tente de novo. O token atual NÃO foi alterado.",
        });
      } else if (r.outcome === "erro_gravar") {
        setMsg({
          tipo: "erro",
          texto:
            "Falha ao gravar no Vault. Clique em “Validar agora” para conferir o estado antes de tentar de novo.",
        });
      } else if (r.outcome === "revalidacao_falhou") {
        setMsg({
          tipo: "critico",
          texto:
            `CRÍTICO: a gravação ocorreu mas a revalidação falhou (${r.motivo}). ` +
            "Faça uma NOVA captura e atualize de novo com urgência — as renovações UniTV podem estar indisponíveis.",
        });
      } else {
        setMsg({ tipo: "erro", texto: "Resultado inesperado. Confira o status acima." });
      }
      await carregar();
    } catch {
      setMsg({
        tipo: "erro",
        texto:
          "Falha de comunicação ao atualizar. O token atual provavelmente não foi alterado — confira o status.",
      });
      await carregar();
    } finally {
      setAtualizando(false);
    }
  }

  const badge = status?.resumo.badge ?? "sem_dado";
  const tokenValido = SHAPE.test(tokenInput.trim());

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "24px 16px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 20,
        }}
      >
        <h1 style={{ fontSize: 22, margin: 0 }}>Token UniTV</h1>
        <Link
          href="/conversas"
          style={{
            border: "1px solid #2a2e38",
            color: "#8a8f9a",
            borderRadius: 6,
            padding: "6px 12px",
            textDecoration: "none",
          }}
        >
          ← Conversas
        </Link>
      </div>

      {carregando && <p>Carregando...</p>}
      {erroStatus && <p className="token-msg-erro">{erroStatus}</p>}

      {!carregando && status && (
        <>
          <section className="token-secao">
            <span className={`token-badge token-badge-${badge}`}>
              {status.resumo.titulo}
            </span>
            <p style={{ color: "#b6bac2", marginTop: 12, marginBottom: 0 }}>
              {status.resumo.detalhe}
            </p>

            <dl className="token-meta">
              <dt>Última validação</dt>
              <dd>
                {fmtData(status.ultimaValidacao?.criado_em)}
                {status.ultimaValidacao && (
                  <span className="token-meta-sub">
                    {" "}
                    · {status.ultimaValidacao.veredito}
                    {" "}({status.ultimaValidacao.motivo_origem}
                    {status.ultimaValidacao.origem_return_code
                      ? `, código ${status.ultimaValidacao.origem_return_code}`
                      : ""}
                    )
                  </span>
                )}
              </dd>

              <dt>Última atualização manual</dt>
              <dd>
                {fmtData(status.ultimaAtualizacaoManual?.atualizado_em)}
                {status.ultimaAtualizacaoManual && (
                  <span className="token-meta-sub">
                    {" "}
                    · por {status.ultimaAtualizacaoManual.atualizado_por ?? "—"} (
                    {status.ultimaAtualizacaoManual.origem})
                  </span>
                )}
              </dd>
            </dl>

            <button
              onClick={validarAgora}
              disabled={validando}
              className="token-btn"
              style={{ marginTop: 8 }}
            >
              {validando ? "Validando..." : "Validar agora"}
            </button>
          </section>

          <section className="token-secao">
            <h2 style={{ fontSize: 16, marginTop: 0 }}>Atualizar token</h2>
            <p style={{ color: "#8a8f9a", marginTop: 0 }}>
              Cole a captura mais recente do <code>dealer_token</code> (32
              caracteres hexadecimais). O token é validado no painel de revenda
              antes de ser gravado; se a validação falhar, o token atual não é
              alterado.
            </p>
            <label
              htmlFor="token-unitv"
              style={{ display: "block", fontSize: 13, color: "#8a8f9a", marginBottom: 6 }}
            >
              Novo token
            </label>
            <input
              id="token-unitv"
              className="token-campo"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder="ex.: 0123456789abcdef0123456789abcdef"
            />
            <div style={{ fontSize: 12, color: "#8a8f9a", marginTop: 6 }}>
              {tokenInput.trim().length}/32{" "}
              {tokenInput.trim().length > 0 && !tokenValido && "— formato inválido"}
            </div>

            <button
              onClick={atualizar}
              disabled={atualizando || !tokenValido}
              className="token-btn token-btn-primario"
              style={{ marginTop: 12 }}
            >
              {atualizando ? "Validando e gravando..." : "Atualizar token"}
            </button>

            {msg && (
              <p
                className={
                  msg.tipo === "ok"
                    ? "token-msg-ok"
                    : msg.tipo === "critico"
                    ? "token-msg-critico"
                    : "token-msg-erro"
                }
                style={{ marginTop: 14 }}
              >
                {msg.texto}
              </p>
            )}
          </section>

          <section className="token-secao">
            <h2 style={{ fontSize: 16, marginTop: 0 }}>
              Como capturar um token novo (procedimento completo)
            </h2>
            <p style={{ color: "#8a8f9a", marginTop: 0 }}>
              O token da sessão do painel de revenda não tem tela de API key nem
              endpoint de renovação. A forma de obtê-lo é observar uma requisição
              da própria página e ler o campo <code>dealer_token</code>. O
              capturador abaixo faz isso de forma <strong>passiva</strong> (só
              observa, não altera nada) e mostra o valor no Console para você
              copiar.
            </p>

            <ol className="token-passos">
              <li>
                Abra o painel de revenda <code>panel-web.revenda.site</code> e
                faça login com o dealer <code>inovatvstream2</code>.
              </li>
              <li>
                Faça uma consulta <strong>&quot;Consultar&quot;</strong> (qualquer
                busca de conta) — <strong>somente leitura</strong>. Não abra
                &quot;Renovar&quot;, não altere nada.
              </li>
              <li>
                Abra o DevTools: <strong>F12 → aba Console</strong>.
              </li>
              <li>
                Copie o <strong>código de captura</strong> abaixo (botão
                &quot;Copiar código de captura&quot;), cole no Console e pressione
                Enter. Ele responde <em>&quot;Capturador armado&quot;</em>.
              </li>
              <li>
                Clique em <strong>&quot;Consultar&quot;</strong> de novo no painel.
                O Console imprime o <code>dealer_token</code> — uma sequência de{" "}
                <strong>32 caracteres hexadecimais</strong> (0-9, a-f).
              </li>
              <li>
                Copie esse valor (o capturador já tenta copiá-lo para a área de
                transferência automaticamente).
              </li>
              <li>Volte para esta tela do Painel InovaTV.</li>
              <li>
                Cole o valor no campo <strong>&quot;Novo token&quot;</strong>{" "}
                (seção acima).
              </li>
              <li>
                Clique em <strong>&quot;Atualizar token&quot;</strong>.
              </li>
              <li>
                Aguarde a validação. Ao concluir, o status no topo fica{" "}
                <strong>🟢 Token válido</strong> e as renovações UniTV voltam a
                funcionar.
              </li>
            </ol>

            <details className="token-detalhes">
              <summary>Código de captura (para colar no Console do painel UniTV)</summary>
              <button
                onClick={copiarSnippet}
                className="token-btn"
                style={{ marginTop: 10 }}
              >
                {copiadoSnippet ? "Copiado ✓" : "Copiar código de captura"}
              </button>
              <pre className="token-code">{SNIPPET_CAPTURA}</pre>
              <p style={{ color: "#8a8f9a", fontSize: 12, marginBottom: 0 }}>
                O código só observa a requisição <code>POST /api/account</code>,
                decifra o corpo e imprime o <code>dealer_token</code>. Não altera
                requisições, não faz chamadas de rede próprias, não usa
                armazenamento, e restaura <code>fetch</code>/<code>XHR</code> ao
                terminar. Nada do token fica gravado — só é exibido para você
                copiar.
              </p>
            </details>

            <div className="token-aviso">
              <strong>Avisos</strong>
              <ul>
                <li>
                  Durante a captura, <strong>não faça renovação</strong> nem
                  qualquer alteração no painel UniTV — só a consulta
                  &quot;Consultar&quot;.
                </li>
                <li>
                  <strong>Nunca</strong> envie o token por WhatsApp, e-mail ou
                  chat. Ele vai só no campo &quot;Novo token&quot; desta tela.
                </li>
                <li>
                  Se o campo do Console não mostrar um valor de 32 hex, recarregue
                  a página do painel e repita a partir do passo 4.
                </li>
              </ul>
            </div>
          </section>

          <section className="token-secao">
            <h2 style={{ fontSize: 16, marginTop: 0 }}>O que acontece depois</h2>
            <p style={{ color: "#b6bac2", marginTop: 0, lineHeight: 1.7 }}>
              Ao clicar em <strong>&quot;Atualizar token&quot;</strong>, o sistema,
              nesta ordem:
            </p>
            <ol className="token-passos">
              <li>Confere o formato (32 caracteres hexadecimais).</li>
              <li>
                <strong>Valida o token no painel de revenda</strong> com uma
                consulta somente-leitura (<code>/api/account</code>). Se não
                autenticar, <strong>o token atual não é alterado</strong> e você
                recebe um aviso.
              </li>
              <li>
                Só então <strong>grava no Vault</strong> (<code>origem =
                recaptura_manual</code>, com o seu e-mail). O Edge Secret{" "}
                <code>UNITV_DEALER_TOKEN</code> não é tocado.
              </li>
              <li>
                <strong>Relê do Vault e revalida</strong> no painel. Se essa
                revalidação falhar, você recebe um aviso crítico para refazer a
                captura.
              </li>
            </ol>
            <p style={{ color: "#8a8f9a", fontSize: 13, marginBottom: 0 }}>
              A partir daí, <code>renovacao-unitv-conta</code> (Edge) e o runner de
              renovação (GitHub Actions) passam a ler o novo token do Vault em até
              ~30&nbsp;s / na próxima execução. O valor colado nunca é exibido de
              volta, nunca vai para logs, nunca é armazenado nesta tela, na URL ou
              no navegador.
            </p>
          </section>
        </>
      )}
    </div>
  );
}

export default function TokenUnitvPage() {
  return (
    <AuthGuard>
      <TokenUnitvConteudo />
    </AuthGuard>
  );
}
