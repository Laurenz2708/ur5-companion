import { useMemo } from "react";

/**
 * UR5 DH parameters (meters).
 * https://www.universal-robots.com/articles/ur/application-installation/dh-parameters-for-calculations-of-kinematics-and-dynamics/
 */
const D1 = 0.089159;
const A2 = -0.42500;
const A3 = -0.39225;
const D4 = 0.10915;
const D5 = 0.09465;
const D6 = 0.0823;

type V3 = [number, number, number];

/**
 * Approximate joint pivot positions in the robot base frame.
 * Good enough for a live visualization — uses the planar arm geometry
 * rotated by the base (J1) angle.
 */
function forwardKinematics(q: number[]): V3[] {
  const q1 = q[0] ?? 0;
  const q2 = q[1] ?? 0;
  const q3 = q[2] ?? 0;
  const q4 = q[3] ?? 0;

  const c1 = Math.cos(q1), s1 = Math.sin(q1);

  // Planar coords (radial r, vertical z).
  const r0 = 0,        z0 = 0;
  const r1 = 0,        z1 = D1;                                  // shoulder
  const r2 = A2 * Math.cos(q2),                z2 = z1 + A2 * Math.sin(q2);     // elbow
  const r3 = r2 + A3 * Math.cos(q2 + q3),      z3 = z2 + A3 * Math.sin(q2 + q3); // wrist1
  // Wrist offset perpendicular to the plane (D4) and small wrist segment (D5).
  const r4 = r3,                               z4 = z3 - D5;                     // wrist2
  const r5 = r4,                               z5 = z4;                           // wrist3
  // Tool length D6 along the (approx) tool z; for viz drop straight down further.
  const rt = r5,                               zt = z5 - D6 * Math.cos(q4);

  // Wrist sideways offset along the plane normal.
  const sideOffset = D4;

  // Lift to 3D using J1 base rotation. The wrist offset is along the plane
  // normal (perpendicular to r-axis): (-s1, c1).
  const toXY = (r: number, off: number): [number, number] => [r * c1 - off * s1, r * s1 + off * c1];

  const p0: V3 = [0, 0, z0];
  const p1: V3 = [...toXY(r1, 0), z1];
  const p2: V3 = [...toXY(r2, 0), z2];
  const p3: V3 = [...toXY(r3, 0), z3];
  const p4: V3 = [...toXY(r4, sideOffset), z4];
  const p5: V3 = [...toXY(r5, sideOffset), z5];
  const pt: V3 = [...toXY(rt, sideOffset), zt];

  return [p0, p1, p2, p3, p4, p5, pt];
}

type Props = {
  jointQ?: number[];
  tcp?: number[];
  live: boolean;
};

export function ArmVisualization({ jointQ, tcp, live }: Props) {
  const joints = useMemo(() => forwardKinematics(jointQ ?? [0, -1.5708, 0, -1.5708, 0, 0]), [jointQ]);
  // Override the last point with the actual TCP from telemetry if available
  // (more accurate than our simplified wrist chain).
  const display = useMemo(() => {
    if (!tcp || tcp.length < 3) return joints;
    const out = joints.slice();
    out[out.length - 1] = [tcp[0], tcp[1], tcp[2]];
    return out;
  }, [joints, tcp]);

  return (
    <div className="panel p-6">
      <div className="flex items-baseline justify-between mb-5">
        <h2 className="text-base font-semibold tracking-tight">Arm visualization</h2>
        <span className={`text-xs ${live ? "text-success" : "text-muted-foreground"}`}>
          {live ? "live" : "offline"}
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ProjectionView label="Side  (radial → · Z ↑)" points={display} mode="side" />
        <ProjectionView label="Top  (X → · Y ↑)" points={display} mode="top" />
      </div>
    </div>
  );
}

function ProjectionView({
  label,
  points,
  mode,
}: {
  label: string;
  points: V3[];
  mode: "side" | "top";
}) {
  const W = 280, H = 220, PAD = 12;
  const reach = 1.0; // meters shown on each side

  // Map world meters to svg pixels.
  const projected = points.map(([x, y, z]) => {
    if (mode === "top") return [x, y] as [number, number];
    // Side view: radial distance vs height. Sign keeps direction relative to base.
    const r = Math.hypot(x, y) * Math.sign(x || 1);
    return [r, z] as [number, number];
  });

  const minU = -reach, maxU = reach;
  const minV = mode === "side" ? -0.1 : -reach;
  const maxV = mode === "side" ? 1.2 : reach;

  const px = (u: number) => PAD + ((u - minU) / (maxU - minU)) * (W - 2 * PAD);
  const py = (v: number) => H - PAD - ((v - minV) / (maxV - minV)) * (H - 2 * PAD);

  const path = projected.map(([u, v], i) => `${i === 0 ? "M" : "L"} ${px(u).toFixed(1)} ${py(v).toFixed(1)}`).join(" ");
  const tcpPoint = projected[projected.length - 1];

  return (
    <div className="rounded-2xl bg-secondary/60 p-3">
      <div className="text-[10px] text-muted-foreground mb-2">{label}</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block">
        {/* frame */}
        <rect x={PAD} y={PAD} width={W - 2 * PAD} height={H - 2 * PAD} rx={8} fill="none" stroke="hsl(var(--border))" strokeOpacity={0.4} />
        {/* origin axes */}
        <g stroke="hsl(var(--primary))" strokeOpacity={0.35} strokeDasharray="2 3">
          <line x1={px(0)} y1={PAD} x2={px(0)} y2={H - PAD} />
          <line x1={PAD} y1={py(0)} x2={W - PAD} y2={py(0)} />
        </g>
        {/* ground floor (side view only) */}
        {mode === "side" && (
          <line
            x1={PAD}
            y1={py(0)}
            x2={W - PAD}
            y2={py(0)}
            stroke="hsl(var(--muted-foreground))"
            strokeOpacity={0.5}
            strokeWidth={1}
          />
        )}
        {/* arm chain */}
        <path
          d={path}
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth={4}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ transition: "d 120ms linear" }}
        />
        {/* joint pivots */}
        {projected.slice(0, -1).map(([u, v], i) => (
          <circle
            key={i}
            cx={px(u)}
            cy={py(v)}
            r={i === 0 ? 6 : 4}
            fill="hsl(var(--background))"
            stroke="hsl(var(--primary))"
            strokeWidth={2}
            style={{ transition: "cx 120ms linear, cy 120ms linear" }}
          />
        ))}
        {/* TCP */}
        <g style={{ transition: "transform 120ms linear" }}>
          <circle cx={px(tcpPoint[0])} cy={py(tcpPoint[1])} r={10} fill="hsl(var(--primary))" fillOpacity={0.18} />
          <circle cx={px(tcpPoint[0])} cy={py(tcpPoint[1])} r={4} fill="hsl(var(--primary))" />
        </g>
      </svg>
    </div>
  );
}