import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Réussite Togo APC",
  description: "Assistant IA scolaire pour les élèves togolais (CM2, 3ème, 1ère).",
  manifest: "/manifest.json",
  applicationName: "Réussite Togo APC",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#2E7D32",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <body className="min-h-screen bg-gradient-to-b from-green-50 via-yellow-50 to-red-50 text-slate-900">
        <main className="mx-auto w-full max-w-6xl px-3 py-3 md:px-4 md:py-4">
          <header className="mb-4 rounded-2xl border border-green-200 bg-white/90 p-4 shadow-sm">
            <h1 className="text-lg font-bold text-green-700">Réussite Togo APC</h1>
            <p className="text-sm text-slate-600">
              Apprendre, analyser, résoudre selon l&apos;approche APC
            </p>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full">
              <div className="flex h-full">
                <span className="w-1/3 bg-green-600" />
                <span className="w-1/3 bg-yellow-400" />
                <span className="w-1/3 bg-red-600" />
              </div>
            </div>
          </header>
          {children}
        </main>
      </body>
    </html>
  );
}
