import "./globals.css";

export const metadata = {
  title: "Painel de Atendimento -- InovaTV",
  description: "Uso interno da equipe InovaTV -- nao e' canal do cliente.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
