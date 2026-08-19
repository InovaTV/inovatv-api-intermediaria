# Handoff — Painel de Atendimento (2026-08-19)

> Documento de continuidade, gerado ao final de uma sessão que chegou
> perto do limite de contexto. Objetivo: a próxima sessão (nesta ou
> em outra máquina) retomar exatamente daqui, sem depender de memória
> da conversa anterior. Ver `CLAUDE.md` (raiz de `inovatv_central`)
> para o histórico completo e a arquitetura geral do Painel de
> Atendimento (Componente 5) — este arquivo é só o resumo prático
> desta etapa específica.

## Estado atual

Painel de Atendimento com **3 colunas**:

```
┌──────────────────┬──────────────────────────────────┬──────────────────┐
│     Conversas     │             Conversa              │  Dados do Contato │
│      1ª (≈400px)  │            2ª (flexível)          │     3ª (≈400px)   │
└──────────────────┴──────────────────────────────────┴──────────────────┘
```

- **1ª e 3ª coluna sempre com a mesma largura** — garantido por uma
  única variável CSS (`--painel-coluna-lateral: 400px`, topo de
  `painel/app/globals.css`), usada nas duas regras
  (`.painel-lista`/`.painel-contato`). Nunca dois valores digitados
  separadamente — mudar um muda os dois juntos.
- **2ª coluna ocupa todo o espaço restante** (`.conversa-area` com
  `flex:1`).
- **3ª coluna é recolhível** (`contatoAberto`, estado local em
  `painel/app/conversas/[id]/page.tsx`): começa aberta; o **×** no
  cabeçalho de "Dados do Contato" fecha; ao fechar, a 2ª coluna cresce
  automaticamente (sem cálculo de CSS extra — só deixa de renderizar o
  `<aside>`, e o `flex:1` da 2ª coluna já resolve sozinho). Para
  reabrir, **clicar no nome do cliente** no cabeçalho da conversa
  (`<h1>`, `cursor:pointer`) — não existe mais um botão separado
  "Contato" (removido nesta etapa a pedido do usuário).

## Primeira coluna (card da lista)

Card em **3 linhas fixas**, cada uma com prioridade clara:

1. **Nome do cliente** — linha inteira só para ele, nunca quebra
   (`white-space:nowrap`), só usa `...` como último recurso se o nome
   for maior que a coluna inteira (raro, com 400px).
2. **Prévia da última mensagem real** — nunca mensagem `origem='sistema'`
   (ver seção Banco abaixo).
3. **Status + data**, juntos, nunca na mesma linha do nome.

**Avatar:** espaço reservado (círculo cinza, `.avatar-iniciais`), mas
**sem mostrar iniciais** ("JR"/"CL"/etc.) por enquanto — decisão
explícita, até existir foto real do WhatsApp. A função `iniciais()`
continua exportada em `layout.tsx`, só não é mais chamada dentro de
`Avatar` — não removida, fica pronta para quando a foto real existir.

## Status: "Aguardando humano" x "Humano assumiu"

- **Nunca deduzido pelo texto da prévia** — vem do campo real do
  sistema.
- `conversas_estado.estado` sozinho **não distingue** os dois casos
  (os dois são `'aguardando_humano'`). A distinção real está em
  `conversas_episodios.assumido_por` (via `episodio_atual_id`):
  - `assumido_por = NULL` → **"Aguardando humano"**.
  - `assumido_por` preenchido → **"Humano assumiu"**.
- `listarConversas()` (`supabase/functions/_shared/conversas_estado.ts`)
  busca esse campo numa segunda consulta pequena (só os episódios em
  aberto da página atual, nunca N+1, nunca RPC nova) e expõe como
  `episodio_atual_assumido_por` (campo computado, não é coluna de
  `conversas_estado`).
- Frontend (`painel/app/conversas/layout.tsx`): `humanoAssumiu = estado
  === "aguardando_humano" && !!episodio_atual_assumido_por`.

## Banco — 2 migrations aplicadas e verificadas nesta sessão

```
20260819000000_painel_previa_ignora_sistema.sql
20260819010000_painel_previa_desempate_seq.sql
```

- **Primeira:** o trigger que mantém `conversas_estado.ultima_mensagem_texto`
  (usado como prévia da 1ª coluna) parou de considerar mensagens
  `origem='sistema'` ("Atendimento humano iniciado/encerrado"). Antes,
  a prévia podia mostrar esses eventos em vez da última mensagem real
  da conversa.
- **Segunda:** durante a validação da primeira, foi encontrado um
  empate real — mensagens inseridas na mesma transação Postgres
  (as RPCs `acionar_transferencia_humana`/`assumir_atendimento`/
  `encerrar_atendimento_humano` inserem várias mensagens numa única
  transação) compartilham o **mesmo `criado_em`** (`now()` é constante
  durante toda a transação em Postgres). Isso fazia o `ORDER BY
  criado_em DESC` escolher entre cliente/IA de forma não-determinística.
  Corrigido com uma coluna nova `mensagens_conversa.seq` (`bigserial`,
  sempre monotônico, nunca empata mesmo na mesma transação) — o
  trigger passou a desempatar por `seq DESC`. Validado com dado real
  (conversa do Js Informática Rp): a prévia passou a mostrar
  corretamente a resposta da IA, não a mensagem do cliente.
- Ambas aplicadas via `npx supabase db push` e confirmadas com `npx
  supabase migration list` (local = remote).

## Pendências futuras (não implementadas, registradas para depois)

1. **Arquivos e mídias no Painel** — envio pelo atendente e recebimento
   do cliente (imagens, documentos, áudios, vídeos). Nada definido
   ainda: nem modelo de dados, nem UI, nem armazenamento. Fica
   explicitamente fora desta etapa.
2. **Avatar real do WhatsApp** — o espaço já está reservado (círculo
   vazio) tanto na 1ª quanto na 3ª coluna; falta só a integração real
   (a prop `fotoUrl` do componente `Avatar` já existe e já teria
   prioridade sobre o círculo vazio, só nunca é preenchida hoje).
3. **Formatação do campo Vencimento** na 3ª coluna — ainda mostra a
   data crua (`2026-09-20T20:09:00-03:00`), sem formatação amigável.
   Registrado como possível refinamento, não decidido como prioridade.
4. Qualquer outro ponto marcado como "fora de escopo" nas sessões
   anteriores continua fora de escopo (ver `CLAUDE.md` da raiz de
   `inovatv_central` para o histórico completo — Realtime, filtros,
   marcar como visto, scroll, balões, RPCs, Webhook/Componente 3 etc.
   não foram tocados nesta etapa).

## Histórico importante / decisões de processo

- **CORS**: as Edge Functions `painel-atendimento-*` só liberam
  `https://inovatv-api-intermediaria.vercel.app` — `http://localhost:3000`
  (ou qualquer porta local) é bloqueado. Decisão explícita do usuário:
  **não alterar CORS só para viabilizar teste local**, a menos que
  surja uma decisão específica futura. Por isso, toda validação com
  dado real desta etapa foi feita direto em produção.
- **Revisão visual local sem dado real**: para revisar a geometria das
  3 colunas sem depender da API real, foi criada uma página temporária
  (`painel/app/preview-layout/page.tsx`, dados fictícios, reaproveitando
  os componentes/CSS reais) servida via `next dev` numa porta livre
  (a 3000 estava ocupada por outro processo do sistema, não relacionado
  a este projeto). **Esse arquivo foi apagado ao final da sessão** —
  não deve existir no repositório; se aparecer numa sessão futura, é
  resíduo e pode ser removido sem cerimônia.
- **Todas as autorizações de execução real (migration/deploy) nesta
  sessão foram dadas uma por vez, nunca em lote antecipado** — mesma
  disciplina já registrada em `CLAUDE.md` seção 0-B. Manter esse
  padrão nas próximas sessões: preparar → mostrar diff/SQL → aguardar
  autorização explícita → executar → confirmar resultado real.

## Este commit inclui

Layout de 3 colunas (frontend) + lógica de `episodio_atual_assumido_por`
(backend, `_shared/conversas_estado.ts`/`_shared/types.ts`) + as 2
migrations já aplicadas no banco (commitadas para registro/histórico,
não para reaplicar).

## Deploy da Edge Function `painel-atendimento-listar`

**Já publicado nesta sessão** (necessário para o campo
`episodio_atual_assumido_por` — e portanto o status "Aguardando
humano"/"Humano assumiu" real — funcionar em produção). Versão subiu
de **7 para 8** (`npx supabase functions deploy
painel-atendimento-listar --no-verify-jwt`, confirmado via `npx
supabase functions list`, `verify_jwt: false` preservado). Não é
preciso fazer nada com essa função numa próxima sessão, a menos que o
código dela mude de novo.

**Outra Edge Function relacionada, `painel-atendimento-abrir`, também
já estava publicada** (v7, de uma etapa anterior desta mesma sessão —
resolveu o `nome_snapshot` não sendo gravado na primeira coluna).
Nenhuma ação pendente nela também.
