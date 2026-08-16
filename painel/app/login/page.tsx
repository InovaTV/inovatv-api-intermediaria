"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  async function entrar(evento: FormEvent) {
    evento.preventDefault();
    setErro(null);
    setCarregando(true);

    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });

    setCarregando(false);
    if (error) {
      setErro("Login ou senha invalidos.");
      return;
    }
    router.replace("/conversas");
  }

  return (
    <div className="container" style={{ maxWidth: 360, marginTop: 80 }}>
      <h1 style={{ fontSize: 20 }}>Painel de Atendimento</h1>
      <p style={{ color: "#8a8f9a", fontSize: 14 }}>Uso interno InovaTV.</p>
      <form onSubmit={entrar} className="card" style={{ display: "grid", gap: 12, marginTop: 16 }}>
        <input
          type="email"
          placeholder="e-mail"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={{ padding: 8, borderRadius: 6, border: "1px solid #2a2e38", background: "#0f1115", color: "#e6e6e6" }}
        />
        <input
          type="password"
          placeholder="senha"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          required
          style={{ padding: 8, borderRadius: 6, border: "1px solid #2a2e38", background: "#0f1115", color: "#e6e6e6" }}
        />
        {erro && <p style={{ color: "#e05a5a", fontSize: 13, margin: 0 }}>{erro}</p>}
        <button
          type="submit"
          disabled={carregando}
          style={{ padding: 10, borderRadius: 6, border: "none", background: "#3a6fd8", color: "#fff", fontWeight: 600 }}
        >
          {carregando ? "Entrando..." : "Entrar"}
        </button>
      </form>
    </div>
  );
}
