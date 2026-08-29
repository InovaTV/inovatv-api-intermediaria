// Fake minimo de "playwright" -- nesta suite (so' cenarios UniTV) o
// Playwright NUNCA deve ser lancado. Se for, o teste falha alto.
export const chromium = {
  launch() {
    throw new Error("fake_playwright: chromium.launch NAO deveria ser chamado num cenario UniTV");
  },
};
