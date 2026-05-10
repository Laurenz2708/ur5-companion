import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Ack } from "@/lib/useRtdeSocket";

type Props = {
  send: (cmd: object) => boolean;
  enabled: boolean;
  lastAck: Ack | null;
};

export function CommandStatus({ send, enabled, lastAck }: Props) {
  const [pending, setPending] = useState<string | null>(null);
  const [pendingSince, setPendingSince] = useState<number>(0);

  function test(cmd: string, payload: object) {
    const ok = send(payload);
    if (ok) {
      setPending(cmd);
      setPendingSince(Date.now());
    }
  }

  // Resolve pending when matching ack arrives
  const resolved =
    pending && lastAck && lastAck.t >= pendingSince && lastAck.cmd === pending;
  const status: "idle" | "waiting" | "ok" | "fail" = !pending
    ? "idle"
    : !resolved
      ? "waiting"
      : lastAck!.ok
        ? "ok"
        : "fail";

  const tone =
    status === "ok"
      ? "text-success"
      : status === "fail"
        ? "text-destructive"
        : status === "waiting"
          ? "text-warning"
          : "text-muted-foreground";

  const label =
    status === "idle"
      ? "No test run yet"
      : status === "waiting"
        ? `Waiting for ${pending}…`
        : status === "ok"
          ? `${pending} supported ✓`
          : `${pending} failed: ${lastAck?.error ?? "unknown"}`;

  return (
    <div className="panel p-6 space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-semibold tracking-tight">Command status</h2>
        <span className="text-xs text-muted-foreground">RTDE support check</span>
      </div>

      <div className="rounded-2xl bg-secondary/60 p-4 space-y-1.5">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Last result
        </div>
        <div className={`text-sm font-mono ${tone}`}>{label}</div>
        {lastAck && (
          <div className="text-[11px] text-muted-foreground font-mono">
            cmd={lastAck.cmd ?? "—"} · ok={String(lastAck.ok)}
            {lastAck.error ? ` · ${lastAck.error}` : ""}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="secondary"
          className="rounded-xl"
          disabled={!enabled}
          onClick={() => test("home", { cmd: "home", speed: 0.1 })}
        >
          Test home
        </Button>
        <Button
          variant="secondary"
          className="rounded-xl"
          disabled={!enabled}
          onClick={() => test("stop", { cmd: "stop" })}
        >
          Test stop
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground leading-relaxed">
        ⚠️ <strong>Test home</strong> moves the robot to its home pose at slow speed
        (0.1). Make sure the workspace is clear. The bridge replies with an ack —
        <span className="text-success"> ok=true</span> means RTDE accepted the
        command, <span className="text-destructive">ok=false</span> shows the
        underlying RTDE error.
      </p>
    </div>
  );
}