// F4 -- varredura ESTATICA do healer. Trava, por leitura do
// codigo-fonte, que o healer:
//   * NUNCA chama /api/account/renew, /pagamento/add/, cria cobranca;
//   * NUNCA importa scripts/lib/unitv-renovar.mjs (I3 / doc C.9);
//   * NUNCA altera o Edge secret UNITV_DEALER_TOKEN nem faz `secrets set`;
//   * so' pode fazer 1 POST de login por ciclo (postLogin chamado 1x,
//     fora de qualquer loop -- ajuste obrigatorio 2026-08-30);
//   * grava SO' o Vault (unitv_dealer_token_definir(...,'autocura','healer'));
//   * NUNCA loga token/senha/login/predicao (I6).
//
// Rodar: npx tsx scripts/testes/autocura_healer_nao_age/teste.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const semComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const ler = (f) => semComentarios(readFileSync(join(RAIZ, f), "utf8"));

const HEALER_LIB = ler("scripts/lib/autocura-unitv-healer.mjs");
const RUNNER = ler("scripts/autocura-unitv-token.mjs");
const CONTA_RO = ler("scripts/lib/autocura-unitv-conta-readonly.mjs");
const RESULTADO = ler("supabase/functions/_shared/autocura_resultado.ts");
const IDX = ler("supabase/functions/autocura-unitv-resultado/index.ts");
const CODIGO = [HEALER_LIB, RUNNER, CONTA_RO, RESULTADO, IDX].join("\n");

const yaml = readFileSync(join(RAIZ, ".github/workflows/autocura-unitv-token.yml"), "utf8")
  .split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");

let falhas = 0;
function proibido(re, alvo, m) { const x = alvo.match(re); if (x) { falhas++; console.error(`FALHA: ${m} -- casou: ${JSON.stringify(x[0])}`); } else console.log(`ok: ${m}`); }
function exigido(re, alvo, m) { if (!re.test(alvo)) { falhas++; console.error(`FALHA: ${m}`); } else console.log(`ok: ${m}`); }

// ---- NUNCA renovacao / cobranca ----
proibido(/\/api\/account\/renew/i, CODIGO, "nenhum arquivo do healer referencia /api/account/renew");
proibido(/\/pagamento\/add\//i, CODIGO, "nenhum arquivo do healer referencia /pagamento/add/");
proibido(/unitv-renovar/i, CODIGO, "nenhum arquivo do healer importa unitv-renovar.mjs");
proibido(/cobrancas_pix|criarCobranca|criarCobrancaOpenPix|openpix|OPENPIX/i, CODIGO, "nenhum arquivo do healer mexe com cobranca");
proibido(/renovarUmAcesso|renovacao-sigma-workflow|processarLote/i, CODIGO, "nenhum arquivo do healer chama o executor de renovacao");
proibido(/unitvSign|createCipheriv[\s\S]{0,40}renew|pre_auth_id/i, CODIGO, "healer nao monta payload de /renew");

// ---- NUNCA altera secret / Edge secret UNITV_DEALER_TOKEN ----
proibido(/UNITV_DEALER_TOKEN/, CODIGO, "healer nao referencia o Edge secret UNITV_DEALER_TOKEN (usa so' o Vault)");
proibido(/secrets\s+set|setSecret|supabase\s+secrets|vault\.update_secret|vault\.create_secret/i, CODIGO, "healer nao escreve secret/Vault por fora da RPC");

// ---- 1 UNICO POST de login ----
{
  const chamadas = (HEALER_LIB.match(/await\s+postLogin\s*\(/g) || []).length;
  if (chamadas !== 1) { falhas++; console.error(`FALHA: postLogin deveria ser chamado exatamente 1x no nucleo, achei ${chamadas}`); }
  else console.log("ok: postLogin chamado exatamente 1x no nucleo (sem retry)");
}
proibido(/for\s*\([^)]*\)\s*\{[\s\S]{0,400}await\s+postLogin/, HEALER_LIB, "postLogin nao esta dentro de um for(...)");
proibido(/while\s*\([^)]*\)\s*\{[\s\S]{0,400}await\s+postLogin/, HEALER_LIB, "postLogin nao esta dentro de um while(...)");
exigido(/postLoginChamado/, HEALER_LIB, "nucleo tem a trava dura postLoginChamado");
exigido(/login_transporte/, HEALER_LIB, "nucleo classifica login_transporte (sem retry -- ajuste 2026-08-30)");

// ---- grava SO' o Vault, na ordem certa ----
exigido(/\^\[0-9a-f\]\{32\}\$/, HEALER_LIB, "nucleo valida o shape ^[0-9a-f]{32}$ do token novo");
exigido(/unitv_dealer_token_definir/, RUNNER, "runner grava no Vault via unitv_dealer_token_definir");
exigido(/p_origem["']?\s*:\s*["']autocura["']/, RUNNER, "grava com origem 'autocura'");
exigido(/p_por["']?\s*:\s*["']healer["']/, RUNNER, "grava com por 'healer'");
exigido(/unitv_dealer_token_ler/, RUNNER, "runner rele o Vault para revalidacao");

// ---- I6: nunca loga token/senha/login/predicao ----
proibido(/console\.\w+\([^)]*\b(predicao|DEALER_SENHA|DEALER_LOGIN|tokenNovo|tokenDaRede)\b/, CODIGO, "nenhum console.* loga token/senha/login/predicao");
proibido(/\blog\(["'][^"']*["']\s*,\s*\{[^}]*\b(predicao|senha|codigo)\s*:/, CODIGO, "log() estruturado nao carrega predicao/senha/codigo como valor");

// ---- canais no callback compartilhado ----
exigido(/canal\s*===?\s*["']healer["']/, RESULTADO, "autocura_resultado.ts trata o canal 'healer'");
exigido(/outcomePermitidoNoCanal/, RESULTADO, "autocura_resultado.ts exporta o cross-check canal x outcome");
exigido(/AUTOCURA_UNITV_OCR_CALLBACK_TOKEN/, IDX, "a EF ainda aceita o token de OCR");
exigido(/AUTOCURA_UNITV_HEALER_CALLBACK_TOKEN/, IDX, "a EF aceita o token do healer");
exigido(/outcomePermitidoNoCanal\s*\(\s*canal\s*,\s*outcome\s*\)/, IDX, "a EF cruza canal x outcome antes de processar");

// ---- workflow do healer ----
exigido(/UNITV_DEALER_LOGIN/, yaml, "workflow do healer TEM UNITV_DEALER_LOGIN no env");
exigido(/UNITV_DEALER_SENHA/, yaml, "workflow do healer TEM UNITV_DEALER_SENHA no env");
exigido(/group:\s*autocura-unitv/, yaml, "concurrency group autocura-unitv (nunca junto com OCR)");
exigido(/timeout-minutes:\s*8/, yaml, "timeout 8min");
exigido(/node scripts\/autocura-unitv-token\.mjs/, yaml, "workflow roda o runner do healer");
exigido(/workflow_dispatch/, yaml, "so' workflow_dispatch (sem cron do healer em F4)");
exigido(/ciclo_id/, yaml, "recebe ciclo_id");
proibido(/schedule:|cron:/, yaml, "workflow do healer NAO tem cron (F4 -- disparo so' manual supervisionado)");
proibido(/echo[^\n]*SENHA|echo[^\n]*DEALER_LOGIN/i, yaml, "workflow nao ecoa credenciais");

// ---- runner nao usa o executor congelado ----
exigido(/autocura-unitv-conta-readonly/, RUNNER, "runner usa o resolvedor READ-ONLY proprio da autocura");
proibido(/from\s+["'][^"']*unitv-renovar/, RUNNER, "runner NAO importa unitv-renovar.mjs");

console.log(falhas === 0 ? "\nTODOS OS TESTES OK" : `\n${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
