-- Bloco 1 do fluxo de renovacao automatica com Pix real (2026-08-23,
-- docs/renovacao_automatica/PLANO_MESTRE_IMPLEMENTACAO.md, Etapa 2/3).
-- Representa a operacao de cobranca criada por NOS para uma renovacao
-- especifica -- nunca criada so por vencimento proximo (caminho
-- reativo, Lacuna 1 ja fechada).
--
-- Provedor trocado de PagBank para OpenPix/Woovi em 2026-08-24 (POC real
-- em Sandbox confirmou criacao de cobranca sem CPF/CNPJ do cliente --
-- requisito que o PagBank nao atendia em nenhuma modalidade). Migration
-- ainda nao tinha sido aplicada ao banco -- editada aqui em vez de
-- corrigida por uma segunda migration.
--
-- operacao_id e' gerado em codigo (crypto.randomUUID()) ANTES da
-- chamada ao provedor, porque precisa ser enviado como correlationID
-- (OpenPix) na criacao da cobranca -- por isso nao tem "default
-- gen_random_uuid()" aqui, precisa ser fornecido no INSERT.
--
-- Unique parcial (status='pendente') implementa em nivel de banco a
-- regra ja decidida "uma cobranca de renovacao pendente por vez, por
-- acesso" (Lacuna 9, decisao 2) -- protege contra corrida real (duas
-- mensagens quase simultaneas tentando criar cobranca pro mesmo
-- public_id), nao so uma checagem de aplicacao.
--
-- tokens_renovacao fica para o Bloco 2 -- nao criado aqui, reduz risco
-- deste bloco (esta tabela nao depende dela).

create table public.cobrancas_pix (
  operacao_id               uuid primary key,
  conversation_id           uuid not null references public.conversas_estado(conversation_id),
  public_id                 text not null,
  servidor_nome             text,
  plano_nome                text,
  valor_esperado_centavos   integer not null,
  transaction_id_provedor   text not null,
  qr_code_texto             text not null,
  status                    text not null default 'pendente'
                              check (status in ('pendente','pago','valor_divergente','expirada','cancelada')),
  criado_em                 timestamptz not null default now(),
  atualizado_em             timestamptz not null default now()
);

create index cobrancas_pix_public_id_idx on public.cobrancas_pix (public_id);

create unique index cobrancas_pix_pendente_unica_por_acesso_idx
  on public.cobrancas_pix (public_id)
  where status = 'pendente';

-- RLS habilitado, sem nenhuma policy publica -- so' acessivel via
-- service_role (Edge Functions), mesmo padrao ja usado em
-- conversas_estado/conversas_episodios/mensagens_conversa.
alter table public.cobrancas_pix enable row level security;
