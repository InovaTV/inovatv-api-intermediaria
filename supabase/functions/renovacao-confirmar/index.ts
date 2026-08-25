// Borda interna do fluxo de botoes do WhatsApp. Nunca e' chamada pelo cliente.
import { confirmarRenovacao, type AcaoConfirmacaoRenovacao } from "../_shared/renovacao_confirmacao.ts";
import { normalizarTelefone } from "../_shared/telefone.ts";

const ID_RENOVACAO = /^renovacao:(aceitar|cancelar):([0-9a-f]{64})$/;

Deno.serve(async (req: Request) => {
  const esperado = Deno.env.get("RENOVACAO_CONFIRMAR_INTERNAL_TOKEN");
  const recebido = req.headers.get("X-Internal-Token");
  if (!esperado || !recebido || recebido !== esperado) return new Response("Nao autorizado", { status: 401 });
  if (req.method !== "POST") return new Response("Metodo nao suportado", { status: 405 });
  let body: { telefone?: string; buttonReplyId?: string };
  try { body = await req.json(); } catch { return new Response("Corpo invalido", { status: 400 }); }
  if (!body.telefone || !body.buttonReplyId) return new Response("Campos obrigatorios ausentes", { status: 400 });
  const match = ID_RENOVACAO.exec(body.buttonReplyId);
  if (!match) return new Response("ID de botao invalido", { status: 400 });
  const [, acao, tokenHash] = match;
  const resultado = await confirmarRenovacao({ tokenHash, acao: acao as AcaoConfirmacaoRenovacao, telefoneOrigem: normalizarTelefone(body.telefone), origem: "whatsapp" });
  return new Response(JSON.stringify(resultado), { status: 200, headers: { "Content-Type": "application/json" } });
});
