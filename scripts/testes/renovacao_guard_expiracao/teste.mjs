// Testes locais de _shared/renovacao_guard_expiracao.ts (Etapa 4,
// 2026-09-15 -- Portal de Renovacao, robustez do fluxo ACEITO/Pix,
// incidente real Flavio Augusto Da Silva). Roda o modulo REAL; banco
// (tokens_renovacao/renovacoes_lote/cobrancas_pix) e Woovi
// (openpix_client) sao fakes em memoria, mesmo padrao ja usado em
// scripts/testes/watchdog_lifecycle/.
//
// Como rodar: npx tsx scripts/testes/renovacao_guard_expiracao/teste.mjs

import { register } from "node:module";
register("./mock-loader.mjs", import.meta.url);

const T = await import("./fake_tokens_renovacao.mjs");
const L = await import("./fake_renovacoes_lote.mjs");
const C = await import("./fake_cobrancas_pix.mjs");
const OP = await import("./fake_openpix_client.mjs");
const guard = await import("../../../supabase/functions/_shared/renovacao_guard_expiracao.ts");

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
}

const AGORA = Date.now();
const VENCIDO = new Date(AGORA - 60 * 1000).toISOString(); // 1min atras
const FUTURO = new Date(AGORA + 5 * 60 * 1000).toISOString(); // 5min a frente

// =======================================================================
// Nada a fazer -- registro null, ou ainda dentro da janela.
// =======================================================================
async function semRegistroAtivo() {
  resetarTudo();
  const r = await guard.resolverTokenParaGuardExpiracao("pub-x", null);
  ok(r === null, "token nulo: retorna null direto, sem nenhuma chamada extra");
  ok(OP.consultasRegistradas().length === 0, "token nulo: nenhuma consulta a Woovi");
}
async function loteSemRegistroAtivo() {
  resetarTudo();
  const r = await guard.resolverLoteParaGuardExpiracao("pub-x", null);
  ok(r === null, "lote nulo: retorna null direto");
}
async function tokenAindaDentroDaJanela() {
  resetarTudo();
  T._seed([{ id: "tk-1", public_id: "pub-1", estado: "aguardando_confirmacao", expira_em: FUTURO }]);
  const token = await T.buscarTokenAtivoPorPublicId("pub-1");
  const r = await guard.resolverTokenParaGuardExpiracao("pub-1", token);
  ok(r?.id === "tk-1" && r.estado === "aguardando_confirmacao", "ainda na janela: retorna inalterado (fast path)");
  ok(OP.consultasRegistradas().length === 0, "ainda na janela: nenhuma chamada a Woovi");
  ok(T._all().find((t) => t.id === "tk-1").estado === "aguardando_confirmacao", "ainda na janela: nada foi fechado no banco");
}
async function tokenExpiraEmInvalidoNuncaFecha() {
  // expira_em NOT NULL no banco -- nunca deveria faltar em producao,
  // mas o guard precisa ser fail-safe mesmo assim (nunca tratar dado
  // invalido/ausente como "vencido").
  resetarTudo();
  T._seed([{ id: "tk-1b", public_id: "pub-1b", estado: "autorizada", operacao_id: "op-1b", expira_em: undefined }]);
  const token = await T.buscarTokenAtivoPorPublicId("pub-1b");
  const r = await guard.resolverTokenParaGuardExpiracao("pub-1b", token);
  ok(r?.id === "tk-1b", "expira_em ausente/invalido: NUNCA tratado como vencido, continua bloqueando");
  ok(OP.consultasRegistradas().length === 0, "expira_em ausente/invalido: nem chega a consultar a Woovi (fast path)");
}

// =======================================================================
// Caso 1 -- 'aguardando_confirmacao' vencido: fecha via CAS, sem Woovi.
// =======================================================================
async function aguardandoVencidoFecha() {
  resetarTudo();
  T._seed([{ id: "tk-2", public_id: "pub-2", estado: "aguardando_confirmacao", expira_em: VENCIDO }]);
  const token = await T.buscarTokenAtivoPorPublicId("pub-2");
  const r = await guard.resolverTokenParaGuardExpiracao("pub-2", token);
  ok(r === null, "aguardando vencido: guard devolve null (nao bloqueia mais)");
  ok(T._all().find((t) => t.id === "tk-2").estado === "expirada", "aguardando vencido: fechado no banco via CAS");
  ok(OP.consultasRegistradas().length === 0, "aguardando vencido: nenhuma consulta a Woovi (nunca ha' cobranca nesse estado)");
}
async function loteAguardandoVencidoFecha() {
  resetarTudo();
  L._seed([{ grupo_id: "g-2", publicId: "pub-2", estado: "aguardando_confirmacao", expira_em: VENCIDO }]);
  const lote = await L.buscarLoteAtivoParaPublicId("pub-2");
  const r = await guard.resolverLoteParaGuardExpiracao("pub-2", lote);
  ok(r === null, "lote aguardando vencido: guard devolve null");
  ok(L._all().find((l) => l.grupo_id === "g-2").estado === "expirada", "lote aguardando vencido: fechado via CAS");
}
async function aguardandoVencidoCasPerdidoReavaliaComSeguranca() {
  // Simula: entre a leitura do chamador e a chamada ao guard, outra
  // execucao ja reivindicou o ACEITO (estado virou 'autorizada' sem
  // cobranca vinculada ainda) -- expirarSeVencido perde o CAS (nao
  // esta' mais 'aguardando_confirmacao'); o guard reavalia com o
  // estado REAL atual (agora 'autorizada' sem operacao_id -> nao ha'
  // nada a reconciliar, permanece bloqueando -- comportamento seguro).
  resetarTudo();
  T._seed([{ id: "tk-3", public_id: "pub-3", estado: "aguardando_confirmacao", expira_em: VENCIDO }]);
  const tokenLido = await T.buscarTokenAtivoPorPublicId("pub-3"); // ainda 'aguardando_confirmacao' na leitura do chamador
  T._all().find((t) => t.id === "tk-3").estado = "autorizada"; // corrida: outra execucao ja avancou
  const r = await guard.resolverTokenParaGuardExpiracao("pub-3", tokenLido);
  ok(r?.estado === "autorizada", "CAS perdido (aguardando->autorizada): reavalia com o estado real, nao insiste no estado antigo");
  ok(T._all().find((t) => t.id === "tk-3").estado === "autorizada", "CAS perdido: nada foi sobrescrito no banco pelo guard");
}

// =======================================================================
// Caso 2 -- 'autorizada' vencida + operacao_id: reconsulta a Woovi.
// =======================================================================
async function autorizadaVencidaWooviActiveMantemBloqueio() {
  resetarTudo();
  T._seed([{ id: "tk-4", public_id: "pub-4", estado: "autorizada", operacao_id: "op-4", expira_em: VENCIDO }]);
  C._seed([{ operacao_id: "op-4", status: "pendente" }]);
  OP._definir("op-4", { outcome: "success", status: "ACTIVE" });
  const token = await T.buscarTokenAtivoPorPublicId("pub-4");
  const r = await guard.resolverTokenParaGuardExpiracao("pub-4", token);
  ok(r?.id === "tk-4", "autorizada + Woovi ACTIVE: continua bloqueando (Etapa 3 cuida da recuperacao)");
  ok(T._all().find((t) => t.id === "tk-4").estado === "autorizada", "autorizada + Woovi ACTIVE: nada fechado no banco");
}
async function autorizadaVencidaWooviTerminalFecha() {
  resetarTudo();
  T._seed([{ id: "tk-5", public_id: "pub-5", estado: "autorizada", operacao_id: "op-5", expira_em: VENCIDO }]);
  C._seed([{ operacao_id: "op-5", status: "pendente" }]);
  OP._definir("op-5", { outcome: "success", status: "EXPIRED" });
  const token = await T.buscarTokenAtivoPorPublicId("pub-5");
  const r = await guard.resolverTokenParaGuardExpiracao("pub-5", token);
  ok(r === null, "autorizada + Woovi EXPIRED: guard devolve null (fechado, libera nova tentativa)");
  ok(T._all().find((t) => t.id === "tk-5").estado === "expirada", "autorizada + Woovi EXPIRED: fechado via expirarAutorizacaoVinculada");
}
async function autorizadaVencidaWooviTerminalVariantesFecha() {
  for (const status of ["CANCELLED", "canceled", "REFUNDED", "refund"]) {
    resetarTudo();
    T._seed([{ id: "tk-5v", public_id: "pub-5v", estado: "autorizada", operacao_id: "op-5v", expira_em: VENCIDO }]);
    C._seed([{ operacao_id: "op-5v", status: "pendente" }]);
    OP._definir("op-5v", { outcome: "success", status });
    const token = await T.buscarTokenAtivoPorPublicId("pub-5v");
    const r = await guard.resolverTokenParaGuardExpiracao("pub-5v", token);
    ok(r === null, `autorizada + Woovi terminal (${status}): fecha (allowlist, case-insensitive)`);
  }
}
async function autorizadaVencidaWooviIndisponivelMantemBloqueio() {
  resetarTudo();
  T._seed([{ id: "tk-6", public_id: "pub-6", estado: "autorizada", operacao_id: "op-6", expira_em: VENCIDO }]);
  C._seed([{ operacao_id: "op-6", status: "pendente" }]);
  OP._definir("op-6", { outcome: "unavailable" });
  const token = await T.buscarTokenAtivoPorPublicId("pub-6");
  const r = await guard.resolverTokenParaGuardExpiracao("pub-6", token);
  ok(r?.id === "tk-6", "autorizada + Woovi indisponivel: continua bloqueando");
  ok(T._all().find((t) => t.id === "tk-6").estado === "autorizada", "autorizada + Woovi indisponivel: nunca fecha");
}
async function autorizadaVencidaCobranca404MantemBloqueio() {
  resetarTudo();
  T._seed([{ id: "tk-7", public_id: "pub-7", estado: "autorizada", operacao_id: "op-7", expira_em: VENCIDO }]);
  C._seed([{ operacao_id: "op-7", status: "pendente" }]);
  OP._definir("op-7", { outcome: "not_found" });
  const token = await T.buscarTokenAtivoPorPublicId("pub-7");
  const r = await guard.resolverTokenParaGuardExpiracao("pub-7", token);
  ok(r?.id === "tk-7", "autorizada + cobranca 404 na Woovi: NAO libera na hora (so' o watchdog, com dupla confirmacao)");
  ok(T._all().find((t) => t.id === "tk-7").estado === "autorizada", "autorizada + 404: nunca fecha por aqui");
}
async function autorizadaVencidaWooviCompletedNuncaFecha() {
  // Critico: nunca perder um pagamento COMPLETED. O guard NUNCA fecha
  // nem reconhece pagamento aqui -- isso e' 100% do webhook/watchdog
  // (reconciliarPagamentoRenovacao, nunca chamado por este modulo).
  resetarTudo();
  T._seed([{ id: "tk-8", public_id: "pub-8", estado: "autorizada", operacao_id: "op-8", expira_em: VENCIDO }]);
  C._seed([{ operacao_id: "op-8", status: "pendente" }]);
  OP._definir("op-8", { outcome: "success", status: "COMPLETED" });
  const token = await T.buscarTokenAtivoPorPublicId("pub-8");
  const r = await guard.resolverTokenParaGuardExpiracao("pub-8", token);
  ok(r?.id === "tk-8", "autorizada + Woovi COMPLETED: guard NUNCA fecha nem reconhece pagamento");
  ok(T._all().find((t) => t.id === "tk-8").estado === "autorizada", "autorizada + COMPLETED: estado do token intocado (webhook/watchdog cuidam disso)");
  ok(C._all().find((c) => c.operacao_id === "op-8").status === "pendente", "autorizada + COMPLETED: cobranca local intocada (nunca marcada 'pago' por aqui)");
}
async function autorizadaVencidaStatusDesconhecidoMantemBloqueio() {
  resetarTudo();
  T._seed([{ id: "tk-9", public_id: "pub-9", estado: "autorizada", operacao_id: "op-9", expira_em: VENCIDO }]);
  C._seed([{ operacao_id: "op-9", status: "pendente" }]);
  OP._definir("op-9", { outcome: "success", status: "ALGO_NOVO_NUNCA_VISTO" });
  const token = await T.buscarTokenAtivoPorPublicId("pub-9");
  const r = await guard.resolverTokenParaGuardExpiracao("pub-9", token);
  ok(r?.id === "tk-9", "autorizada + status Woovi desconhecido: fail-safe, continua bloqueando");
}
async function autorizadaVencidaCobrancaLocalJaPagaNaoConsultaWoovi() {
  resetarTudo();
  T._seed([{ id: "tk-10", public_id: "pub-10", estado: "autorizada", operacao_id: "op-10", expira_em: VENCIDO }]);
  C._seed([{ operacao_id: "op-10", status: "pago" }]); // webhook pode estar em voo
  const token = await T.buscarTokenAtivoPorPublicId("pub-10");
  const r = await guard.resolverTokenParaGuardExpiracao("pub-10", token);
  ok(r?.id === "tk-10", "autorizada + cobranca local ja 'pago': continua bloqueando (nunca corre com o webhook)");
  ok(OP.consultasRegistradas().length === 0, "autorizada + cobranca local ja 'pago': nem chega a consultar a Woovi");
}
async function autorizadaVencidaSemRegistroLocalDeCobrancaMantemBloqueio() {
  resetarTudo();
  T._seed([{ id: "tk-11", public_id: "pub-11", estado: "autorizada", operacao_id: "op-fantasma", expira_em: VENCIDO }]);
  // nenhuma cobranca seedada
  const token = await T.buscarTokenAtivoPorPublicId("pub-11");
  const r = await guard.resolverTokenParaGuardExpiracao("pub-11", token);
  ok(r?.id === "tk-11", "autorizada + cobranca inexistente localmente: continua bloqueando");
  ok(OP.consultasRegistradas().length === 0, "autorizada + cobranca inexistente localmente: nem chega a consultar a Woovi");
}
async function autorizadaVencidaCasPerdidoReavaliaComSeguranca() {
  // Simula: entre a leitura do chamador e o fechamento, o webhook real
  // ja reivindicou o inicio (estado virou 'renovacao_em_andamento') --
  // expirarAutorizacaoVinculada perde o CAS; o guard reavalia e
  // encontra 'renovacao_em_andamento' -> nunca fecha, continua
  // bloqueando (comportamento correto: ha' renovacao real em curso).
  resetarTudo();
  T._seed([{ id: "tk-12", public_id: "pub-12", estado: "autorizada", operacao_id: "op-12", expira_em: VENCIDO }]);
  C._seed([{ operacao_id: "op-12", status: "pendente" }]);
  OP._definir("op-12", { outcome: "success", status: "EXPIRED" });
  const tokenLido = await T.buscarTokenAtivoPorPublicId("pub-12");
  T._all().find((t) => t.id === "tk-12").estado = "renovacao_em_andamento"; // corrida: webhook ganhou
  const r = await guard.resolverTokenParaGuardExpiracao("pub-12", tokenLido);
  ok(r?.estado === "renovacao_em_andamento", "CAS perdido (autorizada->renovacao_em_andamento): reavalia e respeita o estado real, nao fecha por cima");
}

// =======================================================================
// Caso 3 -- 'renovacao_em_andamento': NUNCA tocado, independente de
// expira_em (mesmo vencido ha' muito tempo).
// =======================================================================
async function emAndamentoNuncaTocado() {
  resetarTudo();
  const MUITO_VENCIDO = new Date(AGORA - 60 * 60 * 1000).toISOString(); // 1h atras
  T._seed([{ id: "tk-13", public_id: "pub-13", estado: "renovacao_em_andamento", operacao_id: "op-13", expira_em: MUITO_VENCIDO }]);
  const token = await T.buscarTokenAtivoPorPublicId("pub-13");
  const r = await guard.resolverTokenParaGuardExpiracao("pub-13", token);
  ok(r?.estado === "renovacao_em_andamento", "renovacao_em_andamento vencido: continua bloqueando sempre, sem excecao de expira_em");
  ok(OP.consultasRegistradas().length === 0, "renovacao_em_andamento: nenhuma consulta a Woovi (nunca avaliado por expira_em)");
}
async function loteEmAndamentoNuncaTocado() {
  resetarTudo();
  const MUITO_VENCIDO = new Date(AGORA - 60 * 60 * 1000).toISOString();
  L._seed([{ grupo_id: "g-13", publicId: "pub-13l", estado: "renovacao_em_andamento", operacao_id: "op-13l", expira_em: MUITO_VENCIDO }]);
  const lote = await L.buscarLoteAtivoParaPublicId("pub-13l");
  const r = await guard.resolverLoteParaGuardExpiracao("pub-13l", lote);
  ok(r?.estado === "renovacao_em_andamento", "lote renovacao_em_andamento vencido: continua bloqueando sempre");
}

// =======================================================================
// Lote -- espelho dos casos 'autorizada' do token individual.
// =======================================================================
async function loteAutorizadoVencidoWooviActiveMantemBloqueio() {
  resetarTudo();
  L._seed([{ grupo_id: "g-14", publicId: "pub-14", estado: "autorizada", operacao_id: "op-14", expira_em: VENCIDO }]);
  C._seed([{ operacao_id: "op-14", status: "pendente" }]);
  OP._definir("op-14", { outcome: "success", status: "ACTIVE" });
  const lote = await L.buscarLoteAtivoParaPublicId("pub-14");
  const r = await guard.resolverLoteParaGuardExpiracao("pub-14", lote);
  ok(r?.grupo_id === "g-14", "lote autorizado + Woovi ACTIVE: continua bloqueando");
}
async function loteAutorizadoVencidoWooviTerminalFecha() {
  resetarTudo();
  L._seed([{ grupo_id: "g-15", publicId: "pub-15", estado: "autorizada", operacao_id: "op-15", expira_em: VENCIDO }]);
  C._seed([{ operacao_id: "op-15", status: "pendente" }]);
  OP._definir("op-15", { outcome: "success", status: "EXPIRED" });
  const lote = await L.buscarLoteAtivoParaPublicId("pub-15");
  const r = await guard.resolverLoteParaGuardExpiracao("pub-15", lote);
  ok(r === null, "lote autorizado + Woovi EXPIRED: fecha, libera nova tentativa");
  ok(L._all().find((l) => l.grupo_id === "g-15").estado === "expirada", "lote autorizado + EXPIRED: fechado via expirarLoteAutorizado");
}
async function loteAutorizadoVencidoWooviIndisponivelMantemBloqueio() {
  resetarTudo();
  L._seed([{ grupo_id: "g-16", publicId: "pub-16", estado: "autorizada", operacao_id: "op-16", expira_em: VENCIDO }]);
  C._seed([{ operacao_id: "op-16", status: "pendente" }]);
  OP._definir("op-16", { outcome: "unavailable" });
  const lote = await L.buscarLoteAtivoParaPublicId("pub-16");
  const r = await guard.resolverLoteParaGuardExpiracao("pub-16", lote);
  ok(r?.grupo_id === "g-16", "lote autorizado + Woovi indisponivel: continua bloqueando");
}

// =======================================================================
// Concorrencia -- 2 chamadas simultaneas para o mesmo public_id com
// registro vencido. Exatamente uma fecha; nenhuma cobranca/estado
// duplicado ou inconsistente.
// =======================================================================
async function concorrenciaAguardandoVencido() {
  resetarTudo();
  T._seed([{ id: "tk-conc-1", public_id: "pub-conc-1", estado: "aguardando_confirmacao", expira_em: VENCIDO }]);
  const token = await T.buscarTokenAtivoPorPublicId("pub-conc-1");
  const [r1, r2] = await Promise.all([
    guard.resolverTokenParaGuardExpiracao("pub-conc-1", token),
    guard.resolverTokenParaGuardExpiracao("pub-conc-1", token),
  ]);
  ok(r1 === null && r2 === null, "concorrencia (aguardando vencido): as 2 chamadas concordam (null -- fechado)");
  ok(T._all().filter((t) => t.id === "tk-conc-1" && t.estado === "expirada").length === 1, "concorrencia (aguardando vencido): fechado EXATAMENTE 1 vez, sem duplicidade");
}
async function concorrenciaAutorizadaVencidaTerminal() {
  resetarTudo();
  T._seed([{ id: "tk-conc-2", public_id: "pub-conc-2", estado: "autorizada", operacao_id: "op-conc-2", expira_em: VENCIDO }]);
  C._seed([{ operacao_id: "op-conc-2", status: "pendente" }]);
  OP._definir("op-conc-2", { outcome: "success", status: "EXPIRED" });
  const token = await T.buscarTokenAtivoPorPublicId("pub-conc-2");
  const [r1, r2] = await Promise.all([
    guard.resolverTokenParaGuardExpiracao("pub-conc-2", token),
    guard.resolverTokenParaGuardExpiracao("pub-conc-2", token),
  ]);
  ok(r1 === null && r2 === null, "concorrencia (autorizada + EXPIRED): as 2 chamadas concordam (null -- fechado)");
  ok(T._all().find((t) => t.id === "tk-conc-2").estado === "expirada", "concorrencia (autorizada + EXPIRED): token fechado, estado consistente");
  ok(T._all().filter((t) => t.id === "tk-conc-2").length === 1, "concorrencia: nenhum token duplicado criado");
}
async function concorrenciaLoteAutorizadoVencidoTerminal() {
  resetarTudo();
  L._seed([{ grupo_id: "g-conc-3", publicId: "pub-conc-3", estado: "autorizada", operacao_id: "op-conc-3", expira_em: VENCIDO }]);
  C._seed([{ operacao_id: "op-conc-3", status: "pendente" }]);
  OP._definir("op-conc-3", { outcome: "success", status: "EXPIRED" });
  const lote = await L.buscarLoteAtivoParaPublicId("pub-conc-3");
  const [r1, r2] = await Promise.all([
    guard.resolverLoteParaGuardExpiracao("pub-conc-3", lote),
    guard.resolverLoteParaGuardExpiracao("pub-conc-3", lote),
  ]);
  ok(r1 === null && r2 === null, "concorrencia lote (autorizado + EXPIRED): as 2 chamadas concordam");
  ok(L._all().filter((l) => l.grupo_id === "g-conc-3").length === 1, "concorrencia lote: nenhum lote duplicado");
}

// =======================================================================
// reconciliarCobrancaPendenteAntesDeNovaCobranca -- correcao de
// cobranca pendente bloqueando nova tentativa (2026-09-15).
// =======================================================================
async function reconciliacaoSemPendente() {
  resetarTudo();
  const r = await guard.reconciliarCobrancaPendenteAntesDeNovaCobranca({ publicId: "pub-r1" });
  ok(r.outcome === "sem_pendente", "reconciliacao: sem cobranca pendente -> sem_pendente");
  ok(OP.consultasRegistradas().length === 0, "reconciliacao: sem pendente -> zero chamada a Woovi");
}
async function reconciliacaoSemParametros() {
  resetarTudo();
  const r = await guard.reconciliarCobrancaPendenteAntesDeNovaCobranca({});
  ok(r.outcome === "sem_pendente", "reconciliacao: sem publicId nem grupoId -> sem_pendente (nunca busca as cegas)");
}
async function reconciliacaoTerminalFecha() {
  for (const status of ["EXPIRED", "CANCELLED", "CANCELED", "REFUNDED", "REFUND"]) {
    resetarTudo();
    C._seed([{ operacao_id: "op-r2", public_id: "pub-r2", status: "pendente", qr_code_texto: "00020101-BRCODE-R2", criado_em: new Date().toISOString() }]);
    OP._definir("op-r2", { outcome: "success", status });
    const r = await guard.reconciliarCobrancaPendenteAntesDeNovaCobranca({ publicId: "pub-r2" });
    ok(r.outcome === "pendente_fechada", `reconciliacao: pendente + Woovi ${status} -> pendente_fechada`);
    ok(C._all().find((c) => c.operacao_id === "op-r2").status === "expirada", `reconciliacao: pendente + ${status} -> fechada no banco`);
  }
}
async function reconciliacaoAtivaDevolveDadosENuncaFecha() {
  resetarTudo();
  C._seed([{ operacao_id: "op-r3", public_id: "pub-r3", status: "pendente", qr_code_texto: "00020101-BRCODE-R3", criado_em: new Date().toISOString() }]);
  OP._definir("op-r3", { outcome: "success", status: "ACTIVE", paymentLinkUrl: "https://openpix.com.br/pay/r3" });
  const r = await guard.reconciliarCobrancaPendenteAntesDeNovaCobranca({ publicId: "pub-r3" });
  ok(r.outcome === "pendente_ativa", "reconciliacao: pendente + Woovi ACTIVE -> pendente_ativa");
  ok(r.outcome === "pendente_ativa" && r.operacaoId === "op-r3", "reconciliacao: pendente_ativa devolve o operacaoId da cobranca ANTIGA");
  ok(r.outcome === "pendente_ativa" && r.brCode === "00020101-BRCODE-R3", "reconciliacao: pendente_ativa devolve o brCode (qr_code_texto) da cobranca antiga");
  ok(r.outcome === "pendente_ativa" && r.paymentLinkUrl === "https://openpix.com.br/pay/r3", "reconciliacao: pendente_ativa devolve o paymentLinkUrl da MESMA consulta (sem 2a chamada)");
  ok(OP.consultasRegistradas().length === 1, "reconciliacao: ACTIVE -> exatamente 1 consulta a Woovi (nao 2)");
  ok(C._all().find((c) => c.operacao_id === "op-r3").status === "pendente", "reconciliacao: ACTIVE -> cobranca antiga NUNCA fechada");
}
async function reconciliacaoBloqueandoNosCasosFailSafe() {
  const casos = [
    ["COMPLETED", { outcome: "success", status: "COMPLETED" }],
    ["404", { outcome: "not_found" }],
    ["indisponivel", { outcome: "unavailable" }],
    ["desconhecido", { outcome: "success", status: "ALGO_NOVO" }],
  ];
  for (const [nome, resposta] of casos) {
    resetarTudo();
    C._seed([{ operacao_id: "op-r4", public_id: "pub-r4", status: "pendente", qr_code_texto: "00020101-BRCODE-R4", criado_em: new Date().toISOString() }]);
    OP._definir("op-r4", resposta);
    const r = await guard.reconciliarCobrancaPendenteAntesDeNovaCobranca({ publicId: "pub-r4" });
    ok(r.outcome === "pendente_bloqueando", `reconciliacao: pendente + ${nome} -> pendente_bloqueando (fail-safe, nunca fecha nem libera)`);
    ok(C._all().find((c) => c.operacao_id === "op-r4").status === "pendente", `reconciliacao: ${nome} -> cobranca antiga intocada`);
  }
}
async function reconciliacaoCobrancaLocalJaNaoPendenteNaoConsultaWoovi() {
  resetarTudo();
  C._seed([{ operacao_id: "op-r5", public_id: "pub-r5", status: "pago", qr_code_texto: "00020101-BRCODE-R5", criado_em: new Date().toISOString() }]);
  const r = await guard.reconciliarCobrancaPendenteAntesDeNovaCobranca({ publicId: "pub-r5" });
  // 'pago' nunca aparece pra buscarCobrancaPendente (so' busca status='pendente') -> sem_pendente, correto.
  ok(r.outcome === "sem_pendente", "reconciliacao: cobranca local ja 'pago' nao conta como pendente -> sem_pendente");
  ok(OP.consultasRegistradas().length === 0, "reconciliacao: cobranca ja paga -> zero chamada a Woovi");
}
async function reconciliacaoLoteEspelho() {
  resetarTudo();
  L._seed([{ grupo_id: "g-r6", publicId: "pub-r6-nao-usado", estado: "aguardando_confirmacao", expira_em: FUTURO }]); // presenca so' pra confirmar isolamento entre modulos
  C._seed([{ operacao_id: "op-r6", grupo_id: "grupo-r6", status: "pendente", qr_code_texto: "00020101-BRCODE-R6", criado_em: new Date().toISOString() }]);
  OP._definir("op-r6", { outcome: "success", status: "ACTIVE", paymentLinkUrl: "https://openpix.com.br/pay/r6" });
  const r = await guard.reconciliarCobrancaPendenteAntesDeNovaCobranca({ grupoId: "grupo-r6" });
  ok(r.outcome === "pendente_ativa" && r.brCode === "00020101-BRCODE-R6", "reconciliacao (lote): grupoId + Woovi ACTIVE -> pendente_ativa com dados corretos");

  resetarTudo();
  C._seed([{ operacao_id: "op-r7", grupo_id: "grupo-r7", status: "pendente", qr_code_texto: "00020101-BRCODE-R7", criado_em: new Date().toISOString() }]);
  OP._definir("op-r7", { outcome: "success", status: "CANCELLED" });
  const r2 = await guard.reconciliarCobrancaPendenteAntesDeNovaCobranca({ grupoId: "grupo-r7" });
  ok(r2.outcome === "pendente_fechada", "reconciliacao (lote): grupoId + Woovi CANCELLED -> pendente_fechada");
  ok(C._all().find((c) => c.operacao_id === "op-r7").status === "expirada", "reconciliacao (lote): fechada no banco");
}
async function reconciliacaoConcorrenciaTerminal() {
  resetarTudo();
  C._seed([{ operacao_id: "op-r8", public_id: "pub-r8", status: "pendente", qr_code_texto: "00020101-BRCODE-R8", criado_em: new Date().toISOString() }]);
  OP._definir("op-r8", { outcome: "success", status: "EXPIRED" });
  const [r1, r2] = await Promise.all([
    guard.reconciliarCobrancaPendenteAntesDeNovaCobranca({ publicId: "pub-r8" }),
    guard.reconciliarCobrancaPendenteAntesDeNovaCobranca({ publicId: "pub-r8" }),
  ]);
  ok(r1.outcome === "pendente_fechada" && r2.outcome === "pendente_fechada", "reconciliacao: concorrencia -- as 2 chamadas concordam (pendente_fechada)");
  ok(C._all().filter((c) => c.operacao_id === "op-r8" && c.status === "expirada").length === 1, "reconciliacao: concorrencia -- fechada EXATAMENTE 1 vez, sem duplicidade");
}

await reconciliacaoSemPendente();
await reconciliacaoSemParametros();
await reconciliacaoTerminalFecha();
await reconciliacaoAtivaDevolveDadosENuncaFecha();
await reconciliacaoBloqueandoNosCasosFailSafe();
await reconciliacaoCobrancaLocalJaNaoPendenteNaoConsultaWoovi();
await reconciliacaoLoteEspelho();
await reconciliacaoConcorrenciaTerminal();

await semRegistroAtivo();
await loteSemRegistroAtivo();
await tokenAindaDentroDaJanela();
await tokenExpiraEmInvalidoNuncaFecha();
await aguardandoVencidoFecha();
await loteAguardandoVencidoFecha();
await aguardandoVencidoCasPerdidoReavaliaComSeguranca();
await autorizadaVencidaWooviActiveMantemBloqueio();
await autorizadaVencidaWooviTerminalFecha();
await autorizadaVencidaWooviTerminalVariantesFecha();
await autorizadaVencidaWooviIndisponivelMantemBloqueio();
await autorizadaVencidaCobranca404MantemBloqueio();
await autorizadaVencidaWooviCompletedNuncaFecha();
await autorizadaVencidaStatusDesconhecidoMantemBloqueio();
await autorizadaVencidaCobrancaLocalJaPagaNaoConsultaWoovi();
await autorizadaVencidaSemRegistroLocalDeCobrancaMantemBloqueio();
await autorizadaVencidaCasPerdidoReavaliaComSeguranca();
await emAndamentoNuncaTocado();
await loteEmAndamentoNuncaTocado();
await loteAutorizadoVencidoWooviActiveMantemBloqueio();
await loteAutorizadoVencidoWooviTerminalFecha();
await loteAutorizadoVencidoWooviIndisponivelMantemBloqueio();
await concorrenciaAguardandoVencido();
await concorrenciaAutorizadaVencidaTerminal();
await concorrenciaLoteAutorizadoVencidoTerminal();

console.log(`\n${falhas === 0 ? "TODOS OS TESTES PASSARAM" : `${falhas} FALHA(S)`}`);
process.exit(falhas === 0 ? 0 : 1);
