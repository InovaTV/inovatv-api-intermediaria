// Etapa 2A -- deteccao local dos cookies (inalterada) + login do
// operador via Supabase Auth (preparacao da integracao).
//
// - Deteccao de cookies: EXATAMENTE como na etapa 1. So' presenca
//   (!!cookie), nunca cookie.value, nunca envio.
// - Auth: e-mail/senha -> Supabase Auth (auth.js). Sessao persistida
//   so' em chrome.storage.local. UI mostra so' o veredito
//   ("Operador autorizado" / "nao e' o operador" / "Nao autenticado"),
//   nunca o e-mail nem o token.
// - Envio para atualizar-sessao-rocket: botao DESABILITADO nesta
//   etapa; nenhuma leitura de sessionid/csrftoken para isso.

import { avaliarSessaoRocket, COOKIES_ALVO, URL_ROCKET, derivarEstadoAuth } from "./lib.js";
import { entrar, sair, sessaoValida } from "./auth.js";
import { OPERADOR_AUTORIZADO_EMAIL } from "./config.js";

// ===========================================================================
// Secao 1 -- deteccao local dos cookies (identica a etapa 1)
// ===========================================================================

const $resultado = document.getElementById("resultado");
const $botao = document.getElementById("detectar");

function render({ classe, texto, listaTitulo, lista }) {
  $resultado.textContent = "";

  const p = document.createElement("p");
  p.className = classe;
  p.textContent = texto;
  $resultado.appendChild(p);

  if (lista && lista.length) {
    const titulo = document.createElement("div");
    titulo.textContent = listaTitulo;
    $resultado.appendChild(titulo);

    const ul = document.createElement("ul");
    for (const nome of lista) {
      const li = document.createElement("li");
      li.textContent = nome; // so' o NOME do cookie, nunca o valor
      ul.appendChild(li);
    }
    $resultado.appendChild(ul);
  }
}

async function lerPresenca() {
  // chrome.cookies.get devolve o objeto Cookie ou null. Usamos apenas
  // !!cookie -- cookie.value NUNCA e' lido. O `url` limita a leitura ao
  // dominio do Rocket; `name` limita a exatamente os dois cookies alvo.
  const presenca = {};
  for (const nome of COOKIES_ALVO) {
    const cookie = await chrome.cookies.get({ url: URL_ROCKET, name: nome });
    presenca[nome] = !!cookie;
  }
  return presenca;
}

$botao.addEventListener("click", async () => {
  $botao.disabled = true;
  try {
    const presenca = await lerPresenca();
    const r = avaliarSessaoRocket(presenca);

    if (r.completo) {
      render({ classe: "ok", texto: r.mensagem });
    } else {
      render({
        classe: r.encontrados.length ? "faltando" : "erro",
        texto: r.mensagem,
        listaTitulo: "Cookie(s) faltando:",
        lista: r.faltando,
      });
    }
  } catch {
    render({
      classe: "erro",
      texto:
        "Nao foi possivel ler os cookies. Confirme que a extensao tem " +
        "permissao para app.rocketgestor.com e tente de novo.",
    });
  } finally {
    $botao.disabled = false;
  }
});

// ===========================================================================
// Secao 2 -- login do operador via Supabase Auth (etapa 2A)
// ===========================================================================

const $authLogin = document.getElementById("auth-login");
const $authLogado = document.getElementById("auth-logado");
const $authEmail = document.getElementById("auth-email");
const $authSenha = document.getElementById("auth-senha");
const $authEntrar = document.getElementById("auth-entrar");
const $authSair = document.getElementById("auth-sair");
const $authVeredito = document.getElementById("auth-verdito");
const $authMsg = document.getElementById("auth-msg");
const $enviarRocket = document.getElementById("enviar-rocket");

const MOTIVO_LOGIN = {
  credenciais_invalidas: "E-mail ou senha invalidos.",
  servidor: "Servico de autenticacao indisponivel. Tente de novo.",
  rede: "Sem conexao com o servico de autenticacao.",
  resposta_invalida: "Resposta inesperada do servico de autenticacao.",
};

async function renderAuth() {
  // sessaoValida() ja' faz a renovacao automatica se o token expirou.
  const sessao = await sessaoValida();
  const estado = derivarEstadoAuth({ sessao }, OPERADOR_AUTORIZADO_EMAIL);

  $authLogin.hidden = estado.tela !== "login";
  $authLogado.hidden = estado.tela === "login";
  $authVeredito.textContent = estado.rotulo; // so' o veredito, nunca o e-mail
  $authVeredito.className =
    estado.tela === "operador" ? "ok" : estado.tela === "nao_operador" ? "faltando" : "";

  // Etapa 2A: o envio fica sempre desabilitado (derivarEstadoAuth
  // garante envioRocketHabilitado === false, inclusive para o operador).
  $enviarRocket.disabled = !estado.envioRocketHabilitado;
}

$authEntrar.addEventListener("click", async () => {
  $authMsg.textContent = "";
  $authEntrar.disabled = true;
  try {
    const r = await entrar($authEmail.value.trim(), $authSenha.value);
    $authSenha.value = "";
    if (r.ok) {
      $authEmail.value = "";
      await renderAuth();
    } else {
      $authMsg.textContent = MOTIVO_LOGIN[r.motivo] || "Nao foi possivel entrar.";
    }
  } catch {
    $authMsg.textContent = "Nao foi possivel entrar.";
  } finally {
    $authEntrar.disabled = false;
  }
});

$authSair.addEventListener("click", async () => {
  $authSair.disabled = true;
  try {
    await sair();
    $authMsg.textContent = "";
    await renderAuth();
  } finally {
    $authSair.disabled = false;
  }
});

// O botao ja' nasce disabled no HTML. Este listener existe so' para o
// caso improvavel de ser habilitado -- e mesmo assim NAO envia nada na
// etapa 2A.
$enviarRocket.addEventListener("click", () => {
  $authMsg.textContent =
    "Envio desabilitado nesta etapa (2A). Sera' habilitado na etapa de integracao.";
});

renderAuth();
