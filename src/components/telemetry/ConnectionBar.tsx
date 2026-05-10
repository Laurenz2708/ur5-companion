import { useState } from "react";
import { ConnState } from "@/lib/useRtdeSocket";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from "@tanstack/react-router";

const STATE_META: Record<ConnState, { label: string; color: string; pulse: boolean }> = {
  idle:       { label: "Idle",         color: "bg-muted-foreground", pulse: false },
  connecting: { label: "Connecting",   color: "bg-warning",          pulse: true  },
  open:       { label: "Connected",    color: "bg-success",          pulse: true  },
  closed:     { label: "Disconnected", color: "bg-muted-foreground", pulse: false },
  error:      { label: "Error",        color: "bg-destructive",      pulse: false },
};

export function ConnectionBar({
  url, setUrl, state, hz, connect, disconnect,
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
    <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-2xl bg-primary/10 flex items-center justify-center">
          <span className="text-primary font-semibold text-sm tracking-tight">UR</span>
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight leading-none">UR5 Console</h1>
          <div className="flex items-center gap-1.5 mt-1.5">
            <span className={`status-dot ${meta.color} ${meta.pulse ? "animate-pulse-dot" : ""}`} />
            <span className="text-xs text-muted-foreground">
              {meta.label}{live ? ` · ${hz} Hz` : ""}
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="ws://localhost:8765"
          className="font-mono text-sm w-full sm:w-64 rounded-xl bg-card"
        />
        {!live ? (
          <Button
            onClick={() => { setUrl(draft); setTimeout(connect, 0); }}
            className="rounded-xl"
          >
            Connect
          </Button>
        ) : (
          <Button onClick={disconnect} variant="secondary" className="rounded-xl">
            Disconnect
          </Button>
        )}
        <Link
          to="/setup"
          className="text-xs text-primary hover:underline px-2 py-2 whitespace-nowrap"
        >
          Setup →
        </Link>
      </div>
    </header>
  );
}