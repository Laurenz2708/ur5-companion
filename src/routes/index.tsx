import { createFileRoute } from "@tanstack/react-router";
import { useRtdeSocket } from "@/lib/useRtdeSocket";
import { ConnectionBar } from "@/components/telemetry/ConnectionBar";
import { StatPanel } from "@/components/telemetry/StatPanel";
import { JointBar } from "@/components/telemetry/JointBar";
import { IoBits } from "@/components/telemetry/IoBits";

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

const JOINT_NAMES = ["Base", "Shoulder", "Elbow", "Wrist 1", "Wrist 2", "Wrist 3"];
const POSE_AXES = ["X", "Y", "Z", "Rx", "Ry", "Rz"];

function fmt(n: number | undefined, d = 4) {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  return n.toFixed(d);
}

function safetyAccent(mode?: string) {
  if (!mode) return "accent" as const;
  if (mode === "NORMAL") return "success" as const;
  if (mode === "REDUCED") return "warning" as const;
  return "destructive" as const;
}

function Dashboard() {
  const sock = useRtdeSocket();
  const d = sock.data;
  const speedMag = d?.tcp_speed
    ? Math.hypot(d.tcp_speed[0], d.tcp_speed[1], d.tcp_speed[2])
    : 0;
  const forceMag = d?.tcp_force
    ? Math.hypot(d.tcp_force[0], d.tcp_force[1], d.tcp_force[2])
    : 0;

  return (
    <main className="min-h-screen p-4 md:p-6 space-y-4 max-w-[1400px] mx-auto">
      <ConnectionBar {...sock} />

      {sock.error && (
        <div className="panel border-destructive/50 p-3 font-mono text-xs text-destructive">
          {sock.error}
        </div>
      )}

      {/* Status row */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatPanel label="Robot Mode" accent="accent">
          <div className="text-lg font-semibold tracking-wide">
            {d?.robot_mode ?? "—"}
          </div>
        </StatPanel>
        <StatPanel label="Safety Mode" accent={safetyAccent(d?.safety_mode)}>
          <div className="text-lg font-semibold tracking-wide">
            {d?.safety_mode ?? "—"}
          </div>
        </StatPanel>
        <StatPanel label="TCP Speed" accent="primary">
          <div className="text-lg font-semibold tabular-nums">
            {fmt(speedMag, 3)}
            <span className="text-muted-foreground text-sm ml-1">m/s</span>
          </div>
        </StatPanel>
        <StatPanel label="TCP Force" accent="primary">
          <div className="text-lg font-semibold tabular-nums">
            {fmt(forceMag, 2)}
            <span className="text-muted-foreground text-sm ml-1">N</span>
          </div>
        </StatPanel>
      </section>

      {/* TCP pose */}
      <section className="panel p-5">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            Tool Center Point — Pose
          </h2>
          <span className="font-mono text-[10px] text-muted-foreground">
            base frame · m / rad
          </span>
        </div>
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
          {POSE_AXES.map((axis, i) => {
            const v = d?.tcp_pose?.[i];
            const isRot = i >= 3;
            return (
              <div key={axis} className="rounded-md bg-muted/40 border border-border p-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-accent font-semibold">{axis}</span>
                  <span className="text-[9px] font-mono text-muted-foreground">
                    {isRot ? "rad" : "m"}
                  </span>
                </div>
                <div className="font-mono text-xl tabular-nums mt-1">
                  {fmt(v, isRot ? 4 : 4)}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Joints */}
      <section>
        <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground mb-3 px-1">
          Joints
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {JOINT_NAMES.map((_, i) => (
            <JointBar
              key={i}
              index={i + 1}
              q={d?.joint_q?.[i] ?? 0}
              qd={d?.joint_qd?.[i] ?? 0}
              temp={d?.joint_temp?.[i] ?? 0}
              current={d?.joint_current?.[i] ?? 0}
            />
          ))}
        </div>
      </section>

      {/* I/O */}
      <section className="grid md:grid-cols-2 gap-3">
        <IoBits label="Digital Inputs" bits={d?.digital_in ?? 0} />
        <IoBits label="Digital Outputs" bits={d?.digital_out ?? 0} />
      </section>

      <footer className="text-center text-[11px] font-mono text-muted-foreground py-4">
        Universal Robots UR5 · RTDE telemetry · {sock.state === "open" ? "Receiving" : "Awaiting bridge"}
      </footer>
    </main>
  );
}
