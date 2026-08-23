-- Memoria de sessao da IA (Camada 3) -- extensao com intencao_atual
-- (2026-08-23), fechando o achado real do teste no WhatsApp: "quero
-- renovar meu plano" (2 acessos, sem rotulo) -> "2" perdia a intencao
-- ja estabelecida na mensagem anterior, porque so' acesso_selecionado
-- existia na sessao.
--
-- Mesma disciplina de acesso_selecionado: nunca fonte de fato, nunca
-- decide sozinho o "tipo" da resposta do Gemini (isso continua sendo
-- julgamento do proprio modelo, dentro do que o SYSTEM_PROMPT ja
-- permite) -- so' um sinal de continuidade conversacional, sujeito ao
-- MESMO TTL de 1h e a mesma invalidacao por atendimento humano ja
-- implementados (sessao_atividade_em / migration
-- 20260823140000_sessao_ia_invalidada_por_atendimento_humano.sql --
-- ver migration companheira 20260823160000, que estende essa mesma
-- invalidacao para tambem cobrir esta coluna nova).
--
-- Nao e' um TTL por campo -- a validade de intencao_atual e' regida
-- exclusivamente pelo mesmo sessao_atividade_em unico ja existente,
-- igual acesso_selecionado. Unico valor usado hoje: 'renovacao'.

alter table public.conversas_estado
  add column if not exists intencao_atual text;
