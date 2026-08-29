// Testes locais de _shared/tokens_renovacao.ts -> criarTokenRenovacao
// (REAL). Fake: _shared/supabase_client.ts.
//
// Etapa 2 (Renovacao UniTV, Bloco 3): criarTokenRenovacao ganha params
// opcionais tipo/unitvSn/unitvId. Chamadas Sigma existentes ficam
// IDENTICAS (default 'sigma', unitv_* null). Token UniTV: public_id
// MANTIDO + tipo='unitv' + unitv_sn + unitv_id (obrigatorios; CHECK do
// banco exige os dois).
//
// Como rodar: npx tsx scripts/testes/token_renovacao_unitv/teste.mjs

import { register } from "node:module";
register("./mock-loader.mjs", import.meta.url);

const { insertsRegistrados, resetar } = await import("./fake_supabase_client.mjs");
const { criarTokenRenovacao } = await import("../../../supabase/functions/_shared/tokens_renovacao.ts");

let falhas = 0;
function ok(cond, msg) {
  if (!cond) { falhas++; console.error(`FALHA: ${msg}`); }
  else console.log(`ok: ${msg}`);
}

const BASE = {
  conversationId: "01a0271b-5a54-7d7e-8e4a-ef4c39730e0b",
  publicId: "019ff025-ae5a-7e96-a037-8cfec84178d1",
  telefone: "5517999999999",
  clienteNome: "Cliente Teste",
  servidorNome: "NewOne",
  planoNome: "Mensal",
  valorEsperadoCentavos: 3500,
  vencimentoAtual: "2026-12-08T20:59:59-03:00",
};

// --- C1: chamada Sigma existente (sem tipo) -> payload IDENTICO ao de antes ---
{
  resetar();
  const { tokenBruto, registro } = await criarTokenRenovacao({ ...BASE });
  const p = insertsRegistrados()[0].payload;
  ok(insertsRegistrados()[0].table === "tokens_renovacao", "C1: insert em tokens_renovacao");
  ok(p.tipo === "sigma", "C1: default tipo='sigma'");
  ok(p.unitv_sn === null && p.unitv_id === null, "C1: unitv_sn/unitv_id null quando Sigma");
  ok(p.public_id === BASE.publicId, "C1: public_id preenchido");
  ok(p.estado === "aguardando_confirmacao", "C1: estado inicial aguardando_confirmacao");
  ok(p.token_hash && p.token_hash !== tokenBruto && /^[0-9a-f]{64}$/.test(p.token_hash), "C1: token_hash e' SHA-256 (nunca o bruto)");
  ok(p.valor_esperado_centavos === 3500 && p.plano_nome === "Mensal", "C1: snapshot inalterado");
  ok(registro.id && typeof tokenBruto === "string", "C1: retorna tokenBruto + registro");
}

// --- C2: token UniTV -> tipo='unitv', unitv_sn/unitv_id preenchidos, public_id MANTIDO ---
{
  resetar();
  await criarTokenRenovacao({ ...BASE, servidorNome: "UNITV", tipo: "unitv", unitvSn: "gcnv6v", unitvId: 3433363 });
  const p = insertsRegistrados()[0].payload;
  ok(p.tipo === "unitv", "C2: tipo='unitv'");
  ok(p.unitv_sn === "gcnv6v", "C2: unitv_sn = sn resolvido");
  ok(p.unitv_id === 3433363, "C2: unitv_id = id resolvido do painel");
  ok(p.public_id === BASE.publicId, "C2: public_id MANTIDO no token UniTV (id do cliente no Rocket)");
  ok(p.servidor_nome === "UNITV", "C2: servidor_nome no snapshot");
}

// --- C3: tipo='unitv' sem unitvSn ou sem unitvId -> lanca (guard antes do insert) ---
{
  resetar();
  let erro1 = null;
  try { await criarTokenRenovacao({ ...BASE, tipo: "unitv", unitvId: 3433363 }); } catch (e) { erro1 = e; }
  ok(erro1 && /unitvSn e unitvId/.test(String(erro1.message)), "C3: tipo='unitv' sem unitvSn -> lanca");

  let erro2 = null;
  try { await criarTokenRenovacao({ ...BASE, tipo: "unitv", unitvSn: "gcnv6v", unitvId: null }); } catch (e) { erro2 = e; }
  ok(erro2 && /unitvSn e unitvId/.test(String(erro2.message)), "C3: tipo='unitv' com unitvId null -> lanca");

  ok(insertsRegistrados().length === 0, "C3: nenhum insert feito quando o guard barra");
}

// --- C4: tipo='sigma' explicito com unitvSn passado por engano -> ignorado (nao entra no payload) ---
{
  resetar();
  await criarTokenRenovacao({ ...BASE, tipo: "sigma", unitvSn: "lixo", unitvId: 999 });
  const p = insertsRegistrados()[0].payload;
  ok(p.tipo === "sigma" && p.unitv_sn === null && p.unitv_id === null, "C4: tipo='sigma' zera unitv_* mesmo se passados");
}

console.log(`\n${falhas === 0 ? "TODOS OS TESTES PASSARAM" : `${falhas} FALHA(S)`}`);
process.exit(falhas === 0 ? 0 : 1);
