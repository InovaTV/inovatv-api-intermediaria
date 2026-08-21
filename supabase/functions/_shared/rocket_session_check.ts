// Checagem de saude da sessao do Rocket -- SOMENTE LEITURA, nunca
// altera nenhum dado, nunca toca em cliente. Usa exatamente o mesmo
// endpoint e a mesma logica de deteccao ja validados manualmente
// nesta investigacao (GET /gerenciador/, redirect manual, marcador de
// tela de login como reforco).

export type ResultadoChecagemSessao =
  | { valida: true }
  | { valida: false }
  | { erroRede: true };

const DASHBOARD_URL = "https://app.rocketgestor.com/gerenciador/";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export async function verificarSessaoRocket(
  sessionid: string,
  csrftoken: string,
): Promise<ResultadoChecagemSessao> {
  const cookieHeader = `sessionid=${sessionid}; csrftoken=${csrftoken}`;

  let res: Response;
  try {
    res = await fetch(DASHBOARD_URL, {
      method: "GET",
      redirect: "manual",
      headers: {
        Cookie: cookieHeader,
        "User-Agent": USER_AGENT,
      },
    });
  } catch {
    // Falha de rede/timeout -- NUNCA conta como sessao invalida
    // (regra explicita do usuario).
    return { erroRede: true };
  }

  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get("location") ?? "";
    if (location.includes("/accounts/login/")) {
      return { valida: false };
    }
    // Redirect pra outro lugar que nao o login -- trata como valida
    // (nao e' o sinal inequivoco de sessao expirada que procuramos).
    return { valida: true };
  }

  if (res.status === 200) {
    const corpo = await res.text();
    const pareceTelaDeLogin =
      corpo.includes('id="login-form"') || corpo.includes('name="username"');
    return { valida: !pareceTelaDeLogin };
  }

  // Qualquer outro status inesperado -- trata como falha de rede
  // (nao e' evidencia inequivoca de sessao expirada), nao muda estado.
  return { erroRede: true };
}
