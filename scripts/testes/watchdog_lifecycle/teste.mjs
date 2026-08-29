// Peca 3 (2026-08-29) -- ciclo de vida garantido dos estados presos do
// fluxo de renovacao. Roda o handler REAL de
// supabase/functions/renovacao-sigma-watchdog/index.ts + o modulo REAL
// _shared/reconciliacao_renovacao.ts. So' I/O (banco, Woovi, GitHub,
// WhatsApp) e' fake, com semantica CAS -- para provar idempotencia e
// seguranca sob concorrencia.
//
// Criterio: nunca perder um pagamento que a Woovi tenha concluido; e
// nenhuma operacao expirada/perdida pode bloquear o acesso
// indefinidamente.
//
// Como rodar: npx tsx scripts/testes/watchdog_lifecycle/teste.mjs

import { register } from "node:module";
register("./mock-loader.mjs", import.meta.url);

const T = await import("./fake_tokens_renovacao.mjs");
const L = await import("./fake_renovacoes_lote.mjs");
const C = await import("./fake_cobrancas_pix.mjs");
const OP = await import("./fake_openpix_client.mjs");
const GH = await import("./fake_github_actions_dispatch.mjs");
const CV = await import("./fake_conversas_estado.mjs");
const NT = await import("./fake_notificacao_transferencia.mjs");
const MA = await import("./fake_mensagens_atendimento.mjs");
const WA = await import("./fake_whatsapp_client.mjs");
const { MENSAGEM_RENOVACAO_EXPIRADA_SEM_PAGAMENTO } = await import(
  "../../../supabase/functions/_shared/mensagens_fixas.ts"
);

const TOKEN_INTERNO = "watchdog-token-de-teste";
process.env.RENOVACAO_SIGMA_WATCHDOG_TOKEN = TOKEN_INTERNO;
process.env.WHATSAPP_JOSE_NUMERO = "5511777777777";

let handler;
globalThis.Deno = {
  serve: (fn) => {
    handler = fn;
  },
  env: { get: (nome) => process.env[nome] },
};

await import("../../../supabase/functions/renovacao-sigma-watchdog/index.ts");

let falhas = 0;
function ok(cond, msg) {
  if (!cond) {
    falhas++;
    console.error(`FALHA: ${msg}`);
  } else {
    console.log(`ok: ${msg}`);
  }
}

function resetarTudo() {
  T.resetar();
  L.resetar();
  C.resetar();
  OP.resetar();
  GH.resetar();
  CV.resetar();
  NT.resetar();
  MA.resetar();
  WA.resetar();
}

function run() {
  return handler(
    new Request("https://x/functions/v1/renovacao-sigma-watchdog", {
      method: "POST",
      headers: { "X-Internal-Token": TOKEN_INTERNO, "Content-Type": "application/json" },
      body: "{}",
    }),
  );
}

const H_ATRAS = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h atras (vencido)
const DIAS2_ATRAS = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(); // > carencia de 24h

// ---------------------------------------------------------------------
// CASO A -- 'aguardando_confirmacao' vencido, sem cobranca
// ---------------------------------------------------------------------
async function casoA_individual() {
  resetarTudo();
  T._seed([{ id: "tk-A", estado: "aguardando_confirmacao", expira_em: H_ATRAS }]);
  await run();
  ok(T._all().find((t) => t.id === "tk-A").estado === "expirada", "A ind: token 'aguardando' vencido -> 'expirada'");
  ok(GH.disparosRegistrados().length === 0, "A ind: nenhum workflow disparado");
  ok(CV.acionamentos().length === 0, "A ind: NENHUMA transferencia (Caso A nao transfere)");
  // idempotencia: 2a execucao nao faz nada (query filtra por estado)
  const antes = MA.mensagens().length;
  await run();
  ok(MA.mensagens().length === antes, "A ind: 2a execucao e' no-op (query-guard)");
}
async function casoA_lote() {
  resetarTudo();
  L._seed([{ grupo_id: "gp-A", estado: "aguardando_confirmacao", expira_em: H_ATRAS }]);
  await run();
  ok(L._all().find((l) => l.grupo_id === "gp-A").estado === "expirada", "A lote: lote 'aguardando' vencido -> 'expirada'");
  ok(CV.acionamentos().length === 0, "A lote: nenhuma transferencia");
}

// ---------------------------------------------------------------------
// CASO B -- 'autorizada' + cobranca vinculada + venceu + Woovi COMPLETED
//           => RECUPERAR (nunca perder um pagamento)
// ---------------------------------------------------------------------
async function casoB_recuperar() {
  resetarTudo();
  T._seed([{ id: "tk-B", estado: "autorizada", operacao_id: "op-B", expira_em: H_ATRAS }]);
  C._seed([{ operacao_id: "op-B", status: "pendente", valor_esperado_centavos: 3500 }]);
  OP._definir("op-B", { outcome: "success", status: "COMPLETED", amountCentavos: 3500 });

  await run();

  ok(C._all().find((c) => c.operacao_id === "op-B").status === "pago", "B: cobranca 'pendente' -> 'pago'");
  ok(T._all().find((t) => t.id === "tk-B").estado === "renovacao_em_andamento", "B: token 'autorizada' -> 'renovacao_em_andamento'");
  ok(GH.disparosRegistrados().length === 1 && GH.disparosRegistrados()[0] === "op-B", "B: workflow disparado exatamente 1x");
  ok(CV.acionamentos().length === 0, "B: NENHUMA transferencia (renovacao segue normal)");

  await run(); // idempotencia
  ok(GH.disparosRegistrados().length === 1, "B: 2a execucao NAO redispara (token nao esta mais 'autorizada')");
}
async function casoB_concorrencia() {
  resetarTudo();
  T._seed([{ id: "tk-Bc", estado: "autorizada", operacao_id: "op-Bc", expira_em: H_ATRAS }]);
  C._seed([{ operacao_id: "op-Bc", status: "pendente", valor_esperado_centavos: 3500 }]);
  OP._definir("op-Bc", { outcome: "success", status: "COMPLETED", amountCentavos: 3500 });

  await Promise.all([run(), run(), run()]); // 3 watchdogs concorrentes

  ok(GH.disparosRegistrados().length === 1, "B concorrencia: 3 watchdogs -> workflow disparado EXATAMENTE 1x");
  ok(T._all().find((t) => t.id === "tk-Bc").estado === "renovacao_em_andamento", "B concorrencia: token consistente");
  ok(C._all().find((c) => c.operacao_id === "op-Bc").status === "pago", "B concorrencia: cobranca 'pago' (nunca perdida)");
}
async function casoB_webhookJaMarcouPago() {
  // Webhook real ganhou o passo 2 (cobranca ja 'pago') mas nao avancou
  // o token. O watchdog termina a recuperacao.
  resetarTudo();
  T._seed([{ id: "tk-Bw", estado: "autorizada", operacao_id: "op-Bw", expira_em: H_ATRAS }]);
  C._seed([{ operacao_id: "op-Bw", status: "pago", valor_esperado_centavos: 3500 }]);
  OP._definir("op-Bw", { outcome: "success", status: "COMPLETED", amountCentavos: 3500 });

  await run();
  ok(T._all().find((t) => t.id === "tk-Bw").estado === "renovacao_em_andamento", "B (webhook ja pago): token avancado");
  ok(GH.disparosRegistrados().length === 1, "B (webhook ja pago): workflow disparado 1x");
}

// ---------------------------------------------------------------------
// CASO C -- 'autorizada' + cobranca vinculada + venceu + Woovi NAO COMPLETED
//           => EXPIRAR token + LIBERAR acesso, cobranca fica 'pendente'
// ---------------------------------------------------------------------
async function casoC_naoPago() {
  resetarTudo();
  T._seed([{ id: "tk-C", estado: "autorizada", operacao_id: "op-C", expira_em: H_ATRAS }]);
  C._seed([{ operacao_id: "op-C", status: "pendente", valor_esperado_centavos: 3500 }]);
  OP._definir("op-C", { outcome: "success", status: "ACTIVE", amountCentavos: null });

  await run();

  ok(T._all().find((t) => t.id === "tk-C").estado === "expirada", "C: token 'autorizada' -> 'expirada' (acesso liberado)");
  ok(C._all().find((c) => c.operacao_id === "op-C").status === "pendente", "C: cobranca NAO e' expirada (fica 'pendente' pro Caso D)");
  ok(CV.acionamentos().length === 0, "C: NAO transfere (nao bloqueia o proximo 'quero renovar' do cliente)");
  ok(
    WA.mensagensEnviadas().filter((m) => m.texto === MENSAGEM_RENOVACAO_EXPIRADA_SEM_PAGAMENTO).length === 1,
    "C: cliente avisado 1x com a mensagem fixa de expiracao",
  );
  ok(GH.disparosRegistrados().length === 0, "C: nenhum workflow disparado");
}
async function casoC_concorrencia() {
  resetarTudo();
  T._seed([{ id: "tk-Cc", estado: "autorizada", operacao_id: "op-Cc", expira_em: H_ATRAS }]);
  C._seed([{ operacao_id: "op-Cc", status: "pendente", valor_esperado_centavos: 3500 }]);
  OP._definir("op-Cc", { outcome: "success", status: "ACTIVE", amountCentavos: null });

  await Promise.all([run(), run()]);

  ok(T._all().find((t) => t.id === "tk-Cc").estado === "expirada", "C concorrencia: token 'expirada' (consistente)");
  ok(C._all().find((c) => c.operacao_id === "op-Cc").status === "pendente", "C concorrencia: cobranca intocada");
  ok(
    WA.mensagensEnviadas().filter((m) => m.texto === MENSAGEM_RENOVACAO_EXPIRADA_SEM_PAGAMENTO).length === 1,
    "C concorrencia: cliente avisado EXATAMENTE 1x",
  );
}

// ---------------------------------------------------------------------
// CASO E -- Woovi COMPLETED com valor DIVERGENTE => marca divergente,
//           libera acesso, transfere (ha' dinheiro a conciliar)
// ---------------------------------------------------------------------
async function casoE_divergente() {
  resetarTudo();
  T._seed([{ id: "tk-E", estado: "autorizada", operacao_id: "op-E", expira_em: H_ATRAS }]);
  C._seed([{ operacao_id: "op-E", status: "pendente", valor_esperado_centavos: 3500 }]);
  OP._definir("op-E", { outcome: "success", status: "COMPLETED", amountCentavos: 3499 }); // diverge

  await run();

  ok(C._all().find((c) => c.operacao_id === "op-E").status === "valor_divergente", "E: cobranca -> 'valor_divergente' (nunca 'pago' por aproximacao)");
  ok(T._all().find((t) => t.id === "tk-E").estado === "expirada", "E: token liberado ('expirada')");
  ok(CV.acionamentos().length === 1 && CV.acionamentos()[0].motivo === "renovacao:valor_divergente_reconsulta", "E: transferencia acionada (motivo divergencia)");
  ok(GH.disparosRegistrados().length === 0, "E: NENHUM workflow disparado (valor nao confere)");
}

// ---------------------------------------------------------------------
// CASO D -- rede de seguranca de dinheiro
// ---------------------------------------------------------------------
async function casoD_pagoOrfao() {
  // token JA terminal (expirada), cobranca 'pago', sem renovacao concluida
  resetarTudo();
  T._seed([{ id: "tk-D1", estado: "expirada", operacao_id: "op-D1", expira_em: H_ATRAS, renovacao_concluida_em: null }]);
  C._seed([{ operacao_id: "op-D1", status: "pago", valor_esperado_centavos: 3500 }]);

  await run();

  ok(T._all().find((t) => t.id === "tk-D1").renovacao_concluida_em !== null, "D pago-orfao: ciclo marcado como encerrado (nao reprocessa)");
  ok(CV.acionamentos().length === 1 && CV.acionamentos()[0].motivo === "renovacao:pagamento_apos_expiracao", "D pago-orfao: transferido pra atendente concluir");
  ok(NT.notificacoes().length === 1, "D pago-orfao: Jose avisado 1x");

  await run(); // idempotencia
  ok(CV.acionamentos().length === 1, "D pago-orfao: 2a execucao NAO transfere de novo (renovacao_concluida_em preenchido)");
}
async function casoD_webhookAtrasado() {
  // O Caso C ja expirou o token; DEPOIS o pagamento cai na Woovi.
  // Criterio critico: pagamento registrado, renovacao entregue a humano,
  // NADA perdido.
  resetarTudo();
  T._seed([{ id: "tk-D2", estado: "expirada", operacao_id: "op-D2", expira_em: H_ATRAS, renovacao_concluida_em: null }]);
  C._seed([{ operacao_id: "op-D2", status: "pendente", valor_esperado_centavos: 3500 }]);
  OP._definir("op-D2", { outcome: "success", status: "COMPLETED", amountCentavos: 3500 }); // pagou depois

  await run();

  ok(C._all().find((c) => c.operacao_id === "op-D2").status === "pago", "D webhook-atrasado: pagamento REGISTRADO ('pago') -- nunca perdido");
  ok(T._all().find((t) => t.id === "tk-D2").renovacao_concluida_em !== null, "D webhook-atrasado: ciclo encerrado");
  ok(CV.acionamentos().length === 1 && CV.acionamentos()[0].motivo === "renovacao:pagamento_apos_expiracao", "D webhook-atrasado: transferido pra atendente aplicar a renovacao");
  ok(GH.disparosRegistrados().length === 0, "D webhook-atrasado: NAO dispara workflow (token expirado -- humano aplica)");

  await run(); // idempotencia
  ok(CV.acionamentos().length === 1, "D webhook-atrasado: 2a execucao no-op");
}
async function casoD_concorrencia() {
  resetarTudo();
  T._seed([{ id: "tk-Dc", estado: "expirada", operacao_id: "op-Dc", expira_em: H_ATRAS, renovacao_concluida_em: null }]);
  C._seed([{ operacao_id: "op-Dc", status: "pago", valor_esperado_centavos: 3500 }]);

  await Promise.all([run(), run(), run()]);

  ok(CV.acionamentos().length === 1, "D concorrencia: 3 watchdogs -> transferencia EXATAMENTE 1x");
  ok(NT.notificacoes().length === 1, "D concorrencia: Jose avisado EXATAMENTE 1x");
}
async function casoD_housekeeping() {
  // cobranca 'pendente', token terminal, Woovi NAO COMPLETED, passou a
  // carencia de 24h -> cobranca vira 'expirada' (housekeeping, sem dinheiro).
  resetarTudo();
  T._seed([{ id: "tk-D3", estado: "expirada", operacao_id: "op-D3", expira_em: DIAS2_ATRAS, renovacao_concluida_em: null }]);
  C._seed([{ operacao_id: "op-D3", status: "pendente", valor_esperado_centavos: 3500 }]);
  OP._definir("op-D3", { outcome: "success", status: "EXPIRED", amountCentavos: null });

  await run();
  ok(C._all().find((c) => c.operacao_id === "op-D3").status === "expirada", "D housekeeping: cobranca 'pendente' -> 'expirada' apos carencia de 24h");
  ok(CV.acionamentos().length === 0, "D housekeeping: nenhuma transferencia (sem dinheiro)");
}
async function casoD_housekeeping_dentroDaCarencia() {
  // mesma coisa, mas expira_em ha' so' 1h -> NAO expira a cobranca ainda
  resetarTudo();
  T._seed([{ id: "tk-D4", estado: "expirada", operacao_id: "op-D4", expira_em: H_ATRAS, renovacao_concluida_em: null }]);
  C._seed([{ operacao_id: "op-D4", status: "pendente", valor_esperado_centavos: 3500 }]);
  OP._definir("op-D4", { outcome: "success", status: "ACTIVE", amountCentavos: null });

  await run();
  ok(C._all().find((c) => c.operacao_id === "op-D4").status === "pendente", "D housekeeping: dentro da carencia -> cobranca continua 'pendente'");
}

// ---------------------------------------------------------------------
// LOTE -- espelhos de B e C
// ---------------------------------------------------------------------
async function lote_B_recuperar() {
  resetarTudo();
  L._seed([{ grupo_id: "gp-B", estado: "autorizada", operacao_id: "op-LB", expira_em: H_ATRAS }]);
  C._seed([{ operacao_id: "op-LB", status: "pendente", valor_esperado_centavos: 7000 }]);
  OP._definir("op-LB", { outcome: "success", status: "COMPLETED", amountCentavos: 7000 });

  await run();
  ok(L._all().find((l) => l.grupo_id === "gp-B").estado === "renovacao_em_andamento", "lote B: lote 'autorizada' -> 'renovacao_em_andamento'");
  ok(C._all().find((c) => c.operacao_id === "op-LB").status === "pago", "lote B: cobranca 'pago'");
  ok(GH.disparosRegistrados().length === 1, "lote B: workflow disparado 1x");
}
async function lote_C_naoPago() {
  resetarTudo();
  L._seed([{ grupo_id: "gp-C", estado: "autorizada", operacao_id: "op-LC", expira_em: H_ATRAS }]);
  C._seed([{ operacao_id: "op-LC", status: "pendente", valor_esperado_centavos: 7000 }]);
  OP._definir("op-LC", { outcome: "success", status: "ACTIVE", amountCentavos: null });

  await run();
  ok(L._all().find((l) => l.grupo_id === "gp-C").estado === "expirada", "lote C: lote -> 'expirada' (acessos liberados)");
  ok(C._all().find((c) => c.operacao_id === "op-LC").status === "pendente", "lote C: cobranca intocada");
  ok(CV.acionamentos().length === 0, "lote C: nao transfere");
  ok(
    WA.mensagensEnviadas().filter((m) => m.texto === MENSAGEM_RENOVACAO_EXPIRADA_SEM_PAGAMENTO).length === 1,
    "lote C: cliente avisado 1x",
  );
}

// ---------------------------------------------------------------------
async function vazio() {
  resetarTudo();
  const resp = await run();
  const body = await resp.json();
  ok(body.outcome === "nenhuma_presa", "vazio: nada preso -> 'nenhuma_presa'");
}

await casoA_individual();
await casoA_lote();
await casoB_recuperar();
await casoB_concorrencia();
await casoB_webhookJaMarcouPago();
await casoC_naoPago();
await casoC_concorrencia();
await casoE_divergente();
await casoD_pagoOrfao();
await casoD_webhookAtrasado();
await casoD_concorrencia();
await casoD_housekeeping();
await casoD_housekeeping_dentroDaCarencia();
await lote_B_recuperar();
await lote_C_naoPago();
await vazio();

console.log(`\n${falhas === 0 ? "TODOS OS TESTES PASSARAM" : `${falhas} FALHA(S)`}`);
process.exit(falhas === 0 ? 0 : 1);
