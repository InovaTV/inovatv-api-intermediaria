# Componente 2 — Camada de Conhecimento Empresarial — Rascunho de Conteúdo V1

> **Nota de status — NÃO É IMPLEMENTAÇÃO.** Este documento registra
> conteúdo empresarial em revisão para futuramente virar linhas da
> tabela `conhecimento_institucional` (Componente 2, arquitetura
> fechada em `inovatv_central/CLAUDE.md`, seção "Especificação Técnica
> — Componente 2"). Nenhuma migration, tabela, código ou deploy foi
> criado a partir deste documento. Nada aqui é usado pela IA em
> produção até uma rodada final de aprovação consolidada, com todos os
> blocos revisados.
>
> Este documento é o **dono único deste conteúdo em rascunho** — não
> duplicado em `CLAUDE.md`. A arquitetura/schema do Componente 2
> continua vivendo só lá.

## 0. Status dos blocos

| Bloco | Status |
|---|---|
| `catalogo_planos` | ✅ Fechado (rodada 1) |
| `suporte_tecnico` | ✅ Fechado (rodada 1, V1 — 25 casos) |
| Regras de atendimento (transversais) | ✅ Fechado (rodada 2, V1 — 15 regras) |
| `institucional` | ✅ Fechado (rodada 3, V1) — 3 itens internos seguem PENDENTE DE CONFIRMAÇÃO (indicação, cancelamento, texto de apresentação) |

**Processo acordado:** cada bloco é levantado (o que já existe no
projeto, classificado CONFIRMADO / EXEMPLO-TESTE / PRECISA CONFIRMAR),
depois o usuário fecha o conteúdo real. Só depois de **todos** os
blocos fechados e revisados numa segunda rodada é que este conteúdo
vira proposta de migration + carga inicial de
`conhecimento_institucional`. Nenhuma etapa pula essa ordem.

**Regra estrutural confirmada nesta rodada, vale para todo o
documento:** conhecimento institucional nunca contém dado individual
de cliente (usuário, senha, servidor do cliente, vencimento,
device_key) — isso continua vindo exclusivamente do Rocket via
`/match`/`/status` (Componente 1). Este documento só registra
informação estável, válida para qualquer cliente.

---

## 1. Bloco `catalogo_planos` — fechado

### 1.1 Planos disponíveis (CONFIRMADO)

| Duração | Valor |
|---|---:|
| 30 dias | R$ 35,00 |
| 90 dias | R$ 90,00 |
| 180 dias | R$ 180,00 |
| 365 dias | R$ 300,00 |

Estes são os valores reais aprovados pelo usuário — deixam de ser
tratados como o placeholder de `available_plans_widget.dart`
(`inovatv_central`) e passam a ser conteúdo candidato à base
institucional.

### 1.2 Teste grátis (HISTÓRICO — superado pelo item 4.4)

> **Decisão de consolidação (rodada de revisão, 2026-08-22):** o item
> **4.4** passa a ser a fonte única dos testes por servidor (geral,
> ChannelTV, NewOne, Blaze, UniTV). Este item 1.2 fica só como
> registro histórico do que foi confirmado primeiro — **não gera
> entrada própria** na `conhecimento_institucional`.

- ~~InovaTV / serviço geral: 6 horas grátis.~~
- ~~UniTV (exceção específica): 3 dias grátis.~~

Ressalva que continua valendo (ver 4.4): condições adicionais (limite
de testes por pessoa, quantidade de aparelhos, etc.) não estão
confirmadas — não incluir na base até serem definidas.

### 1.3 Planos por servidor/serviço (DECIDIDO — V1)

**O catálogo de preços é único, independente do servidor.** Não
existe (nem deve ser inventada) uma tabela tipo "NewOne = R$X,
ChannelTV = R$Y" — não há regra comercial aprovada que estabeleça
isso. Servidor é dado do **acesso individual do cliente**, vindo do
Rocket — nunca do catálogo institucional.

### 1.4 Regra própria do UniTV (HISTÓRICO — superado pelo item 4.4)

> Mesma decisão de consolidação de 1.2: o teste de 3 dias do UniTV já
> está coberto pelo item **4.4**. Este item não gera entrada própria.

O que continua valendo, sem mudança: nenhuma regra técnica de UniTV
(autenticação, criptografia, assinatura, endpoints, cálculo interno de
renovação — ver `inovatv-api-intermediaria/docs/unitv/`) entra na base
institucional. Isso é infraestrutura, não conhecimento para cliente.

### 1.5 Catálogo dinâmico via `GET /planos/` do Rocket (FORA DE ESCOPO — V1)

Decisão explícita: **não** expor esse endpoint via
`inovatv-api-intermediaria`, **não** adicionar essa dependência ao
Orquestrador nesta fase. `conhecimento_institucional` terá o catálogo
estático aprovado (1.1). Registrado aqui só como possibilidade futura,
não como trabalho em andamento.

### 1.6 Fora da base institucional (explícito)

Detalhes técnicos da API UniTV · credenciais/acessos · vencimento
individual · usuário/senha · servidor individual do cliente ·
engenharia reversa · endpoint `/planos/` do Rocket.

---

## 2. Bloco `suporte_tecnico` — fechado (V1, 25 casos)

**Princípio geral desta V1 (definido pelo usuário):** procedimentos
intencionalmente conservadores — a IA orienta o que é seguro e
conhecido; quando precisar de dado do Rocket ou quando não houver
segurança na orientação, transfere. Esta V1 não pretende ser
perfeita — é uma primeira camada, para aprender com atendimentos reais
e refinar depois, em vez de tentar antecipar todos os problemas
possíveis:

```
Cliente
   ↓
IA identifica problema
   ↓
Conhecimento V1
   ↓
Orientação segura
   ↓
Resolveu? ──→ Sim → encerra
   │
   Não
   ↓
Humano
   ↓
Caso real observado
   ↓
Melhoramos o conhecimento
```

### 2.1 — Não consigo entrar
- Identificar aplicativo e servidor.
- Confirmar que o cliente está usando o acesso correto.
- Conferir usuário e senha.
- Conferir se o servidor/provedor selecionado está correto.
- Se necessário, consultar o estado do acesso no cadastro.
- Se não resolver, transferir para humano.
- **Não** inventar credenciais nem afirmar que o acesso está vencido sem consultar o cadastro.

### 2.2 — Usuário ou senha não funcionam
- Confirmar aplicativo.
- Confirmar servidor.
- Conferir se usuário e senha foram digitados exatamente.
- Conferir espaços ou caracteres adicionais.
- Confirmar servidor/provedor selecionado.
- Consultar o estado do acesso se o problema persistir.
- Transferir se não houver solução.
- **Nunca** alterar ou inventar senha.

### 2.3 — Meu acesso não aparece
- Primeiro identificar: aplicativo; servidor; aparelho; qual acesso o cliente está tentando utilizar.
- Se o acesso deveria existir, consultar o cadastro.
- Se houver divergência entre o que o cliente possui e o cadastro, transferir para humano.
- A IA não deve criar, alterar ou prometer um acesso.

### 2.4 — Aplicativo não abre
- Orientação inicial: fechar completamente o aplicativo; abrir novamente; reiniciar o aparelho; verificar se há atualização disponível.
- Se continuar, verificar se o problema ocorre somente naquele aplicativo.
- Se houver procedimento específico documentado para aquele aplicativo/aparelho, utilizar o procedimento específico.
- Se não resolver, transferir.

### 2.5 — Aplicativo trava
- Fechar e abrir novamente.
- Reiniciar o aparelho.
- Verificar atualização.
- Verificar se há espaço disponível no aparelho.
- Se aplicável, limpar o cache do aplicativo.
- Se continuar, verificar se o problema ocorre apenas naquele aplicativo.
- Se não resolver, transferir.

### 2.6 — Aplicativo fecha sozinho
- Reiniciar aplicativo.
- Reiniciar aparelho.
- Verificar atualização.
- Verificar espaço disponível.
- Se aplicável, limpar cache.
- Se continuar, verificar se existe versão compatível/documentada para aquele aparelho.
- Se não houver solução documentada, transferir.

### 2.7 — Canais travando
- Verificar primeiro: se a internet está funcionando normalmente; se o problema ocorre em todos os canais ou apenas alguns; qual aplicativo está sendo utilizado; qual servidor está sendo utilizado.
- Se apenas alguns canais apresentarem problema, informar isso ao atendimento humano quando houver necessidade de transferência.
- Se todos os canais estiverem travando, fazer as verificações básicas de internet/aplicativo.
- Se persistir, transferir.

### 2.8 — Canais carregando lentamente
- Verificar conexão de internet.
- Fechar outros aplicativos que possam estar consumindo conexão.
- Reiniciar aplicativo.
- Reiniciar aparelho e, se necessário, conexão de internet.
- Verificar se o problema ocorre em todos os canais.
- Persistindo, transferir.

### 2.9 — Canais não carregam
- Identificar: aplicativo; servidor; aparelho; se nenhum canal funciona ou apenas determinados canais.
- Verificar internet e reiniciar aplicativo.
- Se o problema persistir em todos os canais, transferir para análise.

### 2.10 — Tela preta
- Verificar: se há áudio; se ocorre em todos os canais ou apenas alguns; aplicativo utilizado; aparelho utilizado.
- Reiniciar aplicativo e aparelho.
- Se continuar, pedir print/foto da tela, quando isso ajudar a identificar o problema, e transferir se necessário.

### 2.11 — Sem áudio
- Verificar: se o problema ocorre em todos os canais; volume do aparelho/TV; se o áudio está funcionando em outros aplicativos; se existe áudio em outro canal.
- Se for problema apenas do serviço e persistir após as verificações básicas, transferir.

### 2.12 — Imagem congelada
- Verificar internet.
- Trocar temporariamente de canal para verificar se ocorre somente naquele canal.
- Reiniciar aplicativo.
- Reiniciar aparelho.
- Se ocorrer em vários canais, transferir para análise.

### 2.13 — EPG não aparece
- Primeiro confirmar: qual aplicativo; qual servidor; se os canais funcionam normalmente.
- Se apenas o EPG estiver ausente e os canais funcionarem, tratar como problema específico do aplicativo/servidor.
- **Não** inventar procedimento de atualização de EPG.
- Se houver procedimento documentado para aquele aplicativo, seguir o procedimento.
- Caso contrário, transferir.

### 2.14 — Lista de canais não aparece
- Verificar: se o usuário conseguiu entrar; se o aplicativo está configurado corretamente; servidor/provedor; se existe conexão com a internet.
- Se o acesso entra normalmente mas a lista não aparece, transferir para análise caso as verificações básicas não resolvam.

### 2.15 — Filmes ou séries não carregam
- Verificar: se canais ao vivo funcionam; se o problema ocorre em todo o conteúdo ou somente em um item; aplicativo; servidor; conexão.
- Se apenas determinado conteúdo apresentar problema, registrar essa informação para o atendimento humano.

### 2.16 — Problema somente em alguns canais
- Perguntar: quais canais; se outros canais funcionam normalmente; qual servidor; qual aplicativo.
- **Não** concluir automaticamente que é problema do cliente ou da internet.
- Se continuar, transferir informando quais canais apresentaram problema.

### 2.17 — Problema em todos os canais
- Verificar: internet; aplicativo; aparelho; servidor; se o cliente consegue entrar normalmente.
- Se as verificações básicas não resolverem, transferir.

### 2.18 — Aplicativo desatualizado
- Orientar o cliente a verificar se existe atualização disponível na fonte oficial/loja do aparelho.
- **Não** mandar instalar versões aleatórias encontradas na internet.
- Quando a base de downloads própria estiver disponível, poderá direcionar o cliente para ela.

### 2.19 — Problema depois de atualizar o aplicativo
- Perguntar: qual aplicativo; qual aparelho; quando ocorreu a atualização; qual problema apareceu depois dela.
- Se possível, pedir print da mensagem/tela.
- **Não** orientar downgrade ou instalação de versão desconhecida sem procedimento aprovado.
- Transferir se necessário.

### 2.20 — Problema depois de trocar de aparelho
- Confirmar: novo aparelho; aplicativo; servidor; usuário; senha.
- Verificar se o acesso permite utilização naquele aparelho.
- Se houver necessidade de alteração de cadastro ou alguma limitação do acesso, transferir.

### 2.21 — Problema depois de trocar a internet
- Verificar: se a internet funciona normalmente; se outros aplicativos funcionam; qual aparelho; qual aplicativo; se o problema começou exatamente após a troca.
- Fazer somente verificações de conexão seguras e conhecidas.
- **Não** mandar alterar DNS aleatoriamente.
- Se persistir, transferir.

### 2.22 — Internet funciona, mas o serviço não funciona
- Isso **não** significa automaticamente que o servidor esteja com problema.
- Verificar: aplicativo; servidor; acesso; se outros serviços de internet funcionam; se o problema ocorre em todos os conteúdos.
- Se o acesso estiver correto e o problema persistir, transferir para análise.

### 2.23 — Precisa reinstalar o aplicativo
- A IA pode orientar a reinstalação quando o procedimento estiver documentado para aquele aparelho/aplicativo.
- Antes de orientar: confirmar aplicativo; confirmar aparelho; confirmar servidor.
- Depois da reinstalação, o cliente precisará dos dados do próprio acesso.
- A IA **não** deve fornecer credenciais que não estejam associadas ao cliente.

### 2.24 — Não sabe qual aplicativo usar (EXCLUÍDO da carga inicial)

> **Decisão de consolidação (2026-08-22):** não vira entrada real
> ainda. A matriz servidor × aplicativo × aparelho que este
> procedimento pressupõe não está formalizada em lugar nenhum do
> projeto — o usuário decidiu explicitamente não transformar uma
> associação feita durante a conversa (ex.: "ChannelTV + Samsung") em
> regra oficial. A regra geral "não inventar compatibilidade" já fica
> coberta pelas Regras de Atendimento (Bloco 3). Fica como **pendência
> de conteúdo**: quando a matriz real existir, ela entra na Camada de
> Conhecimento como entrada própria.

- ~~A IA deve: identificar o servidor do acesso do cliente; consultar os aplicativos parceiros daquele servidor; verificar compatibilidade com o aparelho; apresentar as opções adequadas.~~
- ~~Exemplo: cliente com ChannelTV + Samsung → a IA procura primeiro os aplicativos compatíveis com ChannelTV + Samsung, em vez de simplesmente listar todos os aplicativos da InovaTV.~~

### 2.25 — Não sabe onde colocar usuário e senha
- Primeiro identificar: servidor; aplicativo; aparelho.
- Depois orientar conforme o procedimento daquele aplicativo.
- Se o aplicativo utilizar campos como usuário, senha, provider, servidor, a IA poderá explicar onde cada informação deve ser colocada **somente se isso estiver documentado para aquele aplicativo**.
- **Não** inventar campos ou valores.

### 2.26 Regras gerais transversais (suporte técnico)

- **Identificar antes de orientar:** quando necessário, descobrir servidor → aparelho → aplicativo → problema, nessa ordem. Não perguntar tudo sempre; só o que for necessário para o caso.
- **Usar imagem quando ajudar:** a IA pode solicitar foto ou print quando uma tela de erro/configuração puder esclarecer o problema.
- **Não inventar:** nunca inventar usuário, senha, servidor, provider, DNS, URL, código, procedimento ou compatibilidade.
- **Não alterar configuração avançada sem motivo:** evitar orientar alterações de DNS, roteador, rede, configurações avançadas da TV ou do sistema sem procedimento específico aprovado.
- **Transferência:** transferir quando não houver conhecimento suficiente; o procedimento disponível não resolver; houver problema de cadastro; houver suspeita de problema no acesso; for necessária intervenção humana; o cliente pedir atendimento humano; ou houver qualquer risco de a IA começar a especular.
- **Não prometer solução:** a IA pode dizer que vai orientar/testar uma solução, mas não deve garantir que determinada ação vai resolver o problema.

**Nota arquitetural, para não confundir em implementação futura:** o
Componente 2 não decide transferir — ele só fornece o conhecimento
(incluindo os critérios de "quando transferir" descritos acima como
*conteúdo* de cada entrada). Quem decide de fato a ação
(responder/transferir) continua sendo o Gemini seguindo o prompt
congelado, e quem valida/executa continua sendo o Orquestrador/
Validador (Componentes 1 e 4) — nenhuma autoridade nova é criada aqui.

> **Decisão de consolidação (2026-08-22) — item 2.26 FORA da carga
> inicial do Componente 2, junto com o Bloco 3 inteiro (ver nota
> abaixo, seção 3).** A revisão da proposta de migration revelou uma
> limitação real do mecanismo de busca (§7 da arquitetura): ele só
> retorna uma entrada quando as palavras-chave dela aparecem na
> pergunta do cliente. Nenhum cliente pergunta algo do tipo "quais são
> as regras de identificação do aparelho" — são regras de
> **comportamento da IA**, não conhecimento que o cliente busca. Uma
> entrada "Regras Gerais" ficaria cadastrada mas, na prática,
> dificilmente seria retornada pela busca — criando a falsa impressão
> de que essas regras estão "implementadas" quando o Gemini nunca
> chegaria a recebê-las. Decisão do usuário (Opção B, entre as três
> propostas): **não criar essa entrada agora.** O conteúdo continua
> documentado aqui, mas fica marcado como fora da carga V1. Achado
> arquitetural relevante para o futuro: nem todo conteúdo do Bloco 3
> precisa necessariamente virar linha da tabela — pode ser candidato a
> uma futura revisão do prompt de sistema congelado (processo
> separado, com sua própria rodada de validação, não decidido aqui).

---

## 3. Bloco "Regras de Atendimento" — fechado (V1, 15 regras), FORA da carga inicial do Componente 2

> **Decisão de consolidação (2026-08-22):** este bloco inteiro fica de
> fora da primeira carga de `conhecimento_institucional`, pelo mesmo
> motivo já registrado no item 2.26 acima — são regras de
> comportamento, não perguntas de cliente, e o mecanismo de busca por
> palavra-chave do Componente 2 não as recuperaria de forma confiável.
> As 15 regras continuam documentadas abaixo como conteúdo aprovado —
> só não viram linha de tabela nesta etapa. Ficam registradas como
> candidatas a uma futura decisão sobre onde devem "viver" de fato
> (ex.: revisão do prompt de sistema congelado) — não decidido aqui.

**Natureza deste bloco, diferente do Bloco 2:** o Bloco 2
(`suporte_tecnico`) é conhecimento de diagnóstico — os 25 problemas e
como orientá-los. Este Bloco 3 é **comportamento/atendimento** —
regras transversais de como a IA deve agir em qualquer conversa,
independente do problema específico.

### 3.1 — Identificação do cliente
A IA deve utilizar os dados disponíveis no cadastro para identificar o cliente e seu acesso. Quando a situação exigir informação que não esteja disponível ou houver divergência, não deve inventar e deve encaminhar para atendimento humano.

### 3.2 — Identificação do aparelho
Perguntar o aparelho somente quando isso for relevante para a solução. Exemplos: Samsung, LG, Roku, Android TV, TV Box, Fire Stick, TV Stick, celular, computador. Não perguntar o modelo do aparelho sem necessidade.

### 3.3 — Identificação do aplicativo
Quando o problema estiver relacionado ao aplicativo, a IA deve descobrir qual aplicativo o cliente está utilizando antes de orientar.

### 3.4 — Identificação do servidor
Quando a orientação depender do servidor, a IA deve utilizar o servidor do acesso consultado no cadastro. Não deve presumir o servidor.

### 3.5 — Solicitação de foto ou print
A IA pode pedir uma foto/print quando isso ajudar a identificar: mensagem de erro; tela de login; tela de configuração; problema visual; opção que o cliente não consegue localizar. Como a IA já possui capacidade real de análise de imagem, essa informação poderá ser utilizada diretamente no atendimento.

### 3.6 — Quantidade de tentativas
Não será estabelecido inicialmente um número rígido de tentativas. Regra V1: a IA deve tentar uma sequência curta de orientações seguras e relacionadas ao problema. Se não resolver, ou se o problema não estiver documentado, deve encaminhar para atendimento humano. Pode ser refinado posteriormente com base nos atendimentos reais.

### 3.7 — Quando transferir para humano
A IA deve transferir quando: o problema não estiver coberto pelo conhecimento disponível; a orientação disponível não resolver; houver problema ou divergência no cadastro; for necessária alteração de dados do cliente; houver necessidade de intervenção no acesso; houver suspeita de problema que a IA não consiga diagnosticar com segurança; o cliente solicitar atendimento humano.

### 3.8 — Cliente pede humano
Se o cliente pedir para falar com uma pessoa, não deve insistir em continuar o diagnóstico. Deve iniciar o fluxo de transferência humana já existente.

### 3.9 — Não inventar informações
A IA nunca deve inventar: usuário; senha; servidor; provider; DNS; URL; código; aplicativo compatível; procedimento; preço; prazo; condição comercial. Quando a informação não estiver disponível, deve informar que precisa de atendimento humano ou consultar a fonte correta.

### 3.10 — Alterações técnicas
A IA não deve orientar o cliente a alterar configurações avançadas sem que exista procedimento documentado. Especialmente: DNS; roteador; configurações avançadas de rede; configurações avançadas da TV; configurações do sistema.

### 3.11 — Instalação de aplicativos
Diferenciar: **Android / Android TV / TV Box / Fire Stick / TV Stick** — futuramente haverá tutoriais próprios no aplicativo InovaTV; **Smart TV** — procedimentos serão adicionados gradualmente por fabricante (Samsung, LG, Roku). Enquanto determinado procedimento não estiver documentado, a IA não deve inventá-lo.

### 3.12 — Atendimento fora do horário
Horário normal: segunda a sábado, 09:00 às 21:00. Domingos e feriados: o atendimento pode estar disponível conforme a disponibilidade da equipe. A IA não deve prometer atendimento humano nesses períodos.

*(Nota: este horário é reaproveitado no Bloco 4 — Institucional, item "horário já definido" — mesmo dado, não duplicar como decisão separada.)*

### 3.13 — Privacidade e credenciais
A IA deve utilizar somente os dados pertencentes ao próprio cliente. Nunca deve: fornecer credenciais de outro acesso; revelar dados de outro cliente; utilizar um usuário/senha de exemplo como se fosse do cliente; misturar informações entre acessos diferentes.

### 3.14 — Separação entre conhecimento e dados do cliente
Regra importante da arquitetura, já registrada no Bloco 1/2 e reafirmada aqui: **conhecimento institucional** = como instalar, aplicativos, procedimentos, regras, políticas, informações gerais. **Rocket** = cliente, plano, vencimento, servidor, usuário, senha, situação do acesso. A IA não deve substituir uma fonte pela outra.

### 3.15 — Comportamento diante de dúvida
Se houver dúvida real sobre uma orientação, não inventar para tentar ajudar — é preferível transferir para humano.

**Nota arquitetural (mesma já registrada no Bloco 2, reafirmada aqui):**
nenhuma destas 15 regras cria autoridade nova de decisão. Elas são
conteúdo — o que o Gemini deve seguir. A decisão de responder/
transferir continua sendo do Gemini (seguindo o prompt congelado) +
Orquestrador/Validador (Componentes 1 e 4), nunca do Componente 2 em
si.

## 4. Bloco `institucional` — fechado (V1), com 3 itens internos PENDENTE DE CONFIRMAÇÃO

### 4.1 — Identidade
Nome oficial: **InovaTV Central**. Serviço de televisão por streaming da InovaTV.

### 4.2 — Atendimento
Canal oficial: **WhatsApp**. Atendimento pode começar pela IA e ser transferido para humano quando necessário. Segunda a sábado: 09:00 às 21:00. Domingos e feriados: atendimento conforme disponibilidade da equipe.

*(Mesmo horário já registrado no item 3.12 — fonte única, não duplicar como decisão separada.)*

### 4.3 — Planos
- 30 dias — R$ 35
- 90 dias — R$ 90
- 180 dias — R$ 180
- 365 dias — R$ 300

**Importante:** dados gerais do catálogo. O plano específico do cliente continua vindo do Rocket, nunca presumido pela IA.

*(Mesmo catálogo já registrado no item 1.1 — fonte única, não duplicar como decisão separada.)*

### 4.4 — Testes (FONTE ÚNICA — substitui 1.2 e 1.4)
- Regra geral: **6 horas**.
- **ChannelTV:** 6 horas.
- **NewOne:** 4 horas.
- **Blaze:** existem várias modalidades de teste, com 2, 4, 6 e 12 horas, inclusive opções sem conteúdo adulto.
- **UniTV:** 3 dias.

A IA deve considerar o servidor do cliente antes de informar a duração, quando houver regra específica.

*(Amplia o item 1.2, que registrava só a regra geral + UniTV — este item 4.4 é a versão completa por servidor, agora com ChannelTV/NewOne/Blaze também confirmados. Fonte única a partir daqui; o item 1.2 fica como estava por preservação de histórico, sem contradição — só incompleto frente a este.)*

### 4.5 — Reembolso
**Não há reembolso.** A IA não deve prometer exceções que não estejam documentadas.

### 4.6 — Aplicativos (EXCLUÍDO da carga inicial, mesmo motivo do 2.24)

> Mesma decisão de consolidação de 2.24: sem matriz real de
> compatibilidade servidor × aplicativo × aparelho, não vira entrada
> agora. Pendência de conteúdo, não pendência de arquitetura.

~~A InovaTV trabalha com diferentes aplicativos conforme dispositivo e servidor do cliente. A IA deve considerar dispositivo + servidor (consultados, nunca presumidos) antes de recomendar um aplicativo específico.~~

### 4.7 — Instalação
- Android / Android TV / TV Box / Fire Stick / TV Stick: tutoriais completos serão futuramente disponibilizados no aplicativo próprio da InovaTV.
- Smart TVs: procedimentos serão adicionados gradualmente por fabricante (Samsung, LG, Roku).
- A IA não deve inventar procedimentos de instalação que ainda não estejam documentados.

*(Mesma regra já registrada no item 3.11 — fonte única, não duplicar como decisão separada.)*

### 4.8 — Dados individuais do cliente
Servidor, usuário, senha, plano, vencimento e situação do acesso são dados do cliente — devem continuar vindo da fonte apropriada (Rocket, via `/match`/`/status`), nunca virar conhecimento institucional.

### 4.9 — Limite da informação institucional
A IA deve diferenciar "o que a InovaTV oferece/regulamenta" (pertence ao Componente 2) de "o que acontece especificamente com este cliente" (depende dos dados do cliente, nunca do Componente 2).

### 4.10 — PENDENTE DE CONFIRMAÇÃO (não vira regra até o usuário confirmar)

- **Indicação:** existe conhecimento anterior de uma promoção de indicação, mas a regra exata (condições, valor/benefício, como funciona) não está confirmada — deliberadamente não transformada em regra oficial ainda.
- **Cancelamento:** o que a IA pode informar sobre cancelamento ainda não está definido — especialmente relevante por já existir a regra de "sem reembolso" (4.5), que não deve ser confundida com "sem possibilidade de cancelar".
- **Texto oficial de apresentação da empresa:** não redigido — evitar que uma suposição do Claude vire copy oficial da InovaTV.
- Também fora desta V1, por não haver confirmação: política de alteração de plano, outras condições comerciais não definidas.

**Nenhum destes 4 pontos foi transformado em conteúdo aprovado.** Ficam registrados aqui só como lembrete do que falta, não como rascunho de regra.

**Nota arquitetural (mesma reafirmada nos Blocos 2 e 3):** nada neste
bloco cria autoridade de decisão nova — é conteúdo que o Gemini usa
como fonte, a decisão de responder/transferir continua com
Gemini + Orquestrador/Validador.

---

## 5. Próximo passo

Os quatro blocos têm conteúdo V1 registrado. Antes de qualquer
migration/implementação, ainda faltam: (a) uma segunda rodada de
revisão consolidada do usuário sobre o documento inteiro, e (b) as 4
pendências do item 4.10 (indicação, cancelamento, apresentação,
demais condições comerciais) — essas podem ficar de fora da primeira
carga real e ser adicionadas depois, se o usuário preferir não travar
a implementação esperando por elas. Essa decisão (que pendências
bloqueiam a V1 real vs. quais podem entrar depois) ainda não foi
tomada — fica para quando o usuário pedir a consolidação final.
