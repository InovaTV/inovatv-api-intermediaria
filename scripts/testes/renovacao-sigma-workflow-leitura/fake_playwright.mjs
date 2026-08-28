// Fake configuravel do pacote npm "playwright" -- so' pra importar o
// arquivo REAL scripts/renovacao-sigma-workflow.mjs neste ambiente de
// teste (playwright so' e' instalado dentro do job do GitHub Actions).
//
// Diferente da versao anterior (que lancava em launch() de proposito),
// esta versao suporta o fluxo inteiro: goto -> waitForSelector ->
// $$eval (devolve os elementos configurados, ja no formato
// {id,nome,telefone}) -> locator().click()/check()/all() -> select ->
// close(). Registra todos os eventos, com um numero de sequencia
// compartilhado com o fetch mock do teste (via cfg.proximoSeq) para
// permitir assercoes de ORDEM (Playwright antes do contexto Sigma).

let cfg;
let eventos;

export function configurarPlaywright(c = {}) {
  cfg = {
    elementos: [], // o que $$eval retorna (ja como {id,nome,telefone})
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
  },
  $$eval: async (sel) => {
    ev("$$eval", { sel });
    return cfg.elementos;
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
