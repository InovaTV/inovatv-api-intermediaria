// Teste automatizado, com navegador real (Playwright/Chromium), das
// transicoes de tela dentro da pagina do Pix: Aguardando -> Processando
// -> Concluida (sucesso total / parcial / falha total). Diferente de
// teste.mjs (que so' verifica o HTML inicial gerado pelo servidor),
// este arquivo executa de verdade o JS do navegador (fetch, setInterval,
// troca de DOM) contra um backend fake que simula as respostas reais de
// /functions/v1/renovacao-status -- exatamente o mecanismo que ja'
// esta' em producao (nenhuma mudanca de codigo feita so' pra testar).
//
// Como rodar: node scripts/testes/renovacao_iniciar/teste_transicoes_pix.mjs

import { register } from "node:module";
register("./mock-loader.mjs", import.meta.url);

import http from "node:http";
import { chromium } from "playwright";

const { configurar: configurarConfirmacao } = await import("./fake_renovacao_confirmacao.mjs");

const ENV = {
  ROCKET_BASE_URL: "https://rocket.example.test",
  ROCKET_API_KEY: "api-key-de-teste",
  SUPABASE_URL: "https://supabase.example.test",
  RENOVACAO_SIGMA_CALLBACK_TOKEN: "callback-token-de-teste",
};

let handler;
globalThis.Deno = {
  serve: (fn) => { handler = fn; },
  env: { get: (k) => ENV[k] },
};
globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });

await import("../../../supabase/functions/renovacao-iniciar/index.ts");

let falhas = 0;
let total = 0;
function ok(cond, msg) {
  total++;
  if (cond) console.log("ok:", msg);
  else { falhas++; console.error("FALHA:", msg); }
}

function reqPostForm(pares) {
  const body = new URLSearchParams();
  for (const [k, v] of pares) body.append(k, v);
  return new Request("https://x.test/", { method: "POST", body });
}

// brCode EMV bem-formado (mesmo builder de teste ja' usado nas previas
// visuais), tag 54 (valor) = 70.00.
const brCodeFake =
  "00020126480014BR.GOV.BCB.PIX0126chave-pix-teste-1234567890" +
  "520400005303986540570.005802BR5912TOPE TV LTDA6009SAO PAULO" +
  "62070503***6304A1B2";

async function gerarHtmlPix() {
  configurarConfirmacao({
    outcome: "confirmada",
    operacaoId: "op-teste-transicoes",
    brCode: brCodeFake,
    paymentLinkUrl: "https://openpix.com.br/pay/teste-transicoes",
  });
  const resp = await handler(reqPostForm([
    ["etapa", "confirmar"], ["token", "token-bruto-teste-transicoes"], ["telefone", "17998162548"], ["acao", "aceitar"],
  ]));
  return await resp.text();
}

// Sobe um servidor HTTP servindo o HTML gerado e um /functions/v1/
// renovacao-status fake que devolve as respostas passadas em `sequencia`
// em ordem (a ultima resposta se repete se for chamado mais vezes).
function subirServidor(html, sequencia) {
  let chamada = 0;
  const chamadas = [];
  const server = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/functions/v1/renovacao-status") {
      const resposta = sequencia[Math.min(chamada, sequencia.length - 1)];
      chamada += 1;
      chamadas.push(resposta.estado);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(resposta));
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, port: server.address().port, chamadas });
    });
  });
}

async function pararServidor(server) {
  await new Promise((resolve) => server.close(resolve));
}

const html = await gerarHtmlPix();
const browser = await chromium.launch();

// ---------------------------------------------------------------------
// Cenario 1 -- parcial: 1 sucesso + 1 falha, passando por "processando"
// com um item ainda em andamento no meio do caminho (testa a
// atualizacao ao vivo dos badges por item, nao so' o estado final).
// ---------------------------------------------------------------------
{
  const sequencia = [
    { estado: "aguardando_pagamento", itens: [{ servidor: "ChannelTV", resultado: null }, { servidor: "BLAZE", resultado: null }] },
    { estado: "processando_renovacao", itens: [{ servidor: "ChannelTV", resultado: "sucesso" }, { servidor: "BLAZE", resultado: null }] },
    { estado: "parcial", itens: [{ servidor: "ChannelTV", resultado: "sucesso" }, { servidor: "BLAZE", resultado: "falha" }] },
  ];
  const { server, port, chamadas } = await subirServidor(html, sequencia);
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:" + port + "/");

  // Checa a tela inicial (aguardando) ANTES de qualquer wait longo --
  // o 1o poll dispara imediatamente (sondar() roda uma vez fora do
  // setInterval), entao o DOM pode trocar rapido.
  ok(await page.locator("#status-pagamento").isVisible(), "cenario parcial: tela de pagamento (aguardando) aparece primeiro");
  ok((await page.locator("#pix-total").textContent()).includes("70,00"), "cenario parcial: total extraido do brCode aparece certo (R$ 70,00)");
  ok(await page.locator("#qrcode").locator("canvas, img, table").count() >= 1, "cenario parcial: QR Code renderizado (qrcodejs)");

  await page.waitForSelector(".titulo-processando", { timeout: 8000 });
  ok((await page.locator(".titulo-processando").textContent()).includes("Pagamento confirmado"), "cenario parcial: tela 'Processando' aparece apos o 1o poll");
  await page.waitForFunction(() => {
    var el = document.querySelector(".item-processando");
    return el && el.textContent.includes("ChannelTV");
  }, { timeout: 5000 });
  ok(await page.locator(".badge-processando").count() >= 1, "cenario parcial: pelo menos 1 item ainda mostra badge 'Processando'");
  ok(await page.locator(".item-processando:has-text('ChannelTV') .badge-resultado.ok").isVisible(), "cenario parcial: ChannelTV ja' aparece 'Renovado' mesmo com BLAZE ainda processando");

  await page.waitForSelector(".item-resultado", { timeout: 8000 });
  const tituloFinal = await page.locator(".titulo-processando").textContent();
  ok(tituloFinal.includes("Renovação concluída"), "cenario parcial: titulo final correto");
  ok((await page.locator(".subtitulo-central").textContent()).includes("1 de 2"), "cenario parcial: contagem '1 de 2' no subtitulo");
  ok(await page.locator(".contagem-chip.ok:has-text('1 renovado')").isVisible(), "cenario parcial: chip verde '1 renovado(s)'");
  ok(await page.locator(".contagem-chip.falha:has-text('1 não renovado')").isVisible(), "cenario parcial: chip vermelho '1 não renovado(s)'");
  ok(await page.locator(".item-resultado:has-text('ChannelTV') .badge-resultado.ok").isVisible(), "cenario parcial: card ChannelTV com badge verde 'Renovado'");
  ok(await page.locator(".item-resultado.item-falha:has-text('BLAZE')").isVisible(), "cenario parcial: card BLAZE com estilo de falha");
  ok(await page.locator(".item-ajuda a[href*='wa.me']").isVisible(), "cenario parcial: link do WhatsApp aparece no item com falha");
  ok(await page.locator(".voltar-site").isVisible(), "cenario parcial: link 'Voltar para topetv.com.br' presente no encerramento");

  await page.waitForTimeout(4500);
  ok(await page.locator(".item-resultado").count() === 2, "cenario parcial: polling parou (tela final nao mudou apos esperar mais um ciclo)");

  // ---- Tela 7: "Ver historico completo" a partir da tela concluida ----
  const chamadasAntesDoHistorico = chamadas.length;
  ok(await page.locator("#ver-historico").isVisible(), "historico: botao 'Ver historico completo' aparece na tela concluida");
  await page.click("#ver-historico");
  await page.waitForSelector(".linha-tempo", { timeout: 3000 });

  ok(await page.locator(".etapa").count() === 6, "historico: linha do tempo com as 6 etapas");
  ok((await page.locator(".etapa").nth(1).locator("span").textContent()).includes("2 acessos selecionados"), "historico: etapa 'Acessos selecionados' usa a quantidade real (2)");
  ok(await page.locator(".item-comprovante:has-text('ChannelTV') .badge-resultado.ok").isVisible(), "historico: card ChannelTV com badge 'Renovado'");
  ok(await page.locator(".item-comprovante:has-text('BLAZE') .badge-resultado.falha").isVisible(), "historico: card BLAZE mostra o badge 'Nao renovado' (mesmo dado do resultado final)");
  ok(await page.locator(".btn-voltar-inicio[href='https://topetv.com.br']").isVisible(), "historico: botao 'Voltar para o inicio' aponta pro site real");
  ok(await page.locator(".ajuda-final a[href='https://wa.me/5517996242415']").isVisible(), "historico: link 'Fale com a Tope TV' com o numero oficial");
  ok(chamadas.length === chamadasAntesDoHistorico, "historico: nenhuma consulta nova a renovacao-status foi feita so' pra ver o historico");

  await page.close();
  await pararServidor(server);
}

// ---------------------------------------------------------------------
// Cenario 2 -- sucesso total.
// ---------------------------------------------------------------------
{
  const sequencia = [
    { estado: "concluido", itens: [{ servidor: "ChannelTV", resultado: "sucesso" }, { servidor: "UNITV", resultado: "sucesso" }] },
  ];
  const { server, port } = await subirServidor(html, sequencia);
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:" + port + "/");
  await page.waitForSelector(".item-resultado", { timeout: 8000 });

  ok((await page.locator(".titulo-processando").textContent()).includes("Renovação concluída! 🎉"), "cenario sucesso: titulo com o emoji e texto exatos aprovados");
  ok((await page.locator(".subtitulo-central").textContent()).trim() === "Seus acessos foram renovados com sucesso.", "cenario sucesso: subtitulo exato aprovado");
  ok(await page.locator(".status-icone.ok").isVisible(), "cenario sucesso: icone fica verde (classe 'ok')");
  ok(await page.locator(".resumo-contagem").count() === 0, "cenario sucesso: NAO mostra chips de contagem (so' faz sentido no parcial)");
  ok(await page.locator(".badge-resultado.falha").count() === 0, "cenario sucesso: nenhum badge de falha aparece");
  ok(await page.locator(".badge-resultado.ok").count() === 2, "cenario sucesso: os 2 acessos aparecem com badge verde");

  await page.close();
  await pararServidor(server);
}

// ---------------------------------------------------------------------
// Cenario 3 -- falha total.
// ---------------------------------------------------------------------
{
  const sequencia = [
    { estado: "falhou", itens: [{ servidor: "BLAZE", resultado: "falha" }] },
  ];
  const { server, port } = await subirServidor(html, sequencia);
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:" + port + "/");
  await page.waitForSelector(".item-resultado", { timeout: 8000 });

  ok((await page.locator(".titulo-processando").textContent()).includes("Não conseguimos concluir a renovação"), "cenario falha: titulo correto");
  ok(await page.locator(".status-icone.atencao").isVisible(), "cenario falha: icone fica ambar (classe 'atencao')");
  ok(await page.locator(".item-resultado.item-falha").count() === 1, "cenario falha: card unico aparece com estilo de falha");
  ok(await page.locator(".item-ajuda a[href='https://wa.me/5517996242415']").isVisible(), "cenario falha: link do WhatsApp com o numero oficial correto");

  await page.close();
  await pararServidor(server);
}

// ---------------------------------------------------------------------
// Cenario 4 -- seguranca: nome de servidor com HTML nunca deve ser
// injetado cru no DOM (defesa em profundidade da funcao escaparHtml do
// lado do cliente).
// ---------------------------------------------------------------------
{
  const sequencia = [
    { estado: "concluido", itens: [{ servidor: "<img src=x onerror=alert(1)>", resultado: "sucesso" }] },
  ];
  const { server, port } = await subirServidor(html, sequencia);
  const page = await browser.newPage();
  let dialogApareceu = false;
  page.on("dialog", async (d) => { dialogApareceu = true; await d.dismiss(); });
  await page.goto("http://127.0.0.1:" + port + "/");
  await page.waitForSelector(".item-resultado", { timeout: 8000 });
  await page.waitForTimeout(500);

  ok(!dialogApareceu, "cenario seguranca: nome malicioso do servidor NUNCA executa como HTML/JS (escapado)");
  ok((await page.locator(".item-resultado strong").innerHTML()).includes("&lt;img"), "cenario seguranca: nome aparece escapado (&lt;img) no DOM");

  await page.close();
  await pararServidor(server);
}

await browser.close();

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
