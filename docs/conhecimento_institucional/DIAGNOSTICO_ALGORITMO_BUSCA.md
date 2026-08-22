# Diagnóstico — Algoritmo de Busca do Componente 2 (§7)

> **Só leitura/diagnóstico — nenhuma alteração de código, migration,
> `INSERT`, commit ou deploy.** Este documento não propõe nem decide
> nenhuma mudança de arquitetura — isso é explicitamente responsabilidade
> de uma decisão futura (regra permanente já registrada no
> `inovatv_central/CLAUDE.md`: "a especificação técnica não decide
> arquitetura silenciosamente").

## 0. Premissa que precisa ficar clara antes de tudo

**Não existe, em nenhum lugar do código de produção, uma implementação
real do algoritmo de busca do Componente 2.** O Componente 2 continua
"100% no papel" — só especificação (`CLAUDE.md`) e os documentos de
rascunho/proposta desta frente. Os resultados que motivaram este
diagnóstico vieram de um **script de teste descartável**
(`teste_algoritmo_conhecimento.mjs`, escrito nesta sessão, fora do
repositório, no scratchpad) — não de código real do Orquestrador.

Portanto, este diagnóstico não é "achamos um bug em produção" — é
"o script que escrevi para testar as palavras-chave da carga V1 talvez
não implemente fielmente o que a especificação já descreve, e isso
merece ser esclarecido antes de qualquer implementação real."

## 1. Como a pergunta é normalizada (spec vs. script)

**Especificação (§7, passo 1):** *"Normaliza a pergunta do cliente:
minúsculas, sem acento/pontuação, **tokenizada em palavras**."*

**Script de teste:**
```js
function normalizar(s) {
  return s.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // remove acentos
    .replace(/[^\w\s]/g, ' ')                          // remove pontuação
    .replace(/\s+/g, ' ')
    .trim();
}
```

O script normaliza minúsculas/acento/pontuação corretamente, **mas
devolve uma única string, nunca uma lista de tokens/palavras**. A
palavra "tokenizada em palavras" do passo 1 da especificação nunca foi
implementada de fato — o script pulou essa etapa.

## 2. Como as palavras-chave são comparadas (spec vs. script)

**Especificação (§7, passo 2):** *"calcula pontuação = número de
palavras_chave que **aparecem** na pergunta normalizada."* O texto não
detalha mecanicamente o que "aparecem" significa quando a pergunta já
foi tokenizada — não há uma frase explícita tipo "cada palavra-chave é
comparada token a token" ou "como substring". Isso é uma **lacuna real
de especificação**, não só uma falha do meu script (ver seção 5).

**Script de teste:**
```js
const bateram = kwSet.filter((kw) => nq.includes(normalizar(kw)));
```

O script faz **correspondência de substring sobre a string inteira**
(`String.includes`) — nunca compara contra uma lista de tokens. Isso
significa que qualquer palavra-chave que seja um trecho contíguo de
caracteres em qualquer lugar do texto conta como presente, **mesmo que
não respeite fronteira de palavra**.

## 3. A implementação conta cada palavra-chave no máximo uma vez?

**Sim, isso está correto.** `Array.filter()` percorre cada palavra-chave
da lista uma única vez e verifica presença (booleano) — não conta
repetição dentro do texto. Se a mesma palavra-chave aparecesse 5 vezes
na pergunta, ainda contaria 1 ponto só. Este ponto específico da
especificação (§7, passo 2, "mesmo que apareça repetida no texto") foi
implementado fielmente no script.

## 4. Por que `"trava"` casa com `"travando"`

Causa mecânica exata: `"travando".includes("trava")` → `true`, porque
`"trava"` é literalmente os 5 primeiros caracteres de `"travando"` —
```
t r a v a n d o
t r a v a         <- "trava" cabe inteiro aqui, como substring
```
Isso é uma consequência **direta** de usar `String.includes()` (busca
de substring sobre caracteres) em vez de comparar unidades
tokenizadas (palavras inteiras). Se a pergunta e as palavras-chave
fossem de fato comparadas como listas de tokens (como o passo 1 da
especificação pede, mas o passo 2 não detalha como usar essa lista),
`"trava"` e `"travando"` seriam dois tokens diferentes,
**não equivalentes**, e essa correspondência não aconteceria.

## 5. A implementação corresponde exatamente ao algoritmo aprovado?

**Não exatamente — e a especificação em si tem uma lacuna, não só o
script.**

- O **passo 1** (normalizar + tokenizar) foi seguido só parcialmente
  pelo script: normalização sim, tokenização não.
- O **passo 2** (contagem de palavras-chave presentes) foi seguido no
  que diz respeito a "contar no máximo uma vez" (seção 3 acima), mas a
  especificação **nunca definiu mecanicamente** o que significa uma
  palavra-chave "aparecer" numa pergunta já tokenizada — não diz se é
  correspondência de substring de caracteres, de token exato, ou de
  sequência contígua de tokens (para palavras-chave de mais de uma
  palavra, como "todos os canais"). O script escolheu substring de
  caracteres, por ser a implementação mais simples — mas isso é uma
  **decisão implícita minha ao escrever o script de teste**, não algo
  que a especificação já tinha fechado.
- Os **passos 3 a 6** (ordenar, score 0 → nada, único no topo →
  retorna, empate → ambíguo) foram implementados fielmente no script,
  sem desvio.

**Teste de verificação — refazendo o cálculo manualmente com
correspondência por token (respeitando fronteira de palavra, exigindo
sequência contígua de tokens para palavras-chave de mais de uma
palavra) em vez de substring de caracteres**, usando a mesma frase
("todos os canais estão travando"):

- Tokens da pergunta: `[todos, os, canais, estao, travando]`
- Palavra-chave `"travando"` (token único) → presente na lista de
  tokens → bate.
- Palavra-chave `"trava"` (token único) → **não é igual a nenhum token
  da lista** (`"trava" ≠ "travando"`) → **não bate**.
- Resultado: "Aplicativo trava" pontuaria **1** (só "travando"), não 2.
- "Problema em todos os canais" (palavra-chave `"todos os canais"`,
  sequência contígua `[todos, os, canais]`) também pontua **1**.
- **Score fica empatado 1×1 → ambíguo → retorna nada** (transfere para
  humano), em vez do resultado atual do script (vitória errada e
  confiante de "Aplicativo trava" por 2×1).

Ou seja: **corrigir a tokenização para respeitar fronteira de palavra
já eliminaria, por si só, o caso `"trava"`/`"travando"`** — não
resolveria a frase para o resultado "certo" (ainda ficaria ambígua em
vez de acertar "Problema em todos os canais"), mas trocaria um erro
silencioso e confiante por uma transferência segura para humano, que é
exatamente o comportamento que a arquitetura já definiu como
fail-safe (§7, passo 6).

**Importante:** isso **não resolve** o outro achado ("um canal
específico não abre" → "Aplicativo não abre"). Refazendo esse caso com
correspondência por token: tokens da pergunta
`[um, canal, especifico, nao, abre]`; palavra-chave `"não abre"` =
sequência contígua `[nao, abre]`, que **está presente** nos últimos
dois tokens da pergunta. Esse é um match **legítimo** mesmo com
correspondência por token correta — o problema aqui não é o
mecanismo de comparação, é que **nenhuma entrada de canais tem
palavra-chave para "canal específico"** — um gap de cobertura de
conteúdo, não um bug de implementação.

## 6. Alternativas possíveis (registradas para decisão futura — não escolhidas aqui)

Nenhuma das opções abaixo é proposta como solução — são só o leque de
caminhos tecnicamente possíveis, para quando essa decisão for tomada
formalmente:

- **(a) Correspondência por token/fronteira de palavra** (em vez de
  substring de caracteres) — mais fiel à leitura literal do passo 1 da
  especificação ("tokenizada em palavras"); resolveria diretamente o
  caso `trava`/`travando`; não resolve gaps de cobertura de conteúdo
  nem o caso de palavra intercalada (ver "canais **estão** travando",
  abaixo).
- **(b) Token + normalização morfológica leve** (stemming/lematização
  simples: tratar "canal"/"canais", "atualizar"/"atualizei" como a
  mesma raiz) — reduziria a necessidade de listar manualmente cada
  variação de palavra como palavra-chave separada, mas adiciona
  complexidade e reduz um pouco a auditabilidade que motivou a escolha
  original de busca por palavra-chave em vez de embeddings (Arquitetura
  §7: "com keyword matching dá pra explicar exatamente por que um
  trecho foi escolhido").
- **(c) Correspondência de frase com tolerância a palavras intercaladas**
  (ex.: permitir até N palavras entre os tokens de uma palavra-chave de
  múltiplas palavras) — resolveria o caso "canais **estão**
  travando" (hoje nem substring nem token puro capturam isso, porque
  "estão" quebra a adjacência exigida por "canais travando"), mas
  aumenta o risco de correspondência acidental e exige mais calibração.
- **(d) Disciplina de curadoria, sem mudar o algoritmo** — nunca usar
  palavra-chave genérica de uma palavra só quando o significado depende
  de contexto (ex.: nunca cadastrar `"trava"` sozinha); mitigaria o
  sintoma sem mudar mecanismo, mas depende de disciplina humana
  contínua, não de garantia estrutural.
- **(e) Pontuação ponderada por especificidade** (frase de várias
  palavras vale mais que palavra única) — resolveria o caso
  `trava`/`travando` sem precisar de tokenização, mas **muda a regra
  já fechada na especificação** ("cada palavra-chave... sem peso, sem
  frequência") — deixaria de ser o algoritmo aprovado, viraria um novo
  algoritmo, exigindo decisão arquitetural explícita, não só correção
  de bug.

## 7. Resumo

| Pergunta | Resposta |
|---|---|
| Existe implementação de produção? | **Não** — só um script de teste descartável, fora do repositório |
| O script segue o passo 1 (normalizar+tokenizar)? | Normaliza sim, tokeniza não |
| O script conta cada palavra-chave no máximo 1x? | **Sim**, correto |
| Por que `trava` casa com `travando`? | Substring de caracteres, não correspondência por token — decisão implícita do script, não da especificação |
| A especificação já definia mecanicamente "correspondência por token" vs. "substring"? | **Não — é uma lacuna real da especificação**, nunca detalhada no §7 |
| Corrigir a tokenização resolve os 2 achados? | Resolve o caso `trava`/`travando` (vira empate/ambíguo, seguro). **Não** resolve "canal específico" (gap de conteúdo, não de algoritmo) |

## 8. Esclarecimento de especificação fechado (2026-08-22)

Decisão registrada em `inovatv_central/CLAUDE.md` (Componente 2, novo
item **7-A**, logo após o passo 6 do algoritmo original): a
correspondência de palavra-chave é por **token** (sequência contígua
de palavras), nunca por substring de caracteres. Não introduz peso,
stemming, especificidade nem qualquer mecanismo novo — é só a
mecânica que faltava no passo 2 original.

## 9. Harness fiel ao algoritmo (token) — bateria completa, 2026-08-22

Segundo script descartável
(`teste_algoritmo_v2_token.mjs`, scratchpad, não versionado),
implementando normalização → tokenização → correspondência por
sequência contígua de tokens → pontuação sem peso → desempate. Rodado
contra as 26 entradas (24 suporte + 2 catálogo) e 8 grupos de teste.

**Grupo A — bateria representativa (1 frase por entrada, 26 casos):**
25/26 resolveram corretamente para a própria entrada na primeira
tentativa. 1 divergência: **"estou com canais travando direto"**
(frase desenhada para testar "Canais travando") resultou em
**ambíguo** (empate 1×1 com "Aplicativo trava", que também bate no
token `"travando"`) em vez de resolver para "Canais travando"
sozinha. Achado novo, não previsto nos testes anteriores.

**Grupo B — normalização (acento/maiúsculas/pontuação):** 3/3 OK.
Confirma que a normalização (antes da tokenização) funciona
corretamente independente de acento, caixa ou pontuação.

**Grupo C — palavra-chave repetida:** OK. `"trava"` repetida 3x na
mesma frase ainda conta 1 ponto só, como já esperado.

**Grupo D — palavra-chave de múltiplos termos:** confirmado que a
correspondência exige tokens **contíguos** — inserir uma palavra no
meio de uma palavra-chave de vários termos quebra o match por
completo (`"todos os canais pararam"` bate; `"todos aqui os canais
pararam"` não bate em nada). Limitação conhecida, já prevista no
diagnóstico (seção 6, alternativa "c") — não corrigida aqui, por
instrução explícita.

**Grupo E — tentativa de empate:** a frase desenhada para forçar
ambiguidade (`"não consigo entrar, minha senha errada"`) **não
empatou** — "Não consigo entrar" venceu com 2 pontos (bateu duas
palavras-chave próprias, `"entrar"` e `"nao consigo entrar"`, porque
uma é subconjunto de token da outra) contra 1 ponto de "Usuário ou
senha não funcionam". Achado colateral: entradas cuja lista de
palavras-chave tem uma palavra curta que é subsequência de uma frase
mais longa da mesma entrada (ex.: `"entrar"` dentro de `"nao consigo
entrar"`) tendem a pontuar mais alto nesses casos — não é um erro,
é uma consequência direta da regra já aprovada ("cada palavra-chave
conta"), só registrado para conhecimento.

**Grupo F — ausência de correspondência:** OK, confirmado score 0 em
tudo pra frase sem relação nenhuma com o conteúdo.

**Grupo G — retest `trava`/`travando` com token:**
- `"meu aplicativo está travando"` e `"meu app trava direto"` →
  resolvem corretamente e sem ambiguidade para "Aplicativo trava".
- `"todos os canais estão travando"` → **ambíguo** (Aplicativo trava ×
  Problema em todos os canais), exatamente como previsto manualmente
  na rodada anterior — confirmado agora pelo harness real.
- `"um canal específico não abre"` → continua caindo em "Aplicativo
  não abre" (não muda com o token — confirma que é lacuna de
  conteúdo, não de algoritmo, como já diagnosticado).

**Grupo H — casos próximos adicionais (stress test):** mais 3 frases
plausíveis de cliente real, todas resultando em **ambíguo**:
`"aplicativo fecha sozinho depois que atualizei"` (Aplicativo fecha
sozinho × Problema depois de atualizar), `"sem áudio em todos os
canais"` (Sem áudio × Problema em todos os canais), `"atualizei e
agora não abre"` (Aplicativo não abre × Problema depois de atualizar,
mesmo achado da rodada anterior, reconfirmado).

### Leitura dos resultados

**Nenhuma das ambiguidades encontradas nesta bateria produz resposta
errada — todas caem em "ambíguo → transfere para humano"**, o
comportamento seguro que a arquitetura já definiu (§7, passo 6). O
esclarecimento por token eliminou o padrão mais grave (vitória
confiante e errada de uma entrada genérica sobre uma específica) e o
substituiu por transferência segura em todos os casos testados —
inclusive em frases novas que a rodada anterior não tinha coberto.

**Padrão real identificado, não corrigido (fora do escopo desta
rodada):** as entradas "Aplicativo trava" e "Aplicativo não abre" têm
palavras-chave de uma palavra só (`trava`, `travando`, `nao abre`) que
tendem a empatar com qualquer entrada mais específica cujo texto
também contenha essas palavras — apareceu em 5 frases diferentes
nesta bateria (canais travando, canais + travando, fecha sozinho +
atualizei, sem áudio + todos os canais, atualizei + não abre). Isso
não é uma escolha errada de conteúdo (as duas entradas fazem sentido
como estão) — é uma característica do algoritmo aprovado interagindo
com palavras-chave curtas e genéricas. Registrado para decisão futura
de curadoria, não corrigido agora.

**Nenhuma alteração de código, migration, SQL, commit ou deploy foi
feita nesta etapa.** Este diagnóstico e esta bateria ficam registrados
para a próxima etapa: decidir, com a mesma disciplina de sempre
(usuário + GPT), se e como proceder — e só depois disso retomar a
carga V1.
