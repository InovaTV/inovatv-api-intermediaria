// Etapa 1 -- SO' deteccao local.
//
// Le exclusivamente os cookies sessionid e csrftoken de
// https://app.rocketgestor.com via chrome.cookies, converte cada um
// em um booleano de PRESENCA (nunca toca em cookie.value) e delega a
// decisao para a logica pura avaliarSessaoRocket() de lib.js.
//
// Nao armazena (chrome.storage / arquivo / DB), nao envia nada para
// servidor, nao mostra valores, nao faz login nem automacao.

import { avaliarSessaoRocket, COOKIES_ALVO, URL_ROCKET } from "./lib.js";

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
