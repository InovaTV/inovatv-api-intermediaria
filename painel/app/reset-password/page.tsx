// Rota de recuperacao de senha (Supabase Auth). Recebe o link de reset
// enviado por e-mail -- tanto o formato com token no hash (#access_token=
// ...&type=recovery, processado automaticamente pelo supabase-js na
// inicializacao do cliente) quanto o formato PKCE (?code=...), troca por
// uma sessao valida e deixa o usuario definir a senha nova via
// updateUser({ password }). Nao usa AuthGuard de proposito -- o usuario
// chega aqui sem sessao normal, so' com a sessao temporaria de recovery.
"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Estado = "verificando" | "pronto" | "invalido" | "sucesso";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [estado, setEstado] = useState<Estado>("verificando");
  const [senha, setSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    let ativo = true;

    async function preparar() {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (!ativo) return;
        setEstado(error ? "invalido" : "pronto");
        return;
      }

      const { data } = await supabase.auth.getSession();
      if (!ativo) return;
      setEstado(data.session ? "pronto" : "invalido");
    }

    preparar();

    const { data: subscription } = supabase.auth.onAuthStateChange((evento) => {
      if (evento === "PASSWORD_RECOVERY") setEstado("pronto");
    });

    return () => {
      ativo = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  async function salvar(evento: FormEvent) {
    evento.preventDefault();
    setErro(null);

    if (senha.length < 6) {
      setErro("A senha precisa ter pelo menos 6 caracteres.");
      return;
    }
    if (senha !== confirmar) {
      setErro("As senhas nao coincidem.");
      return;
    }

    setSalvando(true);
    const { error } = await supabase.auth.updateUser({ password: senha });
    setSalvando(false);

    if (error) {
      setErro("Nao foi possivel salvar a nova senha: " + error.message);
      return;
    }

    setEstado("sucesso");
    setTimeout(() => router.replace("/login"), 2000);
  }

  return (
    <div className="container" style={{ maxWidth: 360, marginTop: 80 }}>
      <h1 style={{ fontSize: 20 }}>Painel de Atendimento</h1>
      <p style={{ color: "#8a8f9a", fontSize: 14 }}>Redefinir senha.</p>

      {estado === "verificando" && (
        <div className="card" style={{ marginTop: 16 }}>
          <p>Verificando link...</p>
        </div>
      )}

      {estado === "invalido" && (
        <div className="card" style={{ marginTop: 16 }}>
          <p style={{ color: "#e05a5a", fontSize: 14 }}>
            Este link de redefinição é inválido ou expirou. Solicite um novo
            link de recuperação de senha.
          </p>
        </div>
      )}

      {estado === "sucesso" && (
        <div className="card" style={{ marginTop: 16 }}>
          <p style={{ color: "#6fd89a", fontSize: 14 }}>
            Senha atualizada. Redirecionando para o login...
          </p>
        </div>
      )}

      {estado === "pronto" && (
        <form
          onSubmit={salvar}
          className="card"
          style={{ display: "grid", gap: 12, marginTop: 16 }}
        >
          <input
            type="password"
            placeholder="nova senha"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            required
            style={{
              padding: 8,
              borderRadius: 6,
              border: "1px solid #2a2e38",
              background: "#0f1115",
              color: "#e6e6e6",
            }}
          />
          <input
            type="password"
            placeholder="confirmar nova senha"
            value={confirmar}
            onChange={(e) => setConfirmar(e.target.value)}
            required
            style={{
              padding: 8,
              borderRadius: 6,
              border: "1px solid #2a2e38",
              background: "#0f1115",
              color: "#e6e6e6",
            }}
          />
          {erro && (
            <p style={{ color: "#e05a5a", fontSize: 13, margin: 0 }}>{erro}</p>
          )}
          <button
            type="submit"
            disabled={salvando}
            style={{
              padding: 10,
              borderRadius: 6,
              border: "none",
              background: "#3a6fd8",
              color: "#fff",
              fontWeight: 600,
            }}
          >
            {salvando ? "Salvando..." : "Salvar nova senha"}
          </button>
        </form>
      )}
    </div>
  );
}
