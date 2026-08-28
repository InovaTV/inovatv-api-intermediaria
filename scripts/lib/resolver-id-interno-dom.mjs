// Desambiguacao do idClienteInterno a partir de elementos JA' LIDOS do
// DOM RENDERIZADO pelo Playwright -- nunca do HTML cru.
//
// Motivo (investigacao 2026-08-28, docs/renovacao_automatica): a pagina
// do cliente no Rocket deixou de vir server-renderizada no HTML que um
// fetch cru recebe -- e' materializada por JavaScript. O id do cliente
// vive num atributo do botao "Add Pagamento"
// (button[data-bs-target="#modal-add-pagamento"], atributo `cliente_id`,
// mais `nome`/`telefone`) -- so' presente no DOM depois que o JS roda.
// Por isso a resolucao acontece dentro do Playwright (que executa o
// JS), e este modulo so' faz a parte pura: dada a lista ja extraida do
// DOM, decidir qual id casa.
//
// Entrada: array de { id, nome, telefone } -- um por elemento
// [data-bs-target="#modal-add-pagamento"][cliente_id] lido do DOM.
// `id` = valor do atributo `cliente_id` (string de digitos).
// `nome`/`telefone` sao atributos do proprio elemento (a ORDEM dos
// atributos no HTML nao importa -- leitura por getAttribute, nunca
// regex sobre texto).
//
// Regras (identicas a versao antiga, so' a origem do dado mudou):
//   - normaliza telefone (so' digitos) dos dois lados;
//   - `nome` precisa bater EXATAMENTE com nomeAlvo;
//   - `telefone` normalizado precisa bater com telefoneAlvo normalizado
//     (telefoneAlvo vazio nunca casa);
//   - NUNCA escolhe por posicao/ordem;
//   - devolve todos os ids distintos que casam -- o chamador exige
//     exatamente 1 (0 -> "nao encontrado"; 2+ -> "ambiguo").

export function normalizarTelefone(bruto) {
  return String(bruto ?? "").replace(/\D/g, "");
}

export function resolverIdInternoDoDom(elementos, nomeAlvo, telefoneAlvo) {
  const lista = Array.isArray(elementos) ? elementos : [];
  const telAlvo = normalizarTelefone(telefoneAlvo);
  const ids = new Set();
  let totalBotoes = 0;
  let botoesComNomeAlvo = 0;

  for (const el of lista) {
    const id = String(el?.id ?? "").trim();
    if (!/^\d+$/.test(id)) continue;
    totalBotoes++;

    if (el?.nome !== nomeAlvo) continue;
    botoesComNomeAlvo++;

    if (telAlvo.length > 0 && normalizarTelefone(el?.telefone) === telAlvo) {
      ids.add(id);
    }
  }

  return { ids: [...ids], totalBotoes, botoesComNomeAlvo };
}
