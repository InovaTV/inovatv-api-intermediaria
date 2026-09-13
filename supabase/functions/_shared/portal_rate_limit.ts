// Rate limiting da identificacao por telefone do Portal de Renovacao
// (renovacao-iniciar, etapa=telefone) -- Checkpoint 5. Protege SO' essa
// etapa -- nenhuma outra parte do Portal usa este modulo.
//
// Chave = SHA-256 hex do telefone NORMALIZADO, via hashToken() --
// MESMO helper ja usado para o token de renovacao
// (_shared/tokens_renovacao.ts), reaproveitado aqui, nao duplicado. O
// telefone em si NUNCA e' gravado em lugar nenhum por este modulo, nem
// em texto puro nem passado a nenhuma chamada de log.
//
// Ressalva de seguranca conhecida (nao resolvida agora, deliberadamente
// -- ver risco registrado no relatorio do checkpoint): SHA-256 puro,
// sem chave secreta, e' reversivel por forca bruta/rainbow table pra um
// espaco pequeno como numeros de telefone brasileiros (ao contrario de
// um UUID de alta entropia, onde o mesmo hashToken() e' seguro pra esse
// fim). Um HMAC com chave secreta seria mais forte, mas exigiria um
// secret novo -- fora do escopo deste checkpoint ("nao tocar em
// secrets"). Documentado como melhoria futura, nao um bloqueio agora.
//
// Atomicidade: delegada inteiramente ao RPC
// registrar_tentativa_portal_renovacao (migration
// 20260913160000_portal_renovacao_rate_limit.sql) -- um UNICO insert
// ... on conflict ... returning por chamada. Este modulo NUNCA faz
// select->conta->insert em passos separados (isso sim teria uma corrida
// real sob concorrencia).
//
// Falha aberta: se o RPC falhar (erro de rede/config/tabela ausente),
// a tentativa e' PERMITIDA -- rate limiting e' defesa contra abuso,
// nunca pode virar uma segunda forma de negar servico a um cliente
// legitimo. Mesma filosofia ja usada em chamarMatch/chamarStatus
// (_shared/rocket_intermediaria.ts): falha de infraestrutura nunca vira
// bloqueio silencioso do caminho feliz.

import { getServiceClient } from "./supabase_client.ts";
import { hashToken } from "./tokens_renovacao.ts";

const JANELA_SEGUNDOS = 3600; // 1 hora
const LIMITE_TENTATIVAS = 5; // 5 identificacoes por telefone por hora

export async function tentativaDeIdentificacaoPermitida(telefoneNormalizado: string): Promise<boolean> {
  const chave = await hashToken(telefoneNormalizado);

  try {
    const client = getServiceClient();
    const { data, error } = await client.rpc("registrar_tentativa_portal_renovacao", {
      p_chave: chave,
      p_janela_segundos: JANELA_SEGUNDOS,
      p_limite: LIMITE_TENTATIVAS,
    });
    if (error) return true;
    return data === true;
  } catch {
    return true;
  }
}
