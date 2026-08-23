# Levantamento — o ID do comprovante é o `end_to_end_id` do PagBank?

> **Levantamento técnico, não implementação.** Nenhum código, banco,
> Rocket ou PagBank tocados. Baseado em documentação oficial (PagBank
> Developers, `bacen/pix-api`) consultada ao vivo nesta etapa, mais
> comparação estrutural do ID real do comprovante. Onde não há
> confirmação por fonte oficial, está marcado explicitamente como
> inferência.

## 1. O ID do comprovante

```
E182361202608221438s02eb7db157
```

30 caracteres.

## 2. O que está documentado (comprovado, fonte oficial)

**Formato oficial do EndToEndId do Bacen** (`bacen/pix-api`,
confirmado via GitHub oficial do Banco Central):
```
E + ISPB (8 dígitos) + yyyyMMddHHmm (12 dígitos, UTC) + sequencial (11 alfanumérico)
= 32 caracteres, sempre
```

**PagBank documenta o campo** `charges[].payment_method.pix.end_to_end_id`
— descrição literal: *"Id fim a fim da transação."* String, sem
tamanho fixo declarado no schema.

**Achado — inconsistência dentro da própria documentação do
PagBank**, não resolvida por nós:
- A página **"Objeto Order"** mostra como exemplo:
  `ffab77a6818042e292e9bc1d0a51dbf2` — formato hex/UUID, **não** bate
  com o padrão do Bacen acima (sem "E" inicial, sem estrutura de
  data).
- A página **"Webhooks"** mostra como exemplo:
  `E18236120202306271832s05145d8d3d` — este **bate exatamente** com o
  padrão oficial do Bacen: `E` + ISPB `18236120` + data/hora
  `202306271832` (27/06/2023 18:32 UTC) + sequencial `s05145d8d3d`
  (11 caracteres). 32 caracteres certinhos.

Não temos como saber, só pela doc, qual dos dois exemplos reflete o
valor real devolvido em produção — mas o segundo é estruturalmente
válido pelo padrão oficial do Bacen e o primeiro não é. Isso pesa a
favor do exemplo do Webhooks ser o real.

## 3. Comparação com o ID do comprovante

Os **9 primeiros caracteres** do ID do comprovante
(`E18236120`) são **idênticos** aos 9 primeiros caracteres do exemplo
oficial da documentação de Webhooks do PagBank (`E18236120...`) — ou
seja, mesmo prefixo `E` + mesmo ISPB `18236120`.

**Confirmado por fonte independente** (lista de participantes do
Nuclea, câmara que opera o Pix): o ISPB `18236120` pertence à
**PagSeguro Internet S.A.** — a mesma empresa por trás do PagBank.
Isso não é coincidência de dois números aleatórios baterem; ISPB é um
identificador único por instituição.

**O problema:** o ID do comprovante tem só 30 caracteres, não 32.
Reconstruindo o padrão Bacen a partir da posição 10 em diante:
```
posição 10-21 esperada (data/hora, 12 dígitos numéricos): "2608221438s0"
```
Isso contém uma letra (`s`) onde só poderia haver dígito — quebra o
formato se lido literalmente como está.

**Hipótese, não confirmada:** se dois dígitos "20" (o século do ano)
tivessem sido perdidos logo após o ISPB — isto é, se o valor real for
```
E18236120 20260822 1438 s02eb7db157
```
— o resultado bate **perfeitamente** com o padrão Bacen: 32
caracteres, data 22/08/2026 (**hoje**, a data real desta sessão),
hora 14:38 (plausível), sequencial de 11 caracteres alfanuméricos
válido. Essa reconstrução é elegante e plausível, mas **é inferência
minha, não um fato verificado** — pode ser um erro de transcrição
(sua ou minha, ao passar o texto do comprovante pra cá) ou uma
truncagem real de exibição do app do banco. **Não dá pra confirmar
sem reconferir o texto literal exato da imagem, caractere por
caractere** (idealmente copiando/colando do app, não digitando de
memória).

## 4. Achado que muda a resposta prática — PagBank não deixa buscar por `end_to_end_id`

Chequei o endpoint real de consulta de pedido por parâmetros
(`consultar-pedido-parametros`, API de Pedidos, a mesma que já usamos
nas POCs). **Ele aceita exatamente 1 parâmetro: `charge_id`.**
`end_to_end_id` **não é parâmetro de busca aceito** — documentação
literal: *"Invalid search parameters. No known parameter was given"*
pra qualquer parâmetro fora da lista suportada.

Existe também um endpoint de busca por `reference`/intervalo de data
(`consulta-transacoes-por-data-ou-codigo-de-referencia`), mas é da
**API legada v1 do PagSeguro** (`ws.sandbox.pagseguro.uol.com.br/v2`)
— produto diferente da API de Pedidos que este projeto usa, não
relacionado, não aceita `end_to_end_id` também.

**Ou seja: mesmo que o ID do comprovante seja de fato o
`end_to_end_id` verdadeiro, o PagBank não parece oferecer (pelo menos
não documentado) uma forma de "encontrar a cobrança a partir desse
ID".**

## 5. Resposta à pergunta original

> *"Se o cliente enviar esse comprovante, conseguimos extrair esse ID
> e usá-lo pra consultar exatamente aquela transação no PagBank?"*

**Não da forma que a pergunta sugere — não como chave de busca.** Duas
razões independentes, cada uma suficiente sozinha:

1. **Ainda não está 100% confirmado que esse ID É o
   `end_to_end_id`** — a estrutura bate fortemente (prefixo E+ISPB
   idêntico ao exemplo oficial, ISPB confirmado como sendo da
   PagSeguro), mas os 30 vs. 32 caracteres deixam uma lacuna real, só
   fechável reconferindo o comprovante original ou testando contra
   uma resposta real da API (bloqueado hoje pela falta do token, ver
   seção 6).
2. **Mesmo que fosse 100% confirmado, o PagBank não expõe busca por
   esse campo** — o único parâmetro de busca documentado é
   `charge_id`, que é gerado por eles na criação da cobrança, não
   algo que o cliente vê ou manda pra gente.

**O que isso NÃO invalida:** o mecanismo já desenhado (associar
`reference_id`/`charge.id` no momento da criação da cobrança,
guardado em `cobrancas_pix`, reconsultado depois pelo `SELF`/
`charge_id`) continua sendo o único caminho real de busca. O ID do
comprovante, **se confirmado como `end_to_end_id`**, teria valor como
**dado de conferência visual/auditoria** (bater o que o comprovante
mostra contra o que o PagBank devolve pra aquela cobrança, depois de
já ter localizado ela pelo `charge_id`) — não como mecanismo de
localização em si. Isso é uma camada a mais de segurança, não um
atalho que elimina a necessidade do `charge_id`/`reference_id` já
planejados.

## 6. O que falta pra fechar de vez, nenhum item executado nesta etapa

1. **Reconferir o texto literal exato do comprovante** — de preferência
   copiando/colando diretamente da imagem/app, não digitando de
   memória — pra confirmar se os 32 caracteres completos existem e
   testar a hipótese da seção 3.
2. **Testar contra uma resposta real da API/webhook do PagBank** (não
   só contra o exemplo da documentação) — continua bloqueado pela
   ausência do token do PagBank Sandbox como secret configurado
   (mesmo bloqueio já reportado antes de você enviar o comprovante).
3. Confirmar se existe algum endpoint do PagBank não encontrado nesta
   busca que aceite `end_to_end_id` como filtro — não descartado com
   100% de certeza, só não encontrado na documentação consultada.

**Nenhuma implementação, nenhuma alteração de código/banco/Rocket/
PagBank nesta etapa.**

## Fontes consultadas

- [Objeto Order — PagBank Developers](https://developer.pagbank.com.br/reference/objeto-order)
- [Webhooks — PagBank Developers](https://developer.pagbank.com.br/reference/webhooks)
- [Consultar pedido através de parâmetros — PagBank Developers](https://developer.pagbank.com.br/reference/consultar-pedido-parametros)
- [Consulta transações por data ou código de referência (API v1/legada) — PagBank Developers](https://developer.pagbank.com.br/v1/reference/consulta-transacoes-por-data-ou-codigo-de-referencia)
- [Onde encontro a documentação dos campos de um endToEndId — bacen/pix-api (GitHub)](https://github.com/bacen/pix-api/issues/592)
- [Relação de Participantes PCPS — Nuclea (ISPB 18236120 = PagSeguro Internet S.A.)](https://www2.nuclea.com.br/SAP/Rela%C3%A7%C3%A3o%20de%20Participantes%20PCPS.pdf)
