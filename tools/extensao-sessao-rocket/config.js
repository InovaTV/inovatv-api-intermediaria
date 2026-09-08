// Configuracao PUBLICA da extensao. NENHUM SECRET PRIVADO AQUI.
//
// - SUPABASE_ANON_KEY e' a chave de role "anon" do projeto -- publica
//   por design (e' a mesma que roda no bundle do Painel, no navegador
//   do operador). NAO e' a service_role; NAO e' o
//   SESSAO_ROCKET_UPDATE_TOKEN; sozinha nao da' acesso a nada (o
//   gateway/RLS protege o resto).
// - OPERADOR_AUTORIZADO_EMAIL e' um IDENTIFICADOR, nao uma credencial.
//   Serve so' para a UI local antecipar "voce e'/nao e' o operador".
//   A checagem REAL de autorizacao continua no servidor
//   (PAINEL_EMAIL_AUTORIZADO, dentro de atualizar-sessao-rocket).
// - INTEGRACAO_HABILITADA: etapa 2A e' PREPARACAO. O envio de
//   sessionid/csrftoken para atualizar-sessao-rocket fica desligado.

export const SUPABASE_URL = "https://nduxsuxkopuvhwugdkqi.supabase.co";

// role "anon" -- publica. Ver comentario acima.
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5kdXhzdXhrb3B1dmh3dWdka3FpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY0NjA1NzYsImV4cCI6MjEwMjAzNjU3Nn0.hnTrVMb4VcgRoIFi7qTuCMHxB0qD7n55FRUFovGhiPE";

export const OPERADOR_AUTORIZADO_EMAIL = "inovatv.stream@gmail.com";

// Etapa 2A: NAO habilitar. A etapa de integracao troca para true (e
// so' entao a extensao passa a ler sessionid/csrftoken e chamar a
// Edge Function).
export const INTEGRACAO_HABILITADA = false;
