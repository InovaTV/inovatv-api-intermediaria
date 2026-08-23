# Achado do Caso 1 — regra sintática restritiva demais na resolução de acesso

> **NÃO IMPLEMENTADO.** Este documento é levantamento/análise, para
> decisão antes de qualquer código. Nenhum arquivo `.ts` foi alterado,
> nenhum deploy novo, nenhuma ação na conversa de teste que ficou em
> `aguardando_humano`. Registra o achado real do Caso 1 (execução real,
> 23/08/2026) e propõe formas de reconhecimento natural de servidor/
> plano para fechar a lacuna.
>
> **Revisão 2 (mesma sessão) — contrato de identificação FECHADO e
> APROVADO pelo usuário.** Ver seção 6 (redação final da regra) e
> seção 6-A (exigência de extrator único compartilhado).
>
> **Revisão 3 (mesma sessão) — ✅ CASO 1 HOMOLOGADO, ciclo fechado.**
> Correção implementada (`826c2a7`) e observabilidade adicional
> (`e326b79`, `92a14b8`) implantadas (`orchestrator` v35). Terceira
> execução real aprovada com evidência DIRETA (log do Logs Explorer,
> não inferência) — ver seção 7 para a linha do tempo completa e o
> diagnóstico exato. Casos 2-12 continuam bloqueados, aguardando
> liberação individual do usuário.

## 1. O que aconteceu (evidência real, lida do banco em produção)

Mensagem real do cliente de teste (`5517981625486`, 2 acessos:
BLAZE/Meu Uso Testes e NewOne/Js Informática Rp), Caso 1 adaptado da
matriz:

> *"Quero renovar meu NewOne, por favor."*

**Gemini reconheceu a intenção corretamente e identificou o acesso:**

> *"Com certeza! Entendi que você deseja renovar o seu acesso no
> servidor NewOne (Js Informática Rp, Plano Mensal). Em instantes
> prosseguiremos com a sua solicitação!"*

**Validador reprovou** com `renovacao:acesso_nao_determinado` — a
conversa caiu no mecanismo de transferência já existente (episódio
aberto, `conversas_estado.estado = aguardando_humano`, mensagem fixa
de transferência enviada ao cliente real).

**Nada inseguro aconteceu** — nenhuma cobrança, nenhum token, nenhuma
renovação prosseguiu sem determinação clara; o sistema errou para o
lado seguro (transferência), não para o lado arriscado (renovar o
acesso errado ou renovar sem certeza).

## 2. Causa raiz

`_shared/rotulo_acesso.ts` reconhece só o formato **rotulado, com
dois-pontos literais**:

```
REGEX_SERVIDOR_ROTULADO = /(?:^|\s)servidor\s*:\s*([A-Za-zÀ-ÿ0-9]+)/gi
REGEX_PLANO_ROTULADO    = /(?:^|\s)plano\s*:\s*([A-Za-zÀ-ÿ0-9]+)/gi
```

Essas regexes vieram, sem alteração, de `validarPlanoServidorRotulado`
— uma checagem **pré-existente**, criada para um propósito diferente:
conferir se uma resposta do Gemini que **lista/ecoa** acessos no
mesmo formato do contexto (`"Servidor: X"`, o vocabulário que
`contexto.ts` usa) bate com o que existe de fato. Esse formato faz
sentido quando o Gemini está **reproduzindo** dados estruturados.

A Etapa 1 (propor_renovacao) reaproveitou essas mesmas regexes para um
propósito diferente: reconhecer se o Gemini, **confirmando em
linguagem natural** que entendeu a intenção do cliente, identificou
um acesso específico. Nessa situação o Gemini não está ecoando um
rótulo — está **narrando**: "no servidor NewOne", "seu acesso no
NewOne", "o NewOne" — nenhuma dessas formas tem os dois-pontos que a
regex exige.

## 3. A distinção que o usuário apontou (correta, confirmada pela leitura do código)

A Lacuna 3 decidiu uma regra **semântica**:

> "o texto do Gemini precisa conter um rótulo de plano/servidor... que
> aponte pra **exatamente um** dos acessos"

A implementação virou uma regra **sintática**, mais restritiva do que
a Lacuna 3 pedia:

> "o texto precisa conter a substring literal `Servidor: X` ou
> `Plano: X`"

O gap entre as duas é exatamente o que o Caso 1 expôs. **Isso só
afeta clientes com múltiplos acessos** — com 1 acesso só, a resolução
é direta (`length === 1`), sem depender de nenhum rótulo. Antes desta
sessão o cliente de teste tinha 1 acesso só; agora tem 2 (achado
lateral já registrado ao preparar os 12 casos) — foi essa mudança de
estado real que expôs a lacuna pela primeira vez.

## 4. Formas de reconhecimento natural — avaliadas uma a uma

Para cada forma, a avaliação cobre: o que reconheceria, por que é
segura ou arriscada, e uma recomendação (não uma decisão).

### 4.1 `"servidor X"` / `"no servidor X"` — sem dois-pontos

Ex.: *"no servidor NewOne"*, *"servidor NewOne"*, *"o servidor é o
NewOne"*.

**Avaliação: segura.** É praticamente a mesma coisa que já é
reconhecida hoje, só sem o dois-pontos — a palavra-âncora "servidor"
continua presente, reduzindo a chance de capturar algo não
intencional. **Recomendo incluir.**

### 4.2 `"o [NomeServidor]"` — sem a palavra "servidor" antes

Ex.: *"quero renovar meu NewOne"*, *"pode renovar o NewOne pra
mim?"* — **exatamente os exemplos que o usuário deu como desejáveis.**

**Avaliação: segura, com uma condição.** Não há mais uma
palavra-âncora ("servidor") — o reconhecimento passa a depender de
comparar tokens do texto contra os **nomes reais dos servidores do
contexto** (`contexto.acessos[].servidor`, dado estruturado, nunca
inventado). Como nomes de servidor tendem a ser identificadores
distintivos (`NewOne`, `BLAZE`, `ChannelTV`, `StarPlay-BR1` — nomes
reais já vistos neste projeto), a chance de aparecerem por acaso numa
frase sem essa intenção é baixa. **Recomendo incluir, mas com
correspondência de token/palavra inteira — nunca substring** (ver
seção 5, mesmo tipo de bug já corrigido antes neste projeto no
Componente 2, §7-A: `"trava"` batendo dentro de `"travando"`).

### 4.3 `"o plano [NomePlano] do [NomeServidor]"` — cita os dois campos

**Avaliação: segura quando usada** (dupla confirmação), mas **não
deve ser o único caminho** — nem todo cliente vai citar os dois.
Trato como reforço, não como forma exclusiva.

### 4.4 `"o plano [NomePlano]"` sozinho, sem citar servidor

Ex.: *"quero renovar o Mensal"*.

**Avaliação: ARRISCADA — não recomendo incluir como sinal
suficiente.** Nomes de plano (`Mensal`, `Trimestral`, `Anual`) são
palavras comuns do português, não identificadores distintivos como
nomes de servidor. Pior: **colide diretamente com o Caso 9 da
matriz** — a frase de teste do Caso 9 é literalmente *"Quero trocar
meu Mensal pelo anual, tem como?"*. Se `"Mensal"` sozinho virasse
sinal de determinação de acesso, o Caso 9 (que deve **nunca** virar
`propor_renovacao`) passaria a correr o risco real de ser mal
interpretado como uma renovação determinada, exatamente o oposto do
que a Lacuna 7 (troca de plano é outro fluxo) exige. **Recomendo:
nome de plano nunca resolve sozinho — só em combinação com o nome do
servidor** (seção 4.3), nunca isolado.

### 4.5 Nome do cadastro (`"Js Informática Rp"`)

**Avaliação: não recomendo incluir.** O campo `nome` não é usado hoje
em nenhuma checagem de rótulo, e nomes de cadastro podem se repetir
entre acessos diferentes do mesmo telefone (não é garantidamente
distintivo). Um cliente também dificilmente citaria o próprio nome de
cadastro para se identificar — ele já está identificado pelo telefone
(regra permanente do prompt, "IDENTIFICAÇÃO DO CLIENTE"). Baixo valor,
complexidade desnecessária.

### 4.6 Referência posicional (`"o primeiro"`, `"o segundo"`, `"o 1"`)

**Avaliação: ARRISCADA — recomendo excluir explicitamente.** Depende
de uma ordem que o **cliente** viu numa mensagem anterior — mas o
histórico de conversa **não é injetado automaticamente no contexto do
Gemini** (regra já registrada: Componente 5 §16 do `inovatv_central`,
"histórico... nunca é injetado automaticamente no prompt do Gemini").
O Gemini não tem garantia de estar vendo a mesma ordem que o cliente
viu. Resolver por posição seria adivinhar, não determinar.

### 4.7 Referência por vencimento (`"o que vence em fevereiro"`)

**Avaliação: fora de escopo por ora.** Exigiria reaproveitar/estender
a lógica de parsing de data já existente (`REGEX_DATA`,
`normalizarDataBr`) para uma finalidade nova, com risco real de
ambiguidade (dois acessos podem vencer no mesmo mês). Não foi pedido
pelo usuário nem apareceu em nenhum dos 12 casos — não recomendo
incluir nesta rodada.

## 5. Resumo — matriz de decisão

| Forma | Exemplo | Seguro? | Recomendação |
|---|---|---|---|
| `Servidor: X` (já existe) | `"Servidor: NewOne"` | ✅ Seguro | Manter |
| `servidor X` sem dois-pontos | `"no servidor NewOne"` | ✅ Seguro | Incluir |
| Nome do servidor isolado | `"meu NewOne"`, `"o NewOne"` | ✅ Seguro, com correspondência por token (não substring) | Incluir |
| Plano + servidor juntos | `"o Mensal do NewOne"` | ✅ Seguro (reforço) | Incluir como reforço |
| Nome do plano sozinho | `"o Mensal"` | ❌ Arriscado — colide com o Caso 9 | **Não incluir isolado** |
| Nome do cadastro | `"Js Informática Rp"` | ⚠️ Baixo valor, sem necessidade | Não incluir |
| Posição (`"o primeiro"`) | `"o segundo que vc mostrou"` | ❌ Arriscado — depende de histórico não disponível ao Gemini | **Excluir explicitamente** |
| Vencimento | `"o que vence em fevereiro"` | ⚠️ Fora de escopo, complexidade nova | Não incluir nesta rodada |

## 6. Contrato de identificação — ✅ FECHADO E APROVADO (redação final)

> **Regra de identificação de acesso (propor_renovacao, múltiplos
> acessos) — texto final aprovado:**
>
> Com múltiplos acessos no contexto, o texto do Gemini determina o
> acesso quando, e somente quando, **exatamente um** dos acessos tem o
> nome do seu **servidor citado no texto como palavra/token inteiro**
> — em qualquer uma destas formas, todas equivalentes:
> - rotulado, com dois-pontos: `"Servidor: NewOne"` (forma já existente);
> - com a palavra "servidor" por perto, sem dois-pontos: `"servidor
>   NewOne"`, `"no servidor NewOne"`;
> - só o nome, sem a palavra "servidor": `"meu NewOne"`, `"o NewOne"`.
>
> **Servidor + nome do plano juntos** (`"o Mensal do NewOne"`) também
> determinam o acesso — e funcionam como reforço quando o servidor já
> apareceu sozinho.
>
> **Nunca determinam o acesso, mesmo sozinhos ou combinados entre si:**
> - nome do plano isolado, sem o nome de nenhum servidor no mesmo texto
>   (ex.: `"o Mensal"`, `"seu plano Mensal"`) — protege
>   deliberadamente o Caso 9 (seção abaixo);
> - referência posicional (`"o primeiro"`, `"o segundo"`, `"o 1"`);
> - nome do cadastro, data de vencimento, ou qualquer forma não listada
>   acima.
>
> **Zero ou mais de uma correspondência** de nome de servidor continua
> sendo tratado como acesso não determinado — reprova, cai no caminho
> seguro já existente (transferência), exatamente como hoje.

### 6-A. Extrator único, compartilhado pelas duas pontas — exigência confirmada

```text
                  texto Gemini
                       │
                       ▼
              extrairRotulosAcesso()
                  /            \
                 /              \
                ▼                ▼
          Validador         Orquestrador
          aprova/reprova    resolve public_id
```

**Confirmado, sem ambiguidade:** a mesma função de extração
(`_shared/rotulo_acesso.ts`) continua sendo a única fonte da evidência
("quais nomes de servidor/plano aparecem, como palavra inteira, neste
texto") — nunca duas implementações levemente diferentes no Validador
e no Orquestrador. Cada um dos dois continua chamando essa função de
forma **independente** e fazendo sua própria correlação contra o
próprio array de acessos (Validador contra `ContextoParseado.acessos`,
Orquestrador contra `StatusResult[]`) — o extrator só fornece a
evidência bruta (quais nomes aparecem), nunca decide aprovar/reprovar
nem resolve `public_id` (Componente 4 §5 preservado, sem mudança).

### Confirmação: por que isso protege o Caso 9

> *"Quero trocar meu Mensal pelo anual, tem como?"*

Mesmo que o Gemini, ao responder, escreva algo como *"Você quer
alterar seu plano Mensal..."*, isso **não** pode, sozinho, determinar
um acesso — porque a regra final exige o **nome do servidor**, nunca
o nome do plano isolado, para considerar o acesso determinado. O Caso
9 continua protegido pelo próprio desenho da regra, não por um caso
especial extra.

### Implicação técnica (mapeamento, ainda NÃO implementado)

O mecanismo de extração deixa de ser "procurar rótulos `Label:
valor`" e passa a ser "checar se o nome real de servidor de
**exatamente um** acesso do contexto aparece como palavra inteira no
texto" (com o reforço opcional de plano+servidor juntos). Afeta os 3
pontos já mapeados na Etapa 1 (seção 3 do
`LEVANTAMENTO_ETAPA1.md`): `rotulo_acesso.ts` (mecanismo de
extração), `validador.ts`
(`validarPropostaRenovacao`/`acessosCorrespondentesAoRotulo`) e
`orchestrator/index.ts` (`resolverAcessoRenovacao`).

**Cuidado técnico a carregar para a implementação** (não uma decisão
nova — lembrete do próprio histórico do projeto): a correspondência
precisa ser por **token/palavra inteira**, nunca por substring — o
mesmo tipo de bug já encontrado e corrigido no Componente 2
(`inovatv_central/CLAUDE.md`, "esclarecimento de especificação...
correspondência por token, não por substring") ao descobrir que
`"trava"` batia dentro de `"travando"`. Aqui o risco equivalente seria
um nome de servidor curto batendo como substring de outra palavra do
texto (ex.: um servidor hipotético chamado `"Max"` batendo dentro de
`"máximo"`) — a extração precisa reconhecer limites de palavra, nunca
só `.includes()`.

## 7. Estado final — ✅ CASO 1 HOMOLOGADO, com evidência direta

**Linha do tempo completa deste achado, do início ao fechamento:**

1. **Primeira execução real (23/08, ~10:12)** — *"Quero renovar meu
   NewOne, por favor."* → Gemini reconheceu a intenção e o acesso
   corretamente na confirmação em linguagem natural, mas o Validador
   **reprovou** com `renovacao:acesso_nao_determinado` — inconsistência
   de contrato (seções 1-4 acima). Caiu no mecanismo de transferência
   já existente. **Não foi uma falha do Caso 1 em si** — foi o
   reconhecimento de intenção funcionando, barrado por uma regra de
   extração restritiva demais.
2. **Contrato de identificação fechado e aprovado** (seção 6/6-A) —
   nome do servidor como palavra/token inteiro determina o acesso;
   plano isolado nunca determina (protege o Caso 9).
3. **Correção implementada e implantada** — commit `826c2a7`
   (`_shared/rotulo_acesso.ts`, `_shared/validador.ts`,
   `orchestrator/index.ts`), deploy `orchestrator` v33. 68/68 testes
   locais, incluindo reprodução exata da frase real do Caso 1.
4. **Segunda execução real — inconclusiva por motivo totalmente
   alheio à correção**: duas tentativas seguidas (11:32 e 11:35)
   caíram em `sistema:gemini_indisponivel` — a chamada real ao Gemini
   falhou antes de qualquer código desta etapa ser alcançado. Como
   nenhum dos dois lados (Webhook, Orquestrador, `gemini_client.ts`)
   tinha qualquer log nos 6 caminhos de falha da chamada ao Gemini,
   não havia como diagnosticar a causa.
5. **Observabilidade mínima adicionada e implantada** — commit
   `e326b79` (log do diagnóstico `propor_renovacao` no Orquestrador,
   deploy v34) e commit `92a14b8` (log técnico nos 6 caminhos de
   `unavailable` de `_shared/gemini_client.ts` — status HTTP,
   `blockReason`, `finishReason`, exceção/timeout, nunca segredo —
   deploy final **v35**). 73/68→73 testes locais, sem regressão.
6. **Terceira execução real (23/08, 08:46 — horário do log) — ✅
   APROVADA, com evidência DIRETA, não inferência:**
   ```
   [orchestrator] propor_renovacao diagnostico
   {"tipo":"propor_renovacao","validacaoAprovado":true,
    "servidorResolvido":"NewOne",
    "publicId":"01a026ef-8bdd-7641-a4f2-2ae37b184ac0"}
   ```
   Lido direto do Logs Explorer do Supabase (Edge Functions →
   `orchestrator` → Logs) — `publicId` conferido e batendo exatamente
   com o `public_id` real do acesso NewOne/Js Informática Rp (já
   confirmado via `/status` no início da rodada de testes). Cruzamento
   com o banco: `conversas_estado.estado` permaneceu `normal`; só 1
   mensagem gravada (`origem: cliente`, `episodio_id: null`, sem par
   "ia"); nenhuma mensagem WhatsApp enviada; nenhuma cobrança, token
   ou renovação Sigma — nenhum código para essas operações existe
   ainda nesta etapa.

**Nota de leitura, para não confundir no futuro:** as duas ocorrências
de `sistema:gemini_indisponivel` (item 4) **não contam como falha do
Caso 1** — são instabilidade real e transitória da chamada ao Gemini,
observada *durante* a homologação, e foi exatamente esse achado que
motivou a observabilidade adicional (item 5). Na execução que de fato
percorreu o caminho `propor_renovacao`, o resultado foi aprovado de
primeira, com evidência direta.

**Precisão de escopo, apontada pelo usuário — o que foi homologado é
o diagnóstico, não a experiência conversacional final:**

| Aspecto | Resultado |
|---|---|
| Intenção reconhecida (Gemini) | ✅ |
| Acesso determinado (Validador) | ✅ |
| `public_id` correto (Orquestrador) | ✅ |
| Transferência indevida | ❌ não ocorreu |
| Cobrança/token/Sigma | ⏸ não existe nesta etapa (Etapas 2/3) |
| Resposta ao cliente | **Nenhuma enviada — por desenho do modo diagnóstico (opção A), não falha** |
| Experiência final de conversa (mensagem intermediária, Lacuna 8) | **Ainda NÃO homologada — pertence à Etapa 4, não existe código para isso ainda** |

O cliente real, na prática, mandou a mensagem e **não recebeu
nenhuma resposta** — isso é o comportamento correto e esperado do
modo diagnóstico isolado (Etapa 1), não um resultado a ser lido como
"o fluxo de renovação está pronto". O que este achado prova é que a
**cadeia determinística** (reconhecimento → validação → resolução de
`public_id`) funciona — não que a experiência do cliente ao pedir uma
renovação já está completa. Essas são duas afirmações diferentes, e
só a primeira está comprovada até aqui.

**Registro para a matriz do `LEVANTAMENTO_ETAPA1.md` (seção 7):**
**Caso 1 — ✅ APROVADO (diagnóstico)** — evidência direta via log
(item 6 acima). Não usar o rótulo "homologado" sozinho sem qualificar
que é o diagnóstico, não a experiência final — ver tabela acima.

- **Casos 2-12: continuam bloqueados**, aguardando o próximo
  checkpoint do usuário para liberação individual.
- **Nenhuma operação financeira em nenhum momento desta investigação**
  — nenhuma cobrança PagBank, token, renovação Sigma ou mensagem de
  cobrança, em nenhuma das 3 execuções reais.
