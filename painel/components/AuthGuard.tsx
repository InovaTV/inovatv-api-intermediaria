// Guarda de sessao client-side (V1: so' isso, sem middleware/SSR --
// Componente 5 §6, login unico do Jose). Redireciona pra /login se nao
// houver sessao valida; nao valida o e-mail aqui (isso e' feito pelas
// Edge Functions em cada chamada, essa checagem so' evita mostrar a
// tela vazia por um instante).
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [pronto, setPronto] = useState(false);

  useEffect(() => {
    let ativo = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!ativo) return;
      if (!data.session) {
        router.replace("/login");
        return;
      }
      setPronto(true);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_evento, sessao) => {
      if (!sessao) router.replace("/login");
    });

    return () => {
      ativo = false;
      subscription.subscription.unsubscribe();
    };
  }, [router]);

  if (!pronto) {
    return (
      <div className="container">
        <p>Carregando...</p>
      </div>
    );
  }

  return <>{children}</>;
}
