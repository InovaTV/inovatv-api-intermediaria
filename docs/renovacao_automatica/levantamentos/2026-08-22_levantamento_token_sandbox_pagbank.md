# Levantamento — como obter/configurar o token Sandbox do PagBank pra POC de consulta

> **Levantamento, não implementação.** Nenhum token gerado, nenhuma
> configuração de produção alterada, nenhum código escrito. Resolve
> só o bloqueio já identificado: falta o Bearer token Sandbox do
> PagBank como secret, pra poder rodar a POC de consulta real
> (`charge_id`/`SELF`) pedida.

## 1. Achado — já existe (provavelmente) uma conta Sandbox do projeto

`docs/pagamentos/PAGBANK_IDEMPOTENCIA_E_RETRY.md` (linha 91-92,
`inovatv-api-intermediaria`) confirma que os testes reais anteriores
usaram **"o mesmo Bearer token Sandbox dos testes anteriores (token
nunca exposto em arquivo ou documento)"** — ou seja, já existe (ou já
existiu) uma conta de desenvolvedor PagBank associada a este projeto,
usada via PowerShell, de forma deliberadamente não persistida (mesma
disciplina já usada com outras chaves sensíveis aqui, ex. a chave do
Gemini nos testes manuais).

**Não sei se essa conta/token ainda está ativa ou acessível** — só
você pode confirmar isso, entrando no Portal do Desenvolvedor com o
e-mail/login usado da vez anterior.

## 2. Passo a passo oficial pra obter o token (confirmado na documentação)

Pra API que já usamos (**Pedidos/Orders com Pix — não** as APIs de
Transferência/Pix Bacen, que exigem um fluxo à parte de certificado
mTLS, "Connect Challenge" — isso **não se aplica** ao nosso caso, a
própria doc do PagBank diz que esses passos "são exclusivos para a
utilização das APIs de Transferência e Pix Bacen"):

1. Acessar o **Portal do Desenvolvedor** do PagBank:
   `https://portaldev.pagbank.com.br/`
2. Fazer login com a conta PagBank já usada antes (ou criar uma nova,
   se não achar/lembrar a antiga — toda conta nova já nasce em
   Sandbox automaticamente, segundo a doc: *"Todas as novas contas são
   alocadas ao ambiente Sandbox para permitir que você realize testes
   no ambiente de desenvolvimento"*).
3. Clicar na aba **"Tokens"**.
4. Copiar o token Sandbox mostrado ali.

**Não precisa de CNPJ/homologação/aprovação pra isso** — só se aplica
ao ambiente de Produção, que é um fluxo separado e não é o que
queremos agora.

## 3. Como eu recomendo configurar — nunca colar o token aqui no chat

Mesmo padrão já usado neste projeto pra todo token sensível
(`WHATSAPP_ACCESS_TOKEN`, `UNITV_DEALER_TOKEN`, `ROCKET_API_KEY`,
etc.) — você mesmo roda o comando no seu terminal, o valor nunca passa
por aqui:

```
cd inovatv-api-intermediaria
npx supabase secrets set PAGBANK_SANDBOX_TOKEN=<valor copiado do Portal do Desenvolvedor>
```

Depois disso, eu confirmo só que o secret existe (`npx supabase
secrets list` mostra o nome + hash, nunca o valor real — mesma
verificação que já fiz pros outros) e uso `Deno.env.get(...)` numa
function descartável pra POC, mesmo padrão já usado em
`debug-fields`/`whatsapp-diag` — apagada depois de usada.

## 4. O que fica de fora deste levantamento, de propósito

- Nenhum token de **Produção** — nem gerado, nem mencionado além
  desta ressalva.
- Nenhuma alteração em `poc-pagbank-unitv-renew` nem em nenhuma outra
  function existente.
- Nenhuma criação de cobrança nova nesta etapa — a POC de consulta
  (próximo passo, só depois que o secret existir) vai reaproveitar
  identificadores de cobranças de teste já existentes (ex. `ORDE_942E3B5C-...`/
  `CHAR_2A7A3702-...`, da POC UniTV de 2026-08-12) ou, se precisar,
  criar uma cobrança nova só pra esse teste — decisão pro momento da
  POC em si, não desta etapa.

## 5. Próximo passo (só depois que você confirmar o secret configurado)

POC isolada de leitura: consultar uma cobrança real pelo `charge_id`
(endpoint `consultar-pedido-parametros`, já confirmado no levantamento
anterior como o único parâmetro de busca aceito) e, se o link `SELF`
vier no retorno, testar ele também — confirmando status, valor,
`reference_id`, `charge.id` e demais campos retornados. **Só depois
disso eu paro e trago os resultados**, como já combinado.

## Fontes consultadas

- [Crie sua conta PagBank](https://developer.pagbank.com.br/docs/crie-sua-conta-pagbank)
- [Token de autenticação](https://developer.pagbank.com.br/docs/token-de-autenticacao)
- [Obter suas chaves de acesso (Token) — API v1](https://developer.pagbank.com.br/v1/reference/como-obter-token-de-autenticacao)
- `docs/pagamentos/PAGBANK_IDEMPOTENCIA_E_RETRY.md` (`inovatv-api-intermediaria`), linhas 91-92
