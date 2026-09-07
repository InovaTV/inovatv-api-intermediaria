// So' para o import `{ buscarFilhosDoLote }` do resolver carregar.
// Nenhum dos 11 casos alcanca este caminho (o caso "2+ candidatos + 1"
// retorna resposta_nao_reconhecida ANTES de montar a lista; o caso
// "2+ candidatos + palavra" so' verifica outcome === "apresentar_opcoes"
// e que a mensagem e' string).
export async function buscarFilhosDoLote() {
  return [];
}
