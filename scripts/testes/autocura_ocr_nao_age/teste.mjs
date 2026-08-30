// F3-A -- varredura ESTATICA. Trava, por leitura do codigo-fonte, que
// os componentes de F3-A SO' observam/medem -- nunca logam, nunca agem.
//
// Arquivos F3-A:
//   scripts/lib/unitv-captcha-ocr.mjs
//   scripts/autocura-unitv-ocr.mjs
//   .github/workflows/autocura-unitv-ocr.yml
//   supabase/functions/_shared/autocura_ocr_dispatch.ts
//   supabase/functions/_shared/autocura_ocr_agendador.ts
//   supabase/functions/autocura-unitv-ocr-agendador/index.ts
//   supabase/functions/_shared/autocura_resultado.ts
//   supabase/functions/autocura-unitv-resultado/index.ts
//
// Rodar: npx tsx scripts/testes/autocura_ocr_nao_age/teste.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const ARQ_CODIGO = [
  "scripts/lib/unitv-captcha-ocr.mjs",
  "scripts/autocura-unitv-ocr.mjs",
  "supabase/functions/_shared/autocura_ocr_dispatch.ts",
  "supabase/functions/_shared/autocura_ocr_agendador.ts",
  "supabase/functions/autocura-unitv-ocr-agendador/index.ts",
  "supabase/functions/_shared/autocura_resultado.ts",
  "supabase/functions/autocura-unitv-resultado/index.ts",
];

// remove comentarios (os cabecalhos descrevem as proibicoes)
const semComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const codigo = ARQ_CODIGO.map((f) => semComentarios(readFileSync(join(RAIZ, f), "utf8"))).join("\n");

// o YAML NAO tem comentarios de bloco; tira so' linhas '#'
const yaml = readFileSync(join(RAIZ, ".github/workflows/autocura-unitv-ocr.yml"), "utf8")
  .split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");

let falhas = 0;
function proibido(re, alvo, m) { const x = alvo.match(re); if (x) { falhas++; console.error(`FALHA: ${m} -- casou: ${JSON.stringify(x[0])}`); } else console.log(`ok: ${m}`); }
function exigido(re, alvo, m) { if (!re.test(alvo)) { falhas++; console.error(`FALHA: ${m}`); } else console.log(`ok: ${m}`); }

// ---- CODIGO: nada de login / credencial ----
proibido(/UNITV_DEALER_LOGIN|UNITV_DEALER_SENHA/i, codigo, "codigo nao referencia UNITV_DEALER_LOGIN/SENHA");
proibido(/\/api\/(auth\/)?login|SavePW|dealer.?login/i, codigo, "codigo nao chama endpoint de login");
proibido(/\.fill\(|\.type\(|submit\(\)|form\.submit|click\([^)]*(login|entrar|acessar)/i, codigo, "codigo nao preenche/submete formulario de login");

// ---- CODIGO: nada de renovacao / cobranca / Vault / secret ----
proibido(/\/api\/account\/renew/i, codigo, "codigo nao referencia /api/account/renew");
proibido(/\/pagamento\/add\/|unitv-renovar/i, codigo, "codigo nao toca a renovacao Sigma/UniTV");
proibido(/cobrancas_pix|criarCobranca|openpix|OPENPIX/i, codigo, "codigo nao mexe com cobranca");
proibido(/unitv_dealer_token_definir|unitv_dealer_token_ler/i, codigo, "codigo nao le/escreve o Vault do dealer token");
proibido(/vault\.|secrets\s+set|setSecret/i, codigo, "codigo nao mexe com Vault/secrets");
proibido(/obterDealerToken/i, codigo, "codigo nao usa o dealer token");

// ---- CODIGO: agendador/dispatch so' 'calibracao', nunca 'disparo' nem healer ----
proibido(/["'`]disparo["'`]/, codigo, "codigo nunca usa o tipo 'disparo'");
proibido(/autocura_unitv_pode_disparar[\s\S]{0,60}["'`]disparo["'`]/, codigo, "pode_disparar so' e' chamado com 'calibracao'");
proibido(/autocura-unitv-token\.yml|healer/i, codigo, "dispatch aponta so' para o workflow de OCR, nunca o healer");
proibido(/from\(\s*["'`]tokens_renovacao["'`]\s*\)|from\(\s*["'`]renovacoes_lote["'`]\s*\)/, codigo, "codigo nao acessa tabelas de renovacao");

// ---- CODIGO: OCR nao persiste imagem nem valor resolvido ----
proibido(/writeFileSync|fs\.write|appendFile/i, codigo, "runner OCR nao grava arquivo (nao persiste CAPTCHA)");
proibido(/console\.log\([^)]*predicao|console\.log\([^)]*\.join\(""\)/, codigo, "nao loga a string de digitos prevista");
proibido(/(base64|sha256|md5|hash)\([^)]*(img|captcha|png)/i, codigo, "nao gera hash/base64 da imagem para persistir");
exigido(/predicao:\s*_p/, codigo, "runner descarta `predicao` antes de guardar/reportar");

// ---- YAML: workflow de OCR sem credenciais de login ----
proibido(/UNITV_DEALER_LOGIN|UNITV_DEALER_SENHA/i, yaml, "workflow autocura-unitv-ocr.yml NAO tem UNITV_DEALER_LOGIN/SENHA no env");
exigido(/AUTOCURA_UNITV_OCR_CALLBACK_TOKEN/, yaml, "workflow usa AUTOCURA_UNITV_OCR_CALLBACK_TOKEN");
exigido(/node scripts\/autocura-unitv-ocr\.mjs/, yaml, "workflow roda o runner de OCR");

// ---- confirmacoes positivas ----
exigido(/security\/get-info|form_item_validateCode/, codigo, "runner busca o CAPTCHA (endpoint pre-auth / <img>)");
exigido(/AUTOCURA_UNITV_OCR_AGENDADOR_TOKEN/, codigo, "a EF agendadora valida X-Internal-Token");
exigido(/AUTOCURA_UNITV_OCR_CALLBACK_TOKEN/, codigo, "a EF de callback valida X-Internal-Token");
exigido(/autocura_unitv_expirar_orfaos/, codigo, "o agendador chama expirar_orfaos");
exigido(/autocura_unitv_ocr_metricas/, codigo, "o callback grava em autocura_unitv_ocr_metricas");

console.log(falhas === 0 ? "\nTODOS OS TESTES OK" : `\n${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
