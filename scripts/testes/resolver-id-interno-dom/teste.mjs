// Testes unitarios da funcao pura resolverIdInternoDoDom
// (scripts/lib/resolver-id-interno-dom.mjs) -- desambiguacao do
// idClienteInterno a partir dos elementos JA' LIDOS do DOM renderizado
// pelo Playwright. Sem side effect, sem rede, sem Playwright.
//
// Como rodar: npx tsx scripts/testes/resolver-id-interno-dom/teste.mjs

import { resolverIdInternoDoDom, normalizarTelefone } from "../../lib/resolver-id-interno-dom.mjs";

let falhas = 0;
function ok(cond, msg) {
  if (!cond) {
    falhas++;
    console.error(`FALHA: ${msg}`);
  } else {
    console.log(`ok: ${msg}`);
  }
}

const NOME = "Meu Uso Testes";
const TEL = "5517981625486";

// --- 1: exatamente um elemento com nome + telefone ---
{
  const els = [
    { id: "999999", nome: "Outro Cliente", telefone: "5511999990000" },
    { id: "1569178", nome: NOME, telefone: TEL },
    { id: "111", nome: "Mais Um", telefone: "5511111111111" },
  ];
  const r = resolverIdInternoDoDom(els, NOME, TEL);
  ok(r.ids.length === 1 && r.ids[0] === "1569178", "1: exatamente 1 match -> ids = ['1569178']");
  ok(r.totalBotoes === 3, "1: totalBotoes = 3");
  ok(r.botoesComNomeAlvo === 1, "1: botoesComNomeAlvo = 1");
}

// --- 2: zero correspondencias (nome nao bate) ---
{
  const els = [
    { id: "111", nome: "Fulano", telefone: TEL },
    { id: "222", nome: "Beltrano", telefone: TEL },
  ];
  const r = resolverIdInternoDoDom(els, NOME, TEL);
  ok(r.ids.length === 0, "2: nenhum nome bate -> ids vazio");
  ok(r.totalBotoes === 2 && r.botoesComNomeAlvo === 0, "2: totalBotoes=2, botoesComNomeAlvo=0");
}

// --- 2b: nome bate mas telefone diverge -> zero ---
{
  const els = [{ id: "1569178", nome: NOME, telefone: "5511000009999" }];
  const r = resolverIdInternoDoDom(els, NOME, TEL);
  ok(r.ids.length === 0, "2b: nome bate, telefone diverge -> ids vazio");
  ok(r.botoesComNomeAlvo === 1, "2b: botoesComNomeAlvo = 1 (contou o nome, mas telefone reprovou)");
}

// --- 3: duas correspondencias (mesmo nome+telefone, ids distintos) ---
{
  const els = [
    { id: "100", nome: NOME, telefone: TEL },
    { id: "200", nome: NOME, telefone: TEL },
  ];
  const r = resolverIdInternoDoDom(els, NOME, TEL);
  ok(r.ids.length === 2 && r.ids.includes("100") && r.ids.includes("200"), "3: 2 ids distintos -> ambiguo (ids.length === 2)");
}

// --- 3b: mesmo id repetido em 2 elementos -> 1 id distinto ---
{
  const els = [
    { id: "100", nome: NOME, telefone: TEL },
    { id: "100", nome: NOME, telefone: TEL },
  ];
  const r = resolverIdInternoDoDom(els, NOME, TEL);
  ok(r.ids.length === 1 && r.ids[0] === "100", "3b: mesmo id repetido -> 1 id distinto (Set)");
}

// --- 4: atributos em ordem diferente / com chaves extras ---
{
  const els = [
    { telefone: TEL, id: "1569178", nome: NOME, foo: "bar", classe: "btn btn-sm" }, // ordem de chaves invertida + extras
  ];
  const r = resolverIdInternoDoDom(els, NOME, TEL);
  ok(r.ids.length === 1 && r.ids[0] === "1569178", "4: ordem das chaves / chaves extras nao afetam (leitura por getAttribute, nunca regex)");
}

// --- 5: telefone normalizado (formatacao ignorada dos dois lados) ---
{
  const els = [{ id: "1569178", nome: NOME, telefone: "+55 (17) 98162-5486" }];
  ok(resolverIdInternoDoDom(els, NOME, TEL).ids[0] === "1569178", "5a: telefone com +/espacos/parenteses/traco casa com o alvo puro");
}
{
  const els = [{ id: "1569178", nome: NOME, telefone: TEL }];
  ok(resolverIdInternoDoDom(els, NOME, "  55 17 98162-5486 ").ids[0] === "1569178", "5b: telefoneAlvo formatado tambem e' normalizado");
}
{
  // sem codigo do pais dos dois lados -> ainda casa (normalizacao e' so' 'so digitos', igual a versao antiga)
  const els = [{ id: "777", nome: NOME, telefone: "17-98162-5486" }];
  ok(resolverIdInternoDoDom(els, NOME, "17981625486").ids[0] === "777", "5c: mesmos digitos sem DDI dos dois lados -> casa");
}
{
  ok(normalizarTelefone("+55 (17) 9.8162-5486") === "5517981625486", "5d: normalizarTelefone tira tudo que nao e' digito");
  ok(normalizarTelefone(null) === "" && normalizarTelefone(undefined) === "", "5d: normalizarTelefone(null/undefined) = ''");
}

// --- 6: ausencia de dado ---
{
  ok(resolverIdInternoDoDom([], NOME, TEL).ids.length === 0, "6a: lista vazia -> ids vazio");
  ok(resolverIdInternoDoDom(null, NOME, TEL).ids.length === 0, "6b: entrada nao-array -> ids vazio, sem lancar");
  ok(resolverIdInternoDoDom(undefined, NOME, TEL).totalBotoes === 0, "6c: undefined -> totalBotoes 0, sem lancar");
}
{
  const els = [
    { id: "1569178", nome: NOME, telefone: null }, // telefone ausente
    { id: "1569179", nome: null, telefone: TEL }, // nome ausente
    { nome: NOME, telefone: TEL }, // id ausente
    { id: "", nome: NOME, telefone: TEL }, // id vazio
    { id: "abc123", nome: NOME, telefone: TEL }, // id nao-numerico
    { id: "1569180", nome: NOME, telefone: TEL }, // <- o unico valido
  ];
  const r = resolverIdInternoDoDom(els, NOME, TEL);
  ok(r.ids.length === 1 && r.ids[0] === "1569180", "6d: elementos com nome/telefone/id ausente ou invalido sao ignorados; so' o valido casa");
  ok(r.totalBotoes === 3, "6d: totalBotoes conta so' elementos com id numerico (3: 1569178, 1569179, 1569180)");
}
{
  // telefoneAlvo vazio nunca casa (mesma regra da versao antiga)
  const els = [{ id: "1569178", nome: NOME, telefone: "" }];
  ok(resolverIdInternoDoDom(els, NOME, "").ids.length === 0, "6e: telefoneAlvo vazio nunca casa");
}

// --- 7: nunca escolhe por posicao/ordem (so' por nome+telefone) ---
{
  const elsA = [
    { id: "1", nome: NOME, telefone: TEL },
    { id: "2", nome: "X", telefone: TEL },
  ];
  const elsB = [
    { id: "2", nome: "X", telefone: TEL },
    { id: "1", nome: NOME, telefone: TEL },
  ];
  const rA = resolverIdInternoDoDom(elsA, NOME, TEL);
  const rB = resolverIdInternoDoDom(elsB, NOME, TEL);
  ok(rA.ids.length === 1 && rB.ids.length === 1 && rA.ids[0] === rB.ids[0] && rA.ids[0] === "1", "7: resultado independe da ordem dos elementos");
}

console.log(`\n${falhas === 0 ? "TODOS OS TESTES PASSARAM" : `${falhas} FALHA(S)`}`);
process.exit(falhas === 0 ? 0 : 1);
