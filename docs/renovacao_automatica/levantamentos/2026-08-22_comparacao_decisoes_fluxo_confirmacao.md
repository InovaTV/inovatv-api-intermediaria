# Comparação técnica — 3 decisões pendentes do fluxo de confirmação por clique

> **Levantamento/comparação, não implementação nem decisão.** Nenhum
> código, nenhuma migration, nenhum deploy, nenhuma alteração de
> prompt. Continua
> `2026-08-22_desenho_fluxo_comprovante_confirmacao_renovacao.md`.
> **Prompt congelado não alterado nesta etapa, por instrução
> explícita.**

## Achado crítico primeiro — muda a leitura da Decisão 2

Antes de comparar, um fato que não estava claro no desenho anterior e
**muda a recomendação**: **nunca foi confirmado que o `PATCH` via
`ROCKET_API_KEY` (POCs #1/#2) realmente prorroga o serviço real do
cliente no Sigma (painel upstream de IPTV)** — as duas POCs só
confirmaram que o campo `vencimento` do **Rocket** mudou e que uma
mensagem foi enviada. **Nunca reconsultaram o painel Sigma** pra ver
se o acesso de verdade foi prorrogado.

Isso é diferente do mecanismo de sessão do Vault (`POST
pagamento/add`, `inovatv_meta_business_agent` CLAUDE.md §16), que
**foi confirmado com reconsulta independente ao Sigma** — plano
trocado, crédito do revendedor debitado, de verdade.

**Risco real, não hipotético:** se o `PATCH` isolado não prorroga o
Sigma, usar esse caminho faria o sistema mandar "renovação
confirmada!" pro cliente **enquanto o serviço real dele continua
vencido** — uma falsa confirmação, pior do que não automatizar nada.
**Isto não está resolvido nem testado — é o fato que mais pesa nas
três comparações abaixo.**

## Decisão 1 — Onde hospedar a tela/link de confirmação

| Opção | A favor | Contra |
|---|---|---|
| **A — dentro do Next.js do Painel** (`painel/`, mesmo projeto Vercel) | Reaproveita deploy/infra já paga (free tier), mesmo padrão já usado pro `/reset-password` (rota pública, sem exigir login, já existe como precedente no mesmo projeto) | Mistura propósito (ferramenta interna vs. página pública pro cliente) no mesmo projeto |
| **B — novo projeto Next.js separado** | Isolamento mais limpo de responsabilidade | Setup duplicado (novo projeto Vercel, env vars, pipeline) sem ganho técnico real — **descartada por não trazer benefício que justifique o esforço** |
| **C — Edge Function pura servindo HTML** (Supabase, sem Next.js) | Menos peça nova — mesmo padrão já usado em `webhook`/`fase3-mock`; a tela é simples (mostrar dados + botão, sem interatividade React de verdade); zero dependência do Vercel | Sem reaproveitar o "visual" já existente do Painel; precisaria escrever HTML/CSS à mão dentro da function |

**Não recomendo uma sozinho** — mas registro que a comparação real é
entre A e C (B eliminada por falta de vantagem). A favorece
consistência visual e reaproveita um precedente exato
(`/reset-password`); C favorece simplicidade e menos peças novas.

## Decisão 2 — `PATCH` direto vs. sessão do Vault (revisada pelo achado crítico)

| Critério | PATCH direto (`ROCKET_API_KEY`) | Sessão Vault (`pagamento/add`) |
|---|---|---|
| **Prorroga o Sigma de verdade?** | ❌ **Não confirmado — risco real (ver acima)** | ✅ **Confirmado com reconsulta independente** |
| **Depende de login manual periódico?** | ❌ Não — chave de API dura 90 dias, renovação simples | ⚠️ Sim — sessão expira, login sempre manual (Turnstile) |
| **Quem manda a confirmação ao cliente?** | Nós (nosso template) — **elimina dependência do RocketZap** | RocketZap, automaticamente — **mantém a dependência que queremos eliminar** |
| **Já testado de ponta a ponta?** | ✅ 2x (POCs #1/#2), mas sem verificar Sigma | ✅ 1x manual + 1x via script (§16), com verificação completa |
| **Risco de mensagem duplicada** | Nenhum — só nós enviamos | ⚠️ Se nós também enviássemos algo, duplicaria com o RocketZap (mesmo problema já identificado como "Opção B" no levantamento anterior) |

**Tensão real, não resolvida:** os dois objetivos do projeto —
"eliminar dependência do RocketZap" e "garantir que a renovação é
real, não só no papel" — **empurram pra lados opostos** aqui. PATCH
resolve o primeiro mas não prova o segundo; sessão Vault prova o
segundo mas não resolve o primeiro.

**Recomendação de próximo passo, não de decisão final:** antes de
escolher entre os dois, seria preciso um **teste controlado real e
isolado** — fazer o `PATCH` no cliente de teste e **reconsultar o
Sigma de forma independente** (mesma metodologia já usada no §16) pra
ver se o campo lá também mudou. Só depois disso a Decisão 2 pode ser
tomada com informação real, não com suposição. **Isto não foi
executado nesta etapa** — fica registrado como a pendência mais
importante de todo este documento.

## Decisão 3 — Template vs. texto livre na confirmação final (depende da Decisão 2)

**Não é uma decisão independente** — o resultado da Decisão 2 muda a
pergunta:
- **Se PATCH direto:** somos nós quem confirma — aí sim vale comparar
  template vs. texto livre. Recomendação (mantida do desenho
  anterior): **sempre template**, independente do tempo decorrido —
  mais simples (não precisa checar se a janela de 24h ainda está
  aberta) e mais seguro (nunca falha por estar "fora de janela").
- **Se sessão Vault:** o RocketZap já manda a confirmação sozinho —
  **nós não deveríamos mandar nenhuma confirmação nossa**, sob risco
  de duplicar mensagem (mesmo problema já registrado). Nesse cenário,
  a "Decisão 3" desaparece — não há nada nosso a decidir aqui.

## Detalhamento pedido — como cada caso ficaria (independente da Decisão 2, exceto onde indicado)

**Múltiplos acessos:** mesma regra já existente (Componente 1 §8) —
se `/match` retorna mais de um candidato, o Gemini/Validador nunca
escolhem sozinhos qual acesso o comprovante se refere. O fluxo de
confirmação só é considerado depois de esclarecido qual acesso
específico — o token sempre amarra a **um** `public_id`, nunca
ambíguo.

**Dados extraídos do comprovante:** ficam guardados no token
(`dados_identificados`, jsonb) só pra **exibição** na tela de
conferência. **Nunca usados pra decidir o cálculo da renovação** — o
`PATCH`/sessão continua usando a mesma lógica de período do plano
real já testada (`somarPeriodo`, baseada no plano do Rocket, não no
que a imagem mostra).

**Valor identificado só pela imagem:** rotulado explicitamente como
"valor identificado no comprovante" na tela — nunca "valor
confirmado". Nunca influencia nenhum cálculo técnico. Puramente
informativo, pro cliente conferir visualmente.

**Token de uso único:** hash armazenado (nunca o token puro em
texto), reivindicação atômica (`UPDATE ... WHERE usado_em IS NULL`,
mesmo padrão já usado em `assumir_atendimento`), janela de expiração
curta (24-48h, mesmo padrão já desenhado em `2026-08-21_gatilho_meta_renovacao.md`).

**Reconsulta do estado antes de renovar:** sempre um `GET` novo no
momento do `POST` (clique real) — nunca confia no que valia quando o
token foi gerado. Mesma disciplina já usada em toda a investigação
(inclusive nas POCs já feitas).

**Falha na renovação:** se o `PATCH`/sessão falhar, ou a reconfirmação
(`GET` depois) não bater com o esperado, o token é marcado
`resultado = falha`, mostra página genérica de erro ao cliente, e —
igual à disciplina já usada em todo o Orquestrador — **aciona
transferência humana**, nunca falha silenciosamente.

**Clique repetido / token expirado:** clique duplo é coberto pela
reivindicação atômica (só a primeira requisição de fato executa,
mesma corrida já testada em produção no `assumir_atendimento`). Link
expirado mostra página informativa ("link expirado"), nunca executa
nada — mesma garantia estrutural já desenhada (`GET` nunca tem
capacidade de agir, independente de estado do token).

## Resumo do que falta pra fechar as três decisões

1. **Decisão 1** — escolher entre A (Next.js/Painel) e C (Edge
   Function pura). Comparação pronta, falta só a escolha.
2. **Decisão 2** — **não pode ser fechada com segurança sem o teste
   controlado real** (PATCH + reconsulta independente ao Sigma). É a
   pendência mais importante deste documento.
3. **Decisão 3** — depende diretamente do resultado da Decisão 2, não
   decidível isoladamente.

**Prompt de sistema continua intocado. Nenhuma implementação, nenhuma
migration, nenhum deploy, nenhuma renovação real executada nesta
etapa.**
