# Componente 2 — Proposta de Migration + Carga Inicial (V1)

> **NÃO APLICADO — proposta para revisão.** Nenhum comando deste
> documento foi executado contra o banco. A migration referenciada
> (`supabase/migrations/20260822120000_conhecimento_institucional.sql`)
> foi criada como arquivo, mas não aplicada (`db push` ou execução
> manual no SQL Editor) até aprovação explícita do usuário. Nenhum
> commit, deploy ou alteração de código foi feito a partir deste
> documento.
>
> Conteúdo de origem: `docs/conhecimento_institucional/RASCUNHO_CONTEUDO_V1.md`
> (dono único do texto aprovado) — este documento só mapeia esse
> conteúdo já revisado para o formato de linhas da tabela. Onde o
> `conteudo` de uma entrada é citado como "= item X.Y", é o texto
> literal daquele item no rascunho, sem alteração.

## 1. Schema (proposto, ver migration)

```sql
conhecimento_institucional
├── id              uuid, pk
├── categoria       text
├── titulo          text
├── palavras_chave  text[]
├── conteudo        text
├── ativo           boolean default true
└── atualizado_em   timestamptz default now()
```

RLS habilitado, sem policy para `anon`/`authenticated` — só
`service_role`, mesmo isolamento das demais tabelas da IA própria.

## 2. As decisões de consolidação já fechadas (rodada 2, 2026-08-22)

1. **Testes:** item **4.4** do rascunho é a fonte única (geral 6h,
   ChannelTV 6h, NewOne 4h, Blaze 2/4/6/12h, UniTV 3 dias). Itens 1.2
   e 1.4 marcados como histórico no rascunho, não geram entrada.
2. **Compatibilidade servidor × aplicativo × aparelho:** itens 2.24 e
   4.6 **excluídos** desta carga — matriz real não existe ainda,
   fica como pendência de conteúdo (não de arquitetura).
3. **Itens 2.23 e 2.25 — CONFIRMADOS, incluídos** na carga de
   `suporte_tecnico` (entradas 23 e 24 da seção 4).
4. **Regras Gerais (2.26 + Bloco 3 inteiro) — Opção B escolhida: NÃO
   entram na carga inicial.** O mecanismo de busca por palavra-chave
   do Componente 2 não recuperaria de forma confiável uma entrada de
   comportamento (nenhum cliente pergunta "quais são as regras de
   atendimento"). Conteúdo continua documentado no
   `RASCUNHO_CONTEUDO_V1.md`, fora da tabela por ora — candidato a uma
   futura revisão do prompt de sistema congelado, decisão separada,
   não feita aqui.

---

## 3. Entradas propostas — `catalogo_planos` (2 entradas)

| # | Título | Palavras-chave | Conteúdo |
|---|---|---|---|
| 1 | Planos disponíveis | planos, valores, preço, preços, mensalidade, quanto custa, assinatura | = itens 1.1/4.3 (30/90/180/365 dias — R$35/90/180/300). Nota: catálogo único, não varia por servidor (item 1.3) — incluído como frase final desta entrada, não como entrada própria. |
| 2 | Teste grátis | teste, teste grátis, testar, experimentar, degustação, cortesia | = item 4.4 completo (geral 6h, ChannelTV 6h, NewOne 4h, Blaze 2/4/6/12h incl. opção sem conteúdo adulto, UniTV 3 dias) + instrução de considerar o servidor do cliente (via Rocket) antes de informar a duração específica. |

## 4. Entradas propostas — `suporte_tecnico` (24 entradas, confirmadas)

Cada uma das 22 entradas abaixo usa o texto literal do item
correspondente do rascunho como `conteudo` — títulos e palavras-chave
são propostos por mim para revisão, o conteúdo em si não muda uma
vírgula do que você já aprovou.

| # | Item origem | Título | Palavras-chave propostas |
|---|---|---|---|
| 1 | 2.1 | Não consigo entrar | login, entrar, não consigo entrar, acesso negado |
| 2 | 2.2 | Usuário ou senha não funcionam | senha errada, usuário incorreto, senha não funciona, credenciais |
| 3 | 2.3 | Meu acesso não aparece | acesso não aparece, sumiu, não encontro meu acesso |
| 4 | 2.4 | Aplicativo não abre | não abre, aplicativo não abre, app não inicia |
| 5 | 2.5 | Aplicativo trava | travando, trava, congelou, travou |
| 6 | 2.6 | Aplicativo fecha sozinho | fecha sozinho, cai, fechando sozinho, crash |
| 7 | 2.7 | Canais travando | canal travando, canais travando, travamento |
| 8 | 2.8 | Canais carregando lentamente | lento, demorando, carregando devagar, lentidão |
| 9 | 2.9 | Canais não carregam | canais não carregam, não carrega, sem sinal |
| 10 | 2.10 | Tela preta | tela preta, sem imagem, tela escura |
| 11 | 2.11 | Sem áudio | sem áudio, sem som, mudo |
| 12 | 2.12 | Imagem congelada | imagem congelada, travando imagem, parada |
| 13 | 2.13 | EPG não aparece | epg, guia de programação, grade de programação |
| 14 | 2.14 | Lista de canais não aparece | lista de canais, não aparece lista, sem canais na lista |
| 15 | 2.15 | Filmes ou séries não carregam | filmes, séries, vod, não carrega filme |
| 16 | 2.16 | Problema somente em alguns canais | alguns canais, só alguns canais, determinado canal |
| 17 | 2.17 | Problema em todos os canais | todos os canais, nenhum canal funciona |
| 18 | 2.18 | Aplicativo desatualizado | ~~atualizar, atualização, versão antiga, desatualizado~~ → **revisado (rodada 3):** desatualizado, versão antiga, versão desatualizada, tem atualização, existe atualização, atualização disponível, qual a versão, versão mais recente, última versão |
| 19 | 2.19 | Problema depois de atualizar o aplicativo | ~~depois de atualizar, após atualização, parou depois da atualização~~ → **revisado (rodada 3):** atualizei, depois de atualizar, após atualizar, após a atualização, depois da atualização, parou depois de atualizar, parou após atualizar, não abre depois de atualizar, quebrou depois de atualizar, parou de funcionar depois da atualização |
| 20 | 2.20 | Problema depois de trocar de aparelho | troquei de aparelho, novo aparelho, mudei de dispositivo |
| 21 | 2.21 | Problema depois de trocar a internet | troquei de internet, nova internet, mudei o wifi |
| 22 | 2.22 | Internet funciona, mas o serviço não funciona | internet funciona mas não funciona o app, internet ok mas não abre |
| 23 | 2.23 | Precisa reinstalar o aplicativo | reinstalar, reinstalar aplicativo, reinstalar app |
| 24 | 2.25 | Não sabe onde colocar usuário e senha | onde coloco usuário e senha, onde digitar usuário, configurar aplicativo |

**Deixado de fora (decisão já registrada):** 2.24 (compatibilidade —
excluído, matriz real não existe).

## 5. Entradas propostas — `institucional` (3 entradas)

| # | Item origem | Título | Palavras-chave propostas |
|---|---|---|---|
| 1 | 4.1 | O que é a InovaTV | quem é, o que é a inovatv, sobre a empresa, quem vocês são |
| 2 | 4.2 (+3.12) | Atendimento e horário | horário, atendimento, whatsapp, atende, funcionamento |
| 3 | 4.5 | Reembolso | reembolso, dinheiro de volta, estorno, cancelamento com reembolso |

## 6. Entrada mesclada de "Regras Gerais" (2.26 + Bloco 3) — DECIDIDO: Opção B, não entra na carga

Decisão fechada pelo usuário: o mecanismo de busca por palavra-chave
do Componente 2 (§7) não recupera de forma confiável uma entrada de
comportamento (nenhum cliente pergunta "quais são as regras de
atendimento"). Criar essa entrada geraria a falsa impressão de que as
15 regras + a 2.26 estão "implementadas", quando na prática o Gemini
provavelmente nunca as receberia via busca. **Não entra na carga
inicial.** Conteúdo permanece documentado no `RASCUNHO_CONTEUDO_V1.md`
(seções 2.26 e Bloco 3), explicitamente marcado como fora da tabela —
candidato a uma futura revisão do prompt de sistema congelado, decisão
e processo de validação próprios, não feitos aqui.

---

## 7. Resumo — o que entra na primeira carga (fechado)

- **`catalogo_planos`:** 2 entradas.
- **`suporte_tecnico`:** 24 entradas (22 + itens 2.23/2.25 confirmados).
- **`institucional`:** 3 entradas.
- **Regras Gerais:** 0 entradas (Opção B — fora da tabela).
- **Total: 29 entradas.**

**Fora desta carga, permanecem pendentes (sem mudança):** matriz de
compatibilidade servidor×aplicativo×aparelho (2.24/4.6), indicação,
cancelamento, texto de apresentação institucional, outras condições
comerciais (item 4.10 do rascunho), e as 15 regras do Bloco 3 + 2.26
(decisão desta seção).

## 8. SQL de `INSERT` final

Ver `docs/conhecimento_institucional/PROPOSTA_INSERT_V1.sql` — as 29
entradas com `conteudo` literal completo (não mais por referência),
prontas para revisão linha a linha. **Não executado.**

## 9. Testes reais do algoritmo (rodada 3, 2026-08-22)

Implementei o algoritmo do Componente 2 §7 (normalização + pontuação +
desempate) num script Node descartável, rodado localmente contra as
29 entradas — nenhuma tabela real, nenhuma chamada ao Supabase, nada
persistido. Resultados completos na conversa; resumo aqui.

### 9.1 — Colisão 18/19 (Aplicativo desatualizado × Problema depois de atualizar)

Com as palavras-chave **originais**, 3 das 5 frases de teste não
batiam com nenhuma entrada (score 0), e uma batia com a entrada
**errada** ("Aplicativo não abre"). Com as palavras-chave
**revisadas** (aplicadas no SQL), 4 das 5 frases passaram a rotear
corretamente:

| Frase | Original | Revisado |
|---|---|---|
| "meu aplicativo está desatualizado" | ✅ Aplicativo desatualizado | ✅ Aplicativo desatualizado |
| "qual a versão mais atual?" | ❌ nenhuma correspondência | ✅ Aplicativo desatualizado |
| "depois que atualizei parou" | ❌ nenhuma correspondência | ✅ Problema depois de atualizar |
| "atualizei e agora não abre" | ❌ Aplicativo não abre (errado) | ⚠️ **ambíguo** (empata com "Aplicativo não abre", score 1 x 1) |
| "atualizei o aplicativo e ele parou" | ❌ nenhuma correspondência | ✅ Problema depois de atualizar |

**A 5ª frase não ficou 100% resolvida** — a palavra "abre" nela
também aciona a entrada "Aplicativo não abre" (palavra-chave "não
abre"), empatando com "atualizei" (agora keyword de "Problema depois
de atualizar"). Resultado: em vez de responder errado (como antes), o
sistema fica **ambíguo e transfere para humano** — mais seguro que o
comportamento anterior, mas não é o roteamento exato que se pediu
testar. Registrado, não corrigido além disso (fora do escopo desta
rodada de ajuste).

### 9.2 — Casos de canais (11/18/19) — sem alteração, achados registrados

Nenhum empate real entre as 3 entradas de canais nas 5 frases
testadas. Mas o teste revelou dois problemas **mais sérios que
empate** — roteamento confiante para entrada **errada**, fora do
grupo de canais:

| Frase | Resultado real |
|---|---|
| "nenhum canal funciona" | ✅ Problema em todos os canais |
| "só alguns canais estão ruins" | ✅ Problema somente em alguns canais |
| "os canais não carregam" | ✅ Canais não carregam |
| "um canal específico não abre" | ❌ **Aplicativo não abre** (nenhuma entrada de canais tem palavra-chave para "canal específico") |
| "todos os canais estão travando" | ❌ **Aplicativo trava**, score 2 (bateu "travando" + "trava") — vence "Problema em todos os canais", score 1 |

**Causa raiz do segundo caso:** "trava" é literalmente uma substring
de "travando" — a mesma palavra do texto do cliente conta 2 pontos
para a entrada "Aplicativo trava" (2 palavras-chave dela, uma contida
na outra), superando a única palavra-chave que bateria em "Problema em
todos os canais". Achado sistêmico, não específico dos casos de
canais — qualquer entrada com palavras-chave genéricas de uma palavra
só (como "trava"/"travando", "não abre") corre risco de vencer outras
entradas mais específicas por pontuação bruta, mesmo em contexto
errado.

**Nenhuma palavra-chave de canais foi alterada**, por instrução
explícita — ficam registrados como achados para decisão futura.
