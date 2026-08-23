# Desenho — Fluxo Corrigido: Duas Confirmações Separadas (PagBank + Clique do Cliente)

> **Correção de desenho, não implementação.** Substitui a ordem
> proposta em `2026-08-22_desenho_pagbank_fluxo_renovacao.md` (que
> tratava a confirmação do PagBank como suficiente pra renovar
> sozinha) pela ordem correta, descrita pelo usuário. Nenhum código,
> migration, deploy, cobrança ou renovação real executada.

## 0. A correção, em uma frase

**Confirmar que o dinheiro foi pago (PagBank) e autorizar que o
Rocket execute a renovação (clique do cliente) são duas coisas
diferentes, e as duas continuam sendo necessárias — nenhuma substitui
a outra.** O desenho anterior deixava a entender que o webhook do
PagBank, sozinho, já dispararia a renovação automaticamente. Está
corrigido: o PagBank prova o dinheiro; o clique prova a autorização
pra agir.

## 1. Fluxo corrigido (a sequência descrita, sem mudança)

```
1. Cliente já pagou pelo PagBank (cobrança gerada previamente —
   seção 3, mantém a mesma pendência de "quem decide cobrar" já
   registrada no documento anterior)
        ↓
2. Cliente envia o comprovante pelo WhatsApp (continua sendo o
   gatilho de conversa, igual ao desenho original do Caminho
   Secundário — não muda)
        ↓
3. Orquestrador → Gemini identifica que é um comprovante/mensagem
   sobre pagamento → responde algo como "recebi, estou conferindo"
   (mensagem intermediária, nova — seção 5)
        ↓
4. Nossa infraestrutura CONSULTA o PagBank sobre a cobrança
   pendente daquele cliente — RECONSULTA ATIVA, na hora, não espera
   passivamente o webhook (seção 2)
        ↓
5. PagBank confirma (ou não) que aquele pagamento realmente
   aconteceu — PRIMEIRA confirmação, sobre o DINHEIRO
        ↓
   não confirma / não encontra cobrança pendente →
     cai no comportamento já existente (regra congelada: não
     confirma, transfere) — seção 6
        ↓
   confirma →
6. IA responde "Pagamento confirmado" + apresenta o botão/link
   RENOVAR ACESSO — só agora, nunca antes
        ↓
7. Cliente clica — SEGUNDA confirmação, sobre a AUTORIZAÇÃO de agir
        ↓
8. O clique dispara o gatilho no Rocket (mecanismo ainda em aberto —
   seção 4, mesma pendência já registrada)
        ↓
9. Rocket executa a renovação no servidor real
        ↓
10. Rocket devolve os dados atualizados (novo vencimento) —
    reconfirmação, nunca confia no que valia antes do clique
        ↓
11. Nossa infraestrutura envia a confirmação final ao cliente
    (template `pagamento_confirmado`, com os dados reais devolvidos
    pelo Rocket no passo 10 — nunca com dados supostos antes disso)
```

## 2. Passo 4 — como a reconsulta ativa funciona (diferença real do desenho anterior)

**No desenho anterior, o webhook era o gatilho** (push — o PagBank
avisa quando quiser). **Agora o gatilho pra verificar é o comprovante
do cliente** (pull — nós perguntamos ao PagBank, na hora, quando o
cliente se manifesta). Mecanicamente:

1. `/match(telefone)` já resolve o(s) `public_id` candidato(s) — igual
   ao fluxo já existente.
2. Consulta a tabela `cobrancas_pix` (já proposta no documento
   anterior) — existe alguma cobrança **pendente** pra esse cliente?
3. Se existe, reconsulta o PagBank **na fonte** (link `SELF` do
   charge, com API key real — mesmo mecanismo de segurança já
   proposto, "nunca confia só no webhook").
4. `PAID` confirmado → segue pro passo 6. Não confirmado/não
   encontrado → passo 6 alternativo (seção 6, comportamento já
   existente).

**O webhook não é descartado** — continua útil como um segundo canal
(ex.: pra eventualmente avisar o cliente proativamente "recebemos seu
pagamento" antes mesmo dele mandar o comprovante — não decidido,
registrado só como possibilidade). Mas **para este fluxo específico,
quem dispara a verificação é a chegada do comprovante, não o
webhook** — corrige a leitura do desenho anterior.

## 3. O que continua igual, sem mudança, do desenho anterior

- **Associação pagamento↔cliente** via `reference_id` = nosso
  `operacao_id`, decidido na criação da cobrança — sem mudança.
- **Quem decide criar a cobrança em primeiro lugar** — continua em
  aberto, mesma pendência já registrada.
- **Casos de borda** (duplicado, valor diferente, sem identificação,
  já processado) — mesmas regras já desenhadas, sem mudança.
- **Múltiplos acessos** — mesma regra (resolver antes de criar a
  cobrança), sem mudança.

## 4. O que ainda está em aberto — passo 8, "Rocket faz a renovação, como já funciona hoje"

**Isto precisa de esclarecimento antes de fechar o desenho —
registrado, não decidido sozinho.** "Como já funciona hoje" pode
significar dois mecanismos tecnicamente diferentes, já mapeados no
documento anterior (seção 9), com uma implicação real e diferente
cada um:

- **Se for a sessão do Vault** (`POST pagamento/add`, o mesmo caminho
  que o botão "Adicionar Pagamento" usa) — **é o único mecanismo já
  comprovado que prorroga o Sigma de verdade** (gap crítico da seção
  10 do documento anterior, resolvido por esse caminho). **Mas esse
  caminho também aciona o RocketZap sozinho**, que manda sua própria
  confirmação — se o passo 11 também mandar a nossa, **o cliente
  recebe duas confirmações** (mesmo problema já identificado antes
  como risco de duplicidade).
- **Se for `PATCH` via `ROCKET_API_KEY`** (já comprovado 2x pelas
  nossas POCs) — nunca aciona o RocketZap, então o passo 11 (nossa
  confirmação) não duplica nada. **Mas continua sem confirmação de
  que prorroga o Sigma de verdade** — mesmo gap crítico, não resolvido.

**Esta pergunta não foi respondida pela correção do fluxo — continua
sendo a mesma decisão em aberto do documento anterior, só re-descrita
aqui no passo 8.** Se a intenção é usar "o mecanismo que já renova o
servidor de verdade" (sessão Vault), **o passo 11 precisaria ser
removido ou substituído** por "confirmar que o RocketZap já cuidou
disso" — não dá pra ter os dois ao mesmo tempo sem duplicar.

## 5. Mensagem intermediária (passo 3) — nova peça, pequena, não desenhada antes

O "recebi, estou conferindo" é uma peça nova que o desenho anterior
não tinha explicitamente — no desenho anterior (Caminho Principal
via webhook), não havia essa etapa porque o cliente não precisava
mandar nada. Agora que o comprovante volta a ser o gatilho, faz
sentido ter uma resposta intermediária antes da conferência (evita o
cliente ficar sem resposta nenhuma enquanto a reconsulta ao PagBank
acontece). **Texto não fechado agora**, mesma disciplina já combinada
("os textos depois refinamos").

## 6. Comportamento quando o PagBank NÃO confirma (passo 5, ramo alternativo)

**Regra congelada preservada, sem exceção:** se a reconsulta não
encontra uma cobrança pendente pra aquele cliente, ou encontra mas
não está `PAID`, **a IA nunca apresenta o botão** — cai no mesmo
comportamento já existente e testado (não confirma pagamento sem
evidência real, oferece transferência humana). Isso cobre também o
caso de "pagamento sem identificação" já registrado (cliente pagou
fora de uma cobrança nossa) — sem cobrança pendente encontrada, nunca
inventa uma associação.

## 7. Resumo

**Princípio novo, formalizado:** duas confirmações sempre separadas —
**PagBank confirma o dinheiro; o clique do cliente autoriza a ação.**
Nenhuma delas substitui a outra, nenhuma decisão de renovar é tomada
com só uma das duas.

**O que muda do desenho anterior:** o gatilho da verificação passa a
ser o comprovante do cliente (pull), não o webhook sozinho (push); a
renovação nunca é automática mesmo com o PagBank confirmando — precisa
do clique.

**O que não muda, continua pendente:** quem decide criar a cobrança;
qual mecanismo exato executa a renovação no passo 8 (PATCH vs. sessão
Vault) — e essa escolha decide se o passo 11 é necessário ou duplicaria
o RocketZap; o gap de extensão real do Sigma continua sem solução
própria, independente de qual dos dois mecanismos for escolhido.

**Nada implementado, nada submetido, nenhuma cobrança ou renovação
real executada nesta etapa.**
