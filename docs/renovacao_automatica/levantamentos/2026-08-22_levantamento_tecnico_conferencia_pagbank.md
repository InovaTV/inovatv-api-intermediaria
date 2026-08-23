# Levantamento Técnico — Conferência PagBank (Comprovante → Reconsulta → Botão → Renovação)

> **Levantamento técnico, não implementação.** Nenhum código,
> migration, deploy, prompt alterado, renovação real executada.
> Fecha os 12 pontos pedidos, sobre a sequência já corrigida em
> `2026-08-22_desenho_fluxo_corrigido_duas_confirmacoes.md` — não
> repete o fluxo, só aprofunda cada etapa tecnicamente.

## 1. Como relacionar o comprovante ao pagamento correto no PagBank

**Não é pelo conteúdo da imagem.** A relação correta é:

```
telefone da conversa → /match → public_id(s) candidatos
        ↓
consulta cobrancas_pix: existe cobrança PENDENTE pra esse public_id?
        ↓
sim → é essa a cobrança a reconsultar no PagBank (charge.id já
      guardado na criação, seção 2 do desenho anterior)
```

**A imagem do comprovante não precisa ser lida pra achar a cobrança**
— ela é só o **gatilho de conversa** (o cliente se manifestando).
Isso é mais simples e mais seguro que o desenho anterior (que ainda
cogitava o Gemini "extrair dados" da imagem pra montar a conferência)
— aqui a conferência vem inteiramente do PagBank, nunca da imagem.

**Caso real a tratar:** e se existir **mais de uma cobrança
pendente** pro mesmo `public_id` (ex.: um Pix antigo nunca pago, mais
um novo)? Proposta: pegar a **mais recente**, mas **nunca decidir
sozinho se houver ambiguidade real** (ex.: duas cobranças pendentes
com valores diferentes, ambas recentes) — mesma regra já usada em
"múltiplos acessos", cai em transferência/esclarecimento.

## 2. Quais dados do PagBank conseguimos consultar — separando o que é comprovado do que é proposto

**Comprovado (testado de verdade, Sandbox, docs reais):**
- Criar um pedido (`order`) com QR Code Pix — funciona, testado.
- O corpo do **webhook** entrega: `order.id`, `reference_id`,
  `charges[].id`, `charges[].status`, `payment_method.pix.notification_id`,
  `payment_method.pix.end_to_end_id`, e um link `charges[].links[].rel
  == "SELF"`.

**Proposto, NUNCA testado de verdade — importante não confundir com
"comprovado":** a **reconsulta ativa** via esse link `SELF` (chamar de
volta o PagBank, servidor a servidor, pra confirmar o status na
fonte) é uma **proposta arquitetural** do documento de idempotência —
o próprio documento diz explicitamente, no topo: *"a arquitetura
proposta na seção 3 NÃO foi implementada nem aprovada"*. **Nunca foi
efetivamente chamada** nos dois testes reais já feitos. Isso é
central pro novo fluxo (passo 4, "nossa infraestrutura consulta o
PagBank") — **precisa ser testado antes de confiar nele**, não
presumido que funciona só porque o link existe no payload.

**Não confirmado se a resposta desse `GET` traz `charge.amount`
(valor pago) de forma explícita** — plausível (é o recurso completo
da cobrança), mas nunca visto de verdade, só inferido da estrutura já
observada no webhook.

## 3. Como garantir que o pagamento pertence àquele cliente

Pela cadeia de amarração, não por inferência de conteúdo:
`public_id` (resolvido pelo telefone da conversa) → `operacao_id`
nosso (gerado quando a cobrança foi criada, guardado em
`cobrancas_pix`) → `reference_id` enviado ao PagBank = esse
`operacao_id` → `charge.id` retornado pelo PagBank, também guardado.
**Nunca por nome do pagador, CPF, ou qualquer dado de dentro do
comprovante** — o comprovante nunca é fonte de identidade nesta
arquitetura corrigida.

## 4. Pagamento não encontrado

Nenhuma cobrança `pendente` encontrada pra aquele `public_id` (nem
pelo telefone principal, nem por nenhum acesso vinculado) → **regra
congelada preservada, sem exceção**: não apresenta botão, mesma
resposta já testada ("não consigo confirmar", oferece transferência).

## 5. Pagamento já processado

A cobrança já tem `resultado` preenchido em `cobrancas_pix` (já foi
usada num clique anterior) → **não repete a renovação, não apresenta
o botão de novo** — informa que aquele pagamento já foi processado
(mesma disciplina de idempotência, evita renovar duas vezes por um
clique duplicado ou uma segunda mensagem do cliente perguntando de
novo).

## 6. Pagamento com valor diferente do esperado

Já desenhado no documento anterior (seção 8): comparar `charge.amount`
(quando confirmado tecnicamente, seção 2) contra o valor gravado em
`cobrancas_pix` no momento da criação — se não bater, **nunca
confirma automaticamente**, marca divergência, transferência humana.

## 7. Pagamento de outro cliente — caso novo, não coberto antes

**Nunca acontece pela própria arquitetura, se a seção 1 for seguida à
risca** — a busca de cobrança pendente é sempre escopada ao
`public_id` resolvido daquela conversa específica, nunca uma busca
global no PagBank por valor/data. **Isso precisa ser uma regra
explícita de implementação, não só uma consequência acidental**: o
código nunca deve ter um caminho que procure "qualquer cobrança paga
recentemente" sem primeiro restringir por `public_id` do cliente da
conversa.

## 8. Webhook/evento repetido

Mesma Camada 2 já desenhada (tabela dedicada, `UNIQUE` em `charge.id`,
insert-antes-de-agir). **Achado novo desta correção:** como o fluٹo
principal agora é **pull** (reconsulta disparada pelo comprovante),
não **push** (webhook), a dedicação do webhook em si passa a ser
secundária — útil se ele também estiver ativo (ex. pra outros fins
futuros), mas não é mais o gatilho central deste fluxo específico. A
mesma proteção de dedup vale pros dois casos, sem conflito.

## 9. Como o botão só aparece depois da confirmação do PagBank

**Achado importante desta rodada — simplifica o que eu tinha proposto
antes.** No desenho anterior, o Gemini precisava "extrair dados" da
imagem (`dadosIdentificados`) pra montar a conferência — isso não é
mais necessário, porque a conferência vem do PagBank, não da imagem.
Isso significa que a decisão de mostrar o botão **pode ser
inteiramente determinística** (código, não IA):

```
mensagem chega, contém mídia?
  E existe cobrança pendente pro public_id da conversa?
        ↓ (os dois verdadeiros)
  reconsulta o PagBank (seção 2)
        ↓
  PAID + valor bate + pertence a este cliente?
        ↓ sim
  monta mensagem com botão (texto pode ser gerado pelo Gemini,
  mas a DECISÃO de incluir o botão nunca é do Gemini)
```

**Isso reduz — talvez elimine — a necessidade de alterar o contrato
estruturado do Gemini** (o novo `tipo` proposto no desenho anterior).
O Gemini continua útil pra **redigir** a mensagem de forma natural e
pra lidar com o caso de mídia que **não** é comprovante (ex. cliente
manda uma foto qualquer) — mas a "trava" de segurança (mostrar ou não
o botão) fica inteiramente no código determinístico do Orquestrador,
não depende da interpretação do Gemini. **Isto é uma simplificação
real em relação ao desenho anterior, vale registrar como achado.**

## 10. Como o clique dispara o mecanismo de renovação do Rocket

Reaproveita o endpoint de dois passos já desenhado
(`2026-08-21_gatilho_meta_renovacao.md`): `GET /renovar/<token>`
(seguro, nunca executa) → clique real → `POST
/renovar/<token>/confirmar` → reivindica o token atomicamente →
**aciona o mecanismo de renovação já comprovado** (PATCH ou sessão
Vault — decisão ainda aberta, seção 4 do desenho corrigido, com a
mesma implicação sobre duplicar ou não o RocketZap).

## 11. Como obter os dados atualizados do Rocket após a renovação

Já comprovado nas duas POCs (#1/#2): sequência `GET` antes → ação
(`PATCH`/sessão) → `GET` depois, **nunca confia no retorno otimista
da própria ação de renovar** — sempre reconsulta o cadastro real do
cliente pra pegar o `vencimento` atualizado de verdade, mesmos campos
já usados no template `pagamento_confirmado` (nome, plano, servidor,
vencimento).

## 12. Como impedir que o botão seja reutilizado

Token de uso único, hash armazenado (nunca o token puro em texto),
**reivindicação atômica** (`UPDATE tokens_renovacao SET usado_em =
now() WHERE token_hash = ? AND usado_em IS NULL RETURNING
public_id` — 0 linhas afetadas = já usado, aborta com "já
processado"). Mesmo padrão já validado em produção real, sob
concorrência de verdade, na RPC `assumir_atendimento` (testado com
duas chamadas simultâneas, sem duplicação). Expiração curta (24-48h)
cobre o caso do link ficar velho — depois disso, `GET` mostra "link
expirado", nunca executa.

## 13. Resumo — comprovado / precisa implementar / precisa confirmar

### ✅ Já comprovado (com evidência real)

- Criação de pedido/cobrança PIX real no PagBank Sandbox, com QR Code.
- Estrutura do payload do webhook (`reference_id`, `charge.id`,
  `end_to_end_id`, link `SELF` presente).
- PagBank não deduplica `reference_id` repetido (por isso a Camada 1
  é necessária, não opcional).
- Comportamento de retry do webhook (até 3 tentativas, backoff
  crescente).
- Renovação real do UniTV disparada por webhook PagBank
  (`poc-pagbank-unitv-renew`, 2026-08-12) — só pra UniTV.
- `PATCH`/`GET` no Rocket via `ROCKET_API_KEY` (renovação do
  cadastro, sem RocketZap) — POCs #1/#2.
- Sessão do Vault + `pagamento/add` (renova o Sigma de verdade, mas
  aciona o RocketZap) — §16.
- Reivindicação atômica de token sob concorrência real (padrão já em
  produção, `assumir_atendimento`).

### 🔨 Precisa ser implementado (desenhado, nunca codado)

- Tabela `cobrancas_pix` (Camada 1 de idempotência + amarração
  cliente↔cobrança).
- Tabela `tokens_renovacao` (uso único do botão).
- Lógica de criação de cobrança real ligada a um cliente (falta
  decidir quem dispara — seção 6 do documento anterior).
- Lógica de reconsulta ativa disparada pela chegada de um comprovante
  (item novo desta correção — nunca desenhado em detalhe de código,
  só conceitualmente aqui).
- Endpoint de dois passos (`GET`/`POST`) pro botão `RENOVAR ACESSO`.
- Generalização do `poc-confirmacao-renovacao` pra receber `public_id`
  dinâmico em vez de fixo.

### ❓ Precisa ser confirmado tecnicamente (a verificar, dúvida real)

1. **Se a reconsulta via link `SELF` realmente funciona como
   esperado** — nunca chamada de verdade, só proposta (seção 2).
2. **Se a resposta dessa reconsulta traz `charge.amount` de forma
   utilizável** — não confirmado.
3. **Se `PATCH` via `ROCKET_API_KEY` prorroga o Sigma de verdade** —
   gap crítico, decide o mecanismo do passo 8/9 (documento anterior,
   seção 4).
4. **Mecanismo exato do `x-authenticity-token`** — não documentado
   oficialmente.
5. **Mapeamento período↔nome de plano no Rocket** — plausível, não
   1:1 confirmado.
6. **Status atual do `UNITV_DEALER_TOKEN`** — possivelmente inválido
   desde 2026-08-16.
7. **Comportamento do PagBank pra pagamento recebido fora de uma
   cobrança criada por nós** — não confirmado.

**Prompt de sistema não alterado. Nenhum código, migration, deploy ou
renovação real executada nesta etapa.**
