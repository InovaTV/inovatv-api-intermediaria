# Integração do Componente 2 ao Orquestrador — Levantamento Técnico

> **NÃO IMPLEMENTADO.** Este documento é só levantamento/design, para
> revisão antes de qualquer código. Nenhum arquivo `.ts` foi criado ou
> alterado, nenhuma migration, nenhum deploy. Os trechos de código
> abaixo são **pseudocódigo de proposta**, não implementação real.

## 1. Onde o Orquestrador deve chamar a busca de conhecimento

`supabase/functions/orchestrator/index.ts`, entre a montagem do
contexto do cliente e a chamada ao Gemini — logo depois da linha atual:

```ts
const contextoCliente = montarContextoCliente(telefone, statusResults, { matchIndisponivel });
```

e antes de:

```ts
const geminiResult = await chamarGemini(conteudo, contextoCliente);
```

**Nunca dentro do Passo 0** (branch `conversa.estado === "aguardando_humano"`,
linhas ~163-182) — ali o fluxo já retorna antes de chegar perto do
Gemini, então chamar a busca de conhecimento seria uma leitura ao
banco sem nenhum uso, custo sem propósito.

**Independente do resultado do `/match`** — a busca de conhecimento
institucional não depende de o cliente ter sido encontrado
(`matchIndisponivel` ou não). São fontes desacopladas por desenho
(Arquitetura Formal §7), então a chamada acontece sempre que o fluxo
segue além do Passo 0, mesmo se `contextoCliente` for `null`.

## 2. Função nova necessária

Novo módulo `_shared/conhecimento.ts` (mesmo padrão de
`rocket_intermediaria.ts`/`gemini_client.ts` — um arquivo, uma
responsabilidade), exportando:

```ts
export type ConhecimentoResultado =
  | { outcome: "encontrado"; titulo: string; conteudo: string }
  | { outcome: "nada_encontrado" }
  | { outcome: "unavailable" };

export async function buscarConhecimentoRelevante(
  pergunta: string,
): Promise<ConhecimentoResultado> { /* ... */ }
```

Reaproveita `getServiceClient()` de `_shared/supabase_client.ts`
(mesma dependência já usada por `conversas_estado.ts`/
`mensagens_atendimento.ts`) — nenhum cliente novo, nenhuma credencial
nova.

**Algoritmo interno** (Componente 2 §7 + esclarecimento 7-A,
`inovatv_central/CLAUDE.md`, já fechado): normaliza (minúsculas, sem
acento/pontuação) → tokeniza → busca cada `palavras_chave` ativa como
sequência contígua de tokens na pergunta → pontuação = número de
palavras-chave distintas que bateram (sem peso, sem frequência) →
maior score no topo, único → `encontrado`; score 0 em tudo →
`nada_encontrado`; empate no topo → `nada_encontrado` (ambíguo é
tratado como "nada", não é uma quarta categoria — a especificação
nunca define "ambíguo" como outcome próprio, só como razão de retornar
nada); falha na consulta à tabela (erro de rede/banco) →
`unavailable`.

## 3. Como a pergunta é enviada ao algoritmo

**Literalmente a variável `conteudo` já existente** — a mesma string
crua da mensagem do cliente que hoje já é passada para `chamarGemini`
como primeiro argumento. **Nunca** `contextoCliente` (que tem dados do
cliente) nem o corpo HTTP inteiro — só o texto que o cliente escreveu,
exatamente como a Componente 2 §2 já define ("a pergunta/mensagem do
cliente, já isolada pelo orquestrador do bloco de dados do cliente").

```ts
const conhecimentoResult = await buscarConhecimentoRelevante(conteudo);
```

## 4. Tratamento dos três resultados

```ts
let contextoConhecimento: string | null = null;
if (conhecimentoResult.outcome === "encontrado") {
  contextoConhecimento = `[CONHECIMENTO INSTITUCIONAL - ${conhecimentoResult.titulo}]\n${conhecimentoResult.conteudo}`;
}
// "nada_encontrado" e "unavailable": contextoConhecimento permanece null,
// fluxo segue exatamente como hoje -- nenhuma branch de erro, nenhum
// bloqueio, nenhuma mensagem diferente ao cliente.
```

- **`encontrado`** → block formatado (ver seção 5) e concatenado ao
  contexto.
- **`nada_encontrado`** → nunca insere bloco vazio ("por via das
  dúvidas", Componente 1 §10) — segue só com o que já existia
  (`contextoCliente`, se houver).
- **`unavailable`** → mesmo comportamento de `nada_encontrado` do
  ponto de vista do fluxo (segue sem conhecimento institucional,
  Componente 2 §9: "o orquestrador decide seguir sem conhecimento
  institucional"), **mas precisa ser distinguível no log/resposta** —
  ver seção 8, mesma disciplina já usada para `matchIndisponivel` no
  bloco de cliente.

**Proposta de auditoria:** adicionar um campo `conhecimento` ao JSON
de resposta do Orquestrador, no mesmo padrão de `match`/`status` já
existentes:
```ts
conhecimento: { outcome: conhecimentoResult.outcome, titulo: conhecimentoResult.outcome === "encontrado" ? conhecimentoResult.titulo : undefined }
```

## 5. Como o conhecimento selecionado entra no contexto do Gemini

Reaproveita o mesmo padrão de rótulo entre colchetes já usado em
`contexto.ts` (`[DADOS CONECTADOS - CLIENTE]`) — consistência de
formato, sem inventar um estilo novo:

```
[CONHECIMENTO INSTITUCIONAL - Teste grátis]
O teste grátis varia conforme o servidor do acesso: regra geral, 6 horas...
```

Concatenação proposta (novo, no `index.ts`, não em `contexto.ts` —
`montarContextoCliente` continua fazendo só o bloco de cliente, sem
saber nada de conhecimento institucional, mantendo responsabilidade
única de cada módulo):

```ts
const contextoCompleto = [contextoCliente, contextoConhecimento]
  .filter((b): b is string => !!b)
  .join("\n\n");
```

`contextoCompleto` (nunca mais `contextoCliente` sozinho a partir
deste ponto) é o que passa a ser enviado tanto para `chamarGemini`
quanto para `validarResposta` — ver seção 7, é o ponto mais importante
de todo este levantamento.

**O prompt de sistema congelado não precisa mudar.** Já lida com essa
ideia de forma genérica: *"Os dados/documentos conectados que
acompanham cada pergunta fornecem os fatos que você deve usar **sobre
a InovaTV e sobre qualquer cliente**."* — o texto já previa duas
naturezas de dado conectado desde que foi escrito e testado (Rodadas
3/4), mesmo sem essa camada existir ainda. Nenhuma alteração no
`SYSTEM_PROMPT` é necessária ou proposta aqui.

## 6. Como garantir que conhecimento institucional nunca se confunde com dado de cliente

- **Isolamento por construção:** `buscarConhecimentoRelevante(pergunta: string)`
  não recebe `telefone`, `statusResults` nem `contextoCliente` como
  parâmetro — fisicamente não tem acesso a dado de cliente, só ao
  texto da pergunta. Mesma disciplina de fronteira já usada entre
  `rocket_intermediaria.ts` e o resto do código.
- **Rótulos textuais distintos** nos dois blocos (`[DADOS CONECTADOS -
  CLIENTE]` vs. `[CONHECIMENTO INSTITUCIONAL - ...]`) — já é assim que
  o Gemini foi treinado/testado a diferenciar fonte de fato dentro do
  mesmo texto de entrada.
- **Validador continua parseando só o bloco de cliente** — as regex de
  `validador.ts` (`REGEX_TELEFONE_CONTEXTO`, `REGEX_BLOCO_ACESSO`)
  procuram padrões específicos do formato `Telefone: ...` /
  `Nome: ... · Plano: ... · Servidor: ...` que só `montarContextoCliente`
  produz — texto de conhecimento institucional não teria motivo pra
  casualmente bater com esses padrões, mas isso precisa ser
  **confirmado por teste real** (seção 8), não presumido.
- **Nenhuma entrada de `conhecimento_institucional` deve conter dado
  de cliente** — isso já é regra de curadoria (Componente 2 §1,
  reforçada nas 29 entradas aprovadas), não algo que o código
  precisa impor tecnicamente além do que já existe (RLS/allowlist).

## 7. Como o Validador continua funcionando com os dois blocos — ponto crítico

**Nenhuma mudança de assinatura:** `validarResposta(saidaGemini, contextoEnviado)`
já aceita qualquer `string | null` — não precisa saber que agora esse
texto pode ter duas partes.

**A regra de ouro, que precisa ser respeitada na implementação:** o
`contextoCompleto` passado para `validarResposta` tem que ser
**exatamente o mesmo texto**, byte a byte, que foi passado para
`chamarGemini` — nunca `contextoCliente` sozinho por engano. Hoje o
código já reaproveita a mesma variável nos dois lugares
(`contextoCliente` em ambos); a implementação real desta integração
precisa trocar as duas ocorrências para `contextoCompleto`, nunca só
uma. Se isso for esquecido em um dos dois lugares, o Validador passa a
checar a resposta do Gemini contra um contexto diferente do que ele
realmente recebeu — quebra silenciosamente a garantia central do
Componente 4 (§1: "confere a resposta contra o contexto real
enviado"). **Este é o risco de implementação mais real deste
levantamento inteiro**, mais do que qualquer coisa relacionada ao
algoritmo de busca em si.

## 8. Testes locais necessários antes do deploy

1. **Unitários de `buscarConhecimentoRelevante`** (mock do
   `getServiceClient()`): normalização, tokenização, pontuação sem
   peso, palavra-chave repetida conta 1x, nenhuma correspondência,
   empate → `nada_encontrado`, falha simulada de banco → `unavailable`.
2. **Integração no Orquestrador** (mesmo padrão de fakes já usado nas
   fatias anteriores, `_shared` redirecionado para módulos em
   memória): confirma que o bloco de conhecimento só entra no texto
   quando `encontrado`; confirma que Passo 0 (`aguardando_humano`)
   nunca chama `buscarConhecimentoRelevante`; confirma resposta JSON
   incluindo o novo campo `conhecimento`.
3. **Regressão do Validador com bloco de conhecimento presente** —
   rodar casos já cobertos hoje (ex.: os mesmos usados no Componente 1
   §12/Etapa 6) com um `[CONHECIMENTO INSTITUCIONAL - ...]` extra
   concatenado no contexto, confirmando que nenhuma das checagens
   existentes (`validarCredencial`, `validarTelefoneOutroCliente`,
   `validarValorMonetario`, `validarDatas`, `validarContagemAcessos`,
   `validarPlanoServidorRotulado`) muda de comportamento por causa do
   texto extra — cobre exatamente a suposição da seção 6 acima, sem
   presumir que "deveria funcionar".
4. **Verificação da regra de ouro da seção 7** — teste específico
   confirmando que a string passada para `chamarGemini` e a passada
   para `validarResposta` são idênticas quando há conhecimento
   institucional presente (não só "parecidas").
5. **Smoke test com as 29 entradas reais já carregadas** — reaproveitar
   uma amostra das frases já testadas manualmente no diagnóstico
   (`DIAGNOSTICO_ALGORITMO_BUSCA.md`) rodando contra a implementação
   TypeScript real (não mais o script Node solto), confirmando que o
   comportamento bate com o que já foi validado manualmente.
6. **Confirmação de que o contrato HTTP do Orquestrador não muda** —
   `{telefone, conteudo, nomeContato?}` continua exatamente igual;
   nenhuma mudança no Webhook (Componente 3) é necessária para esta
   integração.

## 9. Fora de escopo desta integração (sem mudança nesta etapa)

Curadoria/edição das 29 entradas (V1 já carregada e aprovada) ·
qualquer novo mecanismo de busca (RAG, embeddings, peso, stemming) ·
alteração do prompt de sistema congelado · alteração do Webhook ·
inclusão de conteúdo pendente (indicação/cancelamento/apresentação,
matriz de compatibilidade, Regras Gerais/Bloco 3 — todos já
registrados como fora da V1).

**Nada foi implementado. Próximo passo, quando autorizado:** criar
`_shared/conhecimento.ts`, as mudanças pontuais em
`orchestrator/index.ts` descritas nas seções 1-5 e 7, e os testes da
seção 8 — nesta ordem, com revisão antes de cada commit/deploy, mesma
disciplina de todas as fatias anteriores.
