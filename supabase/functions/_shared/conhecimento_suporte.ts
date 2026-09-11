// Busca da Base Evolutiva de Suporte (Fase 3, Checkpoint 1 --
// aprovado 2026-09-11). Este arquivo cria SOMENTE a funcao de busca --
// nenhum chamador em produção usa isto ainda (nao importado por
// orchestrator/index.ts nem por nenhuma Edge Function). Ligar isto ao
// Orquestrador e' um checkpoint futuro separado, com autorizacao
// propria.
//
// Reaproveita, SEM ALTERAR, o mesmo algoritmo deterministico de
// palavras-chave ja aprovado em _shared/conhecimento.ts (normaliza ->
// tokeniza -> cada palavra-chave precisa aparecer como sequencia
// CONTIGUA de tokens -> pontuacao = numero de palavras-chave distintas
// que bateram, sem peso, sem frequencia -> unico no topo vence; score
// 0 em tudo, ou empate no topo, -> "nada_encontrado", nunca escolhe
// arbitrariamente). As funcoes puras (normalizar/tokenizar/
// contemSequenciaContigua/pontuarEntrada) estao DUPLICADAS aqui de
// proposito -- Checkpoint 1 e' isolado, _shared/conhecimento.ts
// continua intocado. Compartilhar esse codigo entre os dois modulos
// e' um refactor separado, nao decidido aqui.
//
// Diferenca em relacao a conhecimento.ts: filtro de CONTEXTO
// (aplicativo/servidor/dispositivo), aplicado ANTES da pontuacao, e
// so'-status-ativo:
// - So' consulta linhas com status = 'ativo' -- candidato/revisao/
//   arquivado NUNCA aparecem aqui, sem excecao (o registro real do
//   PlaySim, hoje status='candidato', nunca e' retornado por esta
//   funcao ate ser promovido).
// - Para cada eixo (aplicativo/servidor/dispositivo): se o CHAMADOR
//   informou um valor para aquele eixo, o registro so' e' elegivel se
//   tiver o MESMO valor ou for null (curinga). Se o CHAMADOR NAO
//   informou aquele eixo (undefined/null -- nao sabemos o
//   aplicativo/servidor/dispositivo do cliente nesta chamada), so'
//   registros com null naquele eixo sao elegiveis -- nunca inventamos
//   contexto que o chamador nao nos deu, e um conhecimento MARCADO
//   como especifico de um aplicativo/servidor/dispositivo nunca
//   aparece quando esse dado esta ausente. Decisao explicita desta
//   implementacao (o pedido original so' especificava o caso "se
//   informado"; a ausencia de contexto foi resolvida da forma mais
//   conservadora, coerente com "nunca aplicar um conhecimento
//   especifico fora do contexto correto").

import { getServiceClient } from "./supabase_client.ts";

export type ConhecimentoSuporteResultado =
  | {
      outcome: "encontrado";
      conhecimentoId: string;
      titulo: string;
      procedimento: string;
      score: number;
    }
  | { outcome: "nada_encontrado" }
  | { outcome: "unavailable" };

// Todos os eixos opcionais -- string (valor conhecido), null (sabemos
// que nao se aplica) ou undefined/omitido (nao sabemos). null e
// undefined sao tratados de forma IDENTICA (ver bateContexto) --
// "nao informado", em qualquer uma das duas formas.
export interface ContextoConhecimentoSuporte {
  aplicativo?: string | null;
  servidor?: string | null;
  dispositivo?: string | null;
}

interface EntradaConhecimentoSuporte {
  id: string;
  titulo: string;
  procedimento: string;
  palavras_chave: string[];
  aplicativo: string | null;
  servidor: string | null;
  dispositivo: string | null;
}

// ---------------------------------------------------------------------
// Algoritmo de match -- identico a _shared/conhecimento.ts (Componente
// 2 §7 + esclarecimento 7-A, 2026-08-22: correspondencia por token,
// nunca por substring de caracteres).
// ---------------------------------------------------------------------
function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizar(texto: string): string[] {
  const normalizado = normalizar(texto);
  return normalizado.length ? normalizado.split(" ") : [];
}

function contemSequenciaContigua(
  tokensPergunta: string[],
  tokensChave: string[],
): boolean {
  if (tokensChave.length === 0) return false;
  for (let i = 0; i <= tokensPergunta.length - tokensChave.length; i++) {
    let combina = true;
    for (let j = 0; j < tokensChave.length; j++) {
      if (tokensPergunta[i + j] !== tokensChave[j]) {
        combina = false;
        break;
      }
    }
    if (combina) return true;
  }
  return false;
}

function pontuarEntrada(
  tokensPergunta: string[],
  palavrasChave: string[],
): number {
  let pontos = 0;
  for (const chave of palavrasChave) {
    if (contemSequenciaContigua(tokensPergunta, tokenizar(chave))) {
      pontos++;
    }
  }
  return pontos;
}

// ---------------------------------------------------------------------
// Filtro de contexto -- unica coisa nova em relacao a conhecimento.ts.
// ---------------------------------------------------------------------
function bateContexto(
  valorRegistro: string | null,
  valorContexto: string | null | undefined,
): boolean {
  if (valorContexto == null) {
    // Eixo nao informado pelo chamador: so' registro curinga (null)
    // nesse eixo e' elegivel -- nunca inventa/assume contexto.
    return valorRegistro === null;
  }
  // Eixo informado: registro curinga (null) sempre bate; senao precisa
  // ser exatamente igual.
  return valorRegistro === null || valorRegistro === valorContexto;
}

export async function buscarConhecimentoSuporte(
  pergunta: string,
  contexto: ContextoConhecimentoSuporte = {},
): Promise<ConhecimentoSuporteResultado> {
  const client = getServiceClient();
  const { data, error } = await client
    .from("conhecimento_suporte")
    .select("id, titulo, procedimento, palavras_chave, aplicativo, servidor, dispositivo")
    .eq("status", "ativo");

  if (error) return { outcome: "unavailable" };

  const entradas = (data ?? []) as EntradaConhecimentoSuporte[];

  const elegiveis = entradas.filter(
    (entrada) =>
      bateContexto(entrada.aplicativo, contexto.aplicativo) &&
      bateContexto(entrada.servidor, contexto.servidor) &&
      bateContexto(entrada.dispositivo, contexto.dispositivo),
  );

  const tokensPergunta = tokenizar(pergunta);

  let melhorScore = 0;
  let candidatosNoTopo: EntradaConhecimentoSuporte[] = [];

  for (const entrada of elegiveis) {
    const score = pontuarEntrada(tokensPergunta, entrada.palavras_chave ?? []);
    if (score === 0) continue;
    if (score > melhorScore) {
      melhorScore = score;
      candidatosNoTopo = [entrada];
    } else if (score === melhorScore) {
      candidatosNoTopo.push(entrada);
    }
  }

  if (melhorScore === 0 || candidatosNoTopo.length !== 1) {
    return { outcome: "nada_encontrado" };
  }

  const vencedor = candidatosNoTopo[0];
  return {
    outcome: "encontrado",
    conhecimentoId: vencedor.id,
    titulo: vencedor.titulo,
    procedimento: vencedor.procedimento,
    score: melhorScore,
  };
}
