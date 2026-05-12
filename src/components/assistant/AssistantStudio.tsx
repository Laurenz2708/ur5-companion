import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ScanLine,
  Wrench,
  Ruler,
  Sparkles,
  Mic,
  MicOff,
  Volume2,
  Send,
  Bot,
  User as UserIcon,
  AlertTriangle,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Telemetry } from "@/lib/useRtdeSocket";

type Msg = { role: "user" | "assistant"; content: string };

type DetectedPart = {
  name: string;
  confidence: number;
  suggestedProcess: string;
  notes: string[];
};

const PART_LIBRARY: DetectedPart[] = [
  {
    name: "Zylinderkopf 4-Zylinder",
    confidence: 0.94,
    suggestedProcess: "Sitzprüfung Ventile + Reinigung Brennraum",
    notes: ["Ventilsitze auf Dichtheit prüfen", "Brennraum reinigen", "Planheit messen (max 0,05 mm)"],
  },
  {
    name: "Bremssattel (vorne links)",
    confidence: 0.89,
    suggestedProcess: "Bremssattelservice",
    notes: ["Kolben zurückdrücken", "Führungsbolzen fetten", "Beläge prüfen"],
  },
  {
    name: "Schraube M10 x 40 (8.8)",
    confidence: 0.97,
    suggestedProcess: "Festigkeitsprüfung + Sortierung",
    notes: ["Kopfmarkierung 8.8 erkannt", "Sichtprüfung auf Korrosion", "In Magazin A einsortieren"],
  },
  {
    name: "Aluminium-Gehäuse",
    confidence: 0.81,
    suggestedProcess: "Vermessung + Reinigung",
    notes: ["Bezugsfläche scannen", "Gratbildung prüfen", "Mit Druckluft abblasen"],
  },
];

type Stage = "idle" | "clamping" | "scanning" | "analyzing" | "ready";

export function AssistantStudio({
  send,
  enabled,
  telemetry,
}: {
  send: (cmd: object) => boolean;
  enabled: boolean;
  telemetry: Telemetry | null;
}) {
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState(0);
  const [part, setPart] = useState<DetectedPart | null>(null);
  const [zRef, setZRef] = useState<number | null>(null);

  // Chat state
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "assistant",
      content:
        "Hallo. Lege ein Teil ein und starte den Scan – oder frag mich direkt nach einem Arbeitsschritt (z.B. *Bremssattelservice*, *Drehmoment Zylinderkopf*).",
    },
  ]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Voice
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streaming]);

  // Workflow simulation
  function runScan() {
    if (stage !== "idle" && stage !== "ready") return;
    setPart(null);
    setProgress(0);
    setStage("clamping");
    let p = 0;
    const stages: Stage[] = ["clamping", "scanning", "analyzing"];
    let idx = 0;
    const tick = setInterval(() => {
      p += 4;
      setProgress(Math.min(p, 100));
      if (p >= 33 && idx === 0) {
        idx = 1;
        setStage("scanning");
      } else if (p >= 66 && idx === 1) {
        idx = 2;
        setStage("analyzing");
      }
      if (p >= 100) {
        clearInterval(tick);
        const detected = PART_LIBRARY[Math.floor(Math.random() * PART_LIBRARY.length)];
        setPart(detected);
        setStage("ready");
        askAi(
          `Werkstück erkannt: ${detected.name} (Konfidenz ${(detected.confidence * 100).toFixed(0)} %). Schlage 3 nächste Schritte vor und nenne, was der Roboter selbst kann und wo der Mensch ran muss.`,
        );
      }
    }, 80);
  }

  function captureZRef() {
    const z = telemetry?.tcp_pose?.[2];
    if (typeof z === "number") {
      setZRef(z);
      toast.success(`Referenzhöhe gesetzt: ${(z * 1000).toFixed(2)} mm`);
    } else {
      toast.error("Keine Telemetrie – Roboter nicht verbunden.");
    }
  }

  const relativeZmm = useMemo(() => {
    if (zRef === null || !telemetry?.tcp_pose) return null;
    return (telemetry.tcp_pose[2] - zRef) * 1000;
  }, [zRef, telemetry]);

  // Voice input
  function toggleVoice() {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const SR =
      (typeof window !== "undefined" && (window as any).SpeechRecognition) ||
      (typeof window !== "undefined" && (window as any).webkitSpeechRecognition);
    if (!SR) {
      toast.error("Spracheingabe wird in diesem Browser nicht unterstützt.");
      return;
    }
    const rec = new SR();
    rec.lang = "de-DE";
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (ev: any) => {
      const text = ev.results[0][0].transcript;
      setInput((prev) => (prev ? prev + " " + text : text));
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    rec.start();
    recognitionRef.current = rec;
    setListening(true);
  }

  function speak(text: string) {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      toast.error("TTS nicht verfügbar.");
      return;
    }
    const u = new SpeechSynthesisUtterance(text.replace(/[*#`>_-]/g, ""));
    u.lang = "de-DE";
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }

  async function askAi(text: string) {
    if (!text.trim() || streaming) return;
    const userMsg: Msg = { role: "user", content: text.trim() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setStreaming(true);

    const ctxLines: string[] = [];
    if (part)
      ctxLines.push(
        `Erkanntes Teil: ${part.name} (Konfidenz ${(part.confidence * 100).toFixed(0)} %), vorgeschlagener Prozess: ${part.suggestedProcess}.`,
      );
    if (telemetry?.tcp_pose)
      ctxLines.push(
        `TCP Position [m]: X=${telemetry.tcp_pose[0].toFixed(3)} Y=${telemetry.tcp_pose[1].toFixed(3)} Z=${telemetry.tcp_pose[2].toFixed(3)}.`,
      );
    if (relativeZmm !== null)
      ctxLines.push(`Relative Höhe zur Referenz: ${relativeZmm.toFixed(2)} mm.`);
    if (telemetry?.safety_mode)
      ctxLines.push(`Safety Mode: ${telemetry.safety_mode}.`);

    let assistantSoFar = "";
    const upsert = (chunk: string) => {
      assistantSoFar += chunk;
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant" && last.content !== userMsg.content && prev.length > 0 && prev[prev.length - 1] !== userMsg) {
          // append to existing assistant streaming msg
          if (last.role === "assistant" && prev[prev.length - 2] === userMsg) {
            return prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: assistantSoFar } : m));
          }
        }
        return [...prev, { role: "assistant", content: assistantSoFar }];
      });
    };

    try {
      const resp = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, userMsg].slice(-12),
          context: ctxLines.join("\n"),
        }),
      });
      if (!resp.ok || !resp.body) {
        const err = await resp.json().catch(() => ({ error: "Fehler" }));
        toast.error(err.error || `Fehler ${resp.status}`);
        setStreaming(false);
        return;
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let done = false;
      while (!done) {
        const { done: d, value } = await reader.read();
        if (d) break;
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) !== -1) {
          let line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ")) continue;
          const j = line.slice(6).trim();
          if (j === "[DONE]") {
            done = true;
            break;
          }
          try {
            const parsed = JSON.parse(j);
            const c = parsed.choices?.[0]?.delta?.content;
            if (c) upsert(c);
          } catch {
            buf = line + "\n" + buf;
            break;
          }
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Netzwerkfehler");
    } finally {
      setStreaming(false);
    }
  }

  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");

  return (
    <div className="grid lg:grid-cols-5 gap-6">
      {/* Left: workflow */}
      <section className="lg:col-span-3 space-y-6">
        <div className="panel p-6 space-y-5">
          <div className="flex items-baseline justify-between">
            <h2 className="text-base font-semibold tracking-tight">Werkstück-Workflow</h2>
            <span className="text-xs text-muted-foreground">Einlegen → Scan → KI</span>
          </div>

          <div className="grid grid-cols-4 gap-2 text-[11px]">
            {(["clamping", "scanning", "analyzing", "ready"] as Stage[]).map((s, i) => {
              const active = stage === s;
              const done =
                ["clamping", "scanning", "analyzing", "ready"].indexOf(stage) > i;
              return (
                <div
                  key={s}
                  className={`rounded-xl px-2 py-2 text-center border ${
                    active
                      ? "border-primary bg-primary/10 text-primary"
                      : done
                        ? "border-success/40 bg-success/5 text-success"
                        : "border-border bg-secondary/40 text-muted-foreground"
                  }`}
                >
                  {s === "clamping" && "Einspannen"}
                  {s === "scanning" && "3D-Scan"}
                  {s === "analyzing" && "KI-Analyse"}
                  {s === "ready" && "Bereit"}
                </div>
              );
            })}
          </div>

          <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={runScan} disabled={stage !== "idle" && stage !== "ready"} className="rounded-xl">
              <ScanLine className="h-4 w-4 mr-1.5" /> Teil scannen
            </Button>
            <Button
              variant="secondary"
              className="rounded-xl"
              onClick={() => {
                setStage("idle");
                setProgress(0);
                setPart(null);
              }}
            >
              Zurücksetzen
            </Button>
          </div>

          {part && (
            <div className="rounded-2xl bg-secondary/60 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">{part.name}</div>
                <span className="text-xs font-mono text-success">
                  {(part.confidence * 100).toFixed(0)} %
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                Vorschlag: <span className="text-foreground">{part.suggestedProcess}</span>
              </div>
              <ul className="text-xs space-y-1">
                {part.notes.map((n) => (
                  <li key={n} className="flex gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0 mt-0.5" />
                    <span>{n}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="panel p-6 space-y-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-base font-semibold tracking-tight">Präzisions-Höhensensor</h2>
            <span className="text-xs text-muted-foreground">TCP Z relativ</span>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-2xl bg-secondary/60 p-4">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                TCP Z
              </div>
              <div className="font-mono text-lg tabular-nums mt-1">
                {telemetry?.tcp_pose
                  ? (telemetry.tcp_pose[2] * 1000).toFixed(2)
                  : "—"}
                <span className="text-xs text-muted-foreground ml-1">mm</span>
              </div>
            </div>
            <div className="rounded-2xl bg-secondary/60 p-4">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Referenz
              </div>
              <div className="font-mono text-lg tabular-nums mt-1">
                {zRef !== null ? (zRef * 1000).toFixed(2) : "—"}
                <span className="text-xs text-muted-foreground ml-1">mm</span>
              </div>
            </div>
            <div className="rounded-2xl bg-secondary/60 p-4">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Δ relativ
              </div>
              <div
                className={`font-mono text-lg tabular-nums mt-1 ${
                  relativeZmm !== null && Math.abs(relativeZmm) > 5
                    ? "text-warning"
                    : "text-success"
                }`}
              >
                {relativeZmm !== null ? relativeZmm.toFixed(2) : "—"}
                <span className="text-xs text-muted-foreground ml-1">mm</span>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="rounded-xl"
              onClick={captureZRef}
              disabled={!enabled}
            >
              <Ruler className="h-4 w-4 mr-1.5" /> Referenz auf aktuelle Höhe setzen
            </Button>
            <Button
              variant="secondary"
              className="rounded-xl"
              onClick={() => setZRef(null)}
            >
              Reset
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Ähnlich wie bei Pistenraupen: relative Höhe zum Untergrund. Nutze für
            Reinigungs- und Bearbeitungsbahnen mit konstantem Abstand.
          </p>
        </div>

        <div className="panel p-6 space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-base font-semibold tracking-tight">Schnell-Aktionen</h2>
            <span className="text-xs text-muted-foreground">Vorlagen</span>
          </div>
          <div className="grid sm:grid-cols-2 gap-2">
            {[
              { icon: Wrench, label: "Bremssattelservice erklären", q: "Erkläre Schritt für Schritt einen Bremssattelservice mit Anleitung aus der Werkstattpraxis." },
              { icon: Sparkles, label: "Sitzprüfung Zylinderkopf", q: "Wie prüfe ich Ventilsitze in einem Zylinderkopf? Was kann der UR5 davon übernehmen?" },
              { icon: AlertTriangle, label: "Schrauben sortieren", q: "Hilf mir beim Sortieren von Schrauben nach Festigkeitsklasse und Länge. Was kann der Roboter automatisch?" },
              { icon: Bot, label: "Gripper-Vorschlag", q: "Welcher Greifer-Typ passt für das aktuelle Werkstück? Begründe kurz." },
            ].map((a) => (
              <Button
                key={a.label}
                variant="secondary"
                className="rounded-xl justify-start h-auto py-2.5 text-left"
                onClick={() => askAi(a.q)}
                disabled={streaming}
              >
                <a.icon className="h-4 w-4 mr-2 shrink-0" />
                <span className="text-xs">{a.label}</span>
              </Button>
            ))}
          </div>
        </div>
      </section>

      {/* Right: chat */}
      <section className="lg:col-span-2">
        <div className="panel p-5 flex flex-col h-[700px]">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-base font-semibold tracking-tight">KI-Co-Pilot</h2>
            <div className="flex items-center gap-2">
              {lastAssistant && (
                <button
                  onClick={() => speak(lastAssistant.content)}
                  className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                  title="Letzte Antwort vorlesen"
                >
                  <Volume2 className="h-3.5 w-3.5" /> vorlesen
                </button>
              )}
            </div>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto pr-1 space-y-3">
            {messages.map((m, i) => (
              <div
                key={i}
                className={`flex gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {m.role === "assistant" && (
                  <div className="h-7 w-7 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                    <Bot className="h-3.5 w-3.5 text-primary" />
                  </div>
                )}
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap leading-relaxed ${
                    m.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-foreground"
                  }`}
                >
                  {m.content}
                  {streaming && i === messages.length - 1 && m.role === "assistant" && (
                    <Loader2 className="inline h-3 w-3 ml-1 animate-spin" />
                  )}
                </div>
                {m.role === "user" && (
                  <div className="h-7 w-7 rounded-xl bg-secondary flex items-center justify-center shrink-0">
                    <UserIcon className="h-3.5 w-3.5" />
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="mt-3 space-y-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Frage stellen oder Mikro nutzen…"
              className="rounded-xl bg-card resize-none text-sm"
              rows={2}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  askAi(input);
                }
              }}
            />
            <div className="flex gap-2">
              <Button
                type="button"
                variant={listening ? "destructive" : "secondary"}
                className="rounded-xl"
                onClick={toggleVoice}
                title="Sprache → Text"
              >
                {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </Button>
              <Button
                onClick={() => askAi(input)}
                disabled={streaming || !input.trim()}
                className="rounded-xl flex-1"
              >
                {streaming ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <Send className="h-4 w-4 mr-1.5" />
                )}
                Senden
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
