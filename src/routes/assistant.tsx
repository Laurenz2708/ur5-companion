import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useRtdeSocket } from "@/lib/useRtdeSocket";
import { ConnectionBar } from "@/components/telemetry/ConnectionBar";
import { AssistantStudio } from "@/components/assistant/AssistantStudio";

export const Route = createFileRoute("/assistant")({
  component: AssistantPage,
  head: () => ({
    meta: [
      { title: "KI-Assistent — UR5 Co-Pilot" },
      {
        name: "description",
        content:
          "Werkstück erkennen, scannen, KI-Vorschläge erhalten und mit dem UR5 zusammenarbeiten – mit Sprachsteuerung und Präzisions-Höhensensor.",
      },
    ],
  }),
});

function AssistantPage() {
  const sock = useRtdeSocket();
  const live = sock.state === "open";

  return (
    <main className="min-h-screen p-5 md:p-10 max-w-[1200px] mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Zurück zum Dashboard
        </Link>
        <h1 className="text-sm font-semibold tracking-tight">KI-Assistent</h1>
      </div>

      <ConnectionBar {...sock} send={sock.send} />

      {sock.error && (
        <div className="panel border-destructive/30 p-3 text-xs text-destructive text-center">
          {sock.error}
        </div>
      )}

      <AssistantStudio send={sock.send} enabled={live} telemetry={sock.data} />

      <footer className="text-center text-xs text-muted-foreground py-2">
        Mensch + Roboter · automatische Erkennung, Vorschläge & Sprachdialog
      </footer>
    </main>
  );
}
