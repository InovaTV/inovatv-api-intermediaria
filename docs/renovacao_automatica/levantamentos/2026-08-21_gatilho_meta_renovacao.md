# Gatilho da Meta para renovação — levantamento técnico (desenho, nada implementado)

> **Isto é um desenho, não uma implementação.** Nenhum código foi
> escrito, nenhuma instrução da Meta foi alterada, nenhuma coluna
> nova foi adicionada à planilha, nenhuma renovação foi executada.
> Parte da parte Rocket→Sigma (comprovada e documentada em
> `2026-08-21_renovacao_automatica_painel_primeiro.md`, seção 14) —
> este documento assume esse mecanismo como dado e não o reinveste,
> conforme instrução explícita do usuário.

## 0. Premissa e escopo

```
Meta Business Agent → cliente confirma → cliente clica → nossa
infraestrutura recebe o clique → renovação já comprovada (Rocket→Sigma)
```

A Meta **não precisa de Custom Actions nem de chamar nossa API
diretamente** — o mecanismo é um link em texto na conversa, que o
WhatsApp já renderiza como clicável (comportamento universal do
WhatsApp, não específico deste produto).

> **Princípio central deste desenho, revisado e confirmado pelo
> usuário:** a confirmação do cliente na conversa (seção 5) só
> autoriza a IA a **apresentar** o link — não autoriza a renovação em
> si. **Quem efetivamente autoriza a operação é o toque do cliente no
> botão da página (o `POST`).** São duas camadas de confirmação
> distintas, não uma só: (1) a IA decide, com base na conversa, que
> faz sentido oferecer o link; (2) o clique no botão é o ato real de
> autorização da renovação. O `GET` nunca é, em nenhuma hipótese,
> equivalente a essa autorização — só o clique real no botão (que
> gera o `POST`) conta.

**Dependência estrutural que precisa ser dita com força, antes de
qualquer outra coisa:** "Meta Business Agent", neste projeto, é a IA
nativa do WhatsApp Business (configurada via Instructions/Knowledge em
`web.whatsapp.com` → Ferramentas), **não** a IA própria (Gemini 3.6
Flash) especificada nos Componentes 1-5 em `inovatv_central/CLAUDE.md`.
Essa mesma Meta AI está registrada, no próprio `inovatv_central/CLAUDE.md`
("Frente — IA do WhatsApp"), como estando em **pausa deliberada desde
2026-08-15** por uma regressão real de comportamento (passou a
inventar dados de cliente — quantidade de acessos, vencimento, plano
inexistente). Isso não é uma investigação nova a reabrir agora (fora
de escopo aqui), mas é uma dependência direta e real deste desenho:
**qualquer decisão condicional delicada (seção 5) que dependermos
dessa IA específica herda o mesmo risco de confiabilidade já
documentado e nunca resolvido.** Marcado como BLOQUEIO na tabela
final — não impede o desenho, mas deveria impedir produção sem uma
nova rodada de validação (mesma metodologia das Rodadas 3/4 já usada
pra escolher o Gemini) especificamente para este fluxo.

---

## 1. Link dentro da conversa — o que a Meta consegue apresentar

- **Link em texto/URL clicável:** COMPROVADO por comportamento
  universal do WhatsApp — qualquer `http(s)://` em qualquer mensagem
  (de humano ou de IA) vira automaticamente um link tocável com card
  de prévia (Open Graph). Não é um recurso específico da Meta AI, é
  do próprio WhatsApp.
- **Botão nativo/Custom Action:** **não documentado como disponível**
  neste produto (Meta AI Agent hospedado, configurado só por
  Instructions/Knowledge) — isso é um recurso de mensagens
  interativas da **Cloud API** (que exige construir o bot você mesmo,
  exatamente o caminho que a arquitetura da IA própria — Componente 3
  — usa, não o Meta AI Agent nativo). **Não testado neste projeto.**
  Marcado PRECISA TESTAR (expectativa baixa, mas vale confirmar antes
  de descartar de vez).
- **Conclusão prática:** o mecanismo real disponível é a IA incluir
  o link como texto puro na resposta, confiando no auto-render do
  WhatsApp — exatamente a premissa que o usuário já assumiu.

---

## 2. Link específico por acesso

Resolvido naturalmente pela própria estrutura de dados já existente:
a exportação de clientes (`export-clientes` → `CLIENTES_INOVATV`) já
é **uma linha por acesso**, não uma linha por telefone — um cliente
com 2 acessos (ex. Ricardo Julio: Semestral/UNITV + Mensal/NewOne)
já aparece em 2 linhas hoje. Uma coluna de link nessa mesma
exportação já nasce por-acesso, sem nenhuma mudança de modelo.

---

## 3. Origem do link — nova coluna na exportação (desenho, NÃO implementado)

**Preservação explícita:** as 10 colunas aprovadas
(`nome, telefone, usuario, plano, servidor, valor, vencimento, telas,
aplicativo, dispositivo`) permanecem exatamente como estão. O que se
propõe é uma **11ª coluna nova**, `link_renovacao`, sujeita a
aprovação própria e separada — nunca misturada com a decisão já
fechada sobre as 10.

**Onde o token seria gerado:** não na hora da exportação do `.xlsx`
em si (`gerar-clientes-xlsx.mjs` já é só transformação/sanitização,
sem estado) — precisa ser um passo anterior, na própria
`export-clientes` (Edge Function, já fala com o Rocket) ou uma nova
Edge Function companheira, que:

1. Para cada acesso retornado pelo Rocket, verifica se já existe um
   token **válido e não usado** para aquele `public_id` numa tabela
   nova (`tokens_renovacao`, ver seção 4).
2. Se existir, reaproveita o mesmo (não gera um novo a cada sync —
   importante: a automação sincroniza a cada 30-60min, e um cliente
   pode responder horas depois; regenerar a cada ciclo invalidaria
   silenciosamente um link que o cliente já tem na conversa).
3. Se não existir (ou o anterior expirou/foi usado), gera um novo.
4. Devolve a URL completa como o valor da 11ª coluna.

**Isso é geração idempotente por sync, não geração nova a cada
ciclo** — ponto de desenho importante, não deve ser perdido na
implementação futura.

---

## 4. Token — desenho técnico completo

```
https://<dominio>/renovar/<token>
```

- **Geração:** aleatório, alta entropia (ex. 32 bytes via
  `crypto.randomBytes`, codificado em base64url ou hex) — opaco, não
  codifica `public_id` nem nenhum dado do cliente.
- **Armazenamento:** tabela nova, `tokens_renovacao`, no mesmo
  Supabase de `inovatv-api-intermediaria` (reaproveita infraestrutura,
  mesmo padrão de sempre). **O valor bruto do token não fica salvo em
  texto puro no banco** — só um hash (SHA-256), mesma prática já usada
  em mecanismos de reset de senha em geral. O valor bruto só existe na
  URL entregue ao cliente.
- **Associação token → `public_id`:** a própria linha da tabela é a
  associação — `token_hash` como chave, `public_id` como referência
  ao acesso real no Rocket.
- **Validade:** proposta — **24 a 48h**. Justificativa: cobre
  confortavelmente "cliente responde no mesmo dia ou no dia seguinte"
  sem deixar links de semanas atrás ainda ativos dentro do histórico
  da conversa.
- **Uso único:** sim — campo `usado_em` (nullable). Ver seção 8 para
  o mecanismo atômico que garante isso sob concorrência real (mesmo
  padrão já validado nesta investigação para `assumir_atendimento`).
- **Comportamento após renovação:** token marcado como usado; qualquer
  clique seguinte no mesmo link retorna uma página de "link já
  utilizado", sem executar nada de novo.
- **Comportamento quando plano/valor muda depois do token criado:**
  **o token nunca encoda plano/valor — só identidade do acesso.** A
  chamada de renovação, no momento do clique, sempre lê o estado
  **atual** do Rocket/Sigma (mesmo comportamento já comprovado nos
  scripts desta investigação, que leem o plano real via `/planos/`
  antes de calcular, nunca presumem). Se o plano mudou de verdade
  entre a emissão do link e o clique, a renovação reflete o que está
  valendo agora — não o que estava valendo quando o link foi gerado.
  Ver também seção 9 para o caso de o acesso já ter sido renovado por
  outro caminho nesse meio-tempo.

---

## 5. Regra da IA — sequência de decisão (texto de instrução proposto, NÃO aplicado)

> **Importante, reforçando o princípio da seção 0:** tudo nesta seção
> autoriza só a **apresentação** do link — nunca a renovação em si.
> A confirmação do cliente na conversa é a primeira camada
> (justifica oferecer o link); o clique real no botão da página
> (seção 8) é a segunda e única camada que de fato autoriza a
> operação.

```
cliente manda comprovante
        ↓
IA identifica cliente pelo telefone (mecanismo ja existente)
        ↓
1 acesso so?  ──NAO──→ ver secao 6 (desambiguar, nunca escolher sozinho)
        │SIM
        ↓
IA analisa o comprovante (valor)
        ↓
valor bate com o valor do plano ATUAL daquele acesso
(dado ja sincronizado, nao inventado)?
        │
   ┌────┴────┐
  SIM        NAO
   │          │
   │          └──→ NAO oferece link → transferencia para atendente
   ↓
IA pergunta explicitamente: "Confirma que deseja renovar o acesso
[nome do servidor] com esse pagamento?"
        ↓
confirmacao explicita do cliente (nao inferida, nao presumida)
        ↓
SO ENTAO a IA oferece o link daquele acesso especifico
```

**Duas regras centrais, na própria redação da instrução (linguagem
já usada no prompt congelado da IA própria, reaproveitada aqui por
consistência):**
> "Possível renovação não é confirmação. Comprovante conferido não é
> renovação executada. A renovação só começa quando o cliente clicar
> no link — nunca ofereça o link sem confirmação explícita do
> cliente, mesmo que o comprovante pareça bater."

**Risco real, não escondido:** esta é uma sequência condicional de
várias etapas, e a Meta AI já demonstrou nesta mesma investigação
(seção "IA do WhatsApp" do `inovatv_central/CLAUDE.md`) que segue mal
instruções complexas sob certas condições. **PRECISA TESTAR** antes de
confiar em produção — idealmente com uma bateria de casos dedicada
(mesmo estilo das Rodadas 3/4 já usadas para avaliar o Gemini),
específica para esta sequência.

---

## 6. Clientes com múltiplos acessos

Mesma disciplina já usada e comprovada no prompt da IA própria
(Componente 1 §8): **nunca escolher um acesso sozinho.** Se o telefone
tem 2+ acessos, a IA lista todos (servidor + plano) e pergunta qual o
comprovante se refere. Só depois de o cliente indicar qual, a IA
segue pro fluxo da seção 5 **para aquele acesso especificamente** —
inclusive o link oferecido é o token daquele acesso, nunca um
genérico. **Se a resposta do cliente não permitir identificar com
segurança qual acesso, não oferece nenhum link** — transfere.

---

## 7. Alteração de plano — sem gatilho automático

Já é consequência direta da seção 5: se o valor do comprovante não
bate com nenhum plano atual daquele acesso, **ou** o cliente pede
mudança de plano explicitamente, o resultado é sempre o mesmo — sem
link, transferência para atendente. Não há ramo do desenho onde
mudança de plano gera link algum nesta primeira versão.

---

## 8. O que acontece no clique — desenho do endpoint (CORRIGIDO em relação ao esboço original, ver seção 10)

**O desenho original de um passo único (`GET /renovar/<token>` já
executa) está descartado — ver seção 10 para o motivo.** Desenho
revisado, em dois passos. **Nomenclatura importante:** o `POST` não é
chamado de "confirmar" porque pede uma nova confirmação — a
confirmação **já aconteceu** no clique real do botão, na própria
página. O endpoint só processa uma autorização que já foi dada nesse
exato instante (ver princípio na seção 0).

```
PASSO 1 — GET /renovar/<token>          (seguro para qualquer robô/prévia)
        ↓
valida token (existe? nao expirado? nao usado?) -- SO LEITURA
        ↓
NAO existe / expirado / usado → pagina informativa
        ↓
valido → pagina com o botao "CONFIRMAR RENOVACAO"
        ↓
GARANTIA ESTRUTURAL deste passo, sem excecao:
  - nao consome o token
  - nao altera nenhum estado no banco
  - nao chama o Rocket
  - pode ser repetido quantas vezes for (recarregar a pagina,
    prévia do WhatsApp, scanner de antivirus) sem nenhum efeito

PASSO 2 — clique real no botao "CONFIRMAR RENOVACAO" → POST /renovar/<token>/confirmar
  (este e' o unico ponto de todo o fluxo onde a autorizacao do
  cliente se torna real -- ver principio na secao 0)
        ↓
1. valida token (existe? nao expirado? nao usado?)
        ↓
2. reivindica o token de forma atomica (UPDATE ... WHERE usado_em IS
   NULL RETURNING public_id -- mesmo padrao ja validado nesta mesma
   investigacao para assumir_atendimento; 0 linhas = outra requisicao
   ja levou, aborta com "ja utilizado")
        ↓
3. valida a sessao do Rocket (Vault -- ainda valida? monitoramento ja
   comprovado cobre isso, mas o endpoint confere de novo aqui)
        ↓
   sessao invalida → NAO marca o token como definitivamente
   consumido (devolve pro estado disponivel dentro da janela de
   validade original) → pagina "nao foi possivel processar agora"
        ↓
4. consulta o estado ATUAL do acesso no Rocket (nao confia no que
   valia quando o link foi gerado -- mesma disciplina ja usada nos
   scripts desta investigacao)
        ↓
5. verifica se ainda pode renovar:
   - nome/servidor/plano ainda fazem sentido? (mesma checagem de
     identificacao ja usada em teste-patch-renovacao-newone)
   - o vencimento atual ja avancou mais do que seria esperado desde
     a emissao do token? (sinal de renovacao ja feita por outro
     caminho -- ver secao 9) → NAO renova de novo, aborta com
     resultado = "ja_renovado_por_outro_caminho"
        ↓
inconsistente (identificacao ou vencimento suspeito) → aborta,
  registra o resultado especifico, NAO tenta renovar, pagina
  generica de erro
        ↓
consistente → 6. chama o mecanismo de renovacao JA COMPROVADO
  (sessao do Vault -> POST pagamento/add -> Rocket -> Sigma)
        ↓
grava o resultado na propria linha do token (sucesso/falha + detalhe)
        ↓
pagina minima de encerramento (secao 10) -- Rocket ja manda a
  confirmacao real pro cliente via RocketZap
```

---

## 9. Segurança — análise ponto a ponto

| Risco | Mitigação proposta |
|---|---|
| **Token vazado** | Alta entropia, hash no banco (vazamento do banco não expõe token usável), janela curta de validade (24-48h). |
| **Link encaminhado a outra pessoa** | Uso único cobre a execução dupla; se um terceiro usar antes do cliente real, a consequência é limitada — renovar a mesma assinatura que o próprio cliente já queria renovar, não expõe dado novo a ninguém. Risco aceito como proporcional (não bloqueante), conforme instrução do usuário. |
| **Clique duplicado / refresh do navegador** | Resolvido pelo `POST` (não `GET`) + reivindicação atômica do token (seção 8) — só a primeira requisição de fato executa. |
| **Abertura do link semanas depois** | `expira_em` — fora da janela, página de "expirado", sem execução. |
| **Dois cliques simultâneos** | Mesma reivindicação atômica — Postgres garante que só uma das duas corridas "ganha" a linha. |
| **Renovação já realizada por outro caminho** (ex. atendente renovou manualmente pelo Rocket enquanto o token ainda estava válido e não usado) | **Risco real, não coberto só pelo "uso único do token".** Proposta: no PASSO 2, antes de chamar a renovação, comparar o vencimento atual (lido ao vivo) contra uma expectativa razoável (ex.: se já está muito mais no futuro do que faria sentido pro ciclo normal, tratar como suspeito e abortar/marcar pra revisão humana, em vez de renovar de novo às cegas). **Desenho novo, não testado — fica como pendência explícita para quando for implementar.** |
| **Sessão do Rocket inválida no momento do clique** | O PASSO 2 tenta a chamada; se falhar por sessão inválida, **não marca o token como definitivamente consumido** — devolve pro estado "ainda disponível" dentro da janela de validade original, mostra página de "não foi possível processar agora, tente novamente em instantes", e registra a falha (o monitoramento de sessão, já implementado, já estaria simultaneamente gerando o alerta no GitHub). |
| **Alteração de plano depois que o link foi criado** | Já coberto na seção 4/8 — token não encoda termos, sempre lê o estado real no momento do clique; se a checagem de consistência (seção 8) não bater, aborta em vez de renovar às cegas. |
| **Pré-carregamento/crawler/antivírus acessando a URL sem intenção humana** | **Tratado à parte, seção 10 — é o ponto mais crítico.** |

---

## 10. Resultado da página + o risco de pré-carregamento — tratamento específico

**Confirmando a preocupação do usuário: é um risco real e praticamente
garantido de acontecer, não uma hipótese remota.** O próprio WhatsApp,
ao ENVIAR uma mensagem contendo uma URL, já faz um `GET` automático
nessa URL para gerar o card de prévia (Open Graph) — isso acontece
**antes** de qualquer humano ver ou tocar no link, de forma
essencialmente garantida, sempre que a IA mandar a mensagem com o
link. Softwares de segurança corporativa/antivírus com "verificação de
links" também costumam fazer o mesmo tipo de requisição automática.

**Por isso o desenho de passo único (`GET` já executa) está
descartado** (já refletido na seção 8, mas repetido aqui porque é o
ponto central): se um `GET` sozinho executasse a renovação, a própria
prévia do WhatsApp teria gastado o token e debitado um crédito real no
Sigma antes do cliente sequer ver a mensagem.

**Solução estrutural (não apenas heurística):** separar
arquiteturalmente a capacidade de agir da capacidade de responder a um
`GET`.

- O `GET /renovar/<token>` **nunca**, em nenhuma circunstância, tem
  capacidade de executar a renovação — isso é garantido pela própria
  arquitetura (o endpoint de leitura simplesmente não tem esse código,
  não é uma checagem que pode falhar), não por uma heurística que
  tenta adivinhar se é um robô.
- A execução real só acontece num `POST` separado, disparado por um
  clique real num botão da página — crawlers de prévia (WhatsApp,
  Meta, a maioria dos antivírus) buscam a página, leem metadados
  Open Graph, e **não executam JavaScript nem submetem formulários**.
- **Camada extra, complementar (não a defesa principal):**
  inspecionar o header `User-Agent` do `GET` — o crawler de prévia do
  WhatsApp se identifica com uma string reconhecível. Isso pode
  alimentar um log/alerta de "detectamos uma prévia sendo buscada",
  útil pra diagnóstico, **mas nunca deve ser a única barreira** (UA
  pode faltar ou ser falsificado) — a garantia real é estrutural (GET
  não tem capacidade de agir), não baseada em detectar o robô.
  **Não testado neste projeto** — não temos ainda uma captura real do
  UA que o WhatsApp usa nesse ambiente especificamente.

**Página do PASSO 1 (GET) não precisa de conteúdo elaborado** — já que
o Rocket manda a confirmação de verdade via RocketZap depois do
`POST`. Proposta mínima: uma frase confirmando o acesso (ex. "Renovar
plano NewOne — Js Informática Rp") + um botão. **Página do PASSO 2
(POST, resultado)** também pode ser mínima — algo como "Processando...
você receberá a confirmação pelo WhatsApp em instantes", sem precisar
repetir os detalhes que o Rocket já vai mandar.

---

## Cadeia final (com a correção do passo duplo já incorporada)

```
META
  ↓
instruções (comprovante → identificação → comparação → confirmação
             na conversa -- so autoriza a IA a APRESENTAR o link)
  ↓
link específico do acesso (token opaco, uso único, associado ao
                            acesso -- nunca ao telefone, 24-48h)
  ↓
GET /renovar/<token>          -- SEMPRE seguro, sem efeito colateral
                                  algum (nao consome token, nao altera
                                  estado, nao chama Rocket)
  ↓ (CLIQUE REAL no botão -- é aqui que a autorização de verdade
     acontece, não antes)
POST /renovar/<token>/confirmar
  ↓
reivindica token atomicamente (so um clique concorrente vence)
  ↓
valida sessão Rocket (Vault)
  ↓
consulta estado ATUAL do acesso (nunca confia no que valia quando
  o link foi gerado)
  ↓
verifica se ainda pode renovar (identificação bate? já não foi
  renovado por outro caminho nesse meio-tempo?)
  ↓
ACESSO ROCKET (sessão do Vault)
  ↓
POST DE RENOVAÇÃO JÁ COMPROVADO (/gerenciador/pagamento/add/)
  ↓
ROCKET
  ↓
SIGMA
```

---

## Tabela — COMPROVADO / VIÁVEL / PRECISA TESTAR / BLOQUEIO

| Item | Status |
|---|---|
| Renovação real via sessão Rocket → Sigma | **COMPROVADO** |
| Monitoramento de sessão + alerta | **COMPROVADO** |
| WhatsApp renderiza URL em texto como link clicável | **COMPROVADO** (comportamento universal do WhatsApp) |
| Meta AI incluir dinamicamente um link por acesso, vindo do Knowledge, na resposta | **PRECISA TESTAR** |
| Meta AI ter botão/Custom Action estruturado (além de link em texto) | **PRECISA TESTAR** (expectativa baixa) |
| Meta AI seguir a sequência condicional completa (comprovante→comparar→confirmar→link) com confiabilidade | **PRECISA TESTAR** — risco real, herdado do histórico já documentado da mesma IA |
| Confiabilidade geral da Meta AI para esta tarefa | **BLOQUEIO** — mesma IA está em pausa deliberada desde 2026-08-15 por regressão de comportamento; não resolvido, não reaberto aqui por instrução do usuário, mas é dependência direta |
| Nova coluna `link_renovacao` na exportação | **VIÁVEL** — desenho pronto, decisão/implementação pendente, não altera as 10 colunas aprovadas |
| Geração idempotente de token por sync (não gerar de novo a cada ciclo) | **VIÁVEL** — desenho pronto |
| Tabela `tokens_renovacao` (hash, uso único, expiração) | **VIÁVEL** — mesmo padrão já usado em outras tabelas do projeto |
| Endpoint em dois passos (GET seguro + POST que executa) | **VIÁVEL** — desenho pronto, não implementado |
| Reivindicação atômica do token sob concorrência | **VIÁVEL** — mesmo padrão já validado (`assumir_atendimento`) |
| Detecção de renovação já feita por outro caminho (comparar vencimento antes de renovar de novo) | **VIÁVEL, desenho novo** — não testado, pendência explícita |
| Detecção de crawler por User-Agent (camada extra) | **PRECISA TESTAR** — não capturamos ainda o UA real do WhatsApp neste ambiente |
| Onde hospedar (Vercel + Supabase já existentes) | **VIÁVEL** — reaproveita infraestrutura, sem serviço novo |

---

## O que NÃO foi feito nesta etapa (na versão original deste documento)

Nenhum código escrito. Nenhuma coluna adicionada à exportação. Nenhuma
instrução da Meta alterada. Nenhuma tabela criada. Nenhuma renovação
executada. Este documento era só o desenho, para revisão antes de
qualquer implementação.

---

## 11. Achado real e teste de confiabilidade do BLOQUEIO (2026-08-21, sessão seguinte) — evidência ao vivo, não mais só histórico

> Diferente das seções acima (desenho), esta seção documenta **fatos
> executados**: uma correção real de infraestrutura e uma bateria
> curta de teste real contra a Meta AI em produção. Nenhuma coluna
> nova foi adicionada à exportação, nenhuma tabela `tokens_renovacao`
> foi criada, nenhum endpoint do gatilho foi implementado — isso
> continua tudo pendente. O que mudou de fato: a planilha `clientes`
> foi sincronizada de verdade, e testamos ao vivo a leitura da Meta
> AI sobre esse dado.

### 11.1 Correção — não é achado novo, é o mesmo problema já corrigido antes RECORRENDO (correção de registro)

**Nota de precisão, importante:** ao escrever a primeira versão desta
seção, a investigação abaixo foi descrita como se fosse uma
descoberta inédita desta sessão. **Não é.** O `CLAUDE.md` deste
projeto (seção 12, "Descoberta crítica + correção — a Meta lia um
arquivo diferente do que a automação atualizava", 2026-08-20/21) já
documenta que uma sessão anterior, no mesmo dia, **já tinha
encontrado e corrigido exatamente esse problema** — incluindo um
achado de segurança sério não repetido aqui por completo: a planilha
"clientes" continha os 19 campos crus do Rocket, **incluindo a coluna
`senha` com valores reais**, exposta integralmente à Meta (terceiro),
antes daquela correção.

**O que realmente aconteceu nesta sessão:** a dessincronização
**recorreu** — porque `sincronizar-planilha-clientes.mjs` continua
sendo executado **manualmente, sem nenhum agendamento** (mesma
situação de antes, não mudou). Entre a correção da sessão anterior
(marcador de teste deixado em `09/10/2026`, deliberadamente) e agora,
o Rocket avançou de verdade (nossa renovação real desta sessão, seção
14 do outro levantamento, `2026-12-08`), mas a planilha nunca foi
atualizada de novo nesse meio-tempo — daí a divergência que
encontramos ao testar. **Isso confirma, de novo, que a ausência de
agendamento é o risco estrutural real**, não um bug pontual — o
mesmo tipo de "sumiço silencioso" pode voltar a qualquer momento
entre duas execuções manuais.

- `substituir-arquivo-producao.mjs` (`inovatv-api-intermediaria/scripts/`)
  continua com `FILE_ID` fixo em `1MKqRAXfBsZewNvOzZjsGW9GaWraOyOx5`
  (o `.xlsx` órfão, já identificado como obsoleto na correção
  anterior) — não tocado nesta sessão, permanece sem papel na cadeia
  real.
- O arquivo real conectado à Meta continua sendo
  `1WuyPXKLnXHz0Dkgum0vy5cMDUpC85Nm9GHtrjFCMqDA` (Planilha Google
  nativa "clientes"), confirmado de novo nesta sessão.

### 11.2 Segunda execução real do instrumento correto (COMPROVADO)

`inovatv_meta_business_agent/scripts/sincronizar-planilha-clientes.mjs`
(já usado com sucesso na correção da sessão anterior, seção 12 do
`CLAUDE.md`) foi executado **de novo**, desta vez nesta sessão —
mesma API correta (Google Sheets `values.clear`/`values.update`,
nunca a Drive API `files.update` que só serve pra arquivos binários),
mesmas guardas de segurança (nome/mimeType/pasta/aba conferidos antes
de escrever; backup do conteúdo atual salvo e **relido do disco**
antes de qualquer `clear()`; conferência de cabeçalho/contagem de
linhas/ausência de campo proibido depois de escrever).

### 11.3 Sincronização real executada (COMPROVADO)

Pipeline completo rodado nesta sessão: `gerar-clientes-xlsx.mjs` (124
clientes, dado fresco do Rocket via `export-clientes`) →
`verificar-clientes-xlsx.mjs` (aprovado, exit code 0) →
`sincronizar-planilha-clientes.mjs` (execução real, autorizada
explicitamente). Resultado: `updatedRange: Clientes!A1:J125`,
`updatedRows: 125`, `updatedCells: 1193`, mesmo `fileId` preservado,
checagem pós-escrita aprovada (cabeçalho exato, 124 linhas de dado,
zero campo proibido).

**Canário confirmado por leitura direta pós-escrita** (linha do
cliente de teste, Js Informática Rp / NewOne, usuário `2715749553`):

| Momento | Vencimento na planilha |
|---|---|
| Antes da sincronização | `09/10/2026` |
| Depois da sincronização | `2026-12-08T20:59:59-03:00` (bate com o Rocket real) |

### 11.4 Teste de confiabilidade da Meta AI sobre o dado recém-sincronizado — INCONSISTENTE (COMPROVADO, achado crítico)

Pergunta de teste ("Qual o vencimento do meu plano NewOne?"), mesma
pergunta, mesmo dado real por trás, repetida em sequência curta
(~20 minutos), sem nenhuma instrução nova no meio:

| # | Canal | Resultado |
|---|---|---|
| 1 | Conversa real (cliente) | "Não encontrei... conectei você à nossa equipe" (fallback seguro) |
| 2 | Chat de configuração/admin ("How to teach your AI") | **Inventou `08/10/2026`** — data que não existe em nenhuma versão real da planilha (nem a antiga `09/10`, nem a nova `08/12`) |
| 3 | Chat admin, nova tentativa (pedida explicitamente) | Acertou `08/12/2026` — bate com o dado real |
| 4 | Conversa real (cliente), mesma pergunta repetida | "Não encontrei..." de novo — fallback seguro, mas inconsistente com o acerto do #3 |
| 5 | Chat admin, perguntado de novo | "Não encontrei", pediu pro operador confirmar o campo/instrução |

**Leitura do achado:** mesma pergunta, mesmo dado, mesma janela de
tempo curta, zero mudança de instrução — quatro resultados
diferentes (fallback seguro, invenção, acerto, fallback seguro de
novo). Esse é o padrão de uma indexação/busca instável, não de uma
lacuna de instrução — uma lacuna de instrução produziria erro
consistente (sempre erra do mesmo jeito), não esse vaivém.

**A autoexplicação da própria IA sobre a causa** ("dados ainda não
indexados", "não utilizei dados da memória para evitar alucinação")
**foi tratada como não confiável**, seguindo a mesma disciplina já
registrada antes neste projeto para autorrelato de LLM sobre o
próprio funcionamento interno — é texto plausível gerado sob demanda,
não diagnóstico técnico verificável.

**Achado crítico isolado, mais grave que "não encontrar":** o item #2
(inventar `08/10/2026` com confiança total, sem sinalizar incerteza)
é uma violação real do critério "não inventa" — o mesmo padrão de
regressão já documentado em 2026-08-15 (`inovatv_central/CLAUDE.md`,
"Terceira sessão de diagnóstico"), agora reproduzido ao vivo nesta
sessão, depois de múltiplas tentativas de correção ao longo de
5 dias (reinstrução, troca de formato `.docx`→Planilha nativa,
resync).

### 11.5 Decisão do usuário (2026-08-21) — nem abandonar, nem prosseguir; esperar e retestar

**Não abandonamos a Meta AI nativa nesta sessão.** Decisão explícita:
esperar mais tempo (deixar a sincronização "assentar" de verdade,
mesma disciplina de observação passiva já usada antes neste projeto —
ver seção "Primeira rodada de observação" no `inovatv_central/CLAUDE.md`)
e repetir o teste mais tarde. **Só se a inconsistência persistir nesse
reteste é que a Meta AI nativa será abandonada para este fluxo
específico.**

**Recomendação registrada (não é decisão fechada, é recomendação
apresentada ao usuário):** se a inconsistência persistir, considerar a
**IA própria** (Gemini 3.6 Flash, Componentes 1-5 já especificados,
Orquestrador já parcialmente implementado, 40 execuções sem nenhuma
invenção de dado nas Rodadas 3/4) como o "cérebro" de decisão do
gatilho de renovação, no lugar da Meta AI nativa — mantendo intacto
todo o resto do desenho já aprovado (token, endpoint em dois passos,
Vault, revalidação no clique), que é agnóstico a qual IA decide
oferecer o link. Ressalva: a IA própria tem seu próprio bloqueio, de
natureza diferente (aprovação externa da Meta pra Cloud API, `code
133010` — não confiabilidade).

**A bateria completa de validação (40 casos, Rodadas A-J, proposta em
sessão anterior) permanece pausada** — não resumida, não abandonada,
aguardando o reteste após o período de espera.

**Nada implementado do gatilho em si nesta seção** — só a correção de
infraestrutura de sincronização (real, já em produção) e o teste de
confiabilidade (real, evidência coletada). Coluna nova, tabela de
token, endpoint — tudo isso continua no estado "desenhado, não
implementado" das seções 1-10.
