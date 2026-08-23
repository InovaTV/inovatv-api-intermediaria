# Desenho — Fluxo "Comprovante Espontâneo → Conferência → Confirmação pelo Cliente → Renovação"

> **Isto é levantamento/design técnico, não implementação.** Nenhum
> código escrito, nenhuma migration criada, nenhum deploy, nenhuma
> automação do Rocket/RocketZap alterada, nenhuma renovação real
> executada. Combina três peças já existentes e comprovadas
> separadamente — nunca conectadas entre si até agora — e identifica
> exatamente onde cada uma se encaixa no Orquestrador real
> (`inovatv-api-intermediaria`).

## 0. As três peças que já existem, hoje desconectadas

1. **Leitura de imagem pelo Gemini** — comprovada 2026-08-21
   (`gemini_client.ts`, parâmetro `midias`), timeout de 60s quando há
   mídia. Nunca usada, até agora, pra extrair dados de um comprovante
   dentro do fluxo real do Orquestrador — só testada isoladamente.
2. **Mecanismo de renovação real** — `PATCH` via `ROCKET_API_KEY` →
   `GET` de confirmação → template `pagamento_confirmado`. Comprovado
   2x (POC #1 texto livre, POC #2 template), mas hoje só roda com
   `PUBLIC_ID` fixo, disparado manualmente por `curl`
   (`poc-confirmacao-renovacao`).
3. **Link de uso único, dois passos** (`GET` seguro / `POST` executa)
   — desenhado em detalhe em `2026-08-21_gatilho_meta_renovacao.md`,
   nunca implementado, pensado originalmente pra Meta AI apresentar
   depois de "examinar" um comprovante (etapa marcada como bloqueio de
   confiabilidade pra aquele contexto — ver seção 6).

**Este desenho conecta as três**, com a Orquestrador/Gemini/Validador
da IA própria no lugar da Meta AI — e usa o **clique do cliente**,
não a leitura da imagem sozinha, como ponto real de autorização
(exatamente como você descreveu).

## 1. Onde se encaixa no Orquestrador — fluxo revisado

Fluxo atual (Componente 1 §6, inalterado até o ponto de inserção):

```
mensagem chega (telefone + conteúdo [+ mídia])
  ↓
Passo 0 — conversas_estado (se aguardando_humano, para aqui)
  ↓
/match(telefone) → /status(publicId) [ou por candidato, se múltiplos acessos]
  ↓
busca conhecimento institucional
  ↓
monta contexto mínimo
  ↓
chama Gemini (com mídia, se houver)
```

**Ponto novo de inserção, logo após a resposta do Gemini:**

```
  ↓
Gemini devolve tipo estruturado — PRECISA DE UM 3º TIPO NOVO
(seção 2), além dos dois já existentes (responder/transferir)
  ↓
tipo == "apresentar_confirmacao_renovacao"?
  │
  NÃO → fluxo já existente, sem mudança nenhuma
  │      (responder OU transferir, Validador de sempre)
  │
  SIM → VALIDAÇÃO NOVA (seção 3, dona: Validador)
         │
         dados não batem / ambíguo →
           NÃO apresenta botão — cai no comportamento já existente
           (recusa + transferência, regra congelada preservada)
         │
         dados batem →
           1. gera token de uso único (seção 4)
           2. monta mensagem de conferência + link (texto livre,
              janela de 24h já aberta pelo próprio comprovante do
              cliente — NÃO precisa de template aqui)
           3. envia — Orquestrador para aqui, mesmo padrão de sempre
              (não espera o clique, não trava a execução)
```

**O clique do cliente não acontece dentro do Orquestrador** — acontece
numa peça nova, fora dele (seção 5), que só no fim aciona o mecanismo
de renovação já comprovado (peça 2 da seção 0) e manda a confirmação.

## 2. Extensão do contrato estruturado do Gemini (Componente 1 §12)

Hoje: `{ "tipo": "responder" | "transferir", "texto": "string" }`.

**Proposta de extensão (aditiva, não quebra o que já existe):**

```json
{
  "tipo": "responder" | "transferir" | "apresentar_confirmacao_renovacao",
  "texto": "string",
  "dadosIdentificados": {
    "plano": "string opcional",
    "servidor": "string opcional",
    "valor": "string opcional — lido da IMAGEM, nao de /status",
    "vencimentoAtual": "string opcional"
  }
}
```

`dadosIdentificados` só é preenchido quando `tipo` for o novo valor.
**O Gemini não decide sozinho se o botão aparece** — só propõe; quem
decide de verdade é o Validador (seção 3), mesma divisão de poder já
usada pra `responder`/`transferir` (Componente 1 §9: "o Gemini não
tem autoridade final sobre o que é enviado ao cliente").

**Isto exige alterar o prompt de sistema congelado.** Não é uma
mudança cosmética — é uma capacidade nova (hoje o prompt só conhece
`responder`/`transferir`). Pela disciplina já registrada neste
projeto (Rodadas 3/4, revisão de comportamento antes de qualquer
prompt novo entrar em produção), **isso implica uma nova rodada de
teste comportamental antes de qualquer execução real** — não decidido
aqui, só identificado como pré-requisito.

## 3. Validação nova — dona: Validador (Componente 4), regra adicional

**Reaproveita a mesma filosofia já usada em todo o Validador: nunca
confia no que o Gemini afirma, sempre confere contra o contexto real
enviado.** Regras propostas:

- **Identidade do cliente:** o `publicId` já resolvido em `/match`/
  `/status` (Passo anterior do Orquestrador) precisa existir — sem
  cliente identificado, nunca apresenta botão (cai em transferência,
  mesmo comportamento já testado no caso "cliente não encontrado").
- **Plano/Servidor identificados batem com `/status`?** Comparação
  por substring, mesma técnica já usada no Validador pra
  `respostas comuns (heurístico, limitação conhecida já documentada).
- **`valor` identificado é uma affirmação factual concreta** — mas
  **não existe fonte pra conferir** (achado já registrado em toda a
  investigação: `{VALOR}` não está em `/status`/`/match`). Ver seção
  6 — risco residual explícito, não resolvido por este desenho.
- **Múltiplos acessos:** se `/match` retornou mais de um candidato e
  o Gemini não deixou claro pra qual dos acessos o comprovante se
  refere, **não apresenta botão** — mesma regra já usada hoje
  (Componente 1 §8: nunca escolhe um acesso sozinho), aqui estendida:
  primeiro esclarece qual acesso, só depois considera apresentar o
  botão numa mensagem seguinte.
- **Ambiguidade em qualquer um dos itens acima → nunca adivinha,
  sempre reprova** — mesma regra já usada em todo o Validador
  (Componente 4 §9).

## 4. Token de uso único — nova tabela, nome sugerido `tokens_renovacao`

Reaproveita o desenho já pronto (`2026-08-21_gatilho_meta_renovacao.md`,
tabela "COMPROVADO/VIÁVEL", linha "Tabela `tokens_renovacao`... VIÁVEL
— mesmo padrão já usado em outras tabelas do projeto"):

```
tokens_renovacao
├── id                (uuid)
├── token_hash         (hash do token real — nunca o token puro em texto)
├── public_id          (cliente/acesso a renovar)
├── conversation_id     (rastreabilidade — de qual conversa isso veio)
├── dados_identificados (jsonb — plano/servidor/valor/vencimento lidos)
├── criado_em
├── expira_em           (janela curta, 24-48h — mesmo padrão já desenhado)
├── usado_em             (nullable — reivindicação atômica, mesmo
│                          padrão já usado em assumir_atendimento)
└── resultado            (sucesso/falha, preenchido após o POST)
```

Gerado pelo Orquestrador (ou por uma função compartilhada nova,
`_shared/tokens_renovacao.ts`) no momento em que o Validador aprova.

## 5. Peça nova — endpoint web de dois passos (fora do Orquestrador)

**Reaproveita o desenho já pronto, sem mudança de princípio:**

```
GET /renovar/<token>
  → só leitura: token existe? não expirado? não usado?
  → mostra página com os dados identificados + botão "CONFIRMAR RENOVAÇÃO"
  → NUNCA executa nada (protege contra preview automático do
     WhatsApp/crawlers — mesmo raciocínio já registrado)

POST /renovar/<token>/confirmar   (clique real no botão)
  → reivindica o token atomicamente (mesmo padrão de
     assumir_atendimento — 0 linhas afetadas = já usado, aborta)
  → revalida sessão/credenciais necessárias
  → consulta o estado ATUAL do cliente (nunca confia no que valia
     quando o token foi gerado — mesma disciplina já usada em toda
     investigação)
  → aciona o mecanismo de renovação já comprovado (seção 6, POC #1/#2,
     generalizado pra receber o `public_id` do token em vez de fixo)
  → grava resultado no token
  → página mínima de encerramento ("processando, você recebe a
     confirmação pelo WhatsApp")
```

**Onde hospedar:** mesma infraestrutura já usada pelo Painel de
Atendimento (Next.js + Vercel, zero custo novo) — não decidido se é o
mesmo projeto Next.js ou um novo, só a stack em si já está resolvida
por precedente.

## 6. Generalizar `poc-confirmacao-renovacao`

Hoje: `PUBLIC_ID`, `NOME_ESPERADO`, `SERVIDOR_ESPERADO`,
`PLANO_ESPERADO`, `TELEFONE_CLIENTE_TESTE` são constantes fixas no
código. Pra virar o mecanismo real chamado pelo `POST
/renovar/<token>/confirmar`, precisaria:
- Receber `public_id` (do token) em vez de constante.
- Receber o `valor`/dados de confirmação também do token (já
  identificados na seção 4), não mais hardcoded.
- Continuar com a mesma sequência já comprovada: `GET /planos/` →
  `GET cliente` (confirma identidade) → `PATCH` → `GET` de novo
  (confirma de verdade) → dispara `pagamento_confirmado`.
- **Decisão em aberto, não resolvida aqui:** se o `PATCH` continua via
  `ROCKET_API_KEY` (nós mandamos a confirmação, como já testado) ou
  passa a usar a sessão do Vault (RocketZap manda sozinho) — mesma
  pergunta já registrada no levantamento anterior
  (`2026-08-22_levantamento_gatilho_pagamento_confirmado.md`, seção
  4), não decidida por este desenho.

## 7. Confirmação final ao cliente — texto livre ou template, depende do tempo

Mesma regra já fechada na "revisão de mensagens" anterior (seção 0
daquele documento): se o cliente clicar rápido (ainda dentro da
janela de 24h aberta pelo comprovante original), a confirmação
poderia sair como texto livre; se demorar (fora da janela), precisa
do template `pagamento_confirmado` (já aprovado). **Mais simples e
seguro: sempre usar o template**, independente do tempo — evita ter
que checar em qual estado a janela está no momento do `POST`, e o
template já está aprovado e testado. Não decidido definitivamente
aqui, só a recomendação.

## 8. Risco residual explícito — `{VALOR}` lido da imagem, sem conferência independente

**Isto não é resolvido por este desenho, fica registrado.** O
`valor` mostrado na mensagem de conferência vem só da leitura que o
Gemini faz da imagem — não existe hoje nenhuma fonte de sistema
(`/status`, `/match`) pra confirmar que aquele valor é o valor
esperado do plano do cliente. O cliente, ao clicar "confirmar", está
principalmente confirmando "sou eu, é o meu plano" — não
necessariamente escrutinando o valor com cuidado. **Isto é uma
limitação inerente a usar OCR de comprovante como fonte de dado, não
um problema introduzido por este desenho especificamente** — mas
precisa ficar registrado como risco conhecido, não escondido.

## 9. O que precisa de decisão antes de qualquer implementação

1. **Alterar o prompt de sistema congelado** (seção 2) — exige nova
   rodada de validação comportamental antes de produção, mesma
   disciplina das Rodadas 3/4. Não é trabalho pequeno.
2. **Onde hospedar a tela de confirmação** (seção 5) — mesmo projeto
   Next.js do Painel, ou separado?
3. **`PATCH`/`ROCKET_API_KEY` vs. sessão do Vault** (seção 6) — mesma
   decisão já registrada como aberta no levantamento anterior.
4. **Template ou texto livre na confirmação final** (seção 7) —
   recomendação dada, não fechada.
5. **Nome definitivo da tabela/rota** — sugestões dadas, não
   confirmadas.

## 10. Resumo do que este desenho resolve, e o que não resolve

**Resolve:** exatamente o ponto que motivou a conversa — a IA não
confirma pagamento só por receber uma imagem; ela identifica, monta
uma conferência, e **o clique explícito do cliente** é que autoriza a
renovação de verdade. Preserva a regra congelada sobre comprovantes
(nunca alterada, só complementada). Reaproveita as três peças já
comprovadas em vez de reinventar qualquer uma.

**Não resolve:** de onde vem `{VALOR}` de forma confiável (continua
vindo só da imagem, sem conferência independente); a decisão
`PATCH`/sessão do Vault; e não substitui a necessidade de uma rodada
de validação comportamental antes do prompt novo ir pra produção.

**Nada implementado, nada submetido, nenhuma renovação real
executada, Rocket/RocketZap intocados nesta etapa.**
