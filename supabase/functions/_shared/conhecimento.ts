// Camada de Conhecimento Empresarial (Componente 2, inovatv_central
// CLAUDE.md, "Especificacao Tecnica -- Componente 2" + esclarecimento
// 7-A, 2026-08-22: correspondencia por token, nunca por substring de
// caracteres).
//
// Responsabilidade unica: dado o texto da pergunta do cliente --
// NUNCA dado de cliente, nunca telefone, nunca /status -- devolve uma
// entrada de conhecimento institucional selecionada, "nada
// encontrado", ou "unavailable" (falha de consulta -- nunca
// confundido com "nada encontrado", Componente 2 §9). Nao decide
// responder/transferir -- isso continua sendo Gemini + Validador +
// Orquestrador (Componente 1 §9).
//
// Algoritmo (Componente 2 §7 + 7-A): normaliza (minusculas, sem
// acento/pontuacao) -> tokeniza -> cada palavra-chave (token unico ou
// frase) precisa aparecer como sequencia CONTIGUA de tokens na
// pergunta -> pontuacao = numero de palavras-chave distintas que
// bateram, sem peso, sem frequencia (cada uma conta no maximo 1x,
// mesmo repetida no texto) -> maior score no topo: unico -> retorna;
// score 0 em tudo, ou empate no topo -> "nada_encontrado" (ambiguo
// nunca escolhe arbitrariamente, retorna nada, igual "sem
// correspondencia" do ponto de vista do chamador).

import { getServiceClient } from "./supabase_client.ts";

export type ConhecimentoResultado =
  | { outcome: "encontrado"; titulo: string; conteudo: string }
  | { outcome: "nada_encontrado" }
  | { outcome: "unavailable" };

interface EntradaConhecimento {
  titulo: string;
  conteudo: string;
  palavras_chave: string[];
}

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

export async function buscarConhecimentoRelevante(
  pergunta: string,
): Promise<ConhecimentoResultado> {
  const client = getServiceClient();
  const { data, error } = await client
    .from("conhecimento_institucional")
    .select("titulo, conteudo, palavras_chave")
    .eq("ativo", true);

  if (error) return { outcome: "unavailable" };

  const entradas = (data ?? []) as EntradaConhecimento[];
  const tokensPergunta = tokenizar(pergunta);

  let melhorScore = 0;
  let candidatosNoTopo: EntradaConhecimento[] = [];

  for (const entrada of entradas) {
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

  return {
    outcome: "encontrado",
    titulo: candidatosNoTopo[0].titulo,
    conteudo: candidatosNoTopo[0].conteudo,
  };
}
