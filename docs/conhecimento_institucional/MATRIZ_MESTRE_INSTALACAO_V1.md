# Componente 2 — Camada de Conhecimento Empresarial — Matriz Mestre de Instalação (V1)

> **Nota de status — NÃO É IMPLEMENTAÇÃO.** Este documento registra a
> matriz de compatibilidade servidor × aplicativo × dispositivo,
> fornecida pelo responsável da TOPE TV (2026-09-04), em revisão para
> futuramente virar conteúdo da Camada de Conhecimento Empresarial
> (Componente 2, arquitetura fechada em `inovatv_central/CLAUDE.md`,
> seção "Especificação Técnica — Componente 2"). Nenhuma migration,
> tabela, código, teste ou deploy foi criado a partir deste documento.
> Nada aqui é usado pela IA em produção nem no LAB até uma decisão
> própria e explícita sobre como incorporá-lo.
>
> Este documento é o **dono único deste conteúdo em rascunho** — não
> duplicado em `CLAUDE.md`. A arquitetura/schema do Componente 2
> continua vivendo só lá.

## 0. De onde vem este documento

Esta matriz **não é uma frente nova** — é o fechamento de uma pendência
já registrada nos documentos irmãos desta mesma pasta:

- `PROPOSTA_CARGA_INICIAL_V1.md` (seção 2, item 2, e seção final):
  *"Compatibilidade servidor × aplicativo × aparelho: itens 2.24 e 4.6
  excluídos desta carga — matriz real não existe ainda, fica como
  pendência de conteúdo (não de arquitetura)."*
- `RASCUNHO_CONTEUDO_V1.md`, itens **2.24** ("Não sabe qual aplicativo
  usar") e **4.6** ("Aplicativos") — os dois marcados **EXCLUÍDO da
  carga inicial**, com a nota: *"A matriz servidor × aplicativo ×
  aparelho que este procedimento pressupõe não está formalizada em
  lugar nenhum do projeto (...). Fica como pendência de conteúdo:
  quando a matriz real existir, ela entra na Camada de Conhecimento
  como entrada própria."*

Este documento é essa matriz. Ver seção 6 para como ela se conecta
formalmente aos itens 2.24/4.6 quando (e se) for incorporada à carga
real da `conhecimento_institucional` — decisão ainda não tomada.

**Regra estrutural, herdada de `RASCUNHO_CONTEUDO_V1.md`:** esta matriz
nunca contém dado individual de cliente (usuário, senha, servidor do
cliente, vencimento, device_key) — isso continua vindo exclusivamente
do Rocket via `/match`/`/status` (Componente 1). Este documento só
registra informação estável, válida para qualquer cliente daquele
servidor.

---

## 1. Regra especial — UniTV

UniTV é exclusivo para dispositivos Android.

Não apresentar UniTV para:
- Samsung
- LG
- Roku
- iPhone/iOS
- Windows
- outros sistemas não Android.

No UniTV, na primeira utilização do aplicativo naquele dispositivo,
existe teste de 3 dias.

---

## 2. Blaze

### Aplicativos próprios / caminhos

- BLAZE IBO
- BLAZE VU
- BLAZE MAX
- BLESSED PLAYER
- Programa Windows → PC / Notebook Windows
- WebPlayer → PC / Notebook Windows
- XCloudTV → iPhone / iOS

### Aplicativos / parcerias

- XCloud → Samsung / LG / Roku
- Assist Plus → Android e algumas Smart TVs
- PlaySim → Android e algumas Smart TVs
- Lazer Play → Android e algumas Smart TVs
- FunPlay → Android e algumas Smart TVs
- Blessed Player → Android e algumas Smart TVs
- Magic Player → Android e algumas Smart TVs

### Testes informados do Blaze

- Completo: 2 horas, 4 horas, 6 horas e 12 horas
- Sem conteúdo adulto: 2 horas, 4 horas, 6 horas e 12 horas
- XCloud: 6 horas
- Assist Plus: 6 horas
- PlaySim: 6 horas
- Lazer Play: 6 horas
- FunPlay: 6 horas
- Blessed Player: 6 horas
- Magic Player: 6 horas
- PC/Notebook Windows: 6 horas
- iPhone/iOS: XCloudTV / Blessed Player — 6 horas

---

## 3. NewOne

### Android / TV Box / Android TV / Fire Stick

- P2P Binstream V9 → TV Box / Android TV / Fire Stick
- New One IBO → TV Box / Android TV / Fire Stick
- New One VU → TV Box / Android TV / Fire Stick

### Aplicativos parceiros

- NEWONE → LG / Roku
- X-CLOUD → Samsung / LG / Roku / Android / Fire TV
- FUN PLAY → Samsung / LG / Roku / Android / Fire TV
- Focox Play → Samsung
- Lazer Play → LG / Roku / Android / Fire TV
- PLAYSIM → Samsung / LG / Roku
- ASSIST+ → Android e algumas Smart TVs

### Aplicativos alternativos

- Smarters Player → Android e algumas Smart TVs
- XCIPTV → Android e algumas Smart TVs

**DNS não faz parte da matriz.**

### PC / Notebook

- WebPlayer → PC / Notebook

---

## 4. Channel TV

### Aplicativos da Play Store

- APP7620N → Play Store / Android
- KAYROS PLAYER → Android / Play Store
- ZUXO PLAY 5485 → Android / Play Store
- CLYCK PLAYER → Play Store / Android

### Aplicativos parceiros

- LOTÚS 5485 → Samsung / LG / Roku / Android TV
- FUN PLAY 5485 → Samsung / LG / Roku / Android TV
- ZUXO PLAY 5485 → Samsung / LG / Roku / Android TV
- LAZER PLAY 5485 → Roku
- KAYROS PLAYER → Android / Play Store

### IPTV Player

- IPTV PLAYER → link direto / código Downloader
- Compatibilidade específica ainda não deve ser inventada.

---

## 5. Regras da matriz

1. A matriz representa somente informações que foram fornecidas pelo
   responsável da TOPE TV.
2. Não deduzir compatibilidade adicional.
3. Não transformar "Android e algumas Smart TVs" em "todas as Smart
   TVs".
4. Não transformar disponibilidade de aplicativo em compatibilidade
   universal.
5. Não adicionar DNS à matriz.
6. Não adicionar usuário, senha ou credenciais de teste à matriz.
7. Códigos e links de instalação podem ser tratados posteriormente,
   durante a criação dos procedimentos específicos — não criados
   agora.
8. Não misturar esta matriz com a máquina de renovação/pagamento.
9. Não altera `conhecimento_institucional` nesta etapa.
10. Não altera código da IA nesta etapa.
11. Não altera o algoritmo `buscarConhecimentoRelevante` nesta etapa.

---

## 6. Conexão formal com as pendências 2.24/4.6

Quando (e se) esta matriz for incorporada à carga real da
`conhecimento_institucional`, ela resolve diretamente:

- **`RASCUNHO_CONTEUDO_V1.md`, item 2.24** ("Não sabe qual aplicativo
  usar") — passa a ter, pela primeira vez, a matriz real que o
  procedimento pressupunha.
- **`RASCUNHO_CONTEUDO_V1.md`, item 4.6** ("Aplicativos") — mesma
  resolução, do lado do bloco `institucional`.
- **`PROPOSTA_CARGA_INICIAL_V1.md`**, nota de pendência (seção 2, item
  2, e seção final) — deixa de estar em aberto.

**Isto não é uma decisão de incorporação** — só o registro de qual
pendência este documento fecha, para quem for tomar essa decisão no
futuro não precisar procurar de novo. Nenhum dos três documentos
citados foi alterado.

## 7. Próximo passo (não iniciado)

Esta matriz é referência para uma etapa posterior, quando os
procedimentos detalhados (tutoriais passo a passo) forem criados — não
implementados agora. Decisão de como e quando esta matriz vira conteúdo
pesquisável pela IA (nova(s) entrada(s) de `conhecimento_institucional`,
outro mecanismo, ou nenhum por enquanto) permanece em aberto, aguardando
autorização explícita separada.
