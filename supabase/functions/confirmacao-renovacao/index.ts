// Edge Function publica, HTML puro -- Bloco 2, 2026-08-24
// (inovatv_central/CLAUDE.md, desenho aprovado). Tela de
// ACEITO/CANCELAR da renovacao, ANTES de qualquer cobranca existir.
//
// GET  -- NUNCA executa nada, so' le e renderiza. Seguro mesmo com
//         preview automatico de link do WhatsApp/crawler.
// POST -- reivindica o token atomicamente (ACEITO ou CANCELAR), e so'
//         no caminho ACEITO cria a cobranca OpenPix de verdade.
//
// Nenhum segredo (service_role, sessao do Vault, chaves) chega ao
// HTML/cliente em nenhum momento -- so' roda no backend desta
// function. Mesmo padrao ja decidido na Lacuna 5 (fluxo antigo,
// principio preservado).

import {
  hashToken,
  buscarTokenPorHash,
  expirarSeVencido,
  reivindicarAceite,
  reivindicarCancelamento,
  vincularOperacaoAoToken,
  marcarAutorizacaoComoFalha,
  type TokenRenovacao,
} from "../_shared/tokens_renovacao.ts";
import { criarCobrancaOpenPix } from "../_shared/openpix_client.ts";
import { criarCobrancaPixRegistro } from "../_shared/cobrancas_pix.ts";
import { enviarMensagemWhatsApp } from "../_shared/whatsapp_client.ts";
import { acionarTransferenciaHumana } from "../_shared/conversas_estado.ts";
import { inserirMensagem } from "../_shared/mensagens_atendimento.ts";
import {
  formatarValorBRL,
  montarMensagemPixRenovacao,
  MENSAGEM_CANCELAMENTO_RENOVACAO,
  MENSAGEM_PREPARANDO_PAGAMENTO_RENOVACAO,
} from "../_shared/mensagens_fixas.ts";

function paginaHtml(titulo: string, corpo: string): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${titulo} - InovaTV</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; background: #0D1117; color: #E5E7EB; margin: 0; padding: 24px; }
  .card { max-width: 420px; margin: 40px auto; background: #161B22; border-radius: 12px; padding: 24px; }
  h1 { font-size: 20px; margin-top: 0; }
  .dado { margin: 8px 0; }
  .label { color: #9CA3AF; font-size: 13px; }
  .valor { font-size: 16px; }
  form { display: inline-block; margin-top: 20px; margin-right: 8px; }
  button { padding: 12px 24px; border-radius: 8px; border: none; font-size: 15px; font-weight: 600; cursor: pointer; }
  .aceitar { background: #22C55E; color: #0D1117; }
  .cancelar { background: #374151; color: #E5E7EB; }
</style>
</head>
<body><div class="card">${corpo}</div></body>
</html>`;
}

function paginaDados(token: TokenRenovacao): string {
  const valorFormatado = formatarValorBRL(token.valor_esperado_centavos / 100) ?? "0,00";
  const vencimentoFormatado = new Date(token.vencimento_atual).toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });
  return paginaHtml(
    "Confirmar renovação",
    `<h1>Confirme sua renovação</h1>
     <div class="dado"><div class="label">Cliente</div><div class="valor">${token.cliente_nome}</div></div>
     <div class="dado"><div class="label">Servidor</div><div class="valor">${token.servidor_nome}</div></div>
     <div class="dado"><div class="label">Plano</div><div class="valor">${token.plano_nome}</div></div>
     <div class="dado"><div class="label">Valor</div><div class="valor">R$ ${valorFormatado}</div></div>
     <div class="dado"><div class="label">Vencimento atual</div><div class="valor">${vencimentoFormatado}</div></div>
     <form method="POST"><input type="hidden" name="acao" value="aceitar"><button class="aceitar" type="submit">ACEITO</button></form>
     <form method="POST"><input type="hidden" name="acao" value="cancelar"><button class="cancelar" type="submit">CANCELAR</button></form>`,
  );
}

function paginaMensagem(titulo: string, mensagem: string): Response {
  return new Response(paginaHtml(titulo, `<h1>${titulo}</h1><p>${mensagem}</p>`), {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const tokenBruto = url.searchParams.get("token");

  if (!tokenBruto) return paginaMensagem("Link inválido", "Nenhum token foi informado.");

  const tokenHash = await hashToken(tokenBruto);
  let registro = await buscarTokenPorHash(tokenHash);

  if (!registro) return paginaMensagem("Link inválido", "Este link não é reconhecido.");

  registro = await expirarSeVencido(registro);

  if (req.method === "GET") {
    if (registro.estado === "aguardando_confirmacao") {
      return new Response(paginaDados(registro), { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    if (registro.estado === "expirada") return paginaMensagem("Link expirado", "Esse link não é mais válido. Peça uma nova renovação pelo WhatsApp.");
    return paginaMensagem("Já decidido", "Essa renovação já foi confirmada ou cancelada anteriormente.");
  }

  if (req.method !== "POST") {
    return new Response("Método não suportado", { status: 405 });
  }

  const form = await req.formData().catch(() => null);
  const acao = form?.get("acao");

  if (acao === "cancelar") {
    const cancelado = await reivindicarCancelamento(tokenHash);
    if (!cancelado) return paginaMensagem("Já decidido", "Essa renovação já foi confirmada ou cancelada anteriormente.");

    try {
      await inserirMensagem(cancelado.conversation_id, "sistema", "Cliente cancelou a renovação pelo link.", null);
    } catch {
      // best-effort
    }
    const envio = await enviarMensagemWhatsApp(cancelado.telefone, MENSAGEM_CANCELAMENTO_RENOVACAO);
    if (envio.outcome === "success") {
      try {
        await inserirMensagem(cancelado.conversation_id, "ia", MENSAGEM_CANCELAMENTO_RENOVACAO, null);
      } catch {
        // best-effort
      }
    }
    return paginaMensagem("Cancelado", "Sua renovação foi cancelada. Nenhuma cobrança foi criada.");
  }

  if (acao === "aceitar") {
    const autorizado = await reivindicarAceite(tokenHash);
    if (!autorizado) return paginaMensagem("Já decidido", "Essa renovação já foi confirmada ou cancelada anteriormente.");

    try {
      await inserirMensagem(autorizado.conversation_id, "sistema", "Cliente confirmou (ACEITO) a renovação pelo link.", null);
    } catch {
      // best-effort
    }

    // Mensagem intermediaria -- a chamada a OpenPix logo abaixo e'
    // externa e pode demorar; nunca deixa o cliente sem nenhum retorno
    // enquanto isso acontece. Mesma mensagem/disciplina ja usada no
    // Bloco 1 original.
    const envioMsg1 = await enviarMensagemWhatsApp(autorizado.telefone, MENSAGEM_PREPARANDO_PAGAMENTO_RENOVACAO);
    if (envioMsg1.outcome === "success") {
      try {
        await inserirMensagem(autorizado.conversation_id, "ia", MENSAGEM_PREPARANDO_PAGAMENTO_RENOVACAO, null);
      } catch {
        // best-effort
      }
    }

    const operacaoId = crypto.randomUUID();
    const descricaoItem = `Renovação InovaTV - Plano ${autorizado.plano_nome}`.trim();
    const criarResultado = await criarCobrancaOpenPix(operacaoId, autorizado.valor_esperado_centavos, descricaoItem);

    if (criarResultado.outcome !== "success") {
      try {
        await acionarTransferenciaHumana(
          autorizado.conversation_id,
          "renovacao:falha_criar_cobranca_apos_aceite",
          "(cliente clicou ACEITO)",
          "",
        );
      } catch {
        // best-effort
      }
      // Correcao de risco (2026-08-24, revisao do Bloco 2): sem isso,
      // o token ficava preso pra sempre em 'autorizada' -- o indice
      // unico parcial bloquearia qualquer nova solicitacao pro mesmo
      // acesso ate' uma correcao manual no banco. Libera o acesso
      // imediatamente (nao precisa esperar o watchdog de 15min, que
      // continua existindo so' como backstop pro caso raro do processo
      // cair ANTES de chegar aqui). CAS -- so' efetiva se ainda
      // estiver 'autorizada' (nunca sobrescreve um estado mais
      // avancado por corrida improvavel).
      try {
        await marcarAutorizacaoComoFalha(autorizado.id, "renovacao:falha_criar_cobranca_apos_aceite");
      } catch (erro) {
        console.log(
          "[confirmacao-renovacao] falha ao liberar token apos falha de cobranca -- watchdog cobre em ate 15min",
          JSON.stringify({ tokenId: autorizado.id, erro: String(erro) }),
        );
      }
      return paginaMensagem("Algo deu errado", "Não consegui gerar seu Pix agora. Um atendente vai te ajudar pelo WhatsApp.");
    }

    try {
      await vincularOperacaoAoToken(autorizado.id, operacaoId);
    } catch (erro) {
      console.log("[confirmacao-renovacao] falha ao vincular operacao ao token", JSON.stringify({ erro: String(erro) }));
    }

    try {
      await criarCobrancaPixRegistro({
        operacaoId,
        conversationId: autorizado.conversation_id,
        publicId: autorizado.public_id,
        servidorNome: autorizado.servidor_nome,
        planoNome: autorizado.plano_nome,
        valorEsperadoCentavos: autorizado.valor_esperado_centavos,
        transactionIdProvedor: criarResultado.transactionId,
        qrCodeTexto: criarResultado.qrCodeTexto,
      });
    } catch (erro) {
      console.log(
        "[confirmacao-renovacao] falha ao persistir cobranca_pix (cobranca ja existe na OpenPix)",
        JSON.stringify({ operacaoId, transactionId: criarResultado.transactionId, erro: String(erro) }),
      );
    }

    const valorFormatado = formatarValorBRL(autorizado.valor_esperado_centavos / 100) ?? "0,00";
    const textoPix = montarMensagemPixRenovacao(valorFormatado, criarResultado.qrCodeTexto);
    const envioPix = await enviarMensagemWhatsApp(autorizado.telefone, textoPix);
    if (envioPix.outcome === "success") {
      try {
        await inserirMensagem(autorizado.conversation_id, "ia", textoPix, null);
      } catch {
        // best-effort
      }
    }

    return paginaMensagem("Confirmado!", "Prontinho! Te mandei o Pix pelo WhatsApp. Assim que o pagamento for confirmado, sua renovação será feita automaticamente.");
  }

  return paginaMensagem("Ação inválida", "Ação não reconhecida.");
});
