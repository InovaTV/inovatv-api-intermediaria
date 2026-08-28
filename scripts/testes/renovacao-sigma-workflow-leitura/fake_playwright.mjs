// Fake configuravel do pacote npm "playwright" -- so' pra importar o
// arquivo REAL scripts/renovacao-sigma-workflow.mjs neste ambiente de
// teste (playwright so' e' instalado dentro do job do GitHub Actions).
//
// Suporta o fluxo inteiro: goto -> waitForSelector -> $$eval ->
// locator().click()/check()/all() -> select -> close(). Registra todos
// os eventos, com um numero de sequencia compartilhado com o fetch
// mock do teste (via cfg.proximoSeq) para permitir assercoes de ORDEM.
//
// $$eval e waitForSelector sao SELETOR-CIENTES: `cfg.dom` descreve os
// elementos da pagina como objetos { tag?, class?, ...atributos } e o
// fake filtra por seletores simples do tipo
// [attr="val"] / [attr] / .classe. Isso permite testar que o seletor
// '[data-bs-target="#modal-add-pagamento"][cliente_id]' pega o botao
// "Add Pagamento" e ignora o botao "Editar" (que tambem tem cliente_id).
// $$eval roda a funcao `fn` de verdade contra nós-fake (id/getAttribute/
// className), exercitando o mapeamento real do workflow.

let cfg;
let eventos;

export function configurarPlaywright(c = {}) {
  cfg = {
    dom: [], // elementos da pagina: [{ tag?, class?, ...attrs }]
    opcoesSelect: [], // textos de <option> do <select> visivel
    waitForSelectorLanca: false,
    launchLanca: false,
    proximoSeq: () => 0,
    ...c,
  };
  eventos = [];
}
export function eventosPlaywright() {
  return eventos;
}
configurarPlaywright();

function ev(tipo, extra = {}) {
  eventos.push({ tipo, seq: cfg.proximoSeq(), ...extra });
}

// matcher de seletor simples: tokens [a="b"], [a], .classe (tagname ignorado)
function matchSeletor(desc, seletor) {
  const toks = seletor.match(/\[[^\]]+\]|\.[A-Za-z0-9_-]+/g) || [];
  if (toks.length === 0) return false;
  return toks.every((t) => {
    if (t[0] === "[") {
      const m = /^\[\s*([^\]=\s]+)\s*(?:=\s*"([^"]*)")?\s*\]$/.exec(t);
      if (!m) return false;
      const v = desc[m[1]];
      if (m[2] === undefined) return v !== undefined && v !== null;
      return String(v) === m[2];
    }
    // .classe
    return String(desc.class || "").split(/\s+/).includes(t.slice(1));
  });
}

function noFake(desc) {
  return {
    id: desc.id || "",
    className: desc.class || "",
    getAttribute: (k) => (desc[k] === undefined ? null : desc[k]),
  };
}

function selectLocatorFake() {
  return {
    locator: () => ({ allTextContents: async () => cfg.opcoesSelect }),
    selectOption: async (o) => ev("selectOption", { label: o?.label ?? null }),
  };
}

function locatorFake(sel) {
  return {
    click: async () => ev("click", { sel }),
    check: async () => ev("check", { sel }),
    waitFor: async () => ev("waitFor", { sel }),
    all: async () => (sel === "select:visible" ? [selectLocatorFake()] : []),
    locator: (s) => locatorFake(`${sel} ${s}`),
    allTextContents: async () => [],
    selectOption: async () => {},
  };
}

const pageFake = {
  goto: async (url) => ev("goto", { url }),
  waitForSelector: async (sel) => {
    ev("waitForSelector", { sel });
    if (cfg.waitForSelectorLanca) throw new Error("timeout waitForSelector");
    if (!(cfg.dom || []).some((d) => matchSeletor(d, sel))) {
      throw new Error("waitForSelector: nenhum elemento casa (fake)");
    }
  },
  $$eval: async (sel, fn) => {
    ev("$$eval", { sel });
    const casam = (cfg.dom || []).filter((d) => matchSeletor(d, sel)).map(noFake);
    return typeof fn === "function" ? fn(casam) : casam;
  },
  locator: (sel) => locatorFake(sel),
  waitForTimeout: async () => {},
};

const contextFake = {
  addCookies: async () => ev("addCookies"),
  newPage: async () => pageFake,
};

export const chromium = {
  launch: async () => {
    ev("launch");
    if (cfg.launchLanca) throw new Error("chromium.launch falhou (fake)");
    return {
      newContext: async () => contextFake,
      close: async () => ev("close"),
    };
  },
};
