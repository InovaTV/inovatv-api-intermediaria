// Portal de Renovacao Tope TV (topetv.com.br/renovacao) -- Checkpoint 4A.
//
// Escopo desta etapa, deliberadamente parado aqui: telefone -> lista de
// acessos com checkbox (carrinho ainda so' de LEITURA, nenhum token
// criado, nenhuma cobranca, nenhum dinheiro envolvido). A etapa
// "carrinho" (criar tokens_renovacao/renovacoes_lote) e a etapa
// "confirmar" (ACEITO/CANCELAR -> confirmarRenovacao() -> Pix) ficam
// para os proximos checkpoints -- o formulario da lista ja aponta pra
// etapa=carrinho, que ainda nao existe (POST cai no fallback generico
// abaixo, sem excecao).
//
// GET  -- so' renderiza o formulario de telefone. Nunca executa nada.
// POST etapa=telefone -- identifica o cliente DIRETO no Rocket (nunca
//      via /match -- decisao arquitetural do Checkpoint 1: /match exige
//      JWT do Supabase, e nao vamos torna-lo publico so' pro Portal).
//
// Anti-enumeracao: "nao encontramos" e "Rocket indisponivel" usam o
// MESMO texto -- nunca revela qual dos dois aconteceu.
//
// Nunca mostra senha nem credencial de acesso -- nem /clientes/ nem
// consultarClienteCompletoRocket devolvem esses campos (ja garantido
// estruturalmente pelos dois, nao repetido aqui).

import { normalizarTelefone } from "../_shared/telefone.ts";
import { buscarClientesPorTelefone } from "../_shared/rocket_identificar_cliente.ts";
import { consultarClienteCompletoRocket } from "../_shared/rocket_valor_cliente.ts";
import { formatarValorBRL, paraCentavos } from "../_shared/mensagens_fixas.ts";
import { buscarOuCriarConversa } from "../_shared/conversas_estado.ts";
import { criarTokenRenovacao, buscarTokenAtivoPorPublicId, hashToken } from "../_shared/tokens_renovacao.ts";
import { criarRenovacaoLote, existeLoteAtivoParaPublicId, type FilhoLote } from "../_shared/renovacoes_lote.ts";
import { classificarTipoAcesso } from "../_shared/tipo_acesso.ts";
import { chamarResolverContaUnitv } from "../_shared/unitv_conta_client.ts";
import { confirmarRenovacao } from "../_shared/renovacao_confirmacao.ts";
import { tentativaDeIdentificacaoPermitida } from "../_shared/portal_rate_limit.ts";

function escapeHtml(valor: string): string {
  return valor
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function paginaHtml(titulo: string, corpo: string): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(titulo)} - Tope TV</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; background: #0D1117; color: #E5E7EB; margin: 0; padding: 24px; }
  .card { max-width: 480px; margin: 40px auto; background: #161B22; border-radius: 12px; padding: 24px; }
  h1 { font-size: 20px; margin-top: 0; }
  label { display: block; font-size: 13px; color: #9CA3AF; margin-bottom: 6px; }
  input[type="tel"] { width: 100%; box-sizing: border-box; padding: 12px; border-radius: 8px; border: 1px solid #30363D; background: #0D1117; color: #E5E7EB; font-size: 16px; margin-bottom: 16px; }
  button { padding: 12px 24px; border-radius: 8px; border: none; font-size: 15px; font-weight: 600; cursor: pointer; }
  .primario { background: #22C55E; color: #0D1117; width: 100%; }
  .primario:disabled { background: #374151; color: #9CA3AF; cursor: not-allowed; }
  .acesso { border: 1px solid #30363D; border-radius: 8px; padding: 14px; margin-bottom: 10px; }
  .acesso .linha { display: flex; justify-content: space-between; font-size: 14px; margin: 3px 0; }
  .acesso .rotulo { color: #9CA3AF; }
  .acesso label { display: flex; align-items: center; gap: 10px; font-size: 15px; color: #E5E7EB; margin-bottom: 10px; cursor: pointer; }
  .acesso input[type="checkbox"] { width: 18px; height: 18px; }
  .nota { color: #9CA3AF; font-size: 13px; }
  .resumo { margin-top: 16px; }
  .linha.total { display: flex; justify-content: space-between; font-weight: 600; margin-top: 8px; border-top: 1px solid #30363D; padding-top: 10px; }
</style>
</head>
<body><div class="card">${corpo}</div></body>
</html>`;
}

function paginaFormularioTelefone(): Response {
  return new Response(
    paginaHtml(
      "Renovação",
      `<h1>Renovar minha assinatura</h1>
       <form method="POST">
         <input type="hidden" name="etapa" value="telefone">
         <label for="telefone">Seu celular (com DDD)</label>
         <input type="tel" id="telefone" name="telefone" placeholder="(17) 99999-9999" required autofocus>
         <button class="primario" type="submit">Continuar</button>
       </form>`,
    ),
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

function paginaMensagem(titulo: string, mensagem: string): Response {
  return new Response(
    paginaHtml(titulo, `<h1>${escapeHtml(titulo)}</h1><p>${escapeHtml(mensagem)}</p>`),
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

// Mesmo texto para "nao encontramos" e "Rocket indisponivel" --
// disciplina anti-enumeracao ja decidida na especificacao do Portal.
function paginaNaoEncontrado(): Response {
  return paginaMensagem(
    "Não encontramos seu cadastro",
    "Não encontramos nenhum cadastro com esse número. Confira se digitou corretamente ou fale com a gente pelo WhatsApp.",
  );
}

// Fallback generico reaproveitado em qualquer falha da etapa carrinho
// (selecao invalida, Rocket indisponivel na reconsulta, erro ao criar
// token/lote) -- nunca vaza detalhe interno, mesmo texto do fallback de
// etapa desconhecida no final deste arquivo.
function paginaErroGenerico(): Response {
  return paginaMensagem(
    "Não foi possível continuar",
    "Não conseguimos continuar sua renovação agora. Tente novamente pelo link recebido ou fale pelo WhatsApp.",
  );
}

function paginaJaExisteRenovacao(servidor: string): Response {
  return paginaMensagem(
    "Já existe uma renovação em andamento",
    `Já existe uma renovação em andamento para o acesso ${servidor}. Se você já recebeu um Pix para esse acesso, finalize o pagamento; senão, aguarde alguns minutos e tente de novo.`,
  );
}

function paginaErroUnitv(servidor: string): Response {
  return paginaMensagem(
    "Não conseguimos confirmar esse acesso",
    `Não conseguimos confirmar com segurança o acesso ${servidor} agora. Tente novamente em alguns minutos ou fale com a gente pelo WhatsApp.`,
  );
}

interface AcessoParaExibir {
  publicId: string;
  nome: string;
  usuario: string;
  servidor: string;
  plano: string;
  vencimentoFormatado: string;
  valorFormatado: string;
}

// Correcao de UX (apos teste real, Checkpoint 7): os checkboxes nascem
// DESMARCADOS (nunca "checked") -- selecionados por padrao dava a
// impressao enganosa de "todos esses acessos serao renovados". O botao
// "Continuar" nasce desabilitado e so' habilita via JS quando pelo menos
// 1 checkbox estiver marcado -- elimina de vez a possibilidade de
// avancar sem perceber quantos acessos estao selecionados. O titulo de
// cada card e' o SERVIDOR (o que realmente distingue um acesso do outro
// quando todos pertencem ao mesmo cliente) -- SO' quando /match devolveu
// mais de um NOME distinto (multiple_matches podendo ser clientes
// DIFERENTES compartilhando o telefone, nao so' o mesmo cliente com
// varios acessos) o nome tambem entra no titulo ("Nome — Servidor"),
// porque nesse caso e' informacao necessaria pra reconhecer o cadastro
// certo. Regra puramente de apresentacao -- nao muda identificacao,
// consulta ao Rocket, selecao, token ou Pix.
function tituloDoAcesso(nome: string, servidor: string, mostrarNome: boolean): string {
  return mostrarNome ? `${escapeHtml(nome)} — ${escapeHtml(servidor)}` : escapeHtml(servidor);
}

function paginaCarrinho(telefone: string, acessos: AcessoParaExibir[]): Response {
  const mostrarNome = new Set(acessos.map((a) => a.nome)).size > 1;
  const itensHtml = acessos
    .map(
      (a) => `<div class="acesso">
        <label>
          <input type="checkbox" name="publicId" value="${escapeHtml(a.publicId)}">
          <strong>${tituloDoAcesso(a.nome, a.servidor, mostrarNome)}</strong>
        </label>
        <div class="linha"><span class="rotulo">Usuário</span><span>${escapeHtml(a.usuario)}</span></div>
        <div class="linha"><span class="rotulo">Plano</span><span>${escapeHtml(a.plano)}</span></div>
        <div class="linha"><span class="rotulo">Vencimento</span><span>${escapeHtml(a.vencimentoFormatado)}</span></div>
        <div class="linha"><span class="rotulo">Valor da renovação</span><span>R$ ${escapeHtml(a.valorFormatado)}</span></div>
      </div>`,
    )
    .join("\n");

  return new Response(
    paginaHtml(
      "Seus acessos",
      `<h1>Seus acessos</h1>
       <p>Encontramos estes acessos cadastrados para este número de celular. Selecione abaixo quais acessos você deseja renovar. Você pode escolher um ou mais acessos.</p>
       <form method="POST">
         <input type="hidden" name="etapa" value="carrinho">
         <input type="hidden" name="telefone" value="${escapeHtml(telefone)}">
         ${itensHtml}
         <p class="nota">Selecione pelo menos um acesso para continuar.</p>
         <button class="primario" type="submit" id="btn-continuar" disabled>Continuar</button>
       </form>
       <script>
         (function () {
           var caixas = document.querySelectorAll('input[name="publicId"]');
           var botao = document.getElementById('btn-continuar');
           function atualizar() {
             var algumMarcado = Array.prototype.some.call(caixas, function (c) { return c.checked; });
             botao.disabled = !algumMarcado;
           }
           for (var i = 0; i < caixas.length; i++) caixas[i].addEventListener('change', atualizar);
         })();
       </script>`,
    ),
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

interface ItemConferencia {
  nome: string;
  servidor: string;
  usuario: string;
  plano: string;
  vencimentoFormatado: string;
  valorFormatado: string;
}

// Tela de conferencia -- ACEITO/CANCELAR. Ainda nao processa o ACEITO de
// verdade (isso e' o Checkpoint 4C, que vai chamar confirmarRenovacao())
// -- o formulario ja aponta pra etapa=confirmar, que por enquanto cai no
// fallback generico do Deno.serve abaixo, sem excecao.
//
// Correcao de UX (apos teste real, Checkpoint 7): cada acesso continua
// identificavel individualmente (usuario/plano/vencimento/valor), nunca
// so' uma linha "Servidor (Plano) -- Valor" -- essencial numa operacao
// financeira real. "Resumo da renovacao" deixa explicito quantos acessos
// foram selecionados e o texto abaixo explica o que o ACEITO realmente
// faz (gera Pix, renovacao so' apos confirmar o pagamento).
function paginaConferencia(
  tokenBruto: string,
  telefone: string,
  itens: ItemConferencia[],
  totalFormatado: string,
): Response {
  const mostrarNome = new Set(itens.map((i) => i.nome)).size > 1;
  const itensHtml = itens
    .map(
      (i) => `<div class="acesso">
        <strong>${tituloDoAcesso(i.nome, i.servidor, mostrarNome)}</strong>
        <div class="linha"><span class="rotulo">Usuário</span><span>${escapeHtml(i.usuario)}</span></div>
        <div class="linha"><span class="rotulo">Plano</span><span>${escapeHtml(i.plano)}</span></div>
        <div class="linha"><span class="rotulo">Vencimento atual</span><span>${escapeHtml(i.vencimentoFormatado)}</span></div>
        <div class="linha"><span class="rotulo">Valor</span><span>R$ ${escapeHtml(i.valorFormatado)}</span></div>
      </div>`,
    )
    .join("\n");

  const rotuloQuantidade = itens.length === 1 ? "1 acesso selecionado" : `${itens.length} acessos selecionados`;

  return new Response(
    paginaHtml(
      "Confirmar renovação",
      `<h1>Confirme sua renovação</h1>
       ${itensHtml}
       <div class="resumo">
         <p class="nota">${escapeHtml(rotuloQuantidade)}</p>
         <div class="linha total"><span>Total a pagar</span><span>R$ ${escapeHtml(totalFormatado)}</span></div>
       </div>
       <p class="nota" style="margin-top:14px;">Ao confirmar, será gerada uma cobrança Pix no valor total acima. A renovação será processada após a confirmação do pagamento.</p>
       <form method="POST" style="margin-top:20px;">
         <input type="hidden" name="etapa" value="confirmar">
         <input type="hidden" name="token" value="${escapeHtml(tokenBruto)}">
         <input type="hidden" name="telefone" value="${escapeHtml(telefone)}">
         <input type="hidden" name="acao" value="aceitar">
         <button class="primario" type="submit">ACEITO</button>
       </form>
       <form method="POST" style="margin-top:8px;">
         <input type="hidden" name="etapa" value="confirmar">
         <input type="hidden" name="token" value="${escapeHtml(tokenBruto)}">
         <input type="hidden" name="telefone" value="${escapeHtml(telefone)}">
         <input type="hidden" name="acao" value="cancelar">
         <button type="submit">CANCELAR</button>
       </form>`,
    ),
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

// Checkpoint 4C -- tela do Pix, renderizada apos o ACEITO. O QR Code e'
// gerado NO NAVEGADOR a partir do brCode (biblioteca client-side via
// CDN, qrcodejs -- sem VPS, sem geracao de imagem no backend). O token
// bruto fica so' no corpo da pagina/JS (nunca na URL) -- mesmo principio
// ja usado por confirmacao-renovacao?token=..., so' que aqui nem chega a
// aparecer na barra de enderecos. O polling chama renovacao-status por
// caminho RELATIVO (/functions/v1/renovacao-status) -- same-origin com
// esta propria pagina, confirmado na revisao de seguranca do Portal.
function paginaPix(tokenBruto: string, brCode: string, paymentLinkUrl: string): Response {
  const brCodeJs = JSON.stringify(brCode).replaceAll("<", "\\u003c");
  const tokenJs = JSON.stringify(tokenBruto).replaceAll("<", "\\u003c");

  return new Response(
    paginaHtml(
      "Pagamento",
      `<h1>Pague com Pix</h1>
       <p>Escaneie o QR Code ou copie o código abaixo no app do seu banco.</p>
       <div id="qrcode" style="display:flex;justify-content:center;margin:16px 0;"></div>
       <label for="brcode">Pix copia e cola</label>
       <textarea id="brcode" readonly rows="3" style="width:100%;box-sizing:border-box;padding:10px;border-radius:8px;border:1px solid #30363D;background:#0D1117;color:#E5E7EB;font-size:12px;">${escapeHtml(brCode)}</textarea>
       <button id="copiar" type="button" style="margin-top:8px;width:100%;background:#374151;color:#E5E7EB;">Copiar código</button>
       <p id="status-pagamento" style="margin-top:20px;color:#9CA3AF;font-size:14px;">Aguardando pagamento…</p>
       <a href="${escapeHtml(paymentLinkUrl)}" target="_blank" rel="noopener" style="display:block;text-align:center;margin-top:8px;color:#9CA3AF;font-size:13px;">ou abra a página de pagamento</a>
       <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
       <script>
         new QRCode(document.getElementById("qrcode"), { text: ${brCodeJs}, width: 220, height: 220 });
         document.getElementById("copiar").addEventListener("click", function () {
           navigator.clipboard.writeText(${brCodeJs}).then(function () {
             document.getElementById("copiar").textContent = "Copiado!";
           });
         });
         var token = ${tokenJs};
         var statusEl = document.getElementById("status-pagamento");
         var textos = {
           aguardando_confirmacao: "Aguardando pagamento…",
           aguardando_pagamento: "Aguardando pagamento…",
           processando_renovacao: "Pagamento confirmado! Processando sua renovação…",
           concluido: "Renovação concluída com sucesso!",
           parcial: "Alguns acessos foram renovados, outros não. Veja abaixo.",
           falhou: "Não conseguimos concluir a renovação. Fale com a gente pelo WhatsApp.",
           cancelado: "Renovação cancelada.",
           expirado: "O tempo para pagamento expirou.",
           nao_encontrado: "Aguardando pagamento…"
         };
         var intervalo = setInterval(sondar, 4000);
         async function sondar() {
           try {
             var resp = await fetch("/functions/v1/renovacao-status", {
               method: "POST",
               headers: { "Content-Type": "application/json" },
               body: JSON.stringify({ token: token }),
             });
             var dados = await resp.json();
             statusEl.textContent = textos[dados.estado] || "Aguardando pagamento…";
             if (dados.estado === "concluido" || dados.estado === "parcial" || dados.estado === "falhou") {
               clearInterval(intervalo);
               if (Array.isArray(dados.itens)) {
                 var linhas = dados.itens.map(function (i) {
                   var r = i.resultado === "sucesso" ? "renovado" : i.resultado === "falha" ? "falhou" : "processando";
                   return (i.servidor || "") + ": " + r;
                 });
                 statusEl.textContent += " (" + linhas.join(", ") + ")";
               }
             }
           } catch (e) {}
         }
         sondar();
       </script>`,
    ),
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

function formatarVencimento(vencimento: string): string {
  try {
    return new Date(vencimento).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  } catch {
    return "não informado";
  }
}

async function processarEtapaTelefone(form: FormData): Promise<Response> {
  const telefoneBruto = form.get("telefone");
  if (typeof telefoneBruto !== "string" || telefoneBruto.trim().length === 0) {
    return paginaNaoEncontrado();
  }

  const telefone = normalizarTelefone(telefoneBruto);

  // Rate limiting (Checkpoint 5) -- SO' desta etapa. Bloqueado ou nao,
  // a resposta e' EXATAMENTE a mesma pagina generica de "nao
  // encontramos" -- nunca revela se o limite foi atingido, nem se o
  // Rocket chegou a ser consultado (estruturalmente nao e' -- o bloqueio
  // acontece ANTES de qualquer chamada ao Rocket).
  const permitido = await tentativaDeIdentificacaoPermitida(telefone);
  if (!permitido) return paginaNaoEncontrado();

  const identificacao = await buscarClientesPorTelefone(telefone);

  if (identificacao.outcome === "no_match" || identificacao.outcome === "unavailable") {
    return paginaNaoEncontrado();
  }

  // Dados completos por candidato -- MESMO helper ja usado pelo
  // Orquestrador (_shared/rocket_valor_cliente.ts), nenhuma logica nova
  // de consulta ao Rocket aqui. Candidato com dado incompleto (guard de
  // consultarClienteCompletoRocket) e' descartado da lista -- nunca
  // exibido com placeholder que depois quebraria a criacao do token.
  const completos = await Promise.all(
    identificacao.candidatos.map(async (c) => ({
      publicId: c.publicId,
      dados: await consultarClienteCompletoRocket(c.publicId),
    })),
  );

  const acessos: AcessoParaExibir[] = completos
    .filter((c): c is { publicId: string; dados: Extract<typeof c.dados, { outcome: "success" }> } =>
      c.dados.outcome === "success",
    )
    .map((c) => ({
      publicId: c.publicId,
      nome: c.dados.nome,
      usuario: c.dados.usuario ?? "não informado",
      servidor: c.dados.servidorNome,
      plano: c.dados.planoNome,
      vencimentoFormatado: formatarVencimento(c.dados.vencimento),
      valorFormatado: formatarValorBRL(c.dados.valor) ?? "não informado",
    }));

  if (acessos.length === 0) return paginaNaoEncontrado();

  return paginaCarrinho(telefone, acessos);
}

interface ItemResolvido {
  publicId: string;
  tipo: "sigma" | "unitv";
  unitvSn: string | null;
  unitvId: number | null;
  nome: string;
  usuario: string | null;
  servidor: string;
  plano: string;
  valorCentavos: number;
  vencimento: string;
}

// Checkpoint 4B -- carrinho -> criacao do token (1 item) ou lote (2+).
// Ainda NENHUMA cobranca criada aqui (isso so' acontece no ACEITO, dentro
// de confirmarRenovacao() -- Checkpoint 4C).
//
// Seguranca (decisao arquitetural, revisao de seguranca do Portal):
// NUNCA confia em telefone/publicId vindos do formulario como prova de
// pertencimento -- o navegador pode tamperar campos ocultos entre
// requisicoes. Por isso: (1) reconsulta buscarClientesPorTelefone(telefone)
// de novo aqui e SO' aceita publicId que estiver nesse conjunto
// autoritativo; (2) para cada item aceito, reconsulta
// consultarClienteCompletoRocket(publicId) de novo -- nome/servidor/
// plano/valor/vencimento usados pra criar o token vem SEMPRE dessa
// reconsulta, nunca de um campo do formulario.
async function processarEtapaCarrinho(form: FormData): Promise<Response> {
  const telefoneBruto = form.get("telefone");
  const publicIdsSelecionados = form.getAll("publicId").filter((v): v is string => typeof v === "string");

  if (typeof telefoneBruto !== "string" || telefoneBruto.trim().length === 0 || publicIdsSelecionados.length === 0) {
    return paginaErroGenerico();
  }

  const telefone = telefoneBruto;

  const identificacao = await buscarClientesPorTelefone(telefone);
  if (identificacao.outcome !== "single_match" && identificacao.outcome !== "multiple_matches") {
    return paginaErroGenerico();
  }

  const idsValidos = new Set(identificacao.candidatos.map((c) => c.publicId));
  const selecaoValida = [...new Set(publicIdsSelecionados)].filter((id) => idsValidos.has(id));
  if (selecaoValida.length === 0) return paginaErroGenerico();

  const itensResolvidos: ItemResolvido[] = [];
  for (const publicId of selecaoValida) {
    const dados = await consultarClienteCompletoRocket(publicId);
    if (dados.outcome !== "success") return paginaErroGenerico();

    const valorCentavos = paraCentavos(dados.valor);
    if (!valorCentavos) return paginaErroGenerico();

    const [tokenAtivo, loteAtivo] = await Promise.all([
      buscarTokenAtivoPorPublicId(publicId),
      existeLoteAtivoParaPublicId(publicId),
    ]);
    if (tokenAtivo || loteAtivo) return paginaJaExisteRenovacao(dados.servidorNome);

    const tipo = classificarTipoAcesso(dados.servidorNome);
    let unitvSn: string | null = null;
    let unitvId: number | null = null;
    if (tipo === "unitv") {
      const sn = dados.usuario;
      if (!sn) return paginaErroUnitv(dados.servidorNome);
      const resolucao = await chamarResolverContaUnitv(sn);
      if (resolucao.outcome !== "resolvido") return paginaErroUnitv(dados.servidorNome);
      unitvSn = sn;
      unitvId = resolucao.id;
    }

    itensResolvidos.push({
      publicId,
      tipo,
      unitvSn,
      unitvId,
      nome: dados.nome,
      usuario: dados.usuario,
      servidor: dados.servidorNome,
      plano: dados.planoNome,
      valorCentavos,
      vencimento: dados.vencimento,
    });
  }

  const conversa = await buscarOuCriarConversa(telefone);

  let tokenBruto: string;
  try {
    if (itensResolvidos.length === 1) {
      const item = itensResolvidos[0];
      const criado = await criarTokenRenovacao({
        conversationId: conversa.conversation_id,
        publicId: item.publicId,
        telefone,
        clienteNome: item.nome,
        servidorNome: item.servidor,
        planoNome: item.plano,
        valorEsperadoCentavos: item.valorCentavos,
        vencimentoAtual: item.vencimento,
        usuario: item.tipo === "unitv" ? null : item.usuario,
        tipo: item.tipo,
        unitvSn: item.unitvSn,
        unitvId: item.unitvId,
      });
      tokenBruto = criado.tokenBruto;
    } else {
      const filhos: FilhoLote[] = itensResolvidos.map((i) => ({
        tipo: i.tipo,
        publicId: i.publicId,
        unitvSn: i.unitvSn,
        unitvId: i.unitvId,
        clienteNome: i.nome,
        usuario: i.tipo === "unitv" ? null : i.usuario,
        servidorNome: i.servidor,
        planoNome: i.plano,
        valorEsperadoCentavos: i.valorCentavos,
        vencimentoAtual: i.vencimento,
      }));
      const valorTotalCentavos = itensResolvidos.reduce((soma, i) => soma + i.valorCentavos, 0);
      const criado = await criarRenovacaoLote({
        conversationId: conversa.conversation_id,
        telefone,
        valorTotalCentavos,
        regraAplicada: "soma_valores_rocket",
        filhos,
      });
      tokenBruto = criado.tokenBruto;
    }
  } catch {
    // Corrida real possivel (mesma classe ja tratada no Orquestrador):
    // duas submissoes quase simultaneas pro mesmo acesso esbarram no
    // indice unico parcial do banco. Sem retry sofisticado aqui --
    // portal de baixo trafego, o cliente so' tenta de novo.
    return paginaErroGenerico();
  }

  const itensConferencia: ItemConferencia[] = itensResolvidos.map((i) => ({
    nome: i.nome,
    servidor: i.servidor,
    usuario: i.usuario ?? "não informado",
    plano: i.plano,
    vencimentoFormatado: formatarVencimento(i.vencimento),
    valorFormatado: formatarValorBRL(i.valorCentavos / 100) ?? "0,00",
  }));
  const totalCentavos = itensResolvidos.reduce((soma, i) => soma + i.valorCentavos, 0);
  const totalFormatado = formatarValorBRL(totalCentavos / 100) ?? "0,00";

  return paginaConferencia(tokenBruto, telefone, itensConferencia, totalFormatado);
}

// Checkpoint 4C -- ACEITO/CANCELAR. Chama confirmarRenovacao()
// (_shared/renovacao_confirmacao.ts) DIRETAMENTE -- a MESMA funcao ja
// usada e testada pelo botao do WhatsApp (renovacao-confirmar/index.ts),
// `origem: "link"`. Nenhuma logica de cobranca/pagamento nova aqui --
// so' traduz o resultado em HTML. telefoneOrigem e' passado quando
// disponivel (camada extra de defesa, opcional -- a garantia real
// continua sendo a posse do proprio token, mesmo principio ja aceito em
// producao por confirmacao-renovacao?token=...).
async function processarEtapaConfirmar(form: FormData): Promise<Response> {
  const tokenBruto = form.get("token");
  const acao = form.get("acao");
  const telefone = form.get("telefone");

  if (typeof tokenBruto !== "string" || tokenBruto.length === 0) return paginaErroGenerico();
  if (acao !== "aceitar" && acao !== "cancelar") return paginaErroGenerico();

  const tokenHash = await hashToken(tokenBruto);
  const resultado = await confirmarRenovacao({
    tokenHash,
    acao,
    telefoneOrigem: typeof telefone === "string" && telefone.length > 0 ? telefone : undefined,
    origem: "link",
  });

  switch (resultado.outcome) {
    case "cancelada":
      return paginaMensagem("Cancelado", "Sua renovação foi cancelada. Nenhuma cobrança foi criada.");
    case "confirmada":
      return paginaPix(tokenBruto, resultado.brCode, resultado.paymentLinkUrl);
    case "falha_cobranca":
      return paginaMensagem(
        "Algo deu errado",
        "Não conseguimos gerar seu Pix agora. Tente novamente em alguns minutos ou fale com a gente pelo WhatsApp.",
      );
    case "token_expirado":
      return paginaMensagem("Link expirado", "Essa renovação não é mais válida. Volte ao início e comece de novo.");
    case "ja_decidido":
      return paginaMensagem("Já decidido", "Essa renovação já foi confirmada ou cancelada anteriormente.");
    case "token_inexistente":
    case "telefone_nao_confere":
    default:
      return paginaErroGenerico();
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "GET") return paginaFormularioTelefone();

  if (req.method !== "POST") {
    return new Response("Método não suportado", { status: 405 });
  }

  const form = await req.formData().catch(() => null);
  const etapa = form?.get("etapa");

  if (etapa === "telefone" && form) {
    return await processarEtapaTelefone(form);
  }

  if (etapa === "carrinho" && form) {
    return await processarEtapaCarrinho(form);
  }

  if (etapa === "confirmar" && form) {
    return await processarEtapaConfirmar(form);
  }

  return paginaErroGenerico();
});
