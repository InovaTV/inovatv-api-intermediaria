-- Memoria de sessao da IA (Camada 3 da arquitetura de 3 camadas
-- aprovada em 2026-08-23 -- ver
-- docs/propor_renovacao/ACHADO_SELECAO_ACESSO_NAO_PERSISTE.md, secao
-- 8, para o achado/especificacao completa). Escopo desta migration:
-- somente sessao ativa (curto prazo) -- NUNCA memoria persistente
-- entre sessoes (Camada 2, memoria_atendimento, explicitamente fora
-- de escopo agora), NUNCA Redis, NUNCA cron/processo em segundo
-- plano.
--
-- acesso_selecionado: guarda so o public_id do Rocket (identidade),
-- nunca vencimento/valor/plano/servidor em texto -- sempre reconferido
-- contra /match+/status frescos antes de valer pra qualquer coisa
-- (nunca fonte de fato, so ponteiro de contexto).
--
-- sessao_atividade_em: timestamp UNICO de atividade da sessao inteira
-- (nao um TTL por campo) -- renovado a cada mensagem real do cliente.
-- Sessao expira apos 1h de inatividade, contada exclusivamente a
-- partir deste campo, checada em LEITURA pelo Orquestrador -- sem
-- pg_cron, sem aviso automatico de expiracao iminente, sem processo
-- em segundo plano (decisao explicita do usuario, 2026-08-23).

alter table public.conversas_estado
  add column if not exists acesso_selecionado  text;

alter table public.conversas_estado
  add column if not exists sessao_atividade_em timestamptz;
