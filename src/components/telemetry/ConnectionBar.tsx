import { useState } from "react";
import { ConnState } from "@/lib/useRtdeSocket";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from "@tanstack/react-router";

const STATE_META: Record<ConnState, { label: string; color: string; pulse: boolean }> = {
  idle:       { label: "Idle",       color: "bg-muted-foreground", pulse: false },
  connecting: { label: "Connecting", color: "bg-warning",          pulse: true },
  open:       { label: "Live",       color: "bg-success",          pulse: true },
  closed:     { label: "Disconnected", color: "bg-muted-foreground", pulse: false },
  error:      { label: "Error",      color: "bg-destructive",      pulse: false },
};

export function ConnectionBar({
  url, setUrl, state, hz, error, connect, disconnect,
}: {
  url: string;
  setUrl: (u: string) => void;
  state: ConnState;
  hz: number;
  error: string | null;
  connect: () => void;
  disconnect: () => void;
}) {
  const [draft, setDraft] = useState(url);
  const meta = STATE_META[state];
  const live = state === "open";

  return (
    <header className="panel p-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 rounded-md bg-primary/15 border border-primary/40 flex items-center justify-center">
            <span className="text-primary font-mono font-bold text-sm">UR</span>
          </div>
          <div>
            <h1 className="font-mono font-semibold tracking-tight leading-none">
              UR5 · RTDE Console
            </h1>
            <p className="text-[11px] text-muted-foreground mt-1">
              Live telemetry over Real-Time Data Exchange
            </p>
          </div>
        </div>
        <span className="hidden md:inline-flex items-center gap-2 ml-2 px-2 py-1 rounded border border-border bg-muted/40">
          <span className={`status-dot ${meta.color} ${meta.pulse ? "animate-pulse-dot" : ""}`} />
          <span className="font-mono text-xs">{meta.label}</span>
          {live && (
            <span className="font-mono text-xs text-muted-foreground">· {hz} Hz</span>
          )}
        </span>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="ws://localhost:8765"
          className="font-mono text-sm w-full sm:w-72"
        />
        {!live ? (
          <Button
            onClick={() => { setUrl(draft); setTimeout(connect, 0); }}
            className="font-mono"
          >
            Connect
          </Button>
        ) : (
          <Button onClick={disconnect} variant="destructive" className="font-mono">
            Disconnect
          </Button>
        )}
        <Link
          to="/setup"
          className="font-mono text-xs text-accent hover:underline px-2 py-2 whitespace-nowrap"
        >
          Bridge setup →
        </Link>
      </div>

      {error && (
        <div className="md:hidden text-xs font-mono text-destructive">{error}</div>
      )}
    </header>
  );
}