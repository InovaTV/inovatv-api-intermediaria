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
// Camada 3 -- reconciliacao ANTECIPADA (dentro da janela de 2h)
const MIN10_ATRAS = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // criado ha' 10min (> piso de 5min)
const MIN2_ATRAS = new Date(Date.now() - 2 * 60 * 1000).toISOString(); // criado ha' 2min (< piso de 5min -> cedo demais)
const FUTURO_2H = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(); // expira_em ainda no futuro

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
// CASO C -- 'autorizada' + cobranca vinculada + venceu + Woovi confirmou
//           status TERMINAL sem pagamento (EXPIRED)
//           => EXPIRAR token + LIBERAR acesso, cobranca fica 'pendente'.
//   (Split EXPIRED/ACTIVE 2026-09-07: SO' EXPIRED chega aqui. ACTIVE ->
//    ramo 'cobranca_ativa', mais abaixo -- NAO libera.)
// ---------------------------------------------------------------------
async function casoC_naoPago() {
  resetarTudo();
  T._seed([{ id: "tk-C", estado: "autorizada", operacao_id: "op-C", expira_em: H_ATRAS }]);
  C._seed([{ operacao_id: "op-C", status: "pendente", valor_esperado_centavos: 3500 }]);
  OP._definir("op-C", { outcome: "success", status: "EXPIRED", amountCentavos: null });

  await run();

  ok(T._all().find((t) => t.id === "tk-C").estado === "expirada", "C (EXPIRED): token 'autorizada' -> 'expirada' (acesso liberado)");
  ok(C._all().find((c) => c.operacao_id === "op-C").status === "pendente", "C (EXPIRED): cobranca NAO e' expirada (fica 'pendente' pro Caso D)");
  ok(CV.acionamentos().length === 0, "C (EXPIRED): NAO transfere (nao bloqueia o proximo 'quero renovar' do cliente)");
  ok(
    WA.mensagensEnviadas().filter((m) => m.texto === MENSAGEM_RENOVACAO_EXPIRADA_SEM_PAGAMENTO).length === 1,
    "C (EXPIRED): cliente avisado 1x com a mensagem fixa de expiracao",
  );
  ok(GH.disparosRegistrados().length === 0, "C (EXPIRED): nenhum workflow disparado");
}
async function casoC_concorrencia() {
  resetarTudo();
  T._seed([{ id: "tk-Cc", estado: "autorizada", operacao_id: "op-Cc", expira_em: H_ATRAS }]);
  C._seed([{ operacao_id: "op-Cc", status: "pendente", valor_esperado_centavos: 3500 }]);
  OP._definir("op-Cc", { outcome: "success", status: "EXPIRED", amountCentavos: null });

  await Promise.all([run(), run()]);

  ok(T._all().find((t) => t.id === "tk-Cc").estado === "expirada", "C concorrencia (EXPIRED): token 'expirada' (consistente)");
  ok(C._all().find((c) => c.operacao_id === "op-Cc").status === "pendente", "C concorrencia (EXPIRED): cobranca intocada");
  ok(
    WA.mensagensEnviadas().filter((m) => m.texto === MENSAGEM_RENOVACAO_EXPIRADA_SEM_PAGAMENTO).length === 1,
    "C concorrencia (EXPIRED): cliente avisado EXATAMENTE 1x",
  );
}
async function casoC_status_terminal_variantes() {
  // Outros estados explicitamente terminais tambem liberam (allowlist).
  for (const st of ["expired", "CANCELLED", "REFUNDED"]) {
    resetarTudo();
    T._seed([{ id: "tk-Cv", estado: "autorizada", operacao_id: "op-Cv", expira_em: H_ATRAS }]);
    C._seed([{ operacao_id: "op-Cv", status: "pendente", valor_esperado_centavos: 3500 }]);
    OP._definir("op-Cv", { outcome: "success", status: st, amountCentavos: null });
    await run();
    ok(T._all().find((t) => t.id === "tk-Cv").estado === "expirada", `C terminal '${st}': token liberado ('expirada')`);
  }
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
  OP._definir("op-LC", { outcome: "success", status: "EXPIRED", amountCentavos: null });

  await run();
  ok(L._all().find((l) => l.grupo_id === "gp-C").estado === "expirada", "lote C (EXPIRED): lote -> 'expirada' (acessos liberados)");
  ok(C._all().find((c) => c.operacao_id === "op-LC").status === "pendente", "lote C (EXPIRED): cobranca intocada");
  ok(CV.acionamentos().length === 0, "lote C (EXPIRED): nao transfere");
  ok(
    WA.mensagensEnviadas().filter((m) => m.texto === MENSAGEM_RENOVACAO_EXPIRADA_SEM_PAGAMENTO).length === 1,
    "lote C (EXPIRED): cliente avisado 1x",
  );
}

// ---------------------------------------------------------------------
// CAMADA 3 -- reconciliacao ANTECIPADA (dentro da janela de 2h)
//   COMPLETED + valor exato -> recupera pelo MESMO nucleo do fluxo normal
//   qualquer outro resultado -> NO-OP ABSOLUTO (nunca expira/cancela/diverge)
// ---------------------------------------------------------------------
async function c3_recupera_individual() {
  resetarTudo();
  T._seed([{ id: "tk-C3a", estado: "autorizada", operacao_id: "op-C3a", expira_em: FUTURO_2H, criado_em: MIN10_ATRAS }]);
  C._seed([{ operacao_id: "op-C3a", status: "pendente", valor_esperado_centavos: 3500 }]);
  OP._definir("op-C3a", { outcome: "success", status: "COMPLETED", amountCentavos: 3500 });

  await run();

  ok(C._all().find((c) => c.operacao_id === "op-C3a").status === "pago", "C3 recupera ind: cobranca 'pendente' -> 'pago'");
  ok(
    T._all().find((t) => t.id === "tk-C3a").estado === "renovacao_em_andamento",
    "C3 recupera ind: token 'autorizada' -> 'renovacao_em_andamento' ANTES das 2h",
  );
  ok(
    GH.disparosRegistrados().length === 1 && GH.disparosRegistrados()[0] === "op-C3a",
    "C3 recupera ind: workflow disparado exatamente 1x (fluxo normal, executarRecuperacao)",
  );
  ok(CV.acionamentos().length === 0, "C3 recupera ind: NENHUMA transferencia");
  ok(WA.mensagensEnviadas().length === 0, "C3 recupera ind: nenhuma mensagem fixa ao cliente (renovacao segue normal)");
  ok(MA.mensagens().filter((m) => m.origem === "sistema").length === 1, "C3 recupera ind: 1 nota de sistema (so' o vencedor da CAS)");

  await run(); // idempotencia
  ok(GH.disparosRegistrados().length === 1, "C3 recupera ind: 2a execucao NAO redispara (token saiu de 'autorizada')");
}
async function c3_recupera_lote() {
  resetarTudo();
  L._seed([{ grupo_id: "gp-C3a", estado: "autorizada", operacao_id: "op-LC3a", expira_em: FUTURO_2H, criado_em: MIN10_ATRAS }]);
  C._seed([{ operacao_id: "op-LC3a", status: "pendente", valor_esperado_centavos: 7000 }]);
  OP._definir("op-LC3a", { outcome: "success", status: "COMPLETED", amountCentavos: 7000 });

  await run();

  ok(L._all().find((l) => l.grupo_id === "gp-C3a").estado === "renovacao_em_andamento", "C3 recupera lote: lote 'autorizada' -> 'renovacao_em_andamento' ANTES das 2h");
  ok(C._all().find((c) => c.operacao_id === "op-LC3a").status === "pago", "C3 recupera lote: cobranca 'pago'");
  ok(GH.disparosRegistrados().length === 1, "C3 recupera lote: workflow disparado 1x");
  ok(CV.acionamentos().length === 0, "C3 recupera lote: nenhuma transferencia");
}
async function c3_ainda_nao_pago() {
  resetarTudo();
  T._seed([{ id: "tk-C3b", estado: "autorizada", operacao_id: "op-C3b", expira_em: FUTURO_2H, criado_em: MIN10_ATRAS }]);
  C._seed([{ operacao_id: "op-C3b", status: "pendente", valor_esperado_centavos: 3500 }]);
  OP._definir("op-C3b", { outcome: "success", status: "ACTIVE", amountCentavos: null });

  await run();

  ok(C._all().find((c) => c.operacao_id === "op-C3b").status === "pendente", "C3 nao pago: cobranca INTOCADA ('pendente')");
  ok(T._all().find((t) => t.id === "tk-C3b").estado === "autorizada", "C3 nao pago: token INTOCADO ('autorizada') -- NAO expira");
  ok(GH.disparosRegistrados().length === 0, "C3 nao pago: nenhum workflow");
  ok(CV.acionamentos().length === 0, "C3 nao pago: nenhuma transferencia");
  ok(WA.mensagensEnviadas().length === 0, "C3 nao pago: nenhuma mensagem ao cliente");
  ok(MA.mensagens().length === 0, "C3 nao pago: nenhuma nota de sistema");

  await run();
  ok(C._all().find((c) => c.operacao_id === "op-C3b").status === "pendente", "C3 nao pago: 2a execucao segue no-op");
}
async function c3_cedo_demais() {
  resetarTudo();
  T._seed([{ id: "tk-C3c", estado: "autorizada", operacao_id: "op-C3c", expira_em: FUTURO_2H, criado_em: MIN2_ATRAS }]);
  C._seed([{ operacao_id: "op-C3c", status: "pendente", valor_esperado_centavos: 3500 }]);
  OP._definir("op-C3c", { outcome: "success", status: "COMPLETED", amountCentavos: 3500 });

  await run();

  ok(!OP.consultasRegistradas().includes("op-C3c"), "C3 cedo demais: Woovi NUNCA consultada (criado ha' < 5min)");
  ok(T._all().find((t) => t.id === "tk-C3c").estado === "autorizada", "C3 cedo demais: token INTOCADO");
  ok(C._all().find((c) => c.operacao_id === "op-C3c").status === "pendente", "C3 cedo demais: cobranca INTOCADA");
  ok(GH.disparosRegistrados().length === 0, "C3 cedo demais: nenhum workflow");
}
async function c3_ja_expirado_fora_da_query() {
  resetarTudo();
  // token VENCIDO (expira_em no passado): pertence ao sweep de expira_em (Caso B/C/E),
  // NUNCA a' Camada 3.
  T._seed([{ id: "tk-C3d", estado: "autorizada", operacao_id: "op-C3d", expira_em: H_ATRAS, criado_em: MIN10_ATRAS }]);
  const naJanela = await T.buscarAutorizacoesVinculadasAindaNaJanela(5);
  ok(naJanela.length === 0, "C3 ja expirado: token vencido NAO entra na query da Camada 3");

  // e o sweep de expira_em continua funcionando normal, sem caminho duplo:
  C._seed([{ operacao_id: "op-C3d", status: "pendente", valor_esperado_centavos: 3500 }]);
  OP._definir("op-C3d", { outcome: "success", status: "COMPLETED", amountCentavos: 3500 });
  await run();
  ok(T._all().find((t) => t.id === "tk-C3d").estado === "renovacao_em_andamento", "C3 ja expirado: recuperado pelo sweep de expira_em (Caso B), sem regressao");
  ok(GH.disparosRegistrados().length === 1, "C3 ja expirado: workflow 1x (nao ha' caminho duplo)");
}
async function c3_valor_divergente_sem_efeito() {
  resetarTudo();
  T._seed([{ id: "tk-C3e", estado: "autorizada", operacao_id: "op-C3e", expira_em: FUTURO_2H, criado_em: MIN10_ATRAS }]);
  C._seed([{ operacao_id: "op-C3e", status: "pendente", valor_esperado_centavos: 3500 }]);
  OP._definir("op-C3e", { outcome: "success", status: "COMPLETED", amountCentavos: 3499 }); // diverge

  await run();

  ok(
    C._all().find((c) => c.operacao_id === "op-C3e").status === "pendente",
    "C3 divergente: cobranca INTOCADA ('pendente') -- Camada 3 NAO marca 'valor_divergente' (isso e' do Caso E)",
  );
  ok(T._all().find((t) => t.id === "tk-C3e").estado === "autorizada", "C3 divergente: token INTOCADO ('autorizada')");
  ok(GH.disparosRegistrados().length === 0, "C3 divergente: nenhum workflow");
  ok(CV.acionamentos().length === 0, "C3 divergente: nenhuma transferencia");
  ok(MA.mensagens().length === 0, "C3 divergente: nenhuma nota de sistema");
}
async function c3_concorrencia() {
  resetarTudo();
  T._seed([{ id: "tk-C3f", estado: "autorizada", operacao_id: "op-C3f", expira_em: FUTURO_2H, criado_em: MIN10_ATRAS }]);
  C._seed([{ operacao_id: "op-C3f", status: "pendente", valor_esperado_centavos: 3500 }]);
  OP._definir("op-C3f", { outcome: "success", status: "COMPLETED", amountCentavos: 3500 });

  await Promise.all([run(), run(), run()]); // 3 watchdogs concorrentes

  ok(GH.disparosRegistrados().length === 1, "C3 concorrencia: 3 watchdogs -> workflow disparado EXATAMENTE 1x");
  ok(T._all().find((t) => t.id === "tk-C3f").estado === "renovacao_em_andamento", "C3 concorrencia: token consistente");
  ok(C._all().find((c) => c.operacao_id === "op-C3f").status === "pago", "C3 concorrencia: cobranca 'pago' (nunca perdida)");
  ok(
    MA.mensagens().filter((m) => m.origem === "sistema").length === 1,
    "C3 concorrencia: no maximo 1 nota de sistema (so' o vencedor da CAS)",
  );
}
async function c3_corrida_com_webhook() {
  resetarTudo();
  T._seed([{ id: "tk-C3g", estado: "autorizada", operacao_id: "op-C3g", expira_em: FUTURO_2H, criado_em: MIN10_ATRAS }]);
  C._seed([{ operacao_id: "op-C3g", status: "pendente", valor_esperado_centavos: 3500 }]);
  OP._definir("op-C3g", { outcome: "success", status: "COMPLETED", amountCentavos: 3500 });
  // Simula o WEBHOOK real ganhando a corrida enquanto a Camada 3 "espera" a
  // Woovi: marca 'pago' + avanca o token + dispara -- exatamente o
  // openpix-webhook. reconciliarSePago segue, mas reivindicarInicio devolve
  // null -> 'ja_em_andamento' -> Camada 3 nao faz nada.
  OP._aoConsultar(async () => {
    await C.marcarCobrancaComoPaga("op-C3g");
    await T.reivindicarInicioRenovacao("op-C3g");
    await GH.dispararWorkflowRenovacaoSigma("op-C3g");
  });

  await run();

  ok(GH.disparosRegistrados().length === 1, "C3 corrida-webhook: workflow disparado EXATAMENTE 1x (webhook ganhou; Camada 3 nao redispara)");
  ok(T._all().find((t) => t.id === "tk-C3g").estado === "renovacao_em_andamento", "C3 corrida-webhook: token consistente");
  ok(C._all().find((c) => c.operacao_id === "op-C3g").status === "pago", "C3 corrida-webhook: cobranca 'pago' (nunca perdida)");
  ok(
    MA.mensagens().filter((m) => m.origem === "sistema").length === 0,
    "C3 corrida-webhook: Camada 3 NAO emite nota (recebeu 'ja_em_andamento')",
  );
}
async function c3_woovi_indisponivel() {
  resetarTudo();
  T._seed([{ id: "tk-C3h", estado: "autorizada", operacao_id: "op-C3h", expira_em: FUTURO_2H, criado_em: MIN10_ATRAS }]);
  C._seed([{ operacao_id: "op-C3h", status: "pendente", valor_esperado_centavos: 3500 }]);
  OP._definir("op-C3h", { outcome: "unavailable" });

  await run();

  ok(T._all().find((t) => t.id === "tk-C3h").estado === "autorizada", "C3 woovi indisponivel: token INTOCADO");
  ok(C._all().find((c) => c.operacao_id === "op-C3h").status === "pendente", "C3 woovi indisponivel: cobranca INTOCADA");
  ok(GH.disparosRegistrados().length === 0, "C3 woovi indisponivel: nenhum workflow");
  ok(CV.acionamentos().length === 0, "C3 woovi indisponivel: nenhuma transferencia");
  ok(MA.mensagens().length === 0, "C3 woovi indisponivel: nenhuma nota de sistema");

  // proximo ciclo tenta de novo (token continua elegivel)
  OP._definir("op-C3h", { outcome: "success", status: "COMPLETED", amountCentavos: 3500 });
  await run();
  ok(T._all().find((t) => t.id === "tk-C3h").estado === "renovacao_em_andamento", "C3 woovi indisponivel: proximo ciclo recupera quando a Woovi volta");
}

// ---------------------------------------------------------------------
// JANELA DE 5 MIN PONTA A PONTA (2026-09-07)
//   cobranca inexistente (404 na Woovi) -> dupla confirmacao antes de liberar
//   Woovi indisponivel (unavailable)     -> NUNCA libera; backstop de 24h
//   EXPIRED                               -> CASO C (libera)
// ---------------------------------------------------------------------
const MIN1_ATRAS = new Date(Date.now() - 60 * 1000).toISOString(); // < gap de 4min

async function nf_1o_ciclo_marca_sem_liberar() {
  resetarTudo();
  T._seed([{ id: "tk-NF1", estado: "autorizada", operacao_id: "op-NF1", expira_em: H_ATRAS }]);
  OP._definir("op-NF1", { outcome: "not_found" });

  await run();

  const t = T._all().find((x) => x.id === "tk-NF1");
  ok(t.estado === "autorizada", "NF 1o ciclo: token INTOCADO ('autorizada') -- nao libera na 1a deteccao");
  ok(t.cobranca_ausente_em !== null, "NF 1o ciclo: marcador cobranca_ausente_em gravado");
  ok(WA.mensagensEnviadas().length === 0, "NF 1o ciclo: nenhuma mensagem ao cliente");
  ok(CV.acionamentos().length === 0, "NF 1o ciclo: nenhuma transferencia");
  ok(GH.disparosRegistrados().length === 0, "NF 1o ciclo: nenhum workflow");
  ok(MA.mensagens().filter((m) => m.origem === "sistema").length === 1, "NF 1o ciclo: 1 nota de sistema (1a deteccao)");
}

async function nf_2o_ciclo_libera() {
  resetarTudo();
  T._seed([
    { id: "tk-NF2", estado: "autorizada", operacao_id: "op-NF2", expira_em: H_ATRAS, cobranca_ausente_em: MIN10_ATRAS },
  ]);
  OP._definir("op-NF2", { outcome: "not_found" });

  await run();

  ok(T._all().find((x) => x.id === "tk-NF2").estado === "expirada", "NF 2o ciclo: token 'autorizada' -> 'expirada' (acesso liberado)");
  ok(
    WA.mensagensEnviadas().filter((m) => m.texto === MENSAGEM_RENOVACAO_EXPIRADA_SEM_PAGAMENTO).length === 1,
    "NF 2o ciclo: cliente avisado 1x com a mensagem fixa de expiracao",
  );
  ok(CV.acionamentos().length === 0, "NF 2o ciclo: NAO transfere (nao ha' dinheiro -- a cobranca nao existe)");
  ok(GH.disparosRegistrados().length === 0, "NF 2o ciclo: nenhum workflow");

  await run(); // idempotencia
  ok(
    WA.mensagensEnviadas().filter((m) => m.texto === MENSAGEM_RENOVACAO_EXPIRADA_SEM_PAGAMENTO).length === 1,
    "NF 2o ciclo: 2a execucao e' no-op (token nao esta mais 'autorizada')",
  );
}

async function nf_2o_ciclo_cedo_demais_nao_libera() {
  resetarTudo();
  T._seed([
    { id: "tk-NF3", estado: "autorizada", operacao_id: "op-NF3", expira_em: H_ATRAS, cobranca_ausente_em: MIN1_ATRAS },
  ]);
  OP._definir("op-NF3", { outcome: "not_found" });

  await run();

  ok(T._all().find((x) => x.id === "tk-NF3").estado === "autorizada", "NF cedo demais: marcador recente (< 4min) -> NAO libera ainda");
  ok(WA.mensagensEnviadas().length === 0, "NF cedo demais: nenhuma mensagem ao cliente");
}

async function nf_marcador_limpo_por_outro_resultado() {
  resetarTudo();
  // Tinha marcador (404 anterior), mas agora a Woovi diz 'unavailable'
  // DENTRO da carencia de 24h -> o 404 era transitorio: limpa o marcador,
  // nada e' liberado, sem backstop.
  T._seed([
    { id: "tk-NF4", estado: "autorizada", operacao_id: "op-NF4", expira_em: H_ATRAS, cobranca_ausente_em: MIN10_ATRAS },
  ]);
  C._seed([{ operacao_id: "op-NF4", status: "pendente", valor_esperado_centavos: 3500, criado_em: H_ATRAS }]);
  OP._definir("op-NF4", { outcome: "unavailable" });

  await run();

  const t = T._all().find((x) => x.id === "tk-NF4");
  ok(t.estado === "autorizada", "NF marcador limpo: token INTOCADO (unavailable nunca libera)");
  ok(t.cobranca_ausente_em === null, "NF marcador limpo: cobranca_ausente_em zerado (404 anterior era transitorio)");
  ok(CV.acionamentos().length === 0, "NF marcador limpo: nenhuma transferencia (dentro da carencia de 24h)");
}

async function indefinido_dentro_24h_noop() {
  resetarTudo();
  T._seed([{ id: "tk-IN1", estado: "autorizada", operacao_id: "op-IN1", expira_em: H_ATRAS }]);
  C._seed([{ operacao_id: "op-IN1", status: "pendente", valor_esperado_centavos: 3500, criado_em: H_ATRAS }]);
  OP._definir("op-IN1", { outcome: "unavailable" });

  await run();

  ok(T._all().find((x) => x.id === "tk-IN1").estado === "autorizada", "indefinido < 24h: token INTOCADO -- Woovi indisponivel NUNCA libera");
  ok(CV.acionamentos().length === 0, "indefinido < 24h: nenhuma transferencia");
  ok(MA.mensagens().length === 0, "indefinido < 24h: nenhuma nota de sistema");
  ok(WA.mensagensEnviadas().length === 0, "indefinido < 24h: nenhuma mensagem ao cliente");
}

async function indefinido_apos_24h_backstop() {
  resetarTudo();
  T._seed([{ id: "tk-IN2", estado: "autorizada", operacao_id: "op-IN2", expira_em: DIAS2_ATRAS }]);
  C._seed([{ operacao_id: "op-IN2", status: "pendente", valor_esperado_centavos: 3500, criado_em: DIAS2_ATRAS }]);
  OP._definir("op-IN2", { outcome: "unavailable" });

  await run();

  ok(
    T._all().find((x) => x.id === "tk-IN2").estado === "renovacao_indeterminada",
    "backstop 24h: token 'autorizada' -> 'renovacao_indeterminada' (NUNCA 'expirada' em silencio)",
  );
  ok(
    CV.acionamentos().length === 1 && CV.acionamentos()[0].motivo === "renovacao:pagamento_nao_verificavel",
    "backstop 24h: transferencia humana acionada (pagamento nao verificavel)",
  );
  ok(NT.notificacoes().length === 1, "backstop 24h: Jose avisado 1x");
  ok(GH.disparosRegistrados().length === 0, "backstop 24h: nenhum workflow");

  await run(); // idempotencia
  ok(CV.acionamentos().length === 1, "backstop 24h: 2a execucao NAO transfere de novo");
}

// ---------------------------------------------------------------------
// SPLIT EXPIRED / ACTIVE (2026-09-07)
//   A janela de 5min NUNCA e' prova de que a cobranca Woovi expirou -- so'
//   o STATUS efetivo da Woovi decide. ACTIVE apos o expira_em do token NAO
//   libera; aguarda o proximo ciclo. Backstop de 24h (criado_em) so' em
//   anomalia (ACTIVE prolongado) -> encerra + transfere, nunca em silencio.
// ---------------------------------------------------------------------
async function active_apos_expiracao_nao_libera() {
  resetarTudo();
  T._seed([{ id: "tk-AC1", estado: "autorizada", operacao_id: "op-AC1", expira_em: H_ATRAS }]);
  C._seed([{ operacao_id: "op-AC1", status: "pendente", valor_esperado_centavos: 3500, criado_em: H_ATRAS }]);
  OP._definir("op-AC1", { outcome: "success", status: "ACTIVE", amountCentavos: null });

  await run();

  ok(T._all().find((t) => t.id === "tk-AC1").estado === "autorizada", "ACTIVE apos expiracao: token INTOCADO ('autorizada') -- NAO vira 'nao pago'");
  ok(C._all().find((c) => c.operacao_id === "op-AC1").status === "pendente", "ACTIVE apos expiracao: cobranca intocada");
  ok(WA.mensagensEnviadas().length === 0, "ACTIVE apos expiracao: nenhuma mensagem ao cliente");
  ok(CV.acionamentos().length === 0, "ACTIVE apos expiracao: nenhuma transferencia");
  ok(MA.mensagens().length === 0, "ACTIVE apos expiracao: nenhuma nota de sistema (sem spam)");
  ok(GH.disparosRegistrados().length === 0, "ACTIVE apos expiracao: nenhum workflow");
}

async function active_ciclo_seguinte_continua_aguardando() {
  resetarTudo();
  T._seed([{ id: "tk-AC2", estado: "autorizada", operacao_id: "op-AC2", expira_em: H_ATRAS }]);
  C._seed([{ operacao_id: "op-AC2", status: "pendente", valor_esperado_centavos: 3500, criado_em: H_ATRAS }]);
  OP._definir("op-AC2", { outcome: "success", status: "ACTIVE", amountCentavos: null });

  await run();
  await run();
  await run(); // varios ciclos, Woovi segue ACTIVE

  ok(T._all().find((t) => t.id === "tk-AC2").estado === "autorizada", "ACTIVE ciclo seguinte: token segue 'autorizada' apos 3 ciclos");
  ok(C._all().find((c) => c.operacao_id === "op-AC2").status === "pendente", "ACTIVE ciclo seguinte: cobranca segue 'pendente'");
  ok(CV.acionamentos().length === 0, "ACTIVE ciclo seguinte: nenhuma transferencia acumulada");
  ok(MA.mensagens().length === 0, "ACTIVE ciclo seguinte: nenhuma nota de sistema acumulada");
}

async function active_depois_expired_libera() {
  resetarTudo();
  T._seed([{ id: "tk-AC3", estado: "autorizada", operacao_id: "op-AC3", expira_em: H_ATRAS }]);
  C._seed([{ operacao_id: "op-AC3", status: "pendente", valor_esperado_centavos: 3500, criado_em: H_ATRAS }]);
  OP._definir("op-AC3", { outcome: "success", status: "ACTIVE", amountCentavos: null });

  await run();
  ok(T._all().find((t) => t.id === "tk-AC3").estado === "autorizada", "ACTIVE->EXPIRED: 1o ciclo (ACTIVE) NAO libera");

  OP._definir("op-AC3", { outcome: "success", status: "EXPIRED", amountCentavos: null }); // Woovi virou o status
  await run();

  ok(T._all().find((t) => t.id === "tk-AC3").estado === "expirada", "ACTIVE->EXPIRED: 2o ciclo (EXPIRED) libera (CASO C)");
  ok(
    WA.mensagensEnviadas().filter((m) => m.texto === MENSAGEM_RENOVACAO_EXPIRADA_SEM_PAGAMENTO).length === 1,
    "ACTIVE->EXPIRED: cliente avisado 1x, so' quando a Woovi confirmou EXPIRED",
  );
  ok(CV.acionamentos().length === 0, "ACTIVE->EXPIRED: nao transfere");
}

async function active_depois_completed_renova_normal() {
  resetarTudo();
  T._seed([{ id: "tk-AC4", estado: "autorizada", operacao_id: "op-AC4", expira_em: H_ATRAS }]);
  C._seed([{ operacao_id: "op-AC4", status: "pendente", valor_esperado_centavos: 3500, criado_em: H_ATRAS }]);
  OP._definir("op-AC4", { outcome: "success", status: "ACTIVE", amountCentavos: null });

  await run();
  ok(T._all().find((t) => t.id === "tk-AC4").estado === "autorizada", "ACTIVE->COMPLETED: 1o ciclo (ACTIVE) NAO libera nem toca a cobranca");
  ok(C._all().find((c) => c.operacao_id === "op-AC4").status === "pendente", "ACTIVE->COMPLETED: 1o ciclo -- cobranca ainda 'pendente'");

  OP._definir("op-AC4", { outcome: "success", status: "COMPLETED", amountCentavos: 3500 }); // pagou
  await run();

  ok(C._all().find((c) => c.operacao_id === "op-AC4").status === "pago", "ACTIVE->COMPLETED: cobranca 'pendente' -> 'pago'");
  ok(T._all().find((t) => t.id === "tk-AC4").estado === "renovacao_em_andamento", "ACTIVE->COMPLETED: token -> 'renovacao_em_andamento' (CASO B, renovacao segue normal)");
  ok(GH.disparosRegistrados().length === 1 && GH.disparosRegistrados()[0] === "op-AC4", "ACTIVE->COMPLETED: workflow disparado exatamente 1x");
  ok(CV.acionamentos().length === 0, "ACTIVE->COMPLETED: nenhuma transferencia");
}

async function active_completed_via_webhook_nao_perde_renovacao() {
  resetarTudo();
  T._seed([{ id: "tk-AC5", estado: "autorizada", operacao_id: "op-AC5", expira_em: H_ATRAS }]);
  C._seed([{ operacao_id: "op-AC5", status: "pendente", valor_esperado_centavos: 3500, criado_em: H_ATRAS }]);
  OP._definir("op-AC5", { outcome: "success", status: "ACTIVE", amountCentavos: null });

  await run(); // watchdog viu ACTIVE, aguardou
  ok(T._all().find((t) => t.id === "tk-AC5").estado === "autorizada", "ACTIVE+webhook: apos reconciliacao com ACTIVE, token segue 'autorizada'");

  // Agora o WEBHOOK real chega com COMPLETED e avanca tudo (openpix-webhook):
  await C.marcarCobrancaComoPaga("op-AC5");
  await T.reivindicarInicioRenovacao("op-AC5");
  await GH.dispararWorkflowRenovacaoSigma("op-AC5");

  ok(T._all().find((t) => t.id === "tk-AC5").estado === "renovacao_em_andamento", "ACTIVE+webhook: webhook avancou o token");
  ok(GH.disparosRegistrados().length === 1, "ACTIVE+webhook: workflow disparado 1x (pelo webhook)");

  await run(); // watchdog roda de novo
  ok(GH.disparosRegistrados().length === 1, "ACTIVE+webhook: watchdog NAO redispara (token nao esta mais 'autorizada')");
  ok(C._all().find((c) => c.operacao_id === "op-AC5").status === "pago", "ACTIVE+webhook: pagamento preservado ('pago') -- renovacao nunca perdida");
}

async function active_persistente_somente_backstop_24h() {
  resetarTudo();
  T._seed([{ id: "tk-AC6", estado: "autorizada", operacao_id: "op-AC6", expira_em: DIAS2_ATRAS }]);
  C._seed([{ operacao_id: "op-AC6", status: "pendente", valor_esperado_centavos: 3500, criado_em: DIAS2_ATRAS }]);
  OP._definir("op-AC6", { outcome: "success", status: "ACTIVE", amountCentavos: null }); // ACTIVE ha' > 24h -- anomalia

  await run();

  ok(
    T._all().find((t) => t.id === "tk-AC6").estado === "renovacao_indeterminada",
    "ACTIVE persistente: apos 24h (criado_em) -> 'renovacao_indeterminada' (encerramento SEGURO, NUNCA 'expirada' em silencio)",
  );
  ok(
    CV.acionamentos().length === 1 && CV.acionamentos()[0].motivo === "renovacao:cobranca_ativa_prolongada",
    "ACTIVE persistente: transferencia humana acionada (motivo proprio 'cobranca_ativa_prolongada')",
  );
  ok(NT.notificacoes().length === 1, "ACTIVE persistente: Jose avisado 1x");
  ok(GH.disparosRegistrados().length === 0, "ACTIVE persistente: nenhum workflow");
  ok(
    WA.mensagensEnviadas().filter((m) => m.texto === MENSAGEM_RENOVACAO_EXPIRADA_SEM_PAGAMENTO).length === 0,
    "ACTIVE persistente: cliente NAO recebe a mensagem de 'expirou sem pagamento' (foi pra humano)",
  );

  await run(); // idempotencia
  ok(CV.acionamentos().length === 1, "ACTIVE persistente: 2a execucao NAO transfere de novo");
}

async function lote_active_apos_expiracao_nao_libera() {
  resetarTudo();
  L._seed([{ grupo_id: "gp-AC", estado: "autorizada", operacao_id: "op-LAC", expira_em: H_ATRAS }]);
  C._seed([{ operacao_id: "op-LAC", status: "pendente", valor_esperado_centavos: 7000, criado_em: H_ATRAS }]);
  OP._definir("op-LAC", { outcome: "success", status: "ACTIVE", amountCentavos: null });

  await run();

  ok(L._all().find((l) => l.grupo_id === "gp-AC").estado === "autorizada", "lote ACTIVE apos expiracao: lote INTOCADO ('autorizada')");
  ok(CV.acionamentos().length === 0, "lote ACTIVE apos expiracao: nenhuma transferencia");
  ok(WA.mensagensEnviadas().length === 0, "lote ACTIVE apos expiracao: nenhuma mensagem ao cliente");
}

async function lote_active_persistente_backstop_24h() {
  resetarTudo();
  L._seed([{ grupo_id: "gp-ACb", estado: "autorizada", operacao_id: "op-LACb", expira_em: DIAS2_ATRAS }]);
  C._seed([{ operacao_id: "op-LACb", status: "pendente", valor_esperado_centavos: 7000, criado_em: DIAS2_ATRAS }]);
  OP._definir("op-LACb", { outcome: "success", status: "ACTIVE", amountCentavos: null });

  await run();

  ok(L._all().find((l) => l.grupo_id === "gp-ACb").estado === "falhou", "lote ACTIVE persistente: apos 24h -> 'falhou' (encerramento seguro)");
  ok(
    CV.acionamentos().length === 1 && CV.acionamentos()[0].motivo === "renovacao_lote:cobranca_ativa_prolongada",
    "lote ACTIVE persistente: transferencia humana acionada",
  );
  ok(NT.notificacoes().length === 1, "lote ACTIVE persistente: Jose avisado 1x");
}

async function lote_nf_2o_ciclo_libera() {
  resetarTudo();
  L._seed([
    { grupo_id: "gp-NF", estado: "autorizada", operacao_id: "op-LNF", expira_em: H_ATRAS, cobranca_ausente_em: MIN10_ATRAS },
  ]);
  OP._definir("op-LNF", { outcome: "not_found" });

  await run();

  ok(L._all().find((l) => l.grupo_id === "gp-NF").estado === "expirada", "lote NF 2o ciclo: lote -> 'expirada' (acessos liberados)");
  ok(
    WA.mensagensEnviadas().filter((m) => m.texto === MENSAGEM_RENOVACAO_EXPIRADA_SEM_PAGAMENTO).length === 1,
    "lote NF 2o ciclo: cliente avisado 1x",
  );
  ok(CV.acionamentos().length === 0, "lote NF 2o ciclo: nao transfere");
}

async function lote_indefinido_apos_24h_backstop() {
  resetarTudo();
  L._seed([{ grupo_id: "gp-IN", estado: "autorizada", operacao_id: "op-LIN", expira_em: DIAS2_ATRAS }]);
  C._seed([{ operacao_id: "op-LIN", status: "pendente", valor_esperado_centavos: 7000, criado_em: DIAS2_ATRAS }]);
  OP._definir("op-LIN", { outcome: "unavailable" });

  await run();

  ok(L._all().find((l) => l.grupo_id === "gp-IN").estado === "falhou", "lote backstop 24h: lote 'autorizada' -> 'falhou'");
  ok(
    CV.acionamentos().length === 1 && CV.acionamentos()[0].motivo === "renovacao_lote:pagamento_nao_verificavel",
    "lote backstop 24h: transferencia humana acionada",
  );
  ok(NT.notificacoes().length === 1, "lote backstop 24h: Jose avisado 1x");
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
await casoC_status_terminal_variantes();
await casoE_divergente();
await casoD_pagoOrfao();
await casoD_webhookAtrasado();
await casoD_concorrencia();
await casoD_housekeeping();
await casoD_housekeeping_dentroDaCarencia();
await lote_B_recuperar();
await lote_C_naoPago();
// Camada 3 -- reconciliacao antecipada
await c3_recupera_individual();
await c3_recupera_lote();
await c3_ainda_nao_pago();
await c3_cedo_demais();
await c3_ja_expirado_fora_da_query();
await c3_valor_divergente_sem_efeito();
await c3_concorrencia();
await c3_corrida_com_webhook();
await c3_woovi_indisponivel();
// Janela de 5min ponta a ponta (2026-09-07)
await nf_1o_ciclo_marca_sem_liberar();
await nf_2o_ciclo_libera();
await nf_2o_ciclo_cedo_demais_nao_libera();
await nf_marcador_limpo_por_outro_resultado();
await indefinido_dentro_24h_noop();
await indefinido_apos_24h_backstop();
await lote_nf_2o_ciclo_libera();
await lote_indefinido_apos_24h_backstop();
// Split EXPIRED / ACTIVE (2026-09-07)
await active_apos_expiracao_nao_libera();
await active_ciclo_seguinte_continua_aguardando();
await active_depois_expired_libera();
await active_depois_completed_renova_normal();
await active_completed_via_webhook_nao_perde_renovacao();
await active_persistente_somente_backstop_24h();
await lote_active_apos_expiracao_nao_libera();
await lote_active_persistente_backstop_24h();
await vazio();

console.log(`\n${falhas === 0 ? "TODOS OS TESTES PASSARAM" : `${falhas} FALHA(S)`}`);
process.exit(falhas === 0 ? 0 : 1);
