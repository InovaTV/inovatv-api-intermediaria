// Normalizacao de APRESENTACAO de mensagens de sistema -- nunca altera
// o texto real gravado no banco (as RPCs assumir_atendimento/
// encerrar_atendimento_humano continuam escrevendo o texto tecnico
// original). Extraida de [id]/page.tsx (Fatia 3) para ser reaproveitada
// tambem pela previa da lista (layout.tsx) -- mesma regra, um unico
// lugar. Qualquer mensagem de sistema que nao bata com os 2 padroes
// continua exibida como veio, pra nao esconder informacao ainda nao
// tratada (ex.: "Transferencia automatica: ...", de
// acionar_transferencia_humana).
export function apresentarMensagemSistema(texto: string): string {
  if (/^Operador .+ assumiu manualmente$/.test(texto)) {
    return "Atendimento humano iniciado";
  }
  if (/^Atendimento encerrado por .+$/.test(texto)) {
    return "Atendimento humano encerrado";
  }
  return texto;
}
