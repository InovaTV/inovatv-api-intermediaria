// Autenticacao do operador via Supabase Auth (GoTrue), com fetch cru
// contra a REST API publica /auth/v1/*.
//
// POR QUE SEM @supabase/supabase-js (ver README, "Decisao de
// dependencia"): em MV3 a lib exigiria bundler + bundle commitado +
// adaptador de storage proprio (a lib usa localStorage) + desligar o
// auto-refresh dela (o timer morre quando o popup fecha) -- mais
// superficie para as mesmas ~4 chamadas REST.
//
// FRONTEIRAS:
// - Nenhum secret. So' a anon key PUBLICA (config.js).
// - A sessao do operador (access_token + refresh_token + email + exp)
//   e' persistida SO' em chrome.storage.local, para permitir renovacao
//   automatica na proxima abertura do popup.
// - sessionid/csrftoken do Rocket NUNCA passam por aqui.
// - So' fala com {SUPABASE_URL}/auth/v1/* -- nunca com a Edge Function
//   nesta etapa.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const CHAVE_STORAGE = "sessao_supabase";
const MARGEM_RENOVACAO_S = 60; // renova se faltar <= 60s pro expires_at
const BASE_AUTH = `${SUPABASE_URL}/auth/v1`;

function headersBase() {
  return { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" };
}

function agoraEpochS() {
  return Math.floor(Date.now() / 1000);
}

// So' os campos que guardamos -- descarta o resto da resposta do GoTrue
// (user metadata, etc.). Nunca guarda senha.
function normalizarSessao(json) {
  const expiresAt =
    typeof json.expires_at === "number"
      ? json.expires_at
      : agoraEpochS() + (Number(json.expires_in) || 0);
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_at: expiresAt,
    email: (json && json.user && typeof json.user.email === "string")
      ? json.user.email
      : null,
  };
}

async function gravarSessao(sessao) {
  await chrome.storage.local.set({ [CHAVE_STORAGE]: sessao });
}

async function limparSessao() {
  await chrome.storage.local.remove(CHAVE_STORAGE);
}

export async function lerSessao() {
  const r = await chrome.storage.local.get(CHAVE_STORAGE);
  return (r && r[CHAVE_STORAGE]) || null;
}

/**
 * Login por e-mail + senha. Em sucesso, persiste a sessao.
 * NAO retorna nem loga o token. Nao vaza a mensagem de erro do GoTrue.
 * @returns {{ ok: true, email: string|null } | { ok: false, motivo: string }}
 */
export async function entrar(email, senha) {
  let res;
  try {
    res = await fetch(`${BASE_AUTH}/token?grant_type=password`, {
      method: "POST",
      headers: headersBase(),
      body: JSON.stringify({ email, password: senha }),
    });
  } catch {
    return { ok: false, motivo: "rede" };
  }

  if (!res.ok) {
    return {
      ok: false,
      motivo: res.status === 400 ? "credenciais_invalidas" : "servidor",
    };
  }

  const json = await res.json().catch(() => null);
  if (!json || !json.access_token) return { ok: false, motivo: "resposta_invalida" };

  const sessao = normalizarSessao(json);
  await gravarSessao(sessao);
  return { ok: true, email: sessao.email };
}

/**
 * Troca o refresh_token por um par novo. Se o refresh for
 * invalido/revogado, LIMPA a sessao local. Se for falha de rede,
 * mantem a sessao (para tentar de novo depois).
 * @returns {object|null} a sessao renovada, ou null.
 */
export async function renovar() {
  const sessao = await lerSessao();
  if (!sessao || !sessao.refresh_token) {
    await limparSessao();
    return null;
  }

  let res;
  try {
    res = await fetch(`${BASE_AUTH}/token?grant_type=refresh_token`, {
      method: "POST",
      headers: headersBase(),
      body: JSON.stringify({ refresh_token: sessao.refresh_token }),
    });
  } catch {
    return null; // rede: nao limpa -- tenta de novo na proxima abertura
  }

  if (!res.ok) {
    await limparSessao(); // refresh_token invalido/revogado
    return null;
  }

  const json = await res.json().catch(() => null);
  if (!json || !json.access_token) {
    await limparSessao();
    return null;
  }

  const nova = normalizarSessao(json);
  await gravarSessao(nova);
  return nova;
}

/**
 * Sessao utilizavel agora -- renovacao automatica embutida:
 *   - sem sessao          -> null
 *   - token ainda fresco  -> a sessao (sem tocar a rede)
 *   - token expirando     -> tenta renovar()
 *   - renovar() falhou por rede -> devolve a sessao (stale) que ainda
 *                                  esta' no storage
 *   - renovar() invalidou -> null
 * @returns {object|null}
 */
export async function sessaoValida() {
  const sessao = await lerSessao();
  if (!sessao || !sessao.access_token) return null;

  if (agoraEpochS() < sessao.expires_at - MARGEM_RENOVACAO_S) return sessao;

  const renovada = await renovar();
  if (renovada) return renovada;
  return await lerSessao(); // null se renovar() limpou; stale se foi rede
}

/**
 * Logout: revoga no servidor (best-effort) e SEMPRE limpa o storage.
 * @returns {{ ok: true }}
 */
export async function sair() {
  const sessao = await lerSessao();
  if (sessao && sessao.access_token) {
    try {
      await fetch(`${BASE_AUTH}/logout`, {
        method: "POST",
        headers: {
          ...headersBase(),
          Authorization: `Bearer ${sessao.access_token}`,
        },
      });
    } catch {
      // best-effort -- limpa localmente de qualquer jeito
    }
  }
  await limparSessao();
  return { ok: true };
}
