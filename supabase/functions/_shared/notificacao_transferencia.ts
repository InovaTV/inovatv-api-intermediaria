// Notificacao de transferencia humana (cliente + Jose) -- extraido do
// padrao ja usado 3x em orchestrator/index.ts (deveTransferir, Gemini
// indisponivel, processarCobrancaRenovacao/transferirPorFalha), pra
// nao duplicar o mesmo bloco nos caminhos novos do Bloco 2 que nunca
// notificavam ninguem (achado real, homologacao 27/08/2026: cliente
// ficava em silencio apos falha automatica -- confirmado ao vivo no
// caminho do watchdog, Ciclo 1).
//
// Regras, herdadas do padrao ja validado em producao, nunca inventadas
// aqui:
// - So chamar isto depois que o registro interno (acionarTransferenciaHumana)
//   confirmar outcome === "acionada" de verdade -- nunca em
//   "ja_transferida"/erro (evita duplicar aviso sob concorrencia).
// - Mensagem ao cliente primeiro, aviso ao Jose depois -- mesma ordem
//   ja usada nos 3 pontos que funcionam, sem dependencia real entre os
//   dois.
// - Cada envio e independente e best-effort -- falha em qualquer um
//   dos dois NUNCA aciona nova transferencia, nunca tenta de novo,
//   nunca lanca excecao pro chamador.
// - MENSAGEM_TRANSFERENCIA_CLIENTE e texto livre -- pode falhar fora
//   da janela de 24h do WhatsApp pelo mesmo motivo ja documentado
//   (EnvioWhatsAppResultado nao distingue esse erro de qualquer outro
//   "unavailable", pendencia separada, ainda nao implementada). Esse
//   comportamento e herdado deliberadamente, nao um bug novo desta
//   funcao.
import { enviarMensagemWhatsApp, enviarTemplateWhatsApp } from "./whatsapp_client.ts";
import {
  MENSAGEM_TRANSFERENCIA_CLIENTE,
  NOME_TEMPLATE_NOVA_TRANSFERENCIA,
  IDIOMA_TEMPLATE_NOVA_TRANSFERENCIA,
} from "./mensagens_fixas.ts";

export async function notificarTransferenciaHumana(
  telefone: string,
  motivo: string,
  acionadaAgora: boolean,
): Promise<{ clienteAvisado: boolean; joseAvisado: boolean }> {
  if (!acionadaAgora) return { clienteAvisado: false, joseAvisado: false };

  let clienteAvisado = false;
  try {
    const envio = await enviarMensagemWhatsApp(telefone, MENSAGEM_TRANSFERENCIA_CLIENTE);
    clienteAvisado = envio.outcome === "success";
  } catch (erro) {
    console.log("[notificacao_transferencia] falha ao avisar cliente", JSON.stringify({ motivo, erro: String(erro) }));
  }

  let joseAvisado = false;
  const numeroJose = Deno.env.get("WHATSAPP_JOSE_NUMERO");
  if (numeroJose) {
    try {
      const aviso = await enviarTemplateWhatsApp(
        numeroJose,
        NOME_TEMPLATE_NOVA_TRANSFERENCIA,
        IDIOMA_TEMPLATE_NOVA_TRANSFERENCIA,
        [motivo],
      );
      joseAvisado = aviso.outcome === "success";
    } catch (erro) {
      console.log("[notificacao_transferencia] falha ao avisar Jose", JSON.stringify({ motivo, erro: String(erro) }));
    }
  }

  return { clienteAvisado, joseAvisado };
}
