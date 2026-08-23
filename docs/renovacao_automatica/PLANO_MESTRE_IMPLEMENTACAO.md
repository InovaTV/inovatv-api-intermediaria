# Plano Mestre de Implementação — Renovação Automática + Homologação

> **Isto é planejamento, não autorização de execução.** Este
> documento organiza em etapas concretas o que já foi decidido nas
> Lacunas 1-10 (`documentos/levantamentos/2026-08-22_fluxo_renovacao_automatica_pagbank_rocket_cloudapi.md`)
> e na Matriz de Homologação (`documentos/levantamentos/2026-08-22_matriz_homologacao_numero_teste.md`).
> **Nenhuma das decisões arquiteturais é reaberta aqui** — este
> documento só sequencia o que já foi fechado.
>
> **Regra permanente deste plano:** cada etapa que envolver código,
> migration, configuração, deploy ou teste real continua exigindo
> **aprovação própria**, mesmo já estando neste plano. Estar listada
> aqui não autoriza começar — só organiza a ordem e as dependências.

## Estado da base, ao iniciar este plano (22/08/2026)

- **Lacunas 1-10:** fechadas e documentadas (commits `d0e5d6d` até `0e02187`, ver documento consolidado).
- **Matriz de Homologação:** commitada (`df8e3a7`), com ordem de dependência já ajustada.
- **Renovação Sigma via HTTP direto:** comprovada (Lacuna 6), sem Playwright/Chromium.
- **Consulta PagBank por `charge_id`:** comprovada.
- **Fluxo de duas confirmações** (PagBank confirma o dinheiro, clique autoriza): decidido.
- **RocketZap:** continua funcionando normalmente no número oficial, sem alteração — mantido enquanto o novo sistema é construído.
- **Número oficial:** **não migra** até este plano inteiro estar homologado.
- **Número de teste (`17996286135`):** ambiente de homologação completo — não só do fluxo de renovação, também mídia e Calling API.
- **Motor de lembretes:** será reconstruído na nossa infraestrutura — confirmado hoje que o Rocket não expõe nenhum mecanismo de captura de eventos (API documentada, painel, e uma tentativa real de espelhamento via telefone secundário, todos investigados e descartados como caminho viável de ponte permanente).

## Princípio central, repetido porque importa

**Planejamento não é autorização de execução.** As etapas abaixo têm ordem e dependências claras, mas isso não significa "pode implementar tudo em sequência sem parar". Cada etapa começa só quando explicitamente aprovada.

## Status atual, visão rápida

**Regra do status `✅ Homologado`:** só é marcado depois de evidência real observada (execução real, reconsulta independente) — nunca só porque o código foi criado ou passou em teste local.

| Etapa | Status |
|---|---|
| 0 — Base do canal/identidade | ✅ Homologado |
| 1 — `propor_renovacao` | 🔲 Não iniciado |
| 2 — `cobrancas_pix`/`tokens_renovacao` | 🔲 Não iniciado |
| 3 — Criação da cobrança + valor real | 🔲 Não iniciado |
| 4 — Mensagens fixas | 🔲 Não iniciado |
| 5 — Edge Function do token + reconsulta PagBank | 🔲 Não iniciado |
| 6 — Renovação Sigma + confirmação | 🔲 Não iniciado (comportamento já comprovado, código de produção não) |
| 7 — Ponta a ponta | 🔲 Não iniciado |
| Paralela A — Mídia | 🔲 Não iniciado |
| Paralela B — Motor de lembretes | 🔲 Não iniciado |
| Paralela C — Calling API | 🔲 Não iniciado |

---

## Etapas de implementação, em ordem de dependência

### Etapa 0 — Base do canal e identidade
**Status: ✅ Homologado** — já pronta, nenhum trabalho novo. Texto recebido/enviado, IA respondendo, identificação do cliente via `/match`/`/status`. Fundação sobre a qual tudo abaixo é construído.

---

### Etapa 1 — `propor_renovacao` (porta de entrada do núcleo)
**Status: 🔲 Não iniciado**
**Depende de:** Etapa 0 (já pronta).
**O que é construído:**
- Extensão do contrato estruturado do Gemini: novo `tipo: "propor_renovacao"` (Lacuna 2).
- Alteração do `SYSTEM_PROMPT` congelado — mudança sensível, exige disciplina própria do projeto.
- Regras novas do Validador (Lacuna 3): cliente identificado, acesso determinado (rótulo obrigatório se múltiplos acessos), sem checagem de elegibilidade por vencimento.
**Pré-requisito explícito, não pulável:** nova rodada de validação comportamental (mesmo padrão das Rodadas 3/4) antes de qualquer coisa ir pra produção — alterar prompt sem essa rodada não é aceitável, já registrado como disciplina permanente do projeto.
**Critério de homologação:** bateria de casos reais (intenção clara, intenção ambígua, cliente não identificado, múltiplos acessos) rodada no número de teste, sem falso positivo/negativo, sem regressão nos comportamentos já validados (Rodadas 3/4 originais).

---

### Etapa 2 — Infraestrutura de dados do núcleo
**Status: 🔲 Não iniciado**
**Depende de:** nada tecnicamente, mas não faz sentido antes da Etapa 1 decidir o contrato que vai preencher essas tabelas.
**O que é construído:**
- Tabela `cobrancas_pix` (Lacuna 1/7, desenho em `2026-08-22_desenho_pagbank_fluxo_renovacao.md` §6/§8).
- Tabela `tokens_renovacao`, vinculada a `operacao_id` — não a `public_id` direto (Lacuna 4/9). Já registrada a pendência de distinguir "tentativa" de "concluído" (Lacuna 9, decisão 1) — resolver no desenho do schema desta etapa, não antes.
**Critério de homologação:** migrations aplicadas, `RLS`/isolamento de acesso confirmados (mesmo padrão já usado em outras tabelas do projeto — nunca exposta a `anon`/`authenticated`).

---

### Etapa 3 — Criação da cobrança + valor real do cliente
**Status: 🔲 Não iniciado**
**Depende de:** Etapas 1 e 2.
**O que é construído:**
- Busca do valor real do cliente via `GET /gerenciador/api/v1/cliente/{public_id}` → campo `valor` (Lacuna 7 — nunca catálogo, nunca OCR, nunca IA).
- Criação da cobrança PagBank real, `reference_id` = `operacao_id` nosso.
- Regra de "uma cobrança pendente por acesso" (Lacuna 9, decisão 2).
- Tratamento de "sem `valor` cadastrado" → não cria cobrança, transfere (Lacuna 7).
**Critério de homologação:** criar 1 cobrança de teste real, confirmar `reference_id`/`charge.id` corretos; testar especificamente com um cliente de valor negociado divergente do catálogo (mesmo achado real de hoje, ex. R$30 em vez de R$35), confirmar que o valor certo é usado.

---

### Etapa 4 — Mensagens fixas
**Status: 🔲 Não iniciado**
**Depende de:** Etapa 3 (precisa de uma cobrança real pra descrever).
**O que é construído:**
- Mensagem intermediária fixa ("Vou preparar seu pagamento via Pix...", Lacuna 8).
- Mensagem com dados reais da cobrança (QR/valor), enviada só depois da cobrança existir de fato.
- Regra de nunca prometer cobrança que ainda não existe.
**Critério de homologação:** disparar as duas mensagens em sequência real, confirmar que a segunda só sai depois da cobrança confirmada, nunca antes.

---

### Etapa 5 — Edge Function pública do token + reconsulta PagBank
**Status: 🔲 Não iniciado**
**Depende de:** Etapa 2 (tabela `tokens_renovacao`) e Etapa 3 (precisa de cobrança real pra reconsultar).
**O que é construído:**
- Edge Function pura servindo HTML (Lacuna 5) — GET só leitura, nunca executa; POST reivindica token atomicamente.
- Reconsulta ao PagBank no momento do clique (Lacuna 4) — nunca confia só na confirmação antiga.
- Regra "PENDING no clique → token permanece utilizável" (Lacuna 9, decisão 1).
**Critério de homologação:** GET testado até com prévia de WhatsApp/crawler sem nenhum efeito colateral; POST só executa com clique real; teste de dois cliques simultâneos (reivindicação atômica); teste de clique com PagBank ainda `PENDING`.

---

### Etapa 6 — Renovação Sigma + confirmação final
**Status: 🔲 Não iniciado** (comportamento já comprovado — Lacuna 6 — mas o código de produção parametrizável ainda não existe)
**Depende de:** Etapa 5 (é o clique que aciona isso).
**O que é construído:**
- **Comportamento já comprovado** (Lacuna 6, HTTP direto + sessão Vault, sem Chromium) — aqui só generaliza a POC de hoje em código de produção parametrizável (recebe `public_id`/pacote/cliente reais, não fixos).
- Nunca retry automático se resultado desconhecido — reconsulta Sigma, se sem certeza, transferência humana (Lacuna 9, decisão 3).
- Envio da confirmação final (`pagamento_confirmado`) com dados reais devolvidos pelo Rocket.
**Critério de homologação:** 1 execução real completa, comparando Sigma antes/depois; teste do caminho de falha (simular timeout, confirmar que nunca chama o Rocket 2x pro mesmo token).

---

### Etapa 7 — Fluxo completo de ponta a ponta
**Status: 🔲 Não iniciado**
**Depende de:** Etapas 1-6, todas conectadas.
**O que é construído:** nada novo — é a integração de tudo o que já existe nas etapas anteriores.
**Critério de homologação:** 1 execução real completa — intenção reconhecida → cobrança criada → cliente paga de verdade → clique → renovação → confirmação — com um cliente de teste pagando de verdade, do início ao fim, sem intervenção manual no meio.

---

### Casos de borda (Lacuna 9) — não é uma etapa separada
Testados **junto de cada etapa acima**, à medida que ela for implementada — nunca como uma fase final isolada. Ex.: "PagBank `PENDING` no clique" só é testável depois que a Etapa 5 existir; "cobrança concorrente" só depois da Etapa 3.

---

### Etapa paralela A — Mídia (áudio/imagem/documento)
**Status: 🔲 Não iniciado**
**Depende de:** só a Etapa 0 (já pronta) — **não depende nem bloqueia as Etapas 1-7.**
**O que é construído:**
- Contrato Webhook→Orquestrador ganha campos de mídia (hoje só `{telefone, conteudo}`).
- Envio de áudio/imagem/documento pelo Painel de Atendimento (hoje só texto).
**Critério de homologação:** cliente manda áudio/imagem/documento real pelo Webhook, IA usa o conteúdo certo, sem inventar; atendente envia mídia pelo Painel, cliente recebe.

---

### Etapa paralela B — Motor de lembretes
**Status: 🔲 Não iniciado**
**Depende de:** só a Etapa 0 — **independente do núcleo (Etapas 1-7).** É pré-requisito da **migração do número oficial** (Lacuna 10), não da validação do fluxo de renovação.
**O que é construído:**
- Motor de agendamento real (cron, múltiplos clientes) — hoje só existe a `condicaoVenceHoje` isolada e uma POC manual descartável.
- Decisão de produto pendente (Lacuna 10): quais das 15 mensagens do RocketZap são consideradas essenciais antes da migração.
**Critério de homologação:** rodar 1 dia inteiro contra a base real de clientes de teste, sem falso positivo/negativo, comparando contra o que o Rocket teria disparado.

---

### Etapa paralela C — Calling API
**Status: 🔲 Não iniciado**
**Depende de:** nada — totalmente independente de tudo acima.
**O que é construído:** habilitação de Calling features, webhook `calls`, teste de 1 chamada de voz real.
**Critério de homologação:** confirmar elegibilidade da conta (≥ 2.000 destinatários únicos, ainda não medido), depois testar 1 chamada real no número de teste.

---

## O que fica explicitamente fora deste plano

- **Migração do número oficial em si** (Lacuna 10) — só depois que este plano inteiro estiver homologado, com checklist formal próprio, não coberto aqui.
- **Coexistence** — permanece como alternativa futura registrada, não adotada.
- **A ideia de usar o número de teste como "ponte" de eventos do RocketZap** — investigada e descartada nesta mesma sessão (API documentada sem webhooks, painel sem integração de saída, teste real de espelhamento via telefone secundário funcionou tecnicamente mas só sobrevive enquanto o RocketZap tiver sessão — não é solução permanente). Não será retomada sem evidência nova.
- **Mudança de plano** (upgrade/downgrade) dentro do fluxo de renovação — fora de escopo desde a Lacuna 7, é outro fluxo já existente no atendimento.

## Como usar este plano nas próximas sessões

Cada etapa, quando começar a ser implementada, deve:
1. Ser aprovada explicitamente antes do primeiro código.
2. Seguir o mesmo ritmo já usado o dia inteiro: mostrar plano/diff → testar local → aprovação → commit/push → deploy manual → só então (se for o caso) teste real.
3. Ter seu critério de homologação conferido com evidência real antes de ser marcada como concluída — nunca por suposição.

**Nada implementado a partir deste documento.** Ele só organiza a sequência — a primeira etapa a começar, quando autorizado, é a Etapa 1 (`propor_renovacao`).
