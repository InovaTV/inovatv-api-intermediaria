// Textos/config fixos enviados pelo Orquestrador -- nunca gerados
// pelo Gemini nesse momento (Componente 1 §16/§16-A, inovatv_central
// CLAUDE.md, aprovado 2026-08-16).
export const MENSAGEM_TRANSFERENCIA_CLIENTE =
  "🔔 Vou encaminhar seu atendimento para um de nossos atendentes. Em breve, alguém continuará o atendimento por aqui.";

// Aviso ao José (Componente 1 §16-A) -- Message Template submetido a'
// Meta em 2026-08-16, ainda "Em analise" no momento desta escrita.
// Corpo aprovado: "🔔 Nova transferência\nMotivo: {{1}}\nAcesse a
// Interface de Atendimento para assumir a conversa."
export const NOME_TEMPLATE_NOVA_TRANSFERENCIA = "nova_transferencia_humana";
export const IDIOMA_TEMPLATE_NOVA_TRANSFERENCIA = "pt_BR";

// Confirmacao de pagamento/renovacao -- Message Template aprovado pela
// Meta em 2026-08-22 (segunda POC da substituicao do RocketZap,
// inovatv_meta_business_agent, 2026-08-22_desenho_substituicao_rocketzap.md).
// Corpo aprovado (4 variaveis, sem {VALOR} -- deixado de fora
// deliberadamente desta rodada, nao reenviar/alterar o template por
// causa disso):
// "✅ Pagamento confirmado!\n\nOlá,{{1}}! Sua renovação foi registrada
// com sucesso.\n\n📋 Plano:{{2}}\n🖥️ Servidor:{{3}}\n📅 Novo
// vencimento:{{4}}\n\nQualquer dúvida, estamos à disposição.\nInovaTV
// — Sempre pensando em você! 📺"
export const NOME_TEMPLATE_PAGAMENTO_CONFIRMADO = "pagamento_confirmado";
export const IDIOMA_TEMPLATE_PAGAMENTO_CONFIRMADO = "pt_BR";
