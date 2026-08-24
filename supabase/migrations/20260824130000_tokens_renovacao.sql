-- Bloco 2 do fluxo de renovacao automatica (2026-08-24,
-- inovatv_central/CLAUDE.md, desenho aprovado). Representa o ciclo de
-- vida completo de uma SOLICITACAO de renovacao -- desde a
-- apresentacao dos dados ao cliente (ACEITO/CANCELAR) ate a renovacao
-- real no Sigma. Nao substitui cobrancas_pix (Bloco 1) -- convive com
-- ela: tokens_renovacao.operacao_id referencia a cobranca especifica
-- criada DEPOIS do ACEITO, nunca antes.
--
-- Inversao de ordem em relacao ao desenho original das Lacunas 1-9
-- (documentada explicitamente, nao um erro): o ACEITO agora acontece
-- ANTES da cobranca existir -- e' consentimento pra todo o processo
-- (criar cobranca -> aguardar pagamento -> renovar), nao uma segunda
-- confirmacao pos-pagamento. "Duas confirmacoes" continua valendo:
-- autorizacao do cliente (ACEITO) + confirmacao do dinheiro (OpenPix)
-- precisam existir juntas antes da renovacao (Componente 1, Bloco 2).
--
-- token_hash: o token bruto (enviado ao cliente na URL) NUNCA e'
-- gravado em texto puro -- so' o hash SHA-256. Mesma disciplina de
-- "credencial de link magico" ja usada no projeto.

create table public.tokens_renovacao (
  id                        uuid primary key default gen_random_uuid(),
  token_hash                text not null unique,
  conversation_id           uuid not null references public.conversas_estado(conversation_id),
  public_id                 text not null,
  telefone                  text not null,
  operacao_id               uuid null references public.cobrancas_pix(operacao_id),
  -- Snapshot dos dados apresentados ao cliente na tela de confirmacao
  -- (nunca reconsultado de novo so' pra exibir -- se algo mudar entre
  -- a apresentacao e o clique, isso e' tratado como parte do fluxo
  -- normal, nao um caso especial desta tabela).
  cliente_nome              text not null,
  servidor_nome             text not null,
  plano_nome                text not null,
  valor_esperado_centavos   integer not null,
  vencimento_atual          timestamptz not null,
  estado                    text not null default 'aguardando_confirmacao'
                              check (estado in (
                                'aguardando_confirmacao', 'cancelada', 'autorizada', 'expirada',
                                'renovacao_em_andamento', 'renovacao_concluida',
                                'renovacao_falhou', 'renovacao_indeterminada'
                              )),
  criado_em                 timestamptz not null default now(),
  expira_em                 timestamptz not null,
  decidido_em               timestamptz null,
  renovacao_iniciada_em     timestamptz null,
  renovacao_concluida_em    timestamptz null,
  vencimento_confirmado     timestamptz null,
  motivo_falha              text null
);

create index tokens_renovacao_public_id_idx on public.tokens_renovacao (public_id);
create index tokens_renovacao_operacao_id_idx on public.tokens_renovacao (operacao_id);

-- Nao permite renovacao duplicada: so' 1 solicitacao ATIVA por acesso
-- (public_id) -- cobre desde a apresentacao dos dados ate a renovacao
-- terminar. Depois de um estado terminal (cancelada/expirada/
-- renovacao_concluida/renovacao_falhou/renovacao_indeterminada), uma
-- nova solicitacao para o mesmo acesso e' legitima.
create unique index tokens_renovacao_ativo_unico_por_acesso_idx
  on public.tokens_renovacao (public_id)
  where estado in ('aguardando_confirmacao', 'autorizada', 'renovacao_em_andamento');

-- RLS habilitado, sem nenhuma policy publica -- mesmo padrao de todas
-- as tabelas do projeto (so' service_role acessa).
alter table public.tokens_renovacao enable row level security;

-- Watchdog do Bloco 2 (2026-08-24): pg_cron a cada 5 minutos, aciona
-- renovacao-sigma-watchdog via pg_net -- mesmo mecanismo ja usado e
-- comprovado em producao para o monitoramento da sessao do Rocket
-- (migration 20260821150000). Move tokens presos em
-- 'renovacao_em_andamento' ha mais de 15 minutos para
-- 'renovacao_indeterminada' -- garante que nenhuma solicitacao fica
-- pendurada pra sempre, mesmo se o callback do GitHub Actions nunca
-- chegar (job morto/GitHub fora do ar). O token de autenticacao
-- (X-Internal-Token) e' lido do Vault em tempo de execucao -- nunca
-- aparece em texto no corpo deste comando.
select cron.schedule(
  'renovacao-sigma-watchdog',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://nduxsuxkopuvhwugdkqi.supabase.co/functions/v1/renovacao-sigma-watchdog',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Internal-Token', (select decrypted_secret from vault.decrypted_secrets where name = 'renovacao_sigma_watchdog_token')
    ),
    body := '{}'::jsonb
  );
  $$
);
