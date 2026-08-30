// Varredura ESTATICA (F2 da autocura, 2026-08-30). Trava, por leitura do
// codigo-fonte, que o monitor proativo NAO age -- so' detecta, registra
// e mede.
//
// Arquivos F2:
//   supabase/functions/_shared/autocura_monitor.ts   (logica)
//   supabase/functions/autocura-unitv-monitor/index.ts (wrapper fino)
//
// Proibicoes verificadas:
//   * nenhuma referencia a /api/account/renew, /pagamento/add/,
//     unitv-renovar.mjs
//   * nenhum dispatch de workflow (api.github.com/.../dispatches,
//     dispararWorkflow*, GITHUB_ACTIONS_DISPATCH_TOKEN)
//   * nao chama autocura_unitv_pode_disparar / _registrar_inicio /
//     _registrar_fim (nem cria ciclo de disparo)
//   * nao escreve no Vault / nao altera secret
//     (unitv_dealer_token_definir, secrets set, vault.)
//   * nao chama /api/account/renew nem cria cobranca
//     (cobrancas_pix, openpix, criarCobranca*)
//   * so' escreve em autocura_unitv_monitor_estado
//     (nenhum insert/update/upsert/delete em tokens_renovacao /
//      renovacoes_lote / cobrancas_pix / unitv_token_diagnostico /
//      autocura_unitv_ciclos / autocura_unitv_config)
//
// Como rodar: npx tsx scripts/testes/autocura_monitor_nao_age/teste.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const arquivos = [
  "supabase/functions/_shared/autocura_monitor.ts",
  "supabase/functions/autocura-unitv-monitor/index.ts",
];

// Remove comentarios: os cabecalhos destes arquivos DESCREVEM as
// proibicoes ("NAO chama /api/account/renew" etc). A varredura tem que
// olhar so' o CODIGO. Nenhum destes 2 arquivos tem "//" dentro de
// string literal, entao o strip simples e' seguro.
function semComentarios(txt) {
  return txt.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}
const fontes = arquivos.map((f) => ({ f, txt: semComentarios(readFileSync(join(raiz, f), "utf8")) }));
const blob = fontes.map((x) => x.txt).join("\n");

let falhas = 0;
function proibido(re, msg) {
  const m = blob.match(re);
  if (m) { falhas++; console.error(`FALHA: ${msg} -- casou: ${JSON.stringify(m[0])}`); }
  else console.log(`ok: ${msg}`);
}
function exigido(re, msg) {
  if (!re.test(blob)) { falhas++; console.error(`FALHA: ${msg}`); }
  else console.log(`ok: ${msg}`);
}

// --- renovacao real / cobranca ---
proibido(/\/api\/account\/renew/i, "nao referencia /api/account/renew");
proibido(/\/pagamento\/add\//i, "nao referencia /pagamento/add/");
proibido(/unitv-renovar/i, "nao importa/menciona unitv-renovar.mjs");
proibido(/cobrancas_pix|criarCobranca|openpix|OPENPIX/i, "nao mexe com cobranca/OpenPix");

// --- dispatch de workflow ---
proibido(/actions\/workflows\/.+\/dispatches|dispararWorkflow|GITHUB_ACTIONS_DISPATCH_TOKEN/i, "nao dispara workflow do GitHub Actions");

// --- RPCs de ciclo / guard ---
proibido(/autocura_unitv_pode_disparar/i, "nao chama autocura_unitv_pode_disparar");
proibido(/autocura_unitv_registrar_inicio|autocura_unitv_registrar_fim/i, "nao chama registrar_inicio/registrar_fim (nao cria ciclo de disparo)");
proibido(/autocura_unitv_ciclos/i, "nao toca a tabela autocura_unitv_ciclos");

// --- Vault / secret ---
proibido(/unitv_dealer_token_definir|unitv_dealer_token_ler/i, "nao escreve/le o Vault do dealer token");
proibido(/vault\.|secrets\s+set|setSecret/i, "nao mexe com Vault/secrets");
// obterDealerToken() so' pode aparecer INDIRETAMENTE (via diagnosticarTokenUnitv),
// nunca importado direto pelo monitor:
proibido(/obterDealerToken/i, "nao importa obterDealerToken diretamente (uso e' indireto, via diagnosticarTokenUnitv da Fase 1)");

// --- escrita so' em autocura_unitv_monitor_estado ---
proibido(/from\(["'`]tokens_renovacao["'`]\)|from\(["'`]renovacoes_lote["'`]\)/i, "nao acessa tokens_renovacao/renovacoes_lote");
proibido(/\.insert\(|\.upsert\(|\.delete\(/i, "nao faz insert/upsert/delete em nenhuma tabela (so' update em monitor_estado)");
// todo .update( do monitor e' em autocura_unitv_monitor_estado
{
  const updates = [...blob.matchAll(/from\(\s*["'`]([a-z_]+)["'`]\s*\)\s*\.update\(/g)].map((m) => m[1]);
  const foraDoEstado = updates.filter((t) => t !== "autocura_unitv_monitor_estado");
  if (foraDoEstado.length) { falhas++; console.error(`FALHA: update fora de monitor_estado -> ${foraDoEstado.join(",")}`); }
  else console.log(`ok: todo .update() e' em autocura_unitv_monitor_estado (${updates.length} ocorrencia(s))`);
}

// --- login / CAPTCHA ---
proibido(/captcha|CAPTCHA|validateCode|dealer-core\/security|UNITV_DEALER_LOGIN|UNITV_DEALER_SENHA|\/login\b/i, "nao faz login nem resolve CAPTCHA");
proibido(/playwright|chromium|puppeteer/i, "nao usa navegador headless");

// --- lock: aquisicao ATOMICA, sem SELECT separado para decidir ---
exigido(/rpc\(\s*["'`]autocura_unitv_monitor_adquirir_lock["'`]\s*\)/, "adquire o lock via a RPC atomica autocura_unitv_monitor_adquirir_lock");
proibido(/from\(\s*["'`]autocura_unitv_monitor_estado["'`]\s*\)\s*\.select\(/, "NAO faz SELECT em autocura_unitv_monitor_estado (estado vem do retorno da RPC do lock)");
proibido(/\.maybeSingle\(\)[\s\S]{0,200}tick_em_andamento_desde/, "nao decide a aquisicao do lock a partir de um SELECT->maybeSingle");

// --- confirmacoes positivas ---
exigido(/diagnosticarTokenUnitv|diagnosticar\(/, "chama a rotina de diagnostico (Fase 1)");
exigido(/motivoOrigem:\s*["'`]monitor-proativo["'`]/, "usa motivoOrigem 'monitor-proativo'");
exigido(/numeroJose:\s*["'`]{2}/, "passa numeroJose:'' ao diagnostico (suprime alerta da Fase 1)");
exigido(/AUTOCURA_UNITV_MONITOR_TOKEN/, "a EF valida X-Internal-Token == AUTOCURA_UNITV_MONITOR_TOKEN");
exigido(/tick_em_andamento_desde/, "usa o lock anti-sobreposicao");
// liberacao CONDICIONAL do lock (nao "rouba" o de um sucessor)
exigido(/update\(\s*\{\s*tick_em_andamento_desde:\s*null\s*\}\s*\)[\s\S]{0,120}\.eq\(\s*["'`]tick_em_andamento_desde["'`]/, "libera o lock de forma CONDICIONAL (eq tick_em_andamento_desde == valor adquirido)");

console.log(falhas === 0 ? "\nTODOS OS TESTES OK" : `\n${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
