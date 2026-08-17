-- Policies de RLS para o Painel de Atendimento usar Supabase Realtime
-- (Componente 5, Painel de Atendimento -- "Realtime como fundacao
-- tecnica", aprovado 2026-08-17, inovatv_central CLAUDE.md).
--
-- Ate aqui, conversas_estado/mensagens_conversa nao tinham NENHUMA
-- policy pra anon/authenticated -- so service_role (via Edge
-- Functions) acessava. O Supabase Realtime respeita RLS: sem uma
-- policy de SELECT, o cliente do navegador (autenticado como o
-- operador via Supabase Auth) nunca receberia nenhum evento de
-- postgres_changes, mesmo a mensagem tendo chegado de verdade.
--
-- Escopo deliberadamente minimo, aprovado explicitamente pelo
-- usuario: SO' SELECT, restrito ao mesmo e-mail unico ja autorizado
-- nas Edge Functions (PAINEL_EMAIL_AUTORIZADO) -- nenhum acesso novo
-- alem do que o Painel ja tem hoje via painel-atendimento-listar/
-- abrir. Nenhuma policy de INSERT/UPDATE/DELETE -- toda escrita
-- continua exclusivamente pelas Edge Functions existentes (assumir/
-- responder/encerrar). Realtime e' so mecanismo de sincronizacao
-- visual, nunca um novo caminho de acesso a dado ou de operacao de
-- negocio.
--
-- O e-mail fica hardcoded aqui (nao e' segredo, so' um identificador)
-- -- duplica o mesmo valor do secret PAINEL_EMAIL_AUTORIZADO, risco
-- de decisao aceito conscientemente (se o e-mail autorizado mudar um
-- dia, precisa atualizar os dois lugares).

create policy "painel_le_conversas_estado"
  on public.conversas_estado
  for select
  to authenticated
  using (auth.jwt() ->> 'email' = 'inovatv.stream@gmail.com');

create policy "painel_le_mensagens_conversa"
  on public.mensagens_conversa
  for select
  to authenticated
  using (auth.jwt() ->> 'email' = 'inovatv.stream@gmail.com');

-- Garante que as duas tabelas emitem eventos de replicacao pro
-- Realtime -- pre-requisito independente da RLS acima. Idempotente:
-- se a tabela ja for membro da publicacao, ignora o erro em vez de
-- falhar a migration inteira.

do $$
begin
  alter publication supabase_realtime add table public.conversas_estado;
exception when duplicate_object then
  null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.mensagens_conversa;
exception when duplicate_object then
  null;
end $$;
