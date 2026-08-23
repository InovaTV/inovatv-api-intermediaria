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

## `export-clientes` — exportação em massa sanitizada (2026-08-14, implementado e testado; REMOVIDA DO DEPLOY em 2026-08-23)

**Não está mais implantada.** Removida (`supabase functions delete`)
por não ter mais nenhum consumidor ativo — o único era
`gerar-clientes-xlsx.mjs`, script da arquitetura Meta Business Agent
abandonada, hoje isolado em `scripts/meta_business_agent/`. Código
preservado em `supabase/functions/export-clientes/index.ts` só como
histórico; não reimplantar sem um consumidor real novo e decisão
explícita.

Uso interno da automação Rocket → Google Drive → Meta AI (contexto de
negócio completo em `inovatv_central`, seção "Frente — IA do WhatsApp
(Meta Business Agent) + automação Rocket → Google Drive" do
`CLAUDE.md`) — **nunca exposto à Meta**, que só enxerga o arquivo
resultante no Google Drive, nunca esta API. Mesmo padrão de código e de
proteção (verificação JWT padrão das Edge Functions) de `/status` e
`/match`.

`GET /functions/v1/export-clientes?page=N` → chama `GET
/gerenciador/api/v1/clientes/?page=N&page_size=100` no Rocket, sem
nenhum filtro (varre o catálogo inteiro, paginado — busca filtrada
continua sendo papel do `/match`). `page_size` sempre fixo em 100,
nunca vindo de quem chama, para manter o comportamento previsível e
dentro do limite de 60 req/min do Rocket (compartilhado com `/match` e
`/status`).

```json
// sucesso
{ "outcome": "success", "page": 1, "totalPages": 2, "clientes": [ { "publicId": "...", "nome": "...", "telefone": "...", "usuario": "...", "planoNome": "...", "servidorNome": "...", "valor": "...", "vencimento": "...", "telas": 1, "aplicativoNome": "...", "dispositivoNome": "..." } ] }

// pagina invalida (nao inteiro ou < 1)
{ "outcome": "invalid_request", "page": null, "totalPages": null, "clientes": [] }

// Rocket indisponivel, erro, ou secrets ausentes
{ "outcome": "unavailable", "page": 1, "totalPages": null, "clientes": [] }
```

**Nunca repassa `senha` nem `device_key_or_OTP_code`.** `publicId` é
mantido na resposta — serve só para a lógica de comparação/diff da
automação (saber que é o mesmo cliente entre uma execução e outra);
quem gerar `CLIENTES_INOVATV.xlsx` a partir desta resposta **não deve
incluir `publicId` como coluna do arquivo** (decisão já tomada, ainda
não implementada — é a Etapa 2 da automação, ver `inovatv_central`).

**Testado com evidência real (2026-08-14):** implantado manualmente via
editor do painel do Supabase (CLI não instalada neste ambiente) no
projeto correto (`inovatv-api-intermediaria`, ref
`nduxsuxkopuvhwugdkqi` — **atenção**: o arquivo local
`supabase/.temp/linked-project.json` deste repositório está apontando
para o projeto errado, `InovaTV Platform`/`deovfultywlftlvdzukc`, o do
Painel; corrigir antes de usar `supabase` CLI para deploy). Chamado
via painel "Test" do Supabase (`page=1` e `page=2`): `outcome:
success` nas duas, `totalPages: 2` consistente, paginação devolvendo
clientes diferentes por página, `planoNome`/`servidorNome` confirmados
como texto simples (não objeto aninhado), nenhum `senha`/
`device_key_or_OTP_code` em nenhum registro. Cliente real conferido —
"Js Informática Rp" (o mesmo usado nos testes da Meta AI):
`servidorNome: "ChannelTV"`, `valor: "35.0"`, `vencimento:
"2026-08-31T23:59:00-03:00"` — idêntico ao que a Meta AI já tinha
reportado antes, fechando o ciclo com evidência cruzada real.

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
    export-clientes/index.ts  # Automacao WhatsApp AI, 2026-08-14 -- REMOVIDA DO DEPLOY em 2026-08-23, codigo so como historico
```

Projeto Supabase: novo, plano Free, separado do projeto do Painel
(`InovaTV Platform`) — nunca compartilha organização de dados com ele
(ADR-021, `inovatv_painel`).
