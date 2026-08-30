# Autocura automática do `UNITV_DEALER_TOKEN` — Fases 3/4

> **Status: PROJETO/ARQUITETURA aprovado como base (2026-08-30), com 6 ajustes
> incorporados nesta revisão. NENHUM código, migration, Edge Function, workflow,
> OCR ou secret de login foi criado. Nenhum login real foi feito.**
>
> Dono deste conhecimento: este arquivo. Marco/estado resumido:
> `inovatv-api-intermediaria/NEXT_SESSION.md` e `inovatv_central/CLAUDE.md`
> ("Frente — Fluxo de Renovação Automática", Etapa 2 UniTV / autocura).
>
> Contexto anterior: `NEXT_SESSION.md` §0.3 (U1 concluído — CAPTCHA = 4 dígitos;
> U3/U4 inconclusivos) e §4.6 / §4.6.1 / §4.6.2 (natureza do `dealer_token`,
> comparação A×B, opções i/ii/iii). Fase 1 (diagnóstico/observabilidade) e Fase 2A
> (Vault como fonte viva) já estão **em produção** — ver checkpoints de 2026-08-29/30.

---

## 1. Objetivo

Quando o `UNITV_DEALER_TOKEN` morrer (TTL de sessão do painel de revenda, eviction
por login concorrente, sweep do servidor, ou troca de senha do painel):

```
detectar → confirmar → recuperar automaticamente → validar token novo →
gravar no Vault → validar de novo → voltar ao normal
```

A **recaptura manual** (o procedimento passivo na sessão logada do painel, feito
em 2026-08-30) continua existindo **apenas como fallback de emergência** — nunca
como operação de rotina.

---

## 2. Invariantes (não-negociáveis)

Estas regras valem para **toda** implementação futura desta frente. Uma
especificação técnica que as contrarie está errada.

| # | Invariante |
|---|---|
| **I1** | **Allowlist obrigatória.** O healer automático só pode disparar para um `returnCode` de token morto **conhecido e explicitamente autorizado** (`autocura_unitv_config.return_codes_que_disparam`, não-nulo/não-vazio). Código desconhecido → veredito tratado como `codigo_desconhecido` → alerta (se aplicável) → **não dispara**. Enquanto não houver um `returnCode` real de token morto documentado e autorizado, `autocura_unitv_config.healer_ativo = false` e o healer automático permanece **desativado**. |
| **I2** | **Modo observação é a primeira etapa obrigatória.** `modo_observacao = true` na estreia: monitor, detector, confirmação, OCR do CAPTCHA e métricas funcionam; **nenhuma tentativa de login (`POST` de autenticação) é enviada**, em nenhum caminho. Sair do modo observação é uma decisão manual (flip de config) após revisão explícita. |
| **I3** | **Guard financeiro.** O healer **não pode iniciar** enquanto existir renovação UniTV em `aguardando_confirmacao`, `autorizada` ou `renovacao_em_andamento` (`tokens_renovacao` avulso **ou** filho de `renovacoes_lote`). O healer **nunca possui qualquer caminho** para `POST /api/account/renew` — nem código, nem import, nem construção de payload de `/renew`. |
| **I4** | **Vault.** Vault (`vault.secrets` name `unitv_dealer_token`, via RPC `unitv_dealer_token_ler`/`unitv_dealer_token_definir`) = **token vivo**. Edge secret `UNITV_DEALER_TOKEN` = **bootstrap/fallback estático**. A autocura atualiza **somente o Vault**. O Edge secret **nunca** é alterado pelo healer (nem por nenhuma peça desta frente). |
| **I5** | **Falha do healer.** Qualquer falha em qualquer passo → **encerra o ciclo** → **alerta** → **fallback = recaptura manual**. Nunca reexecuta automaticamente uma renovação que já falhou. Nunca reexecuta `POST /pagamento/add/` nem `POST /api/account/renew`. |
| **I6** | **Nunca em log/tela:** o `UNITV_DEALER_TOKEN` (nem hash/prefixo), a senha (`UNITV_DEALER_SENHA`), o login (`UNITV_DEALER_LOGIN`), o **CAPTCHA resolvido**, `dealer_name`, `UNITV_DIAG_ANCHOR_SN`, telefone/e-mail/nome/identificador. O CAPTCHA resolvido é registrado só como **bucket de confiança** + contagem de refreshes. |
| **I7** | **Limite rígido de tentativas, cooldown e kill-switch** em todos os ciclos (§7). Um só ciclo por vez. Hard-stop após N falhas consecutivas. |

---

## 3. Decisão sobre C1/C6 — a V1 é construível agora, sem login de teste

As três premissas de pior caso **não são obstáculos** — são o que torna o desenho
seguro:

| Premissa de pior caso | Como a V1 lida, sem precisar testar |
|---|---|
| Um novo login pode invalidar a sessão anterior | O healer só roda com o token **já confirmado morto** — não há sessão viva da automação a perder. Sessão manual concorrente do José: coberta pelo kill-switch (§7) + pela revalidação final do ciclo (§9, passo 7). |
| Falha de login pode ser credencial inválida / conta bloqueada | O CAPTCHA é **pré-validado a alta confiança antes de qualquer `POST`** (refresh grátis e ilimitado até o limiar). Logo, um `POST` de login que falhe **não é "talvez o CAPTCHA"** — é credencial/bloqueio → **para o ciclo, alerta urgente, fallback manual**. Nunca reinsiste. |
| CAPTCHA correto + login recusado → parar, nunca insistir | É a regra acima. `cap_post_por_ciclo` só cobre **erro de transporte** no `POST` (timeout/5xx/rede), **nunca** recusa de autenticação. |

**O que só um login de teste controlado traria (V2):**
1. Distinguir, pelo código do servidor, "CAPTCHA errado" × "credencial errada" ×
   "conta bloqueada" (U3 inconclusivo) → permitiria **1 retry automático de CAPTCHA**.
2. Medir o limiar real de lockout/rate-limit (U4 inconclusivo) → permitiria
   **relaxar caps**.
3. Confirmar o `returnCode` exato de um `dealer_token` morto (C4). **A V1 não
   precisa de login de teste para isso** — o código real é observado
   passivamente quando o token morrer naturalmente em produção (fica gravado em
   `unitv_token_diagnostico.probe_return_code`), o José revisa, confirma que é
   rejeição de auth genuína (não rate-limit) e adiciona à allowlist. Só então o
   healer automático é ativado (I1).

**Conclusão:** V1 = maximamente conservadora (qualquer não-sucesso = terminal
para o ciclo + alerta + manual). Segura de construir e operar sem nenhum probe
de login agora.

---

## 4. Máquina de estados de alto nível

```
        token vivo (normal)
              │
              ▼  cliente real usa  OU  monitor proativo sonda  OU  calibração agendada
     ┌──────────────────┐
     │ 1. DETECTAR      │  unitv_token_diagnostico → veredito
     └────────┬─────────┘  (reativo: renovacao-unitv-conta → diagnosticarTokenUnitv;
              │             proativo: EF autocura-unitv-monitor, cron */15)
              │ veredito = token_morto (≥2 probes, MESMO returnCode C ≠ 0)
              ▼
     ┌──────────────────┐
     │ 2. CONFIRMAR     │  2ª batida read-only, ≥ confirmacao_gap_min depois,
     │  (anti-falso-+)  │  MESMO C. Outage (transport_fail) e rate-limit não satisfazem.
     └────────┬─────────┘
              │ C conhecido+autorizado (I1)?
              │   não  → veredito 'codigo_desconhecido' → alerta (dedupe) → PARA (não dispara)
              │   sim  ▼
     ┌──────────────────┐   guards falham → NÃO dispara (log + próximo tick)
     │ 3. GUARDS        │   healer_ativo · kill-switch · pausa · cooldown · caps ·
     │ (pode_disparar)  │   ciclo em_andamento · renovação UniTV em voo (I3) ·
     │                  │   hard-stop (N falhas) · allowlist não-vazia (I1)
     └────────┬─────────┘
              │ liberado → registra ciclo (estado=em_andamento) → dispatch workflow
              ▼
     ┌──────────────────┐
     │ 4. RECUPERAR     │  GitHub Actions (Playwright):
     │  (healer)        │  abrir login → CAPTCHA (endpoint pré-auth) → template match →
     │                  │  refresh até confiança ≥ limiar (SEM POST) →
     │                  │  ── se modo_observacao=true: PARA AQUI, outcome='observacao' ──
     │                  │  ≤1 POST de login efetivo (folga transporte: cap 2) →
     │                  │  extrair token da resposta de login
     └────────┬─────────┘
              │ token novo obtido
              ▼
     ┌──────────────────┐
     │ 5. VALIDAR NOVO  │  shape (32 hex) → /api/account read-only →
     │  TOKEN           │  returnCode 0? senão: ciclo=falhou, VAULT INTOCADO (I4)
     └────────┬─────────┘
              │ válido
              ▼
     ┌──────────────────┐
     │ 6. GRAVAR VAULT  │  unitv_dealer_token_definir(token,'autocura','healer')
     │                  │  — SÓ o Vault. Edge secret NÃO é tocado (I4).
     └────────┬─────────┘
              ▼
     ┌──────────────────┐
     │ 7. REVALIDAR     │  ler de volta do Vault (unitv_dealer_token_ler) →
     │  (belt & susp.)  │  /api/account read-only. OK → ciclo=sucesso
     └────────┬─────────┘
              ▼
        token vivo (normal)  +  alerta informativo "autocura OK"

   Qualquer passo 4–7 falha → ciclo=falhou + failure_class + ALERTA URGENTE +
   fallback = recaptura manual (I5). N falhas seguidas → hard-stop (kill-switch
   automático) + alerta CRÍTICO.
```

---

## 5. Etapa 0 — Modo Observação (obrigatória — I2)

**Objetivo:** provar o comportamento do solver de CAPTCHA e do detector **sem
tocar na conta** (sem nenhum `POST` de login, sem sessão, sem chamada de conta
autenticada). É a **primeira** etapa a rodar em produção, antes de qualquer
autocura real.

### 5.1 O que funciona em `modo_observacao = true`

- **Monitor proativo** (`autocura-unitv-monitor`, cron `*/15`) roda normalmente e
  grava `unitv_token_diagnostico` como qualquer diagnóstico.
- **Detector + confirmação** rodam e registram tudo (inclusive `codigo_desconhecido`).
- **Calibração agendada do OCR** — a cada `calibracao_intervalo_h` (default 24h), o
  monitor dispara o workflow em **modo calibração**: o runner abre a página de
  login, busca N CAPTCHAs pelo endpoint **pré-autenticado**
  (`POST /api/dealer-core/security/get-info`, sem token, sem sessão), roda o
  pipeline de OCR, e grava a **distribuição de confiança** + contagem de
  segmentações válidas. **Nenhum `POST` de login. Nenhuma chamada autenticada.**
- **Métricas** gravadas em `autocura_unitv_ciclos` (`outcome='observacao'` ou
  `'calibracao'`).

### 5.2 O que está bloqueado em `modo_observacao = true`

- **`POST` de login** — o runner **sai antes** desse passo, sempre, em qualquer
  ciclo (calibração ou disparo por token morto confirmado). `outcome='observacao'`,
  `login_posts=0`.
- Gravação no Vault (não há token novo — não houve login).
- Qualquer alteração de secret.

### 5.3 Critérios para sair do modo observação

**Todos**, revisados manualmente (José + GPT), então flip de config:

1. **OCR calibrado** — a distribuição de confiança dos CAPTCHAs coletados mostra
   taxa alta de `alta` confiança e segmentação de exatamente 4 dígitos
   consistente, ao longo de ≥ N dias (sugerido: 7). Ajuste dos limiares
   (`ocr_score_min`, `ocr_margem_min`) feito só com base nesses dados.
2. **`returnCode` real de token morto conhecido e autorizado** (I1) — obtido
   passivamente de uma morte real do token registrada em
   `unitv_token_diagnostico`, revisado, confirmado como rejeição de auth genuína,
   e adicionado a `autocura_unitv_config.return_codes_que_disparam`.
3. **Revisão explícita** do histórico de ciclos de observação (`autocura_unitv_ciclos`)
   sem anomalias.

Só então: `modo_observacao = false` **e** `healer_ativo = true` (os dois flips,
juntos, numa mesma revisão).

---

## 6. Componentes

### A. Detector

#### A.1 O que reusa (sem alteração)

- **`unitv_token_diagnostico`** (tabela + `diagnosticarTokenUnitv`, Fase 1, em
  produção). Já classifica `token_vivo` / `token_morto` / `indeterminado_outage`
  / `indeterminado` com a regra "≥2 probes consistentes"; `token_morto` exige
  `probe_return_code IS NOT NULL` (≥2 `auth_reject` com o **mesmo** `returnCode`).
- **`resolverContaUnitv`** — probe read-only via `POST /api/account` resolvendo
  `UNITV_DIAG_ANCHOR_SN`. **Nunca** toca `/renew`.
- **Gatilho reativo já existente** — `renovacao-unitv-conta` → `reason === "unavailable"`
  → `EdgeRuntime.waitUntil(diagnosticarTokenUnitv(...))`.

#### A.2 O que adiciona

- **Monitor proativo** — nova EF `autocura-unitv-monitor`, cron **`*/15`**,
  read-only:
  1. Roda `diagnosticarTokenUnitv({ motivoOrigem: "monitor-proativo" })`.
  2. Se o veredito for `token_morto`, aplica a regra de confirmação (A.3).
  3. Sweep: fecha como `indeterminado`/`orfao` qualquer `autocura_unitv_ciclos`
     em `em_andamento` há > `orfao_timeout_min`.
  4. Em `modo_observacao`: dispara a **calibração agendada** do OCR (§5.1) a cada
     `calibracao_intervalo_h`.
- Sem trigger de banco na inserção do diagnóstico — o cron `*/15` captura o caso
  reativo em ≤ 15 min. (Trigger DB → EF é V2.)

#### A.3 Quando `token_morto` é "suficientemente confirmado" para disparar

Todas as condições:

1. **Batida 1** — linha `unitv_token_diagnostico` com `veredito='token_morto'` e
   `probe_return_code = C` (≠ 0, não-nulo). Já embute "≥2 probes, mesmo código".
2. **Batida 2** — o `autocura-unitv-monitor`, **antes de disparar**, roda uma
   batida fresca de probes read-only e obtém **`token_morto` com o mesmo
   `probe_return_code = C`**.
3. **Separação temporal** — batida 1 e batida 2 com **≥ `confirmacao_gap_min`**
   (default 10 min) entre si.
4. **Allowlist (I1)** — `C ∈ autocura_unitv_config.return_codes_que_disparam`.
   - `return_codes_que_disparam` nula/vazia → **nunca** é actionable (com
     `healer_ativo=false`, que é o estado até a allowlist ser preenchida).
   - `C` fora da allowlist → veredito de disparo = **`codigo_desconhecido`** →
     alerta ao José (dedupe 24h): *"Possível token morto com returnCode
     desconhecido — investigar e, se for rejeição de auth genuína, autorizar na
     allowlist"* → **não dispara**.

Resultados alternativos da batida 2:
- `token_vivo` → **falso alarme** (token se recuperou / transitório): log
  `autocura_falso_alarme`, nada mais.
- `indeterminado_outage` (≥2 `transport_fail`) → **outage do painel**: nunca
  dispara, log, tenta no próximo tick.
- `indeterminado` (misto / códigos divergentes) → inconclusivo: não dispara, log.

#### A.4 Como evita falso positivo por outage / rate-limit

| Ameaça | Defesa |
|---|---|
| Painel fora do ar | `transport_fail` → `indeterminado_outage`, **nunca** `token_morto`. Healer não dispara. |
| Rate-limit transitório (código de auth ≠ 0 por alguns min) | (a) probes espaçados ≥ 20s; (b) batidas 1 e 2 separadas ≥ 10 min → janela de rate-limit raramente abrange ambas; (c) exige **mesmo `returnCode`** nas duas batidas; (d) **allowlist (I1)** — só um código explicitamente confirmado como "token morto" dispara; um código de rate-limit nunca entra na allowlist. |
| Drift de dado na conta âncora | `resolverContaUnitv` retorna `nao_encontrado`/`ambiguo` → classificado `ok`/`ancoraResolveu=false` (token **autenticou**) → **não** é `token_morto`. |
| Âncora não configurada | `ancora_status='ausente'`, `probe_total=0` → `veredito='indeterminado'` → não dispara. |

---

### B. Healer

#### B.1 Workflow separado

`.github/workflows/autocura-unitv-token.yml` — **novo, isolado** de
`renovacao-sigma.yml`.

```yaml
name: Autocura UNITV Dealer Token
on:
  workflow_dispatch:
    inputs:
      ciclo_id: { required: true, type: string }   # UUID do ciclo já registrado
concurrency:
  group: autocura-unitv           # NUNCA duas execuções simultâneas
  cancel-in-progress: false
jobs:
  autocura:
    runs-on: ubuntu-latest
    timeout-minutes: 8
    steps: [ checkout, setup-node@20, npm i playwright@1.47.0,
             npx playwright install --with-deps chromium,
             run: node scripts/autocura-unitv-token.mjs ]
    env:
      CICLO_ID:                      ${{ github.event.inputs.ciclo_id }}
      SUPABASE_URL:                  ${{ secrets.SUPABASE_URL }}
      SUPABASE_SERVICE_ROLE_KEY:    ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
      AUTOCURA_UNITV_CALLBACK_TOKEN: ${{ secrets.AUTOCURA_UNITV_CALLBACK_TOKEN }}
      UNITV_DEALER_LOGIN:           ${{ secrets.UNITV_DEALER_LOGIN }}
      UNITV_DEALER_SENHA:          ${{ secrets.UNITV_DEALER_SENHA }}
      UNITV_DEALER_NAME:           ${{ secrets.UNITV_DEALER_NAME }}
```

Disparado **só** via `workflow_dispatch` pela EF `autocura-unitv-monitor` (reusa
`GITHUB_ACTIONS_DISPATCH_TOKEN`, que já tem Actions:read/write neste repo). Nunca
à mão para operação normal.

#### B.2 Como abre o painel

`scripts/autocura-unitv-token.mjs` (novo) + `scripts/lib/unitv-captcha-ocr.mjs`
(novo) + templates de dígito versionados (`scripts/lib/captcha-templates/0.png …
9.png` — gerados uma vez de amostras, sem segredo).

1. `chromium.launch()` → `page.goto('https://panel-web.revenda.site/#/login')`.
2. **Não** reaproveita sessão/cookie (estado limpo — é o que o healer conserta).

#### B.3 Como obtém o CAPTCHA

- Chama / intercepta `POST /api/dealer-core/security/get-info` — **endpoint
  pré-autenticado** (é a tela de login; sem token, sem sessão, sem tocar a conta).
  PNG 240×80, `data:image/png;base64`, campo `form_item_validateCode`.
- Guarda o identificador (`key`/`id`) que o servidor associa a essa imagem
  (necessário no `POST` de login) — confirmado no bundle/DOM durante a
  implementação, **sem submeter**.
- Botão **"Eu não vejo"** gera outra imagem — **grátis, sem throttle observado**
  (~8 refreshes na investigação). É o mecanismo de refresh.

#### B.4 Template matching / OCR dos 4 dígitos

Pipeline puro (sem serviço pago, sem modelo pesado — CAPTCHA trivial: 4 dígitos
grandes, `isolatedDarkPx:0`, `strikeLikeRows:0`, fundo ~92% branco):

1. Decodifica PNG → grayscale → **binariza** (Otsu ou limiar fixo — cor por
   dígito é irrelevante).
2. Segmenta em 4 caixas (projeção vertical / componentes conexos; 4 blobs).
3. Cada caixa → normaliza ao tamanho dos templates → correlação (NCC) contra os
   10 templates `0–9`.
4. Por dígito: `score_top1`, `margem = score_top1 − score_top2`.

#### B.5 Confiança suficiente

- **Por dígito**: `score_top1 ≥ ocr_score_min` (inicial 0.92) **e**
  `margem ≥ ocr_margem_min` (inicial 0.15) — **calibrados no modo observação** (§5.3).
- **Global**: os 4 dígitos passam **e** exatamente 4 blobs segmentados **e**
  resultado casa `^[0-9]{4}$`.
- Qualquer critério falha → **refresh** (não conta como login) e recomeça.

#### B.6 Limite de refresh de CAPTCHA

`cap_refresh_captcha` por ciclo (default 12). Estourou sem atingir confiança →
**aborta o ciclo sem nenhum `POST`**, `failure_class='captcha_sem_confianca'`,
alerta urgente. (Estouro sistemático = sinal de mudança no painel.)

#### B.7 Limite de `POST` de login

- `cap_post_por_ciclo` (default 2). **Mas**: com CAPTCHA pré-validado a alta
  confiança, a **1ª recusa de autenticação encerra o ciclo**
  (`failure_class='login_recusado'`). O 2º `POST` só é usado se o 1º falhar por
  **transporte** (timeout/5xx/rede), **nunca** por recusa.
- ≥ 30 s entre `POST`s (se houver 2).
- Cap global cross-ciclo: `cap_post_diario` (default 6) / 24h, verificado pela
  RPC de guard **antes** do dispatch.
- **Em `modo_observacao=true`: 0 `POST`s, sempre (I2).**

#### B.8 Tratamento de erro de login

| Situação | Ação |
|---|---|
| CAPTCHA nunca atinge confiança (≥ `cap_refresh_captcha`) | aborta sem `POST` · `captcha_sem_confianca` · alerta urgente |
| 1º `POST` → recusa de auth (qualquer resposta ≠ sucesso, com CAPTCHA de alta confiança) | **para** · `login_recusado` · alerta urgente · **não usa o 2º `POST`** · fallback manual (I5) |
| 1º `POST` → erro de transporte (timeout/5xx) | 1 retry (2º `POST`) após ≥ 30 s; falhou de novo → `login_transporte` · alerta urgente |
| Login OK, resposta sem token reconhecível | `token_shape_invalido` · Vault intocado (I4) · alerta urgente |
| Token novo falha `/api/account` read-only | `token_novo_invalido` · Vault intocado (I4) · alerta urgente |
| Gravou Vault mas revalidação (passo 7) falha | `revalidacao_falhou` · alerta **CRÍTICO** (Vault pode ter token ruim → recaptura manual já) |
| Exceção não prevista (Playwright, rede…) | `excecao` · Vault intocado · alerta urgente |

Todo caminho reporta um resultado final ao callback `autocura-unitv-resultado`
(mesma disciplina do runner Sigma — nunca deixa o ciclo pendurado). Se nem o
callback funcionar → o sweep do monitor (§A.2) fecha o ciclo como
`indeterminado`/`orfao` em `orfao_timeout_min`.

---

### C. Segurança

#### C.1 Kill-switch

`autocura_unitv_config.kill_switch boolean` (singleton, editável via SQL Editor —
**sem deploy**). `true` → `autocura_unitv_pode_disparar()` recusa tudo. Também
`pausado_ate timestamptz` (pausa temporária; `'infinity'` = hard-stop). O José
sobe o kill-switch **antes de qualquer recaptura manual planejada** e desce
depois.

#### C.2 Cooldown entre ciclos

`cooldown_min` (default 120). `pode_disparar` recusa se
`max(autocura_unitv_ciclos.ended_at) + cooldown_min > now()`. Vale para sucesso
**e** falha.

#### C.3 Contador persistido

**`autocura_unitv_ciclos`** (append-only, 1 linha por ciclo). Fonte única de:
cooldown, caps diários, hard-stop por falhas consecutivas, métricas (§F). Só
recebe `UPDATE` de `ended_at`/`outcome`/`failure_class`/métricas na conclusão do
próprio ciclo.

#### C.4 Limite diário

`cap_ciclos_diario` (default 4) e `cap_post_diario` (default 6), janela móvel 24h,
contados de `autocura_unitv_ciclos`. `pode_disparar` recusa se qualquer um seria
excedido. Ciclos de **calibração** (modo observação) usam cap próprio
`cap_calibracao_diario` (default 2) e **não** contam para `cap_ciclos_diario`.

#### C.5 Comportamento se houver sessão manual ativa

- O healer só roda com token **confirmado morto** → do lado da automação não há
  sessão viva a perder.
- Sessão manual concorrente do José (ex.: recaptura manual): risco de eviction
  mútua (painel usa sessão única por dealer). Mitigação:
  - **Kill-switch** é o mecanismo primário — José sobe antes de mexer.
  - Se houver corrida: o **passo 7** (revalidação lendo do Vault) detecta se o
    token gravado morreu (evictado por login concorrente) → ciclo
    `revalidacao_falhou` → alerta **CRÍTICO** → recaptura manual. Nunca fica token
    morto silencioso no Vault sem alerta.
  - `cooldown ≥ 2h` impede o healer de brigar repetidamente com uma sessão manual.

#### C.6 Comportamento se o novo login invalidar o token anterior

É o **caso esperado e desejado** — o token anterior já estava morto (por isso o
ciclo). O healer: valida o token **novo** read-only → só então grava no Vault →
revalida lendo do Vault. Ambos os consumidores (`obterDealerToken` na Edge,
`lerDealerTokenVault` no runner) leem o Vault a cada uso (cache 30s na Edge) →
convergem para o token novo em ≤ 30s. O Edge secret `UNITV_DEALER_TOKEN` **nunca
é tocado pela autocura** (I4) — permanece como bootstrap/fallback estático.

#### C.7 Proteção contra loop (healer → token inválido → healer)

- **Falhas consecutivas** — `pode_disparar` conta ciclos `outcome='falhou'`
  seguidos (sem nenhum `sucesso` no meio). `≥ max_ciclos_falhos_consecutivos`
  (default 3) → **hard-stop**: seta `pausado_ate = 'infinity'` + alerta
  **CRÍTICO**. Só reset manual (SQL Editor).
- **Um só ciclo por vez** — índice único parcial em `autocura_unitv_ciclos
  (estado)` onde `estado='em_andamento'` → `autocura_unitv_registrar_inicio`
  falha se já há ciclo aberto. `concurrency: group` do workflow é a 2ª barreira.
- **Ciclo nunca se auto-redispara** — só o cron `autocura-unitv-monitor`
  dispara, e só via `pode_disparar` (cooldown + caps + hard-stop + allowlist).
- **Ciclo órfão** — sweep no cron fecha como `indeterminado`/`orfao` qualquer
  `em_andamento` há > `orfao_timeout_min` → libera para o próximo, respeitando
  cooldown.
- Um ciclo `falhou` que não gravou nada no Vault deixa o token morto no lugar →
  o próximo tick vê `token_morto` de novo → mas cooldown + cap de falhas
  consecutivas gate.

#### C.8 Guard financeiro (I3) — renovação UniTV em voo

`autocura_unitv_pode_disparar()` recusa (`motivo='renovacao_unitv_em_voo'`) se
existir **qualquer**:

- `tokens_renovacao` com `tipo = 'unitv'` e `estado in ('aguardando_confirmacao',
  'autorizada', 'renovacao_em_andamento')`;
- `renovacoes_lote` com ≥ 1 filho `tipo='unitv'` e `estado in
  ('aguardando_confirmacao', 'autorizada', 'renovacao_em_andamento')`.

O healer **nunca** interfere numa renovação em andamento. Essas renovações são
reconciliadas pelo `renovacao-sigma-watchdog` existente; o cliente já está
protegido pelo gate pré-cobrança (§E). O healer espera o campo esvaziar (próximo
tick de 15 min).

#### C.9 Ausência de caminho para `/api/account/renew` (I3)

- `scripts/autocura-unitv-token.mjs` importa **só** helpers de CAPTCHA/OCR, login
  e validação read-only. **Nunca** importa `scripts/lib/unitv-renovar.mjs`.
- Nenhuma peça da autocura constrói o path `/api/account/renew`, nem o payload de
  `/renew` (`sign` MD5 + AES de renovação), nem chama `POST /pagamento/add/`.
- Suíte `autocura_nunca_renew` (§10) faz varredura estática (grep) confirmando a
  ausência dessas referências em todos os arquivos da autocura — falha o CI se
  aparecerem.

---

### D. Token novo — do login ao Vault

Ordem **rígida**, executada pelo runner:

1. **Extrair** — parsear a resposta do `POST` de login. O `dealer_token` (32 hex)
   aparece na resposta de login (é o valor que hoje vive em
   `Authorization`/`token`/`dealer_token`). Localização exata do campo →
   confirmada na implementação **sem submeter** (leitura do bundle) ou no 1º run
   real supervisionado (fora do modo observação).
2. **Validar shape** — `^[0-9a-f]{32}$`. Falha → `token_shape_invalido`, aborta,
   **Vault intocado** (I4).
3. **Testar read-only** — `POST /api/account` resolvendo `UNITV_DIAG_ANCHOR_SN`
   com o token novo (mesma mecânica de `unitv_conta.ts`). Exige `returnCode 0`.
   Qualquer outra coisa → `token_novo_invalido`, aborta, **Vault intocado** (I4).
4. **Só então gravar** — `POST /rest/v1/rpc/unitv_dealer_token_definir` com
   `service_role` key (mesmo padrão de `lerDealerTokenVault` no runner Sigma):
   `unitv_dealer_token_definir(<token>, 'autocura', 'healer')`. `'autocura'` **já
   é valor válido** no `check` de `unitv_dealer_token_estado.origem` — **nenhuma
   migration nova nesse ponto**.
5. **Atualizar metadados** — a própria RPC carimba `unitv_dealer_token_estado`
   (`origem='autocura'`, `atualizado_em=now()`, `atualizado_por='healer'`). O
   runner grava também a métrica do ciclo.
6. **Revalidar lendo de novo do Vault** — `POST /rest/v1/rpc/unitv_dealer_token_ler`
   → valor recém-gravado → repete o passo 3. OK → `outcome='sucesso'`. Falha →
   `revalidacao_falhou` + alerta **CRÍTICO**.
7. **Callback** — `POST autocura-unitv-resultado` com `X-Internal-Token =
   AUTOCURA_UNITV_CALLBACK_TOKEN` e `{ ciclo_id, outcome, failure_class?,
   métricas }`. A EF `autocura-unitv-resultado`:
   - Fecha o ciclo em `autocura_unitv_ciclos` (RPC `autocura_unitv_registrar_fim`).
   - Faz **uma 3ª validação independente** (lendo do Vault via
     `unitv_dealer_token_ler` + `/api/account`) — defesa em profundidade, lado Edge.
   - `sucesso` → alerta informativo "autocura OK" (dedupe).
   - qualquer falha → alerta **URGENTE** ao José (template
     `nova_transferencia_humana`, texto fixo: *"Autocura UNITV_DEALER_TOKEN
     falhou (`<failure_class>`) — recapturar manualmente"*), dedupe 6h. N falhas
     seguidas → `pausado_ate='infinity'` + alerta **CRÍTICO** (I5/I7).

**Nunca** grava o Vault com token não validado (passo 3 é pré-condição do passo
4). **Nunca** chama `/api/account/renew` (I3).

---

### E. Recuperação — clientes e pagamentos durante a queda

#### E.1 Clientes que ficaram aguardando atendimento

Durante a queda, qualquer cliente que tente renovar UniTV cai em
`renovacao-unitv-conta` → `outcome:"indisponivel"` → o Orquestrador já faz
`transferirPorFalha("renovacao:unitv_conta_indisponivel", MENSAGEM_RENOVACAO_INSTABILIDADE)`
→ **cliente recebe "instabilidade temporária, encaminhando para atendente"** e a
conversa vai para `aguardando_humano`. Isso **já existe** e não muda.

Quando a autocura conclui (`sucesso`), a EF `autocura-unitv-resultado` **não
reprocessa nada automaticamente**. O José recebe o alerta "autocura OK",
encontra as conversas em `aguardando_humano` (motivo
`renovacao:unitv_conta_indisponivel`) no Painel de Atendimento e reinicia a
renovação normalmente. Nova solicitação é legítima porque nenhuma anterior chegou
a criar token/cobrança (§E.2). **V1 não faz retomada automática de conversa** (V2).

#### E.2 Garantir que nenhum pagamento seja perdido

- **Gate pré-cobrança (já existe)** — no ACEITO de uma renovação UniTV **nova**, o
  Orquestrador chama `chamarResolverContaUnitv(sn)` **antes** de criar
  token/cobrança. Token morto → `indisponivel` → **aborta antes de qualquer
  `cobrancas_pix`**. Não existe cobrança órfã de token morto para renovação nova.
  Idem no fluxo de **lote** (`loteTemUnitv` + resolução por filho antes de criar
  qualquer cobrança — aborta o lote inteiro).
- **Renovação já paga cuja execução UniTV falhou por token morto** — o filho vira
  `unitv_pendente` no workflow → `renovacao-sigma-resultado` mapeia para
  `renovacao_indeterminada` + transferência humana; lote fica `parcial`. O
  `renovacao-sigma-watchdog` (`*/5`) garante que nada fica pendurado. **Esses
  casos já estão sinalizados e alertados** — o José os resolve manualmente
  (renovar aquele acesso pelo painel) depois que a autocura restaurar o token. A
  autocura **não** os re-executa (I5).

#### E.3 Não reexecutar renovação já iniciada (I5)

- `unitv-renovar.mjs` (executor congelado) chama `/api/account/renew` **1×** por
  acesso, sem chave de idempotência — regra já vigente.
- `renovacao_indeterminada` / `renovacao_falhou` são **estados terminais** —
  nenhum sweep os re-dispara.
- O healer **nunca** chama `/renew` (I3/§C.9).
- Guard §C.8 — o healer nem sequer roda enquanto há renovação UniTV não-terminal.

---

### F. Observabilidade

#### F.1 Logs estruturados

`console.log("[autocura-unitv] <evento>", JSON.stringify({...}))` em cada
EF/runner. Eventos: `monitor_tick`, `confirmacao_ok`, `codigo_desconhecido`,
`falso_alarme`, `guard_recusou`, `dispatch`, `calibracao_inicio`,
`captcha_refresh`, `captcha_confianca_bucket`, `login_post`, `token_validado`,
`vault_gravado`, `revalidacao`, `ciclo_fim`. Campos: `ciclo_id`, `outcome`,
`failure_class`, contadores.

**Nunca** logam nada da lista de I6.

#### F.2 Histórico — tabela nova `autocura_unitv_ciclos`

Append-only, RLS on sem policy (padrão do projeto):

| coluna | tipo | nota |
|---|---|---|
| `id` | uuid pk | |
| `iniciado_em` | timestamptz | |
| `estado` | text check (`em_andamento`,`concluido`) | 1 `em_andamento` por vez (índice único parcial) |
| `tipo` | text check (`disparo`,`calibracao`) | `calibracao` = modo observação, sem token morto |
| `trigger` | text check (`monitor_proativo`,`reativo`,`agendado`) | |
| `diag_return_code` | int null | o `probe_return_code` que disparou (null em calibração) |
| `modo_observacao` | boolean | snapshot da config no início do ciclo |
| `captcha_refreshes` | smallint | |
| `captcha_confianca_bucket` | text (`alta`/`media`/`baixa`/`n_a`) | nunca o valor (I6) |
| `login_posts` | smallint | 0 em observação/calibração, sempre |
| `outcome` | text check (`sucesso`,`falhou`,`indeterminado`,`observacao`,`calibracao`) | null enquanto `em_andamento` |
| `failure_class` | text null | ver §B.8 + `codigo_desconhecido`/`orfao` |
| `vault_gravado` | boolean default false | |
| `alertado_jose` | boolean default false | |
| `ended_at` | timestamptz null | |

`unitv_token_diagnostico` continua sendo o histórico do **lado detector** (sem
mudança de schema).

#### F.3 Métricas (consultas ad-hoc no SQL Editor — V1)

- autocuras nos últimos 30/90 dias: `count(*) where outcome='sucesso'`
- quantas **falharam**: `count(*) filter (where outcome='falhou')`; taxa de falha
- distribuição de `failure_class`
- tempo médio de ciclo (`ended_at - iniciado_em`)
- refreshes de CAPTCHA por ciclo + distribuição de `captcha_confianca_bucket`
  (calibra o OCR — principal métrica do modo observação)
- MTBF do token (intervalo entre `sucesso` consecutivos) → TTL real do painel
- ocorrências de `codigo_desconhecido` (candidatos a entrar na allowlist)

(V2: view materializada / painel.)

---

## 7. Config, limites e guards

### 7.1 `autocura_unitv_config` (singleton `id=1`, editável sem deploy)

| Parâmetro | Default V1 | Papel |
|---|---|---|
| `healer_ativo` | **`false`** | mestre. `false` → nenhum `POST` de login jamais (só monitor/detector/calibração). Só vira `true` junto com o flip de saída do modo observação (§5.3) |
| `modo_observacao` | **`true`** | I2 — monitor/detector/OCR/métricas sim; `POST` de login **nunca**. Primeira etapa obrigatória |
| `return_codes_que_disparam` | **`null`** | I1 — allowlist de `returnCode` de token morto. **`null`/vazio + `healer_ativo=true` é proibido** (`pode_disparar` recusa `allowlist_vazia`). Preenchido só com código real observado e revisado |
| `kill_switch` | `false` | corte total |
| `pausado_ate` | `null` | pausa temporária / hard-stop (`'infinity'`) |
| `cooldown_min` | `120` | mínimo entre ciclos (sucesso ou falha) |
| `cap_ciclos_diario` | `4` | ciclos de disparo / 24h |
| `cap_calibracao_diario` | `2` | ciclos de calibração / 24h (não contam no anterior) |
| `cap_post_diario` | `6` | `POST`s de login / 24h |
| `cap_post_por_ciclo` | `2` | folga p/ transporte; recusa de auth encerra no 1º |
| `cap_refresh_captcha` | `12` | refreshes / ciclo antes de abortar sem `POST` |
| `max_ciclos_falhos_consecutivos` | `3` | dispara hard-stop (`pausado_ate='infinity'`) |
| `confirmacao_gap_min` | `10` | separação mínima entre as 2 batidas de confirmação |
| `orfao_timeout_min` | `20` | fecha ciclo `em_andamento` pendurado |
| `calibracao_intervalo_h` | `24` | frequência da calibração de OCR em modo observação |
| `ocr_score_min` | `0.92` | limiar de correlação por dígito (calibrado no modo observação) |
| `ocr_margem_min` | `0.15` | margem top1−top2 por dígito |

### 7.2 Guards de `autocura_unitv_pode_disparar()` — todos devem passar

| Guard | Recusa se |
|---|---|
| healer ativo | `config.healer_ativo = false` **e** o pedido é de disparo real (calibração ignora este) |
| allowlist (I1) | `config.healer_ativo = true` **e** `config.return_codes_que_disparam` nula/vazia → `allowlist_vazia` |
| código autorizado (I1) | disparo real **e** `C ∉ config.return_codes_que_disparam` → o monitor emite `codigo_desconhecido` (alerta) e não chama `pode_disparar` para disparo |
| kill-switch | `config.kill_switch = true` |
| pausa / hard-stop | `config.pausado_ate > now()` (inclui `'infinity'`) |
| cooldown | `max(ciclos.ended_at) + config.cooldown_min > now()` |
| cap ciclos/dia | `count(ciclos disparo 24h) ≥ config.cap_ciclos_diario` |
| cap POST/dia | `sum(login_posts 24h) + config.cap_post_por_ciclo > config.cap_post_diario` |
| ciclo aberto | existe `ciclo.estado = 'em_andamento'` |
| **renovação UniTV em voo (I3)** | §C.8 |
| confirmação | não há 2 batidas `token_morto` mesmo `C`, ≥ `confirmacao_gap_min` de separação |

### 7.3 Estados do ciclo

`autocura_unitv_ciclos.estado`: `em_andamento` → `concluido`, com `outcome ∈
{sucesso, falhou, indeterminado, observacao, calibracao}`.

---

## 8. Tabelas / RPCs necessárias

### 8.1 Migrations novas (aplicação **manual** via SQL Editor — padrão do repo)

1. **`autocura_unitv_ciclos`** — tabela append-only (§F.2). RLS on, **sem
   policy**. Índice único parcial em `estado='em_andamento'`; índice em
   `iniciado_em desc`. Retenção 180 dias, limpeza manual (volume baixíssimo).
2. **`autocura_unitv_config`** — singleton (`id=1`, `check (id=1)`). Colunas =
   §7.1. RLS on, sem policy. 1 `insert` default (`healer_ativo=false`,
   `modo_observacao=true`, `return_codes_que_disparam=null`).
3. **RPCs** `SECURITY DEFINER`, `search_path` fixo, `revoke` de
   `public/anon/authenticated`, `grant execute` **só** a `service_role` (padrão
   idêntico a `unitv_dealer_token_*` e `rocket_sessao_*`):
   - `autocura_unitv_pode_disparar()` → `jsonb { pode boolean, motivo text }`
   - `autocura_unitv_registrar_inicio(p_tipo text, p_trigger text, p_return_code int)`
     → `uuid` (raise `P0001` se já há `em_andamento`)
   - `autocura_unitv_registrar_fim(p_ciclo_id uuid, p_outcome text, p_failure_class text, p_metrics jsonb)`
     → `void`

### 8.2 Reusadas **sem alteração**

- `unitv_dealer_token_definir` / `unitv_dealer_token_ler` / `unitv_dealer_token_estado`
  (`'autocura'` já é `origem` válida — **nenhuma migration nova**).
- `unitv_token_diagnostico` + `diagnosticarTokenUnitv`.
- `resolverContaUnitv` / `unitv_conta.ts`.
- `enviarTemplateWhatsApp` + template `nova_transferencia_humana`.

### 8.3 pg_cron

1 job novo: `autocura-unitv-monitor`, `*/15 * * * *`, via `net.http_post` —
`X-Internal-Token` lido do Vault **no corpo do `cron.schedule`** (igual ao
`renovacao-sigma-watchdog`). Precisa de `autocura_unitv_monitor_token` no Vault +
`AUTOCURA_UNITV_MONITOR_TOKEN` como Edge secret (mesmo par de
`renovacao_sigma_watchdog_token`).

---

## 9. Sequência completa (fora do modo observação — referência)

```
[cron */15]  autocura-unitv-monitor:
  1. diagnosticarTokenUnitv({motivoOrigem:"monitor-proativo"})  → grava unitv_token_diagnostico
  2. veredito != token_morto → fim (log monitor_tick). Sweep ciclo órfão. Se modo_observacao: calibração agendada.
  3. veredito == token_morto (probe_return_code = C):
     3a. existe batida anterior token_morto mesmo C, ≥ confirmacao_gap_min atrás?  não → fim (aguarda confirmação)
     3b. C ∈ return_codes_que_disparam (I1)?  não → log codigo_desconhecido + alerta (dedupe 24h) → fim
  4. autocura_unitv_pode_disparar():
       healer_ativo? allowlist não-vazia? kill_switch? pausado_ate? cooldown?
       cap_ciclos_diario? cap_post_diario? ciclo em_andamento? renovação UniTV em voo (I3)?
       → qualquer NÃO: log guard_recusou(motivo) → fim
  5. autocura_unitv_registrar_inicio('disparo', trigger, C) → ciclo_id  (falha se já há em_andamento)
  6. dispatch autocura-unitv-token.yml (inputs.ciclo_id) via GITHUB_ACTIONS_DISPATCH_TOKEN
  7. log dispatch(ciclo_id)

[GitHub Actions]  scripts/autocura-unitv-token.mjs:
  8.  chromium → goto login
  9.  loop até confiança ≥ limiar OU cap_refresh_captcha:
        get-info (CAPTCHA, endpoint pré-auth) → binariza → segmenta 4 → NCC vs templates → confiança
        baixa → "Eu não vejo" (refresh, NÃO conta como login)
      estourou → callback(falhou, captcha_sem_confianca) → alerta → EXIT
  10. -- SE modo_observacao=true (I2): callback(observacao, métricas de OCR) → EXIT. NENHUM POST. --
  11. POST login (UNITV_DEALER_LOGIN + UNITV_DEALER_SENHA + código):
        recusa de auth   → callback(falhou, login_recusado) → alerta → EXIT (não usa 2º POST) (I5)
        erro transporte  → 1 retry após 30s; falhou de novo → callback(falhou, login_transporte)
        sucesso          → segue
  12. extrair dealer_token da resposta → shape 32hex?  não → callback(falhou, token_shape_invalido) [Vault intocado]
  13. /api/account read-only com token novo → returnCode 0?  não → callback(falhou, token_novo_invalido) [Vault intocado]
  14. rpc unitv_dealer_token_definir(token, 'autocura', 'healer')   [service_role] — SÓ o Vault (I4)
  15. rpc unitv_dealer_token_ler → /api/account read-only de novo → OK?
        não → callback(falhou, revalidacao_falhou) → alerta CRÍTICO
        sim → callback(sucesso, métricas)

[EF]  autocura-unitv-resultado (X-Internal-Token = AUTOCURA_UNITV_CALLBACK_TOKEN):
  16. autocura_unitv_registrar_fim(ciclo_id, outcome, failure_class, métricas)
  17. 3ª validação independente (Vault → /api/account)  [defesa em profundidade]
  18. sucesso  → alerta informativo (dedupe)
      falhou   → alerta URGENTE (template) + se ≥ max_ciclos_falhos_consecutivos → pausado_ate='infinity' + alerta CRÍTICO (I5/I7)

[cron */15, mesma EF]  sweep: ciclo em_andamento há > orfao_timeout_min → registrar_fim(indeterminado, 'orfao')
```

---

## 10. Testes

Todos locais (`npx tsx scripts/testes/<suite>/teste.mjs`), fakes em memória —
**nenhum** login/rede/renovação real.

### 10.1 Suítes novas

| Suíte | Cobre |
|---|---|
| `autocura_pode_disparar` | cada guard isolado + combinações; **`healer_ativo=false` recusa disparo**; **`allowlist_vazia` recusa quando `healer_ativo=true`** (I1); kill-switch; cooldown na borda; caps diários; **renovação UniTV em voo — individual e lote (I3)**; ciclo `em_andamento` bloqueia 2º início; hard-stop após N falhas |
| `autocura_confirmacao` | 1 batida só → não dispara; 2 batidas < `gap` → não; 2 batidas mesmo C ≥ `gap` **e C na allowlist** → dispara; C fora da allowlist → `codigo_desconhecido` + alerta, **não dispara** (I1); códigos divergentes → não; `token_vivo` na 2ª → falso alarme; `indeterminado_outage` → não |
| `autocura_modo_observacao` | **com `modo_observacao=true`, o runner sai antes de qualquer `POST`** (I2); `login_posts=0`; grava ciclo `observacao`/`calibracao`; calibração agendada roda sem token morto; nenhuma chamada autenticada; nenhuma escrita no Vault |
| `autocura_captcha_ocr` | vetores reais de imagem (amostras): 4 dígitos segmentados; buckets alta/média/baixa; refresh até limiar; estouro de `cap_refresh_captcha` → abort sem `POST`; **nunca loga o valor resolvido** (I6) |
| `autocura_token_novo` | shape inválido → não grava; `/api/account` returnCode ≠ 0 → **Vault intocado** (I4); sucesso → grava com `origem='autocura'`, `atualizado_por='healer'`; revalidação falha → `revalidacao_falhou` |
| `autocura_resultado` | `registrar_fim` fecha ciclo; 3ª validação independente; alerta URGENTE por `failure_class`; dedupe 6h; N falhas seguidas → `pausado_ate='infinity'` + CRÍTICO (I5/I7) |
| `autocura_monitor_tick` | veredito ≠ morto → no-op; morto + guards + allowlist → dispatch; sweep de ciclo órfão > `orfao_timeout_min`; calibração só em `modo_observacao` |
| `autocura_loop_guard` | healer falha → não re-dispara no mesmo tick; cooldown respeitado; N× falha → hard-stop; um `sucesso` zera a contagem consecutiva |
| `autocura_nunca_renew` | **varredura estática** (I3/§C.9): nenhum arquivo da autocura importa `unitv-renovar.mjs`, nem referencia `/api/account/renew`, nem `/pagamento/add/`, nem monta payload de `/renew` |
| `autocura_vault_apenas` | **varredura estática + unit** (I4): a autocura só chama `unitv_dealer_token_definir`; nenhuma peça chama `supabase secrets set`, nem edita `UNITV_DEALER_TOKEN` |

### 10.2 Regressão

As **26 suítes atuais** continuam verdes — a autocura não toca `orchestrator`,
`renovacao-sigma-*`, `unitv-renovar.mjs`, `unitv_conta.ts`, `unitv_dealer_token.ts`.

---

## 11. Workflows e Edge Functions novas

| Item | Papel |
|---|---|
| `.github/workflows/autocura-unitv-token.yml` | healer Playwright (§B.1). `workflow_dispatch` (input `ciclo_id`). `concurrency: autocura-unitv`. `timeout 8min` |
| `scripts/autocura-unitv-token.mjs` | runner (novo — não escrito nesta etapa) |
| `scripts/lib/unitv-captcha-ocr.mjs` | pipeline OCR (novo) |
| `scripts/lib/captcha-templates/[0-9].png` | templates de dígito (assets, sem segredo) |
| EF `autocura-unitv-monitor` | cron `*/15` — detector proativo + confirmação + dispatch + sweep + calibração. `--no-verify-jwt`, `X-Internal-Token` próprio |
| EF `autocura-unitv-resultado` | callback do runner. `--no-verify-jwt`, `X-Internal-Token = AUTOCURA_UNITV_CALLBACK_TOKEN` |
| `renovacao-sigma.yml` / `renovacao-sigma-*` / `unitv-renovar.mjs` | **intocados** |

---

## 12. Secrets necessários

Configuração de secret = ação do usuário (checkpoint próprio), **não** parte da
implementação.

| Secret | Onde | Novo? | Uso |
|---|---|---|---|
| `UNITV_DEALER_LOGIN` | GitHub Actions | **novo** | usuário do dealer no login (`inovatvstream2`) |
| `UNITV_DEALER_SENHA` | **só GitHub Actions** | **novo** | senha do dealer; nenhuma EF precisa → blast radius mínimo |
| `AUTOCURA_UNITV_CALLBACK_TOKEN` | GitHub Actions + Supabase Edge | **novo** | auth runner → `autocura-unitv-resultado` |
| `AUTOCURA_UNITV_MONITOR_TOKEN` | Supabase Edge + Vault (`autocura_unitv_monitor_token`) | **novo** | auth cron → `autocura-unitv-monitor` |
| `GITHUB_ACTIONS_DISPATCH_TOKEN` | Supabase Edge | reusado | dispatch do workflow (já tem escopo Actions) |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | GitHub Actions | reusado | runner lê/grava Vault + ciclos |
| `UNITV_DEALER_NAME` | GitHub Actions | reusado | validação read-only do token novo |
| `UNITV_DIAG_ANCHOR_SN` | Supabase Edge | reusado | probe de validação (passos 3/6/17) |
| `WHATSAPP_JOSE_NUMERO` | Supabase Edge | reusado | alertas |
| `UNITV_DEALER_TOKEN` | Supabase Edge | reusado, **nunca escrito pela autocura** (I4) | fallback estático |

> Nota: `UNITV_DEALER_LOGIN`/`UNITV_DEALER_SENHA` **não** são configurados até a
> implementação da etapa do healer com `POST` (Fase 4). O modo observação (Fase
> 2/3) **não precisa deles** — o endpoint de CAPTCHA é pré-autenticado.

---

## 13. Roadmap de implementação (incremental — cada etapa: implementar → revisar → aprovar → próxima)

| Fase | Escopo | Toca produção? |
|---|---|---|
| **F0** | **Este documento.** ✅ (2026-08-30) | não |
| **F1** | Migrations: `autocura_unitv_ciclos`, `autocura_unitv_config` (`healer_ativo=false`, `modo_observacao=true`, allowlist `null`) + 3 RPCs. Aplicação manual. Testes `autocura_pode_disparar`, `autocura_confirmacao`. | schema novo, isolado; nenhum comportamento existente muda |
| **F2** | EF `autocura-unitv-monitor` (detector proativo + confirmação + sweep, **sem dispatch de workflow ainda**) + cron `*/15` + secret do monitor. EF `autocura-unitv-resultado` (esqueleto). Testes `autocura_monitor_tick`. | grava só `unitv_token_diagnostico` (já existia) + `autocura_unitv_ciclos` |
| **F3** | Workflow `autocura-unitv-token.yml` + runner + `unitv-captcha-ocr.mjs` + templates, **rodando só em `modo_observacao=true`**: CAPTCHA + OCR + métricas + calibração agendada. **Zero `POST` de login.** Secrets `AUTOCURA_UNITV_CALLBACK_TOKEN`. Testes `autocura_modo_observacao`, `autocura_captcha_ocr`, `autocura_nunca_renew`, `autocura_vault_apenas`. **Roda ≥ 7 dias.** | dispara workflow que só busca CAPTCHA (endpoint pré-auth); não toca a conta |
| **F4** | Após: (a) OCR calibrado; (b) `returnCode` real de token morto observado, revisado e adicionado à allowlist; (c) revisão. Implementar o caminho `POST` de login + extração/validação de token + gravação no Vault + revalidação. Secrets `UNITV_DEALER_LOGIN`/`UNITV_DEALER_SENHA`. Testes `autocura_token_novo`, `autocura_resultado`, `autocura_loop_guard`. **Ainda `healer_ativo=false`** — validação supervisionada (1 run manual acompanhado). | 1º login real, supervisionado |
| **F5** | Flip `modo_observacao=false` **e** `healer_ativo=true` (juntos, numa revisão). Autocura automática ativa. Monitorar métricas. | autocura autônoma |

**Nenhuma fase após F0 começa sem aprovação explícita (José + GPT).**

---

## 14. O que NÃO está nesta V1 (fica para V2)

1. **1 retry automático de CAPTCHA** — depende de U3 (distinguir "CAPTCHA errado"
   de "credencial errada" pelo código do servidor).
2. **Relaxar caps** (`cooldown`, `cap_post_diario`) — depende de U4 (medir o
   lockout real).
3. **Health check sem âncora** — trocar `resolverContaUnitv(ANCHOR_SN)` por
   `getDealerInfo` (`POST /api/dealer-core/...`, não depende de conta específica).
   Aposenta `UNITV_DIAG_ANCHOR_SN`.
4. **Trigger de banco** (`unitv_token_diagnostico` insert → NOTIFY → EF) para
   reduzir latência de detecção de ≤ 15 min para segundos.
5. **Retomada proativa de clientes** — após `sucesso`, mensagem automática "já
   pode tentar renovar de novo" para conversas em `aguardando_humano` com motivo
   `renovacao:unitv_conta_indisponivel`.
6. **"Lembrar-me"** — verificar (read-only, 1–2 logins observados) se estende o
   TTL do token o suficiente para reduzir a frequência de autocura.
7. **Painel/view de métricas** de autocura (MTBF do token, taxa de sucesso,
   distribuição de `failure_class`).
8. **Reprocessamento assistido** de `renovacao_indeterminada` UniTV pós-autocura
   (hoje 100% manual — I5).

---

## 15. Fallback de emergência — recaptura manual (SOP)

Enquanto a autocura estiver em modo observação (F2/F3), ou se ela entrar em
hard-stop, ou a qualquer momento que o José preferir:

1. Subir `autocura_unitv_config.kill_switch = true` (evita corrida com o healer).
2. Abrir a sessão logada do painel (`panel-web.revenda.site`, dealer
   `inovatvstream2`).
3. Captura passiva do `dealer_token` (interceptor read-only de headers
   `token`/`Authorization` + 1 navegação de leitura), **sem login automatizado**.
4. `select public.unitv_dealer_token_definir('<token>', 'recaptura_manual', 'jose');`
   no SQL Editor — valor colado na hora, **nunca** em arquivo/chat/log; ponte via
   arquivo gitignored temporário apagado logo após.
5. Verificação read-only: `unitv_dealer_token_ler` (indireta, via
   `renovacao-unitv-conta` `sn=<âncora>` → `resolvido`).
6. Baixar o `kill_switch` de volta para `false`.

Procedimento validado em 2026-08-30 (checkpoint Fase 2A).
