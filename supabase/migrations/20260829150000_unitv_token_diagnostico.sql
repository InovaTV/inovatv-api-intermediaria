-- Fase 1 da autocura do UNITV_DEALER_TOKEN (2026-08-29,
-- inovatv_central/CLAUDE.md, "Frente -- Fluxo de Renovacao Automatica",
-- Etapa 2 UniTV / autocura). SO' confirmacao + observabilidade:
--
--   * NAO faz login, NAO toca UNITV_DEALER_TOKEN nem nenhum secret,
--     NAO chama /api/account/renew, NAO cria cobranca, NAO altera o
--     comportamento de renovacao existente.
--   * Registro read-only do diagnostico disparado quando
--     renovacao-unitv-conta ia devolver {outcome:"indisponivel"} por
--     'unavailable' (token rejeitado OU painel fora). 'credenciais_ausentes'
--     e 'sn_invalido' continuam SEPARADOS de 'unavailable' -- nao ha' o
--     que sondar.
--
-- Tabela append-only: cada linha e' UMA execucao da rotina de
-- diagnostico (diagnosticarTokenUnitv, _shared/unitv_token_diag.ts).
-- Nunca sofre UPDATE de dado (so' insert), nunca sofre DELETE fora da
-- limpeza de retencao abaixo.
--
-- SEM PII, SEM CREDENCIAL. Nenhuma coluna guarda: UNITV_DEALER_TOKEN
-- (nem hash/prefixo), dealer_name, o SN ancora (UNITV_DIAG_ANCHOR_SN),
-- telefone, e-mail, nome ou qualquer identificador. A unica coluna de
-- texto livre e' `painel_msg` -- ver o comentario dela abaixo: passa
-- por 3 camadas de higienizacao na aplicacao (redacao do SN +
-- mascaramento de e-mail/numero + PORTAO ALLOWLIST que troca o texto
-- inteiro por um marcador fixo se sobrar qualquer coisa suspeita), e o
-- log estruturado nem sequer inclui o texto -- so' um status
-- (ausente/presente/omitida). O CHECK de tamanho e' a ultima rede.
--
-- ANCORA OPERACIONAL TEMPORARIA (UNITV_DIAG_ANCHOR_SN): a Fase 1 sonda
-- a saude do token resolvendo UMA conta UniTV conhecida (SN em project
-- secret, nunca hardcoded). Isso e' um EXPEDIENTE DE V1, nao uma
-- dependencia arquitetural permanente: a Fase 2 (C8) decide o health
-- check definitivo (ex.: getDealerInfo, que nao depende de nenhuma
-- conta especifica). Trocar/aposentar o SN ancora e' so' mudar o
-- secret -- nenhum dado desta tabela referencia a conta, nenhuma FK,
-- nenhuma constraint. A tabela sobrevive a qualquer troca de ancora.
--
-- RLS habilitado SEM nenhuma policy: so' quem tem a service_role key
-- acessa -- mesmo padrao de conversas_estado / tokens_renovacao /
-- cobrancas_pix (isolamento por chave, nao por policy de linha).
--
-- RETENCAO: 180 dias, limpeza MANUAL via SQL Editor (sem pg_cron --
-- volume e' baixissimo: so' grava quando um cliente real tenta renovar
-- UniTV com o token caido). Nao ha' restricao de privacidade (zero
-- PII/credencial) -- e' housekeeping puro. Comando de limpeza:
--
--     delete from public.unitv_token_diagnostico
--      where criado_em < now() - interval '180 days';
--
-- Vira um pg_cron trivial se algum dia o volume justificar (nao deve).
--
-- APLICACAO: MANUAL via SQL Editor do Supabase (mesmo processo de toda
-- migration deste repositorio) -- este arquivo e' o artefato revisado,
-- nao roda sozinho.

create table public.unitv_token_diagnostico (
  id                    uuid primary key default gen_random_uuid(),
  criado_em             timestamptz not null default now(),

  -- Veredito da agregacao dos probes (regra: >=2 probes consistentes):
  --   token_vivo            -- >=2 probes com returnCode 0 (o painel
  --                            aceitou o token; o conteudo da lista e'
  --                            outra questao -- ver ancora_status)
  --   token_morto           -- >=2 probes com returnCode != 0 E o MESMO
  --                            returnCode (token rejeitado de forma
  --                            consistente)
  --   indeterminado_outage  -- >=2 probes com falha de transporte
  --                            (HTTP/rede/timeout) -- painel provavelmente
  --                            fora, NAO da' pra afirmar que o token morreu
  --   indeterminado         -- misto / returnCodes de auth divergentes /
  --                            ancora nao configurada -- inconclusivo
  veredito              text not null
                          check (veredito in (
                            'token_vivo', 'token_morto',
                            'indeterminado_outage', 'indeterminado'
                          )),

  -- Slug fixo do sinal interno que disparou o diagnostico. Fase 1 tem
  -- um unico: 'renovacao-unitv-conta:indisponivel'. Constante, sem PII.
  motivo_origem         text not null,

  -- Detalhe da chamada /api/account que FALHOU e causou o 'indisponivel'
  -- (vindo do CallErr enriquecido de _shared/unitv_conta.ts). Hoje esse
  -- returnCode/HTTP e' lido 1x e descartado -- aqui ele passa a ficar.
  origem_return_code    integer null,
  origem_http_status    integer null,

  -- Contagem dos probes read-only (POST /api/account resolvendo o SN
  -- ancora). probe_total = ok + auth_reject + transport_fail (CHECK).
  probe_total           smallint not null default 0
                          check (probe_total between 0 and 10),
  probe_ok              smallint not null default 0,   -- returnCode 0
  probe_auth_reject     smallint not null default 0,   -- returnCode != 0
  probe_transport_fail  smallint not null default 0,   -- HTTP/rede/timeout
  constraint unitv_token_diagnostico_probe_soma
    check (probe_total = probe_ok + probe_auth_reject + probe_transport_fail),

  -- returnCode comum que apareceu em >=2 probes AUTH_REJECT (o valor
  -- usado pra decidir 'token_morto'). NULL fora desse caso. E' o dado
  -- que acumula, ao longo do tempo, "que codigo um dealer_token morto
  -- produz" -- hoje desconhecido (C4).
  probe_return_code     integer null,

  -- ok           -- algum probe resolveu o SN ancora para exatamente 1
  --                 conta (token autenticou E dado da ancora consistente)
  -- nao_resolveu -- probes rodaram mas o SN ancora nunca resolveu nesta
  --                 execucao (drift de dado na conta ancora, OU o painel
  --                 nunca autenticou -- ver veredito pra distinguir)
  -- ausente      -- UNITV_DIAG_ANCHOR_SN nao configurado -> probes pulados
  ancora_status         text not null
                          check (ancora_status in ('ok', 'nao_resolveu', 'ausente')),

  -- errorMessage do painel -- SO' populada a partir de uma resposta
  -- returnCode != 0 do /api/account, isto e', erro da CAMADA DE AUTH,
  -- gerado ANTES de qualquer lookup de conta (nunca contem nome/dados
  -- de titular). Antes de chegar aqui, higienizarMsgPainel(): (1) redige
  -- o SN ancora (case-insensitive, todas as ocorrencias); (2) mascara
  -- e-mail -> [email] e numeros longos -> [num]; (3) PORTAO -- se sobrar
  -- '@', 4+ digitos seguidos, char fora de um conjunto conservador,
  -- > 60 chars, ou >= 2 palavras capitalizadas (sinal de nome proprio),
  -- o texto inteiro vira o marcador fixo '[mensagem do painel omitida]'.
  -- Ou seja: aqui so' entra frase curta comprovadamente generica (<= 60)
  -- OU esse marcador -- NUNCA o texto original, NUNCA SN/telefone/
  -- e-mail/nome/identificador. O CHECK de 120 e' a ultima rede.
  painel_msg            text null
                          check (painel_msg is null or char_length(painel_msg) <= 120),

  -- Aviso ao Jose foi ENVIADO nesta execucao (so' em veredito
  -- 'token_morto', com dedupe de 6h). false quando: veredito != morto,
  -- dedupe suprimiu, WHATSAPP_JOSE_NUMERO ausente, ou o envio falhou.
  alertado_jose         boolean not null default false
);

-- Historico cronologico + suporte a limpeza de retencao.
create index unitv_token_diagnostico_criado_em_idx
  on public.unitv_token_diagnostico (criado_em desc);

-- Dedupe do aviso ao Jose: "houve token_morto JA alertado nas ultimas
-- 6h?". Indice parcial pequeno e barato.
create index unitv_token_diagnostico_dedupe_idx
  on public.unitv_token_diagnostico (criado_em desc)
  where veredito = 'token_morto' and alertado_jose = true;

-- RLS on, SEM policy -- so' service_role (mesmo padrao das demais
-- tabelas operacionais do projeto).
alter table public.unitv_token_diagnostico enable row level security;
