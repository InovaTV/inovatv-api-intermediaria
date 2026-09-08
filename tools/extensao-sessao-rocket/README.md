# Extensao Chrome — Sessao Rocket

Ferramenta **local e isolada** (`tools/extensao-sessao-rocket/`). Nao
faz parte de nenhuma Edge Function, do Painel, do fluxo de renovacao
nem do app.

## Etapas

| Etapa | O que entrega | Estado |
|---|---|---|
| **1** | Deteccao local dos cookies `sessionid` / `csrftoken` do Rocket | pronta |
| **2A** | Login do operador via Supabase Auth (anon key **publica**) + **preparacao** da chamada a `atualizar-sessao-rocket`, **desabilitada** | pronta (esta versao) |
| 2B / integracao | Habilitar o envio de `sessionid`/`csrftoken` para `atualizar-sessao-rocket` autenticando por Supabase Auth | **nao feita** |

## O que a etapa 2A faz

1. **Deteccao dos cookies** — igual a etapa 1. Le via `chrome.cookies`
   **apenas** `sessionid` e `csrftoken` de `https://app.rocketgestor.com`,
   converte cada um em booleano de presenca (`!!cookie`) e mostra so'
   **se cada um foi encontrado** — e, se faltar, **qual** (pelo nome).
   Nunca le/mostra/registra o **valor**.
2. **Login do operador (Supabase Auth)** — e-mail + senha ->
   `POST {SUPABASE_URL}/auth/v1/token`. Em sucesso, a sessao
   (`access_token` + `refresh_token` + `expires_at` + `email`) e'
   guardada **so' em `chrome.storage.local`**, para **renovar sozinha**
   na proxima abertura do popup (`sessaoValida()` troca o
   `refresh_token` por um par novo quando o token esta perto de
   expirar). Tem **logout** (revoga no servidor + limpa o storage).
3. **Veredito do operador** — a UI mostra apenas `Operador autorizado`
   / `Autenticado, mas NAO e' o operador autorizado` / `Nao autenticado`.
   **Nunca** exibe e-mail nem token. O `OPERADOR_AUTORIZADO_EMAIL` em
   `config.js` e' so' um identificador para antecipar esse veredito na
   tela; a checagem **definitiva** de autorizacao continua no servidor
   (`PAINEL_EMAIL_AUTORIZADO`, dentro de `atualizar-sessao-rocket`).
4. **Preparacao da integracao** — `integracao.js` expõe
   `descreverChamadaAtualizarSessao()` (so' um descritor textual) e
   `enviarSessaoParaRocket()` (trava dura: `INTEGRACAO_HABILITADA`
   e' `false`, retorna `{ enviado:false, motivo:'integracao_desabilitada_etapa_2a' }`
   **sem ler cookies e sem `fetch`**). O botao "Enviar" nasce
   `disabled`.

## O que a etapa 2A **NAO** faz (limites deliberados)

- Nao inclui nenhum **secret privado**. `config.js` tem so' a
  **anon key publica** (role `anon` — a mesma do bundle do Painel), a
  URL publica do projeto e um e-mail identificador.
- Nao contem `SESSAO_ROCKET_UPDATE_TOKEN` nem `service_role`.
- Nao envia `sessionid` nem `csrftoken` para a Edge Function (nem para
  lugar nenhum) — a deteccao segue 100% local.
- Nao le outro cookie, de nenhum outro dominio.
- Nao altera nenhuma Edge Function, Vault, secret, migration nem o
  fluxo de renovacao.
- Sem Playwright/CDP/automacao. O login/Turnstile do **Rocket**
  continua sendo acao humana no proprio site — a extensao so' *le* o
  cookie resultante.

## Decisao de dependencia — por que **sem** `@supabase/supabase-js`

Auth via `fetch` cru contra `/auth/v1/*` (o que `auth.js` faz) e' mais
**simples e seguro** em MV3 do que a lib:

| | `fetch` cru (adotado) | `@supabase/supabase-js` |
|---|---|---|
| Build | nenhum — `load unpacked` como esta' | precisa bundler (esbuild/rollup) + bundle commitado ou `node_modules` |
| Storage | `chrome.storage.local` direto (idiomatico MV3) | a lib usa `localStorage`; precisaria de um adaptador custom |
| Auto-refresh | feito na abertura do popup (`sessaoValida()`) | o timer interno da lib morre quando o popup fecha — teria que ser substituido de qualquer jeito |
| Superficie / supply chain | 1 arquivo, 0 dependencia | +arvore de deps (`auth-js`, `postgrest-js`, `realtime-js`, `functions-js`, `ws`...) |
| O que a etapa precisa | 4 chamadas REST (`token` x2, `logout`, e decodificar o `email`) | idem — o valor agregado da lib nao se aplica aqui |

Se uma etapa futura precisar de Realtime/PostgREST/Storage do Supabase
na extensao, ai' vale reavaliar — e sera' discutido antes de adicionar.

## CORS / permissoes

- `host_permissions` continua **so'** `https://app.rocketgestor.com/*`
  (deteccao de cookie). O `fetch` para `/auth/v1/*` funciona sem
  declarar o host do Supabase porque o GoTrue responde
  `Access-Control-Allow-Origin: *` para os endpoints de auth
  (verificado).
- `permissions`: `["cookies", "storage"]` — `storage` e' novo na 2A,
  para o `chrome.storage.local` da sessao.
- **A etapa de integracao** vai precisar adicionar
  `https://nduxsuxkopuvhwugdkqi.supabase.co/*` a `host_permissions`,
  porque `atualizar-sessao-rocket` responde CORS fixo para o dominio do
  Painel (nao `*`). Isso sera' feito naquela etapa, nao aqui.

## Estrutura

| Arquivo | Papel |
|---|---|
| `manifest.json` | MV3. `permissions: ["cookies","storage"]`; `host_permissions` **so'** Rocket. Um popup, sem background, sem content script. |
| `config.js` | Constantes **publicas**: `SUPABASE_URL`, `SUPABASE_ANON_KEY` (role `anon`), `OPERADOR_AUTORIZADO_EMAIL`, `INTEGRACAO_HABILITADA = false`. **Nenhum secret.** |
| `lib.js` | Logica **pura** (sem `chrome.*`, sem rede): `avaliarSessaoRocket` (etapa 1) + `tokenExpirado` / `avaliarOperador` / `derivarEstadoAuth` (etapa 2A). Nunca retorna e-mail nem valor de cookie. |
| `auth.js` | Cliente GoTrue por `fetch` cru + persistencia em `chrome.storage.local`: `entrar`, `sair`, `renovar`, `sessaoValida`, `lerSessao`. |
| `integracao.js` | Preparacao **desabilitada** da chamada a `atualizar-sessao-rocket`. |
| `popup.html` / `popup.js` | UI. `popup.js` mantem o bloco de deteccao de cookie **identico** a etapa 1 e adiciona a secao de login. |
| `testes/teste.mjs` | Logica pura (etapa 1 + etapa 2A). |
| `testes/teste-auth.mjs` | Maquina de estados do `auth.js` com `fetch`/`chrome` stubados. Sem credenciais reais. |

## Instalar em modo desenvolvedor

1. `chrome://extensions` -> ligue **"Modo do desenvolvedor"**.
2. **"Carregar sem compactacao"** -> selecione
   `tools/extensao-sessao-rocket/`.
3. A extensao "InovaTV — Sessao Rocket (etapa 2A: ...)" aparece na
   lista. Fixe na barra se quiser.

Sem passo de build.

## Usar

1. **Deteccao:** faca login em `app.rocketgestor.com` normalmente e
   clique em "Detectar cookies de sessao".
2. **Operador:** no popup, informe e-mail/senha do **operador Supabase**
   (a mesma conta autorizada do Painel) e clique "Entrar". O popup
   passa a mostrar o veredito e um botao "Sair". A sessao renova
   sozinha nas aberturas seguintes.
3. **Enviar:** desabilitado nesta etapa.

## Rodar os testes

```
node tools/extensao-sessao-rocket/testes/teste.mjs
node tools/extensao-sessao-rocket/testes/teste-auth.mjs
# ou, com npx tsx, o mesmo
```

`teste.mjs`: deteccao de cookie (value-blindness, chaves desconhecidas,
determinismo) + `tokenExpirado` / `avaliarOperador` (nunca retorna
e-mail) / `derivarEstadoAuth` (envio SEMPRE desabilitado na 2A,
inclusive para o operador) + `integracao` (nada e' enviado, `fetch`
nunca chamado) + `config` (role `anon`, sem `service_role` / sem
`SESSAO_ROCKET_UPDATE_TOKEN`).

`teste-auth.mjs`: `entrar` (sucesso / 400 sem vazar mensagem / erro de
rede), renovacao automatica (fresco nao renova / expirado renova /
refresh revogado limpa / refresh com erro de rede mantem stale),
`sair` (revoga + limpa; limpa mesmo se o logout falhar; idempotente
sem sessao), e as invariantes: nunca chama Edge Function, nunca poe
`sessionid`/`csrftoken` num corpo, `apikey` sempre = anon key.
