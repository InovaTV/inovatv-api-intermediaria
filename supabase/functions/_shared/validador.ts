// Validador Deterministico (Componente 4, inovatv_central CLAUDE.md,
// frente "IA propria"). Confere a saida estruturada do Gemini contra o
// contexto real enviado na mesma chamada -- NUNCA outra IA, so
// comparacao de texto/regex deterministica (Componente 4 §1).
//
// Nao chama /match, /status ou Gemini de novo (Componente 4 §4). Nao
// decide se a transferencia era "a decisao certa" -- isso e'
// autoridade ja delegada ao Gemini (Componente 1 §9); o validador so
// confere seguranca/politica (SEMPRE roda, §6/§8) e afirmacoes
// factuais checaveis (SO roda se houver algo pra checar, §7/§8). Na
// duvida, sempre reprova (§9) -- nenhuma checagem abaixo "deixa
// passar" por falha de extracao/ambiguidade.
//
// Limitacao conhecida, documentada (nao escondida, mesmo espirito do
// Componente 4 §7 pra plano/servidor): nao ha checagem de "nome de
// outro cliente citado em prosa livre" -- comparar palavra
// capitalizada do texto contra nomes do contexto teria alto risco de
// falso positivo (saudacoes, nomes de produto/servidor) sem NLP. So
// telefone (padrao numerico confiavel), data, contagem de acessos e
// plano/servidor ROTULADOS explicitamente sao checados.
//
// Motivos de reprovacao possiveis (para consumo futuro pelo log do
// Componente 1 §19 -- log em si nao implementado aqui):
//   formato:objeto_invalido
//   formato:tipo_invalido
//   formato:texto_vazio_ou_invalido
//   seguranca:possivel_credencial
//   seguranca:telefone_nao_reconhecido
//   seguranca:valor_nao_confere
//   factual:data_nao_confere
//   factual:contagem_acessos_ambigua
//   factual:contagem_acessos_diverge
//   factual:plano_ou_servidor_nao_confere

export type ValidacaoResultado =
  | { aprovado: true }
  | { aprovado: false; motivo: string };

interface AcessoContexto {
  nome: string;
  plano: string;
  servidor: string;
  vencimento: string;
  telas: string;
}

interface ContextoParseado {
  telefone: string | null;
  acessos: AcessoContexto[];
}

const REGEX_DATA = /\b\d{2}\/\d{2}\/\d{4}(?:\s\d{2}:\d{2})?\b/g;
// Data ISO 8601 como o /status real devolve em "vencimento" (Componente
// 1 §7) -- contexto.ts repassa esse valor sem reformatar. So a parte
// AAAA-MM-DD e' usada na comparacao factual (Gemini nunca cita hora ao
// parafrasear a data, confirmado em evidencia real da Etapa 5/6).
const REGEX_DATA_ISO_CONTEXTO = /\b(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}/g;
const REGEX_TELEFONE = /\b\d{8,13}\b/g;
const REGEX_VALOR = /R\$\s?[\d.,]+/gi;
const REGEX_BLOCO_ACESSO =
  /Nome:\s*([^·\n]+?)\s*·\s*Plano:\s*([^·\n]+?)\s*·\s*Servidor:\s*([^·\n]+?)\s*·\s*Vencimento:\s*([^·\n]+?)\s*·\s*Telas:\s*([^·\n]+?)(?=\n|$)/g;
const REGEX_TELEFONE_CONTEXTO = /Telefone:\s*([^\n]+)/;
const REGEX_PLANO_ROTULADO = /(?:^|\s)plano\s*:\s*([A-Za-zÀ-ÿ0-9]+)/gi;
const REGEX_SERVIDOR_ROTULADO = /(?:^|\s)servidor\s*:\s*([A-Za-zÀ-ÿ0-9]+)/gi;

const GATILHOS_CREDENCIAL = [
  "senha",
  "device_key",
  "device key",
  "chave de dispositivo",
  "otp",
];

// "nao"/"não" ja cobrem as demais frases por substring -- mantidas
// explicitas so pra documentar as formas de recusa realmente vistas
// em teste (Rodadas 3/4).
const MARCADORES_NEGACAO = [
  "não",
  "nao",
  "não tenho",
  "não está",
  "não consta",
  "não posso",
  "não encontrei",
  "não disponível",
];
const JANELA_NEGACAO = 40;

// Achado real em teste (2026-08-21, bateria de testes reais pelo
// Webhook, Caso 2): a regex de contagem casava "um" dentro de "mais de
// um acesso", lendo como afirmacao literal de 1 acesso -- quando na
// verdade "mais de um" significa "varios", o oposto. Esses
// quantificadores aproximados nunca afirmam uma contagem exata, entao
// o numeral que os segue nao deve virar uma comparacao factual.
const MARCADORES_QUANTIFICADOR_APROXIMADO = [
  "mais de",
  "mais que",
  "pelo menos",
  "acima de",
  "menos de",
  "menos que",
];
const JANELA_QUANTIFICADOR = 15;

function textoTemQuantificadorAproximadoAntes(
  texto: string,
  indice: number,
): boolean {
  const inicio = Math.max(0, indice - JANELA_QUANTIFICADOR);
  const janela = texto.slice(inicio, indice).toLowerCase();
  return MARCADORES_QUANTIFICADOR_APROXIMADO.some((m) => janela.includes(m));
}

// Lista fixa de numerais por extenso (Componente 4 §7). Forma digito
// e' livre (\d+), sem lista fixa.
const NUMERAIS: Record<string, number> = {
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  três: 3,
  tres: 3,
  quatro: 4,
  cinco: 5,
};
const NUMERAL_ALT = [...Object.keys(NUMERAIS), "\\d+"].join("|");
// So o ramo "numeral antes de acesso(s)" (ex.: "2 acessos", "dois
// acessos") -- e' a unica ordem que corresponde a uma declaracao de
// CONTAGEM TOTAL (Componente 4 §7). A ordem inversa ("acesso 1",
// "Acesso 1/2", "acesso: 1") e' o formato de IDENTIFICACAO individual
// que o proprio contexto.ts produz e que o Componente 1 §8 espera ser
// ecoado -- nunca deve ser lida como afirmacao de quantidade.
const REGEX_CONTAGEM_ACESSOS = new RegExp(
  `\\b(${NUMERAL_ALT})\\s+acessos?\\b`,
  "gi",
);

function reprovar(motivo: string): ValidacaoResultado {
  return { aprovado: false, motivo };
}

function parseContexto(contexto: string | null): ContextoParseado {
  if (!contexto) return { telefone: null, acessos: [] };

  const telefoneMatch = contexto.match(REGEX_TELEFONE_CONTEXTO);
  const telefone = telefoneMatch ? telefoneMatch[1].trim() : null;

  const acessos: AcessoContexto[] = [];
  for (const m of contexto.matchAll(REGEX_BLOCO_ACESSO)) {
    acessos.push({
      nome: m[1].trim(),
      plano: m[2].trim(),
      servidor: m[3].trim(),
      vencimento: m[4].trim(),
      telas: m[5].trim(),
    });
  }
  return { telefone, acessos };
}

function mascararDatas(texto: string): string {
  return texto.replace(REGEX_DATA, "");
}

// Normaliza uma data DD/MM/AAAA (com hora opcional, ignorada) do texto
// do Gemini para AAAA-MM-DD, pra comparar contra as datas ISO extraidas
// do contexto. Retorna "" se o formato nao bater com o esperado.
function normalizarDataBr(dataBr: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(dataBr);
  if (!m) return "";
  const [, dd, mm, aaaa] = m;
  return `${aaaa}-${mm}-${dd}`;
}

// Extrai o conjunto de datas (AAAA-MM-DD) presentes no contexto bruto,
// reconhecendo o formato ISO 8601 real do /status.
function extrairDatasIsoContexto(contextoBruto: string): Set<string> {
  const datas = new Set<string>();
  for (const m of contextoBruto.matchAll(REGEX_DATA_ISO_CONTEXTO)) {
    datas.add(`${m[1]}-${m[2]}-${m[3]}`);
  }
  return datas;
}

function textoTemNegacaoProxima(texto: string, indice: number): boolean {
  const inicio = Math.max(0, indice - JANELA_NEGACAO);
  const fim = Math.min(texto.length, indice + JANELA_NEGACAO);
  const janela = texto.slice(inicio, fim).toLowerCase();
  return MARCADORES_NEGACAO.some((m) => janela.includes(m));
}

// --- Seguranca/politica (SEMPRE roda, Componente 4 §6/§8) ---

function validarCredencial(texto: string): ValidacaoResultado | null {
  const textoLower = texto.toLowerCase();
  for (const gatilho of GATILHOS_CREDENCIAL) {
    const indice = textoLower.indexOf(gatilho);
    if (indice !== -1 && !textoTemNegacaoProxima(texto, indice)) {
      return reprovar("seguranca:possivel_credencial");
    }
  }
  return null;
}

function validarTelefoneOutroCliente(
  texto: string,
  contexto: ContextoParseado,
): ValidacaoResultado | null {
  if (!contexto.telefone) return null; // sem telefone de referencia, nada a comparar

  const telefoneEsperado = contexto.telefone.replace(/\D/g, "");
  const textoMascarado = mascararDatas(texto);
  const candidatos = textoMascarado.match(REGEX_TELEFONE) ?? [];

  for (const candidato of candidatos) {
    if (candidato !== telefoneEsperado) {
      return reprovar("seguranca:telefone_nao_reconhecido");
    }
  }
  return null;
}

function validarValorMonetario(
  texto: string,
  contextoBruto: string,
): ValidacaoResultado | null {
  const valores = texto.match(REGEX_VALOR) ?? [];
  for (const valor of valores) {
    if (!contextoBruto.includes(valor)) {
      return reprovar("seguranca:valor_nao_confere");
    }
  }
  return null;
}

// --- Factual (so roda quando ha afirmacao checavel, §7/§8) ---

function validarDatas(
  texto: string,
  contextoBruto: string,
): ValidacaoResultado | null {
  const datas = texto.match(REGEX_DATA) ?? [];
  if (datas.length === 0) return null; // nada checavel

  const datasIsoContexto = extrairDatasIsoContexto(contextoBruto);

  for (const data of datas) {
    const bateLiteral = contextoBruto.includes(data); // contexto ja em DD/MM/AAAA (ex.: testes sinteticos)
    const normalizada = normalizarDataBr(data);
    const bateIso = normalizada !== "" && datasIsoContexto.has(normalizada); // contexto real, ISO 8601
    if (!bateLiteral && !bateIso) {
      return reprovar("factual:data_nao_confere");
    }
  }
  return null;
}

// Janela de caracteres (mesmo estilo de JANELA_NEGACAO) usada para
// decidir se um numeral "1" e' descricao de UM item individual (ex.:
// "1 acesso no servidor ChannelTV") em vez de uma declaracao de total.
// So o valor 1 e' elegivel -- gramaticalmente, um item unico so pode
// ser descrito no singular; qualquer outro valor so pode ser total ou
// contradicao genuina (Componente 4 §7). A ancora exigida e' o nome
// real de um servidor do contexto (Componente 1 §8: cada acesso e'
// descrito com seu servidorNome) -- plano NAO e' usado como ancora por
// ser generico demais (ex. "Mensal" aparece em quase todo cliente).
const JANELA_ITEM_INDIVIDUAL = 60;

function numeralIndicaItemIndividual(
  texto: string,
  indice: number,
  valor: number,
  servidoresContexto: string[],
): boolean {
  if (valor !== 1) return false;
  const inicio = Math.max(0, indice - JANELA_ITEM_INDIVIDUAL);
  const fim = Math.min(texto.length, indice + JANELA_ITEM_INDIVIDUAL);
  const janela = texto.slice(inicio, fim).toLowerCase();
  return servidoresContexto.some((s) => janela.includes(s));
}

function validarContagemAcessos(
  texto: string,
  contexto: ContextoParseado,
): ValidacaoResultado | null {
  const servidoresContexto = contexto.acessos.map((a) => a.servidor.toLowerCase());
  const encontrados = new Set<number>();
  for (const m of texto.matchAll(REGEX_CONTAGEM_ACESSOS)) {
    const numeralTexto = (m[1] ?? "").toLowerCase();
    const valor = numeralTexto in NUMERAIS
      ? NUMERAIS[numeralTexto]
      : /^\d+$/.test(numeralTexto)
        ? Number(numeralTexto)
        : null;
    if (valor === null) continue;
    if (numeralIndicaItemIndividual(texto, m.index!, valor, servidoresContexto)) continue;
    if (textoTemQuantificadorAproximadoAntes(texto, m.index!)) continue;
    encontrados.add(valor);
  }

  if (encontrados.size === 0) return null; // nada checavel
  if (encontrados.size > 1) return reprovar("factual:contagem_acessos_ambigua");

  const [unico] = encontrados;
  if (unico !== contexto.acessos.length) {
    return reprovar("factual:contagem_acessos_diverge");
  }
  return null;
}

function validarPlanoServidorRotulado(
  texto: string,
  contexto: ContextoParseado,
): ValidacaoResultado | null {
  const planosContexto = contexto.acessos.map((a) => a.plano.toLowerCase());
  const servidoresContexto = contexto.acessos.map((a) => a.servidor.toLowerCase());

  for (const m of texto.matchAll(REGEX_PLANO_ROTULADO)) {
    const valor = m[1].toLowerCase();
    if (!planosContexto.some((p) => p.includes(valor) || valor.includes(p))) {
      return reprovar("factual:plano_ou_servidor_nao_confere");
    }
  }
  for (const m of texto.matchAll(REGEX_SERVIDOR_ROTULADO)) {
    const valor = m[1].toLowerCase();
    if (!servidoresContexto.some((s) => s.includes(valor) || valor.includes(s))) {
      return reprovar("factual:plano_ou_servidor_nao_confere");
    }
  }
  return null;
}

// --- Formato/schema (guarda de entrada, pedido explicito do usuario) ---

type FormatoValidado =
  | { valido: true; tipo: "responder" | "transferir"; texto: string }
  | { valido: false; motivo: string };

function validarFormato(saidaGemini: unknown): FormatoValidado {
  if (typeof saidaGemini !== "object" || saidaGemini === null) {
    return { valido: false, motivo: "formato:objeto_invalido" };
  }

  const obj = saidaGemini as Record<string, unknown>;
  if (obj.tipo !== "responder" && obj.tipo !== "transferir") {
    return { valido: false, motivo: "formato:tipo_invalido" };
  }
  if (typeof obj.texto !== "string" || obj.texto.trim().length === 0) {
    return { valido: false, motivo: "formato:texto_vazio_ou_invalido" };
  }

  return { valido: true, tipo: obj.tipo, texto: obj.texto };
}

// --- Entrada publica ---

export function validarResposta(
  saidaGemini: unknown,
  contextoEnviado: string | null,
): ValidacaoResultado {
  const formato = validarFormato(saidaGemini);
  if (!formato.valido) return reprovar(formato.motivo);

  const { texto } = formato;
  const contextoBruto = contextoEnviado ?? "";
  const contextoParseado = parseContexto(contextoEnviado);

  const checagens: Array<() => ValidacaoResultado | null> = [
    () => validarCredencial(texto),
    () => validarTelefoneOutroCliente(texto, contextoParseado),
    () => validarValorMonetario(texto, contextoBruto),
    () => validarDatas(texto, contextoBruto),
    () => validarContagemAcessos(texto, contextoParseado),
    () => validarPlanoServidorRotulado(texto, contextoParseado),
  ];

  for (const checagem of checagens) {
    const resultado = checagem();
    if (resultado) return resultado;
  }

  return { aprovado: true };
}
