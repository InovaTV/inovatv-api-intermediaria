// Fake configuravel do pacote npm "playwright" -- copia byte a byte do
// fake ja usado (e comprovado) em
// scripts/testes/renovacao_sigma_workflow_misto/fake_playwright.mjs.
// Cada suite mantem sua propria copia (mesmo padrao ja existente no
// projeto) para nao acoplar suites de teste diferentes.

let cfg;
let eventos;

export function configurarPlaywright(c = {}) {
  cfg = {
    dom: [], // elementos da pagina: [{ tag?, class?, ...attrs }]
    opcoesSelect: [], // textos (ou {text,value}) de <option> do <select> visivel
    waitForSelectorLanca: false,
    launchLanca: false,
    proximoSeq: () => 0,
    // Valor de input[name="telas"] no formulario "ADD Pagamento" (o
    // Rocket ja preenche sozinho com o cadastro do cliente). Default
    // "1" cobre os cenarios que nao testam telas explicitamente. `null`
    // simula o campo NAO EXISTIR na pagina (locator nunca resolve).
    telasInputValue: "1",
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

function optionLocatorsFake() {
  return (cfg.opcoesSelect || []).map((item, i) => {
    const opt = typeof item === "string" ? { text: item, value: `fake-value-${i}` } : item;
    return {
      textContent: async () => opt.text ?? "",
      getAttribute: async (name) => (name === "value" ? (opt.value ?? "") : null),
    };
  });
}

function selectLocatorFake(sel = "select:visible") {
  const options = optionLocatorsFake();
  return {
    locator: (child) =>
      child === "option"
        ? { all: async () => options, allTextContents: async () => options.map(async (o) => (await o.textContent()) ?? "") }
        : locatorFake(`${sel} ${child}`),
    selectOption: async (o) => ev("selectOption", { value: o?.value ?? null, label: o?.label ?? null }),
  };
}

function locatorFake(sel) {
  return {
    click: async () => ev("click", { sel }),
    check: async () => ev("check", { sel }),
    uncheck: async () => ev("uncheck", { sel }),
    waitFor: async () => ev("waitFor", { sel }),
    all: async () => (sel === "select:visible" ? [selectLocatorFake(sel)] : []),
    locator: (s) => {
      if (s === "option" && sel.includes("#id_sigma_package_id_select")) {
        return { all: async () => optionLocatorsFake() };
      }
      return locatorFake(`${sel} ${s}`);
    },
    allTextContents: async () => [],
    selectOption: async (o) => ev("selectOption", { value: o?.value ?? null, label: o?.label ?? null }),
    inputValue: async () => {
      if (sel.includes('input[name="telas"]')) {
        ev("inputValue", { sel });
        if (cfg.telasInputValue === null) {
          throw new Error(`elemento nao encontrado (fake): ${sel}`);
        }
        return cfg.telasInputValue;
      }
      return "";
    },
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
  waitForLoadState: async (state) => ev("waitForLoadState", { state }),
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
