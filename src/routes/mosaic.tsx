import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useRtdeSocket } from "@/lib/useRtdeSocket";
import { ConnectionBar } from "@/components/telemetry/ConnectionBar";
import { MosaicStudio } from "@/components/mosaic/MosaicStudio";

export const Route = createFileRoute("/mosaic")({
  component: MosaicPage,
  head: () => ({
    meta: [
      { title: "Mosaik-Studio — UR5 Bildplatzierung" },
      {
        name: "description",
        content:
          "Bild hochladen, in 30×30 Steine (10 mm) auf 30×30 cm umwandeln und vom UR5 Roboterarm legen lassen.",
      },
    ],
  }),
});

function MosaicPage() {
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
        <h1 className="text-sm font-semibold tracking-tight">Mosaik-Studio</h1>
      </div>

      <ConnectionBar {...sock} send={sock.send} />

      {sock.error && (
        <div className="panel border-destructive/30 p-3 text-xs text-destructive text-center">
          {sock.error}
        </div>
      )}

      <MosaicStudio send={sock.send} enabled={live} />

      <footer className="text-center text-xs text-muted-foreground py-2">
        300 × 300 mm · 30 × 30 Steine à 10 mm · 20 Farben
      </footer>
    </main>
  );
}