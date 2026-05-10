import { createFileRoute } from "@tanstack/react-router";
import { useRtdeSocket } from "@/lib/useRtdeSocket";
import { ConnectionBar } from "@/components/telemetry/ConnectionBar";
import { ControlPanel } from "@/components/telemetry/ControlPanel";
import { GestureControl } from "@/components/telemetry/GestureControl";
import { CommandStatus } from "@/components/telemetry/CommandStatus";
import { ToolHeadPreview } from "@/components/telemetry/ToolHeadPreview";
import { ArmVisualization } from "@/components/telemetry/ArmVisualization";

export const Route = createFileRoute("/")({
  component: Dashboard,
  head: () => ({
    meta: [
      { title: "UR5 RTDE Console — Live Robot Telemetry" },
      {
        name: "description",
        content:
          "Live telemetry dashboard for Universal Robots UR5 over RTDE. Joint angles, TCP pose, forces, safety state and I/O.",
      },
    ],
  }),
});

const POSE_AXES = ["X", "Y", "Z", "Rx", "Ry", "Rz"];
const JOINT_NAMES = ["J1", "J2", "J3", "J4", "J5", "J6"];

function fmt(n: number | undefined, d = 4) {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  return n.toFixed(d);
}
function safetyTone(mode?: string) {
  if (mode === "NORMAL") return "text-success";
  if (mode === "REDUCED") return "text-warning";
  if (!mode) return "text-muted-foreground";
  return "text-destructive";
}

function Dashboard() {
  const sock = useRtdeSocket();
  const d = sock.data;
  const live = sock.state === "open";
  const robotReady = live && (sock.bridgeStatus?.robotConnected ?? true);
  const speedMag = d?.tcp_speed ? Math.hypot(d.tcp_speed[0], d.tcp_speed[1], d.tcp_speed[2]) : 0;
  const forceMag = d?.tcp_force ? Math.hypot(d.tcp_force[0], d.tcp_force[1], d.tcp_force[2]) : 0;

  return (
    <main className="min-h-screen p-5 md:p-10 max-w-[1200px] mx-auto space-y-8">
      <ConnectionBar {...sock} />

      {sock.error && (
        <div className="panel border-destructive/30 p-3 text-xs text-destructive text-center">
          {sock.error}
        </div>
      )}

      {/* Status pills */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Robot">
          <span className="text-base font-semibold">
            {d?.robot_mode ?? sock.bridgeStatus?.robotState ?? "—"}
          </span>
        </Stat>
        <Stat label="Safety">
          <span className={`text-base font-semibold ${safetyTone(d?.safety_mode)}`}>
            {d?.safety_mode ?? "—"}
          </span>
        </Stat>
        <Stat label="Speed">
          <span className="text-base font-semibold tabular-nums">
            {fmt(speedMag, 3)} <span className="text-muted-foreground text-xs">m/s</span>
          </span>
        </Stat>
        <Stat label="Force">
          <span className="text-base font-semibold tabular-nums">
            {fmt(forceMag, 1)} <span className="text-muted-foreground text-xs">N</span>
          </span>
        </Stat>
      </section>

      <div className="grid lg:grid-cols-5 gap-6">
        {/* Live telemetry */}
        <section className="lg:col-span-3 space-y-6">
          <ArmVisualization jointQ={d?.joint_q} tcp={d?.tcp_pose} live={live} />
          <ToolHeadPreview pose={d?.tcp_pose} live={live} />
          <div className="panel p-6">
            <div className="flex items-baseline justify-between mb-5">
              <h2 className="text-base font-semibold tracking-tight">Tool position</h2>
              <span className="text-xs text-muted-foreground">base frame</span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {POSE_AXES.map((axis, i) => {
                const v = d?.tcp_pose?.[i];
                const isRot = i >= 3;
                return (
                  <div key={axis} className="rounded-2xl bg-secondary/60 p-4">
                    <div className="flex items-baseline justify-between">
                      <span className="text-xs font-medium text-primary">{axis}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {isRot ? "rad" : "m"}
                      </span>
                    </div>
                    <div className="font-mono text-lg tabular-nums mt-1.5">{fmt(v, 3)}</div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="panel p-6">
            <h2 className="text-base font-semibold tracking-tight mb-5">Joint angles</h2>
            <div className="space-y-3">
              {JOINT_NAMES.map((name, i) => {
                const q = d?.joint_q?.[i] ?? 0;
                const deg = (q * 180) / Math.PI;
                const pct = ((q + 2 * Math.PI) / (4 * Math.PI)) * 100;
                return (
                  <div key={name} className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground w-6">{name}</span>
                        <span className="text-sm font-mono tabular-nums">{fmt(deg, 1)}°</span>
                      </div>
                      <span className="text-[11px] font-mono text-muted-foreground tabular-nums">
                        {fmt(d?.joint_qd?.[i], 3)} rad/s
                      </span>
                    </div>
                    <div className="h-1 bg-secondary rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all duration-200"
                        style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Control panel */}
        <section className="lg:col-span-2">
          <ControlPanel send={sock.send} enabled={robotReady} />
        </section>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <GestureControl send={sock.send} enabled={robotReady} />
        <CommandStatus send={sock.send} enabled={robotReady} lastAck={sock.lastAck} />
      </div>

      <footer className="text-center text-xs text-muted-foreground py-2">
        Universal Robots UR5 · RTDE
      </footer>
    </main>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="panel p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
        {label}
      </div>
      {children}
    </div>
  );
}
