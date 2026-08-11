# inovatv-api-intermediaria

API intermediária entre a **InovaTV Central** e o **Rocket Gestor** —
nunca a Central fala com o Rocket diretamente. Arquitetura completa,
decisões e contexto de negócio vivem em `inovatv_central`
(`docs/identidade_sincronizacao/ARQUITETURA_IDENTIDADE_SINCRONIZACAO.md`
e `DESIGN_DECISIONS.md`, Decisão 050/051) — este repositório não
duplica esse conteúdo, só a implementação.

## Estado atual: Fase 4 — primeira integração real com o Rocket (concluída e validada com evidência real, 2026-08-11)

Implementa as duas únicas chamadas GET aprovadas para esta fase —
**Cenário B** (`match`) e **Cenário C** (`status`). Deliberadamente,
nesta fase:

- **Somente leitura.** Nenhum `POST`/`PATCH`/`DELETE` no Rocket, em
  nenhuma hipótese. Nenhuma criação/edição de cliente. Confirmado —
  só GETs foram executados durante toda a validação.
- **Nenhum vínculo persistido.** Nenhuma tabela, nenhuma migration.
- **Nenhum cache/coalescência de requisições** — fica para fase
  própria (arquitetura já decidida, ver Decisão 051 em
  `inovatv_central`; implementação fica para a Fase 5).
- `ROCKET_BASE_URL` (`https://app.rocketgestor.com`, valor não
  sensível) e `ROCKET_API_KEY` vêm exclusivamente de Edge Function
  Secrets do projeto Supabase — nunca aparecem em código, nunca são
  devolvidos em nenhuma resposta. **Secrets configurados.** A
  `X-API-Key` em uso foi criada em 11/08/2026, validade 90 dias,
  expira em 09/11/2026 — o valor da chave nunca é registrado em
  nenhum documento, commit ou log, só essas datas.
- Nunca repassa `senha` nem `device_key_or_OTP_code` (campos reais do
  Rocket) — só o subconjunto normalizado descrito abaixo. Nunca
  repassa o `detail` cru de erro do Rocket. **Confirmado
  empiricamente**, não só no código: uma função temporária de
  depuração (`debug-fields`, nunca devolveu valores de campo, só
  nomes de chave — apagada do projeto e do repositório local logo
  depois de usada, nunca commitada) rodou contra um cliente real e
  classificou 34 campos brutos → 5 mantidos, 29 descartados,
  incluindo `senha` e `device_key_or_OTP_code` confirmados presentes
  e descartados.

**Evidência real de ponta a ponta (2026-08-11):**
`/status/{public_id}` e `/match?telefone=...` testados contra um
cliente real de teste — o `publicId` devolvido pelos dois endpoints é
idêntico, fechando o ciclo de identificação com prova real. Nenhum
dado bruto do Rocket (telefone, MAC, e-mail, PIX, senha, device key)
atravessa a API intermediária.

### `status` — Cenário C (cliente já vinculado)

`GET /functions/v1/status/{public_id}` → chama
`GET /gerenciador/api/v1/cliente/{public_id}` no Rocket.

```json
// encontrado
{ "outcome": "success", "linkState": "linked", "publicId": "...", "syncedAt": "...", "cliente": { "nome": "...", "vencimento": "...", "planoNome": "...", "servidorNome": "...", "telas": 1 } }

// nao encontrado (404 do Rocket)
{ "outcome": "success", "linkState": "unlinked", "publicId": null, "syncedAt": "..." }

// Rocket indisponivel, erro, ou secrets ausentes
{ "outcome": "unavailable", "linkState": "unlinked", "publicId": null, "syncedAt": "..." }

// public_id ausente/malformado na URL (400)
{ "outcome": "invalid_request", "linkState": "unlinked", "publicId": null, "syncedAt": "..." }
```

### `match` — Cenário B (cliente existe, ainda não vinculado)

`GET /functions/v1/match?<campos>` → chama
`GET /gerenciador/api/v1/clientes/` no Rocket, com os filtros
recebidos (allowlist: `nome`, `usuario`, `telefone`, `email`, `mac`,
`pix`, `link_m3u`, `painel_id`, `busca`). 0/1/N candidatos decidido
por `paginacao.total` da resposta do Rocket, nunca por
`itens.length` isolado.

```json
// nenhum candidato
{ "outcome": "no_match", "candidates": [] }

// um candidato
{ "outcome": "single_match", "candidates": [{ "publicId": "...", "nome": "...", "usuario": "..." }] }

// multiplos candidatos
{ "outcome": "multiple_matches", "candidates": [{ "publicId": "...", "nome": "...", "usuario": "..." }, ...] }

// Rocket indisponivel, erro, ou secrets ausentes
{ "outcome": "unavailable", "candidates": [] }

// nenhum parametro de busca informado (400)
{ "outcome": "invalid_request", "candidates": [] }
```

## Fase 3 — esqueleto mínimo (histórico, preservado)

`fase3-mock` continua implantada, só como registro histórico de que o
caminho Central → HTTPS → Edge Function → JSON foi provado antes de
qualquer conexão real com o Rocket — não é mais o próximo passo, não
foi removida (arquivo órfão intencional, mesma disciplina de não
remover sem autorização explícita já usada em `inovatv_central`).

## Estrutura

```
supabase/
  functions/
    fase3-mock/index.ts   # Fase 3, historico
    status/index.ts       # Fase 4, Cenario C
    match/index.ts         # Fase 4, Cenario B
```

Projeto Supabase: novo, plano Free, separado do projeto do Painel
(`InovaTV Platform`) — nunca compartilha organização de dados com ele
(ADR-021, `inovatv_painel`).
