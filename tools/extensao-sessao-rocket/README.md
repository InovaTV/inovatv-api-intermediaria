# Extensao Chrome — Sessao Rocket (etapa 1: deteccao)

Ferramenta **local e isolada**. Nao faz parte de nenhuma Edge Function,
do Painel, do fluxo de renovacao nem do app. Vive so' nesta pasta.

## O que esta etapa faz

Ao clicar no botao da extensao, ela verifica **localmente** se os dois
cookies de sessao do Rocket existem neste navegador:

- `sessionid`
- `csrftoken`

Ambos lidos **exclusivamente** do dominio `https://app.rocketgestor.com`
via `chrome.cookies`. Mostra apenas **se cada um foi encontrado ou
nao** — e, se algum faltar, **qual** (pelo nome).

## O que esta etapa **NAO** faz (limites deliberados)

- Nao le nenhum outro cookie, de nenhum outro dominio.
- Nao le, nao mostra e nao registra o **valor** de nenhum cookie.
- Nao guarda nada: sem `chrome.storage`, sem arquivo, sem banco.
- Nao envia nada para servidor nenhum (sem `fetch`, sem `XHR`).
- Nao faz login, nao automatiza, nao usa Playwright/CDP.
- Nao contem nenhum secret, token interno ou credencial.
- Nao integra (ainda) com `atualizar-sessao-rocket` — isso e' etapa
  posterior, aprovada separadamente.

## Estrutura

| Arquivo | Papel |
|---|---|
| `manifest.json` | MV3. `permissions: ["cookies"]` + `host_permissions` **so'** `https://app.rocketgestor.com/*`. Um popup, sem background, sem content script. |
| `lib.js` | Logica **pura** (`avaliarSessaoRocket`) — recebe so' presenca booleana por nome, devolve `{ completo, encontrados, faltando, mensagem }`. Sem `chrome.*`, sem I/O. |
| `popup.html` / `popup.js` | UI do popup. `popup.js` le a **presenca** (`!!cookie`) dos dois cookies e delega a `lib.js`. Nunca toca em `cookie.value`. |
| `testes/teste.mjs` | Testes da logica pura. Sem Chrome, sem rede, sem credenciais. |
| `package.json` | So' `type: module` + script `test`. Sem dependencias. |

## Instalar em modo desenvolvedor

1. Abra o Chrome em `chrome://extensions`.
2. Ligue **"Modo do desenvolvedor"** (canto superior direito).
3. Clique em **"Carregar sem compactacao"** ("Load unpacked").
4. Selecione a pasta `tools/extensao-sessao-rocket/` deste repositorio.
5. A extensao "InovaTV — Sessao Rocket (etapa 1: deteccao)" aparece na
   lista. Fixe-a na barra (icone de quebra-cabeca -> alfinete) se
   quiser acesso rapido.

Nao ha' passo de build — os arquivos sao carregados como estao.

## Usar

1. Faca login normalmente em `https://app.rocketgestor.com` (usuario,
   senha e Turnstile — sempre acao humana).
2. Clique no icone da extensao para abrir o popup.
3. Clique em **"Detectar cookies de sessao"**.
4. Resultado possivel:
   - **Verde** — "Sessao do Rocket detectada: sessionid e csrftoken
     estao presentes neste navegador."
   - **Amarelo** — "Sessao incompleta. Encontrado: `<nome>`. Faltando:
     `<nome>`." + lista dos que faltam.
   - **Vermelho** — "Nenhum cookie de sessao do Rocket encontrado.
     Faltando: sessionid, csrftoken." (normalmente = sem login) ou um
     erro de permissao.

Nenhum valor e' exibido em nenhum dos casos.

## Rodar os testes

```
node tools/extensao-sessao-rocket/testes/teste.mjs
# ou
npx tsx tools/extensao-sessao-rocket/testes/teste.mjs
```

Cobrem: os dois presentes; so' um presente (com o nome do que falta);
nenhum presente; entrada invalida/ausente; chaves desconhecidas
ignoradas; "value-blindness" (so' `=== true` conta como presente, um
"valor" na entrada nunca vaza para a saida); determinismo; e o escopo
das constantes (`COOKIES_ALVO`, `URL_ROCKET`).

## Proxima etapa (nao incluida aqui)

Enviar `sessionid`/`csrftoken` para `atualizar-sessao-rocket`
autenticando por Supabase Auth (sem secret embutido na extensao). So'
sera' feita com aprovacao propria — este README sera' atualizado
quando isso acontecer.
