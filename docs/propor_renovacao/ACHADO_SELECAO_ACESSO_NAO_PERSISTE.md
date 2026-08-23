# ACHADO — seleção de acesso não persiste entre mensagens

> **Isto é só um registro de achado — nenhuma solução é proposta aqui.**
> Encontrado durante a execução real do Caso 1 da Etapa 1b
> (`docs/propor_renovacao/LEVANTAMENTO_ETAPA1.md`, seção 9),
> 2026-08-23, investigado só por leitura (código real + registros
> reais em `mensagens_conversa`/`conversas_estado`). Nenhum código foi
> alterado, nenhum novo teste real foi executado, nenhum commit foi
> feito a partir deste documento.

## 1. Contexto do achado

Durante a tentativa de reexecutar o Caso 1 real (cliente com intenção
explícita de renovar), o cliente de teste real (`Js Informática Rp`,
`5517981625486`) foi encontrado com **2 acessos cadastrados** (não 1,
como o Caso 1 pressupõe) — `Meu Uso Testes` (Servidor BLAZE) e
`Js Informática Rp` (Servidor NewOne). Isso levou a uma sequência real
de 3 mensagens que expôs o comportamento registrado aqui.

## 2. Reprodução real das 3 mensagens

Conversa `43fcff07-80e5-4d0a-b814-62323ef6c3a9`, telefone
`5517981625486`, `estado: "normal"` durante toda a sequência (nunca
saiu de `normal`, nunca precisou de intervenção humana). Registros
reais lidos direto de `mensagens_conversa` (só leitura):

| # | Horário (UTC) | Origem | Texto |
|---|---|---|---|
| 1 | 16:33:23.048 | cliente | "Quero renovar meu plano" |
| 2 | 16:33:23.450 | ia | "Identifiquei que você possui mais de um acesso cadastrado: 1) Meu Uso Testes (Servidor BLAZE) e 2) Js Informática Rp (Servidor NewOne). Qual deles você gostaria de renovar?" |
| 3 | 16:37:46.817 | cliente | "2" |
| 4 | 16:37:46.991 | ia | "Você selecionou o Acesso 2: Js Informática Rp (Servidor: NewOne, Plano: Mensal, Vencimento: 08/02/2027). Como posso te ajudar com esse acesso?" |
| 5 | 16:38:37.322 | cliente | "Quero renovar esse acesso" |
| 6 | 16:38:37.490 | ia | "Identifiquei que você possui dois acessos cadastrados: 1) Nome: Meu Uso Testes (...) e 2) Nome: Js Informática Rp (...). Por favor, me informe qual desses acessos você deseja renovar." |

**Nenhuma das 3 mensagens do cliente (1, 3, 5) produziu o log
`[orchestrator] propor_renovacao diagnostico`** — confirmado por
ausência desse log estruturado nas 3 execuções. Ou seja, em nenhum
momento desta sequência o `tipo` retornado pelo Gemini foi
`propor_renovacao`; todas as 3 respostas da IA correspondem ao
caminho `responder`.

## 3. Evidência de que "2" é interpretado somente no turno atual

A resposta da mensagem 4 ("Você selecionou o Acesso 2...") prova que o
Gemini conseguiu interpretar "2" como uma seleção **dentro daquela
única chamada** — o contexto enviado naquele turno já listava os 2
acessos numerados ("Acesso 1/2"/"Acesso 2/2", ver seção 4), então "2"
foi lido corretamente como referência ao segundo item **da lista que
acabou de ser mostrada na mesma chamada**.

Isso não é o mesmo que o sistema ter "lembrado" da seleção. A mensagem
5 ("Quero renovar esse acesso") prova o oposto: enviada 5 mensagens/50
segundos depois, sem repetir o número "2" nem citar "NewOne"/
"ChannelTV" (nenhum rótulo de servidor/plano no texto), a resposta 6
volta a listar os 2 acessos do zero — comportamento idêntico ao da
mensagem 1, como se as mensagens 3 e 4 nunca tivessem acontecido.

## 4. Ausência de `acesso_selecionado` (ou equivalente) em qualquer estado persistente

Confirmado por leitura direta do código (`supabase/functions/`):

- `conversas_estado` (schema real, migrations aplicadas): campos
  `conversation_id`, `telefone`, `nome_snapshot`, `estado`,
  `episodio_atual_id`, `atualizado_em` — nenhum campo de acesso
  selecionado, `public_id` ativo, ou qualquer estado de negócio.
- `mensagens_conversa`: grava histórico completo (texto + origem),
  mas é usado **só para consulta humana** (Painel de Atendimento) —
  nunca é relido pelo Orquestrador para montar contexto da IA
  (Componente 5 §16, ver seção 6).
- Grep por `selecion*`/`acesso_selecionado`/`ultimoAcesso` em
  `supabase/functions/` não encontrou nenhuma ocorrência relevante (o
  único match, em `_shared/conhecimento.ts`, é sobre seleção de
  entrada de conhecimento institucional, sem relação com acesso de
  cliente).

Não existe, em nenhuma tabela ou variável de estado do sistema, um
lugar onde "o cliente escolheu o Acesso 2" poderia ter sido gravado.

## 5. Ausência de histórico de conversa em `chamarGemini`

Confirmado por leitura direta de `_shared/gemini_client.ts`:

```ts
export async function chamarGemini(
  mensagemCliente: string,
  contextoCliente: string | null,
  midias: MidiaAnexada[] = [],
): Promise<GeminiResult> {
  const primeira = await chamarUmaVez(mensagemCliente, contextoCliente, midias);
  ...
}
```

Nenhum parâmetro de histórico. Dentro de `chamarUmaVez`, a chamada real
à API do Gemini monta:

```ts
contents: [{ role: "user", parts }],
```

**Um único turno** (`role: "user"`), nunca um array com os turnos
anteriores da conversa. `parts` é montado só de `contextoCliente` (a
string retornada por `montarContextoCliente`) + a mensagem atual do
cliente.

`montarContextoCliente` (`_shared/contexto.ts`) é reconstruído do zero
a cada chamada, exclusivamente a partir de `statusResults` (resultado
fresco de `/match`+`/status` contra o Rocket) — sempre lista os mesmos
2 acessos, na mesma ordem, sem nenhum campo derivado de mensagens
anteriores. Para este telefone, o contexto enviado na mensagem 5 é
estruturalmente **idêntico** ao contexto enviado na mensagem 1.

## 6. Relação com Componente 5 §16 e o `SYSTEM_PROMPT`

**Componente 5 §16** (`inovatv_central/CLAUDE.md`, "Evolução futura —
histórico como contexto conversacional seletivo da IA"): registra
explicitamente que o histórico permanente de conversa (seções 7-B/12
daquele documento) existe **hoje só para consulta humana, auditoria, e
confronto de informação com o cliente pelo operador** — nunca é
injetado automaticamente no prompt do Gemini. A ideia de a IA um dia
poder consultar o histórico para entender referência conversacional do
próprio cliente (exemplos citados naquele texto: "aquele problema que
falei ontem", "faz igual da outra vez") está registrada como
**possibilidade futura, explicitamente não implementada**.

**`SYSTEM_PROMPT`** (seção "FONTES DE VERDADE E PRECEDÊNCIA", texto
congelado): "O que foi dito antes nesta mesma conversa (por você ou
pelo cliente) também não é fonte de fato — se a resposta depender de
um dado que pode ter mudado (vencimento, valor, status), confira de
novo nos dados conectados antes de responder, mesmo que já tenha
respondido isso antes na mesma conversa." Essa regra foi escrita
pensando em fatos que podem mudar entre o início e o fim de uma
conversa (vencimento, valor) — o efeito colateral observado aqui
(a IA também não retém uma escolha puramente conversacional, sem
relação com fato que muda) é uma consequência direta da mesma
arquitetura de "sempre reconsultar, nunca confiar no histórico", não
uma violação dela.

## 7. Conclusão

O comportamento observado (mensagem 5 reapresentando os 2 acessos, sem
aproveitar a seleção feita na mensagem 3) é **consequência direta e
esperada da arquitetura atual** — ausência de qualquer memória de
conversa nas chamadas ao Gemini (Componente 1, por desenho) combinada
com a regra de "múltiplos acessos" do `SYSTEM_PROMPT` (sem rótulo
explícito de servidor/plano na mensagem atual, a IA sempre volta a
listar tudo). **Não é um bug da implementação da Etapa 1b** — a lógica
de persistência condicional de `origem: "ia"` (implementada e testada
nesta mesma sessão) nunca chegou a ser exercitada nesta sequência,
porque nenhuma das 3 mensagens produziu `tipo: "propor_renovacao"`.

Nenhuma solução foi proposta nas seções 1-7 acima — só o achado em si.
A especificação da solução, fechada em sessão seguinte (mesmo dia),
está na seção 8, abaixo. Nenhuma alteração de código, `SYSTEM_PROMPT`,
schema, Plano Mestre, deploy ou teste real foi feita a partir deste
documento inteiro (achado + especificação).

---

## 8. Especificação técnica fechada — memória de sessão (`acesso_selecionado`)

> **Direção arquitetural aprovada (2026-08-23):** Supabase/Postgres
> sozinho, sem Redis (comparação completa registrada no histórico desta
> frente — Redis descartado por falta de necessidade real de
> performance e por risco prático de esbarrar na regra permanente de
> nunca contratar VPS, já que a Hostinger já contratada é hospedagem
> compartilhada, sem suporte a rodar um daemon persistente). `acesso_selecionado`
> é um **ponteiro de contexto conversacional**, nunca fonte de verdade
> — `/match`+`/status` continuam sendo as únicas fontes oficiais de
> dado atual, sempre obrigatórias, sempre revalidadas a cada chamada.
>
> **Isto é especificação fechada, não implementação.** Nenhum código,
> schema, `SYSTEM_PROMPT` ou produção foi alterado a partir daqui.

### 8.1 Campo e tipo — FECHADO

```sql
alter table conversas_estado add column acesso_selecionado    text;         -- public_id do Rocket, nullable
alter table conversas_estado add column acesso_selecionado_em timestamptz;  -- momento da selecao, nullable
```

Guarda exclusivamente o `public_id` (mesmo identificador que `/match`/
`/status` já devolvem) — nunca um rótulo textual, nunca vencimento/
valor/plano. Sem FK (o `public_id` vive no Rocket, fonte externa).

### 8.2 Validade — FECHADO: 15 minutos de inatividade

TTL de **15 minutos**, contado **exclusivamente** a partir de
`acesso_selecionado_em` — nunca da última atividade geral da conversa,
nunca de `atualizado_em`. Checagem feita **em leitura**, no momento em
que o Orquestrador for usar o valor — **sem `pg_cron` obrigatório**;
um valor expirado simplesmente deixa de ser lido/usado, mesmo que
continue fisicamente na linha até uma próxima escrita o sobrescrever.
Nenhuma rotina de limpeza automática é exigida por esta especificação
(pode ser adicionada depois, como otimização de espaço, nunca como
requisito de correção).

### 8.3 Invalidação/ignorar — FECHADO, 3 condições, qualquer uma basta

`acesso_selecionado` é tratado como **inexistente** (mesmo comportamento
de `null`) sempre que:
1. **Expirado** — mais de 15 minutos desde `acesso_selecionado_em` (seção 8.2).
2. **`public_id` não existe no conjunto atual** de `statusResults`/
   `contexto.acessos` daquela chamada — reconferido a cada mensagem,
   nunca presumido válido.
3. **Nova seleção ocorreu** — `acesso_selecionado`/`acesso_selecionado_em`
   são sempre sobrescritos pela seleção mais recente (nunca acumulam,
   nunca há histórico de seleções — só a última).

Nenhuma dessas 3 condições gera erro, aviso ao cliente, ou log de
alerta — é só o mesmo caminho já existente hoje (ambiguidade →
pergunta de novo / reprova), sem efeito colateral novo.

### 8.4 Onde a seleção é registrada — FECHADO: também no caminho `responder`

**Confirmado, não só `propor_renovacao`.** O caso real reproduzido
(mensagens 3-4 da seção 2) aconteceu inteiramente dentro do caminho
`responder` — foi ali, não em `propor_renovacao`, que a IA confirmou
"Você selecionou o Acesso 2: ... NewOne". Registrar a seleção só no
caminho `propor_renovacao` não teria corrigido o caso real observado.
Portanto: sempre que `statusResults.length > 1` e a resposta do Gemini
(`geminiData.texto`, qualquer `tipo` que resulte em envio ao cliente —
`responder` **e** `propor_renovacao`) citar exatamente um servidor do
conjunto atual como palavra inteira, grava `acesso_selecionado`/
`acesso_selecionado_em`. Nunca grava se 0 ou 2+ servidores aparecerem
no texto (mesma disciplina de ambiguidade já usada no Validador,
`_shared/rotulo_acesso.ts`).

### 8.5 Prioridade — FECHADO: mensagem atual sempre vence

**Ordem fixa, sem exceção:**
1. Rótulo explícito extraído da **mensagem/resposta atual** (mecanismo
   já existente, `nomeApareceComoPalavra` contra `geminiData.texto` da
   chamada em curso).
2. Só se (1) não resolver — `acesso_selecionado` guardado, **e apenas
   se ainda válido** pelas 3 condições da seção 8.3.

O contexto de sessão nunca sobrepõe um rótulo que apareça na mensagem
atual — é estritamente um sinal de segunda prioridade, usado só na
ausência de informação melhor.

### 8.6 Participação no Validador e no `resolverAcessoRenovacao` — FECHADO, fallback revalidado

**`validarPropostaRenovacao` (`_shared/validador.ts`):** ganha um
parâmetro novo, `acessoSelecionadoPublicId: string | null`. Ordem de
checagem:
1. Resolve pelo rótulo da mensagem atual — **inalterado**, mesmo
   caminho de hoje.
2. Só se (1) falhar e houver 2+ acessos: verifica se
   `acessoSelecionadoPublicId` **ainda está presente** no conjunto
   atual de `contexto.acessos` (dado fresco daquela mesma chamada,
   nunca cacheado) — se estiver, aprova apontando pra esse acesso; se
   não estiver (ou for `null`/expirado), reprova
   `renovacao:acesso_nao_determinado`, exatamente como hoje.

**`resolverAcessoRenovacao` (`orchestrator/index.ts`):** ganha a mesma
extensão, em espelho — chamado de forma **independente** do Validador,
nunca reaproveitando o resultado interno dele (preserva o padrão já
estabelecido: extrator/checagem chamados separadamente pelos dois
consumidores, Componente 4 §5 — Validador nunca decide dado de
negócio, só aprova/reprova).

**Por que isto não transforma `acesso_selecionado` em fonte de verdade:**
o valor nunca carrega um fato sobre o acesso (nunca vencimento/valor/
plano/servidor em texto) — é só um **ponteiro de identidade**
(`public_id`), e esse ponteiro é **sempre reconfirmado contra o dado
oficial fresco** (`statusResults`/`contexto.acessos` da chamada atual)
antes de valer pra qualquer coisa. Se `/match`+`/status` não
confirmarem mais aquele `public_id`, o sinal é descartado — a fonte
oficial sempre tem a palavra final, nunca o ponteiro guardado.

### 8.7 Bloco `[CONTEXTO DA CONVERSA]` — FECHADO, conteúdo exato

```
[CONTEXTO DA CONVERSA]
Nesta conversa, o cliente mencionou anteriormente o acesso: Servidor NewOne.
Use esta informação apenas para entender a quem "esse acesso"/"ele"/"esse
plano" se refere, se o cliente usar uma referência indireta. NUNCA trate
isto como um fato atual — os dados reais e atualizados deste acesso já
estão no bloco [DADOS CONECTADOS - CLIENTE] acima.
```

Regras de conteúdo, todas fechadas:
- Contém **só o nome do servidor** (identidade) — nunca vencimento,
  valor, plano, telas ou qualquer campo que possa estar desatualizado;
  esses continuam vindo exclusivamente de `[DADOS CONECTADOS -
  CLIENTE]`, montado fresco a cada chamada.
- A instrução de uso (resolver referência, nunca tratar como fato) vive
  **dentro do próprio bloco** — reforço redundante deliberado, além da
  regra geral do `SYSTEM_PROMPT`.
- **Omitido inteiramente** quando não há seleção válida (seção 8.3) —
  nunca um bloco vazio ou placeholder.
- Posicionado **sempre depois** de `[DADOS CONECTADOS - CLIENTE]` na
  concatenação de contexto (mesmo mecanismo já existente,
  `partesContexto.join("\n\n")`) — reforça a hierarquia de autoridade
  entre as duas fontes.
- Construído por uma função **irmã** de `montarContextoCliente`
  (nunca a mesma função, nunca misturada com a montagem de dados
  oficiais) — nome de referência nesta especificação:
  `montarContextoConversa`.

### 8.8 Fluxo obrigatório do caso real, resolvido — registrado como contrato

```
"Quero renovar meu plano"        (2 acessos, sem rotulo)
   -> tipo=responder, Gemini lista os 2, pede pra escolher
   -> nada gravado (Gemini nao citou servidor especifico)

"2"
   -> tipo=responder, Gemini responde "Voce selecionou o Acesso 2:
      ... NewOne ..."
   -> extracao (8.4) encontra "NewOne" como unico servidor citado
   -> GRAVA acesso_selecionado=<public_id NewOne>, acesso_selecionado_em=now()

"Quero renovar esse acesso"      (dentro de 15 min, mesmo conjunto de acessos)
   -> Passo 0 -> /match -> /status (sempre obrigatorio, dados frescos)
   -> mensagem atual sem rotulo explicito
   -> acesso_selecionado ainda valido (8.3: nao expirado, public_id
      ainda presente no conjunto atual)
   -> [CONTEXTO DA CONVERSA] citando NewOne enviado ao Gemini (8.7)
   -> Validador/Orquestrador resolvem NewOne via fallback (8.6)
   -> RESOLVIDO: acesso = NewOne
```

Este é o contrato que a implementação futura precisa satisfazer —
registrado aqui como critério de aceite, não como resultado já
observado (nada foi implementado ainda).

### 8.9 Extração via texto do Gemini — por que não depende de posição

**Registrado explicitamente:** o mecanismo de extração (seção 8.4) é
uma **solução da implementação atual**, escolhida deliberadamente **em
vez de** uma resolução posicional determinística (ex.: Orquestrador
mapear "2" → `statusResults[1]` diretamente pelo índice do array).

A alternativa posicional foi comparada e descartada porque: (a)
exigiria confiar que `/match`+`/status` devolvem os acessos **na mesma
ordem** entre chamadas diferentes — garantia nunca verificada nem
documentada para a API do Rocket; se a ordem mudar entre uma chamada e
outra (novo acesso cadastrado, reordenação interna), um índice
guardado apontaria **silenciosamente** para o acesso errado, num fluxo
que mexe com dinheiro; (b) resolveria só o caso do dígito solto ("2"),
nunca o caso real que originou esta investigação ("esse acesso", sem
nenhum número).

A extração por nome de servidor (identidade, não posição) é imune a
essa fragilidade — o `public_id` gravado é sempre reconferido contra o
conjunto atual (seção 8.3, condição 2), nunca contra uma posição de
array. Qualquer implementação futura desta especificação **não deve**
introduzir resolução por índice/posição como atalho — a identidade
(`public_id`, cross-checado contra dado fresco) é o único mecanismo
aprovado.

### 8.10 Janela de 24h do WhatsApp — NÃO é critério de validade da memória

**Correção explícita a uma proposta anterior desta mesma investigação:**
em rodada anterior deste levantamento, foi sugerido usar a janela de
24h de atendimento do WhatsApp Business Platform como um "teto
absoluto externo" pro TTL de `acesso_selecionado`. **Isso foi
descartado pelo usuário e não faz parte da especificação fechada.**

Motivo: são conceitos diferentes, que não devem se misturar. A janela
de 24h do WhatsApp regula **capacidade de envio** (mensagem livre vs.
exigência de Message Template aprovado pela Meta) — é uma regra de
canal/entrega, não uma regra sobre há quanto tempo uma escolha
conversacional do cliente continua relevante. A validade de
`acesso_selecionado` é regida **inteiramente** pela regra da seção
8.2 (15 minutos desde `acesso_selecionado_em`) — nenhuma outra janela,
prazo ou limite externo participa desta decisão.

### 8.11 Nada implementado

Nenhum código, schema, `SYSTEM_PROMPT`, Plano Mestre, deploy ou teste
real foi alterado/executado a partir desta especificação. Fica como
contrato fechado, aguardando autorização explícita separada para
implementação.
