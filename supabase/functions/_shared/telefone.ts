// Normalizacao de telefone (Bug 3, inovatv_central CLAUDE.md, bateria
// de testes reais pelo Webhook, 2026-08-21). Achado real: o mesmo
// cliente teve mensagens processadas com o telefone em dois formatos
// diferentes ("5517981625486" e "17981625486"), e conversas_estado
// compara/grava telefone por igualdade exata (`.eq("telefone", ...)`)
// -- sem normalizacao, isso cria duas conversas para o mesmo cliente
// real, cada uma com seu proprio historico e estado.
//
// Regra por TAMANHO em digitos, nunca por "comeca com 55": DDD 55 e'
// uma regiao real do Brasil (Rio Grande do Sul) -- um numero local de
// la, sem codigo do pais, ja comeca com "55" naturalmente
// (ex.: "55991234567", 11 digitos). Checar "startsWith('55')" trataria
// esse caso como se ja tivesse codigo do pais, incorretamente. O
// tamanho (11 vs. 13 digitos) e' o sinal confiavel.
//
// Escopo desta funcao, deliberadamente minimo (aprovado, 2026-08-21):
// so estabelece a representacao canonica interna (usada por
// conversas_estado -- Componente 5 §7). NAO decide o formato enviado
// ao Rocket (`chamarMatch`) nem faz nenhuma migracao/fusao de conversa
// historica ja existente -- essas duas coisas ficam para decisao
// separada, com checkpoint proprio (alteracao real de dado de
// producao).
//
// Tamanho inesperado (nem 11 nem 13 digitos apos limpar formatacao):
// nunca inventa um formato -- so remove pontuacao/espacos e devolve
// como veio. Isso preserva a informacao (nunca descarta o telefone),
// mas NAO torna a entrada "valida" -- um telefone malformado continua
// malformado depois de passar por aqui, so sem caracteres de
// formatacao. Chamadores downstream (buscarOuCriarConversa, /match,
// envio ao WhatsApp) recebem exatamente esse valor tal como esta,
// sem nenhuma validacao adicional feita por esta funcao.
export function normalizarTelefone(bruto: string): string {
  const digitos = bruto.replace(/\D/g, "");
  if (digitos.length === 11) return `55${digitos}`;
  if (digitos.length === 13 && digitos.startsWith("55")) return digitos;
  return digitos;
}
