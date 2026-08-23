# Desenho — Ganhou Um Mês Grátis Pela Indicação (levantamento, sem submissão)

> **Levantamento e desenho, não implementação.** Nenhum template
> criado/submetido, nenhum código escrito, nenhuma automação do
> Rocket alterada. Continua o inventário
> (`2026-08-22_inventario_substituicao_rocketzap.md`, item 13).

## 0. Correção ao inventário/matriz anteriores — texto literal revela bem mais do que o resumo dizia

A matriz de migração original listava as variáveis desta mensagem
como `{NOME}` `{NOME_ULTIMO_INDICADO}` `{TELEFONE}` — só 3. **O texto
literal completo (lido ao vivo agora) usa 9 variáveis diferentes**, e
inclui um **novo convite promocional embutido dentro da própria
mensagem de agradecimento**, não só a confirmação do crédito. Mesmo
padrão de correção já visto no `Teste Grátis Iniciado`: o resumo da
matriz original estava incompleto, não o texto real.

## 1. Texto literal completo (confirmado ao vivo nesta sessão)

```
👋 Olá, *{NOME}!* Tudo bem?

🙏 *MUITO OBRIGADO PELA SUA INDICAÇÃO!*

Ficamos muito felizes em saber que você está aproveitando nossos conteúdos e indicando a InovaTV para seus amigos e familiares! 🤩

🎁 Você ganhou *1 mês totalmente grátis* pela indicação de *{NOME_ULTIMO_INDICADO}!*

✅ Plano atual: *{PLANO} — R$ {VALOR}*
✅ Usuário: *{USUARIO}*
✅ Servidor: *{SERVIDOR}*
🕐 Próximo vencimento: *{VENCIMENTO} às {HORA}*

🚀 E a promoção *Indique e Ganhe* continua ativa!

💰 Para cada novo amigo indicado que contratar um plano conosco, você ganha *mais 1 mês grátis* de assinatura.

📌 Seu amigo só precisa informar seus dados no atendimento:

👤 Nome: *{NOME}*
📱 Celular: *{TELEFONE}*

📺 *InovaTV — Sempre pensando em você!*
```

**Variáveis usadas (9, corrigindo os 3 da matriz original):** `{NOME}`
`{NOME_ULTIMO_INDICADO}` `{PLANO}` `{VALOR}` `{USUARIO}` `{SERVIDOR}`
`{VENCIMENTO}` `{HORA}` `{TELEFONE}`.

**Achado curioso, não crítico:** `{NOME}` aparece duas vezes na
mensagem — uma para o cliente que está sendo agradecido (saudação
inicial), outra dentro do bloco final que orienta o *indicado* a
informar seus próprios dados. É o mesmo nome de variável reaproveitado
em dois contextos diferentes pelo motor de template do Rocket — não é
um erro, mas reforça que o bloco final é dirigido a uma pessoa
diferente (o novo indicado), não ao destinatário da mensagem.

## 2. Gatilho real — confirmado, é manual (bate com a matriz original)

**Não existe evento pontual automático para isto** — diferente de
Pagamento Confirmado e Teste Grátis Iniciado, a tela
`/gerenciador/configuracoes/` não tem nenhum campo "Mensagem de
indicação" configurável (confirmado nesta sessão e na anterior — só
existem "Mensagem pagamento" e "Mensagem de Teste Criado"). **Também
não existe Cobrança nem automação de Testes ligando a esta mensagem**
— não está entre as 6 Cobranças nem os 3 Envios de Teste.

Bate exatamente com o que a matriz de migração já tinha concluído
(seção 3.5): *"do lado do Rocket, é um processo manual — o cliente
responde no próprio WhatsApp [dizendo que indicou alguém], e alguém
(humano, hoje) registra a indicação manualmente no sistema para gerar
o crédito."* O disparo desta mensagem específica, na prática, é uma
ação manual do José (provavelmente pelo botão "Enviar" do próprio
card da mensagem, ou copiado/colado) depois de registrar o crédito —
não confirmado o mecanismo exato de envio, só que não é automático.

## 3. Dados disponíveis hoje na nossa infraestrutura

| Variável | Disponível? | Fonte |
|---|---|---|
| `{NOME}` | ✅ Sim | `/status` → `cliente.nome` |
| `{PLANO}` | ✅ Sim | `/status` → `cliente.planoNome` |
| `{SERVIDOR}` | ✅ Sim | `/status` → `cliente.servidorNome` |
| `{VENCIMENTO}` / `{HORA}` | ✅ / ⚠️ Provável | `/status` → `cliente.vencimento` |
| `{USUARIO}` | ⚠️ Parcial | Só em `/match`, mesma lacuna já registrada |
| `{VALOR}` | ❌ Não disponível | Mesma lacuna já registrada em toda a investigação |
| `{NOME_ULTIMO_INDICADO}` | ❌ Não disponível | Não existe conceito de "quem indicou quem" em `/match`/`/status` hoje — dado novo, não coberto por nenhuma API atual |
| `{TELEFONE}` (do indicado, pro bloco final) | N/A | Esse bloco é instrução textual pro indicado agir, não um dado a preencher automaticamente |

**Achado estrutural, mais sério que os de variável faltando:** o dado
"quem indicou quem" **não existe em lugar nenhum da nossa
infraestrutura hoje** — é uma relação que só o processo manual
(alguém anota, no Rocket, que o cliente X indicou o cliente Y) produz.
Reproduzir esta mensagem de forma automática exigiria ou (a) criar
esse relacionamento na nossa própria camada, ou (b) continuar
dependendo do registro manual no Rocket como fonte, e só ler de lá —
nenhuma das duas coisas está decidida ou implementada.

## 4. Categoria provável na Meta — não é só "confirmação", como o próprio usuário já alertou

**Concordando com a ressalva já levantada:** a existência da promoção
"Indique e Ganhe" não torna automaticamente Marketing a mensagem de
confirmação do crédito — mas **o texto real desta mensagem específica
vai além de confirmar**: ele explicitamente **repete o convite da
promoção** ("a promoção Indique e Ganhe continua ativa... você ganha
mais 1 mês grátis") e **instrui a ação de conversão de um terceiro**
(o amigo indicado). Isso é estruturalmente diferente de
`pagamento_confirmado` (que só informa um fato, sem reabrir nenhuma
oferta) — é mais parecido com o "Teste Grátis Iniciado" (confirmação
+ oferta comercial embutida).

**Mesma recomendação de separar as duas coisas:**
- **Núcleo pra template (Utilidade, candidato razoável):** "Você
  ganhou 1 mês grátis pela indicação de X. Plano atual: Y, vencimento:
  Z." — puramente informativo, sem reabrir a promoção.
- **Convite pra indicar de novo — não vai no template.** Isso é
  conteúdo promocional (mesma natureza do próprio `Promoção Indique e
  Ganhe`, item 12 do inventário, já marcado como "Marketing quase
  certo"). Se o cliente perguntar sobre a promoção depois, dentro da
  janela de 24h aberta pela resposta, o Orquestrador pode responder
  com esse conteúdo via Conhecimento Institucional — mesma lógica já
  aplicada ao Teste Grátis Iniciado.

## 5. Proposta de núcleo transacional (rascunho, não submetido)

```
🎁 Você ganhou 1 mês grátis!

Olá,{{1}}! Você ganhou 1 mês totalmente grátis pela indicação de {{2}}.

📋 Plano atual:{{3}}
📅 Novo vencimento:{{4}}

Obrigado por indicar a InovaTV!
InovaTV — Sempre pensando em você! 📺
```
4 variáveis (nome, nome do indicado, plano, vencimento) — sem
`{VALOR}`/`{USUARIO}`/`{SERVIDOR}` (mesmo corte já aplicado no
`pagamento_confirmado`, mesma lacuna de dado), sem reabrir a promoção,
sem instrução pro indicado.

**Isto ainda não resolve o achado da seção 3** (de onde vem
`{NOME_ULTIMO_INDICADO}` na nossa infraestrutura) — a proposta de
texto assume que esse dado existiria disponível no momento de montar
a mensagem, mas hoje ele só existe dentro do processo manual do
Rocket. Fica registrado como bloqueador de implementação, não
resolvido aqui.

## 6. O que fica pendente, não decidido aqui

1. **De onde viria `{NOME_ULTIMO_INDICADO}`** na nossa infraestrutura
   — bloqueador mais sério desta mensagem específica.
2. **Mecanismo exato de disparo hoje** (botão "Enviar" manual? outro
   caminho?) — não confirmado, só que não é automático.
3. **Se/quando o processo de indicação vira, de fato, algo que a IA
   própria participa** — decisão de produto já sinalizada como em
   aberto na matriz original (seção 3.5), não resolvida aqui.
4. Nome definitivo do template — não sugerido ainda, sem prioridade
   decidida entre os itens acumulados.

**Nada submetido, nada implementado. Aguardando revisão antes de
decidir a sequência de trabalho entre os itens já levantados
(Pagamento Confirmado, Vence Hoje, Teste Grátis Iniciado, este).**
