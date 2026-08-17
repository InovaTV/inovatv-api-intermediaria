// Estado vazio da coluna direita (Etapa 2, layout estilo WhatsApp).
// A lista migrou pra app/conversas/layout.tsx (Etapa 1 -> Etapa 2) --
// esta pagina so' renderiza quando a URL e' exatamente /conversas,
// ou seja, nenhuma conversa selecionada ainda.
"use client";

import AuthGuard from "@/components/AuthGuard";

function SelecioneConversa() {
  return (
    <div
      className="container"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        color: "#8a8f9a",
      }}
    >
      <p>Selecione uma conversa para ver o histórico.</p>
    </div>
  );
}

export default function ConversasPage() {
  return (
    <AuthGuard>
      <SelecioneConversa />
    </AuthGuard>
  );
}
