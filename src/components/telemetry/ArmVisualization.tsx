import { useMemo } from "react";

/**
 * UR5 DH parameters (meters). Standard convention from Universal Robots.
 * d, a, alpha per joint i (theta = q_i).
 */
const DH = [
  { a: 0.0,      d: 0.089159, alpha:  Math.PI / 2 },
  { a: -0.42500, d: 0.0,      alpha:  0           },
  { a: -0.39225, d: 0.0,      alpha:  0           },
  { a: 0.0,      d: 0.10915,  alpha:  Math.PI / 2 },
  { a: 0.0,      d: 0.09465,  alpha: -Math.PI / 2 },
  { a: 0.0,      d: 0.0823,   alpha:  0           },
] as const;

type V3 = [number, number, number];
type Mat4 = number[]; // row-major 4x4

function ident(): Mat4 {
  return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
}
function mul(A: Mat4, B: Mat4): Mat4 {
  const C = new Array(16).fill(0) as Mat4;
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++)
      for (let k = 0; k < 4; k++)
        C[i*4+j] += A[i*4+k] * B[k*4+j];
  return C;
}
function dhMatrix(theta: number, d: number, a: number, alpha: number): Mat4 {
  const ct = Math.cos(theta), st = Math.sin(theta);
  const ca = Math.cos(alpha), sa = Math.sin(alpha);
  return [
    ct, -st*ca,  st*sa, a*ct,
    st,  ct*ca, -ct*sa, a*st,
    0,   sa,     ca,    d,
    0,   0,      0,     1,
  ];
}
function origin(M: Mat4): V3 { return [M[3], M[7], M[11]]; }

/** Joint origins p0..p6 (base, shoulder, upper-arm tip, forearm tip, wrist1, wrist2, tcp/wrist3). */
function forwardKinematics(q: number[]): V3[] {
  let T: Mat4 = ident();
  const points: V3[] = [origin(T)];
  for (let i = 0; i < 6; i++) {
    const { a, d, alpha } = DH[i];
    T = mul(T, dhMatrix(q[i] ?? 0, d, a, alpha));
    points.push(origin(T));
  }
  return points;
}

type Props = {
  jointQ?: number[];
  tcp?: number[];
  live: boolean;
};

export function ArmVisualization({ jointQ, tcp, live }: Props) {
  const points = useMemo(
    () => forwardKinematics(jointQ ?? [0, -1.5708, 0, -1.5708, 0, 0]),
    [jointQ],
  );
  // Replace last point with TCP from telemetry if available.
  const display = useMemo(() => {
    if (!tcp || tcp.length < 3) return points;
    const out = points.slice();
    out[out.length - 1] = [tcp[0], tcp[1], tcp[2]];
    return out;
  }, [points, tcp]);

  return (
    <div className="panel p-6">
      <div className="flex items-baseline justify-between mb-5">
        <h2 className="text-base font-semibold tracking-tight">Arm visualization</h2>
        <span className={`text-xs ${live ? "text-success" : "text-muted-foreground"}`}>
          {live ? "live" : "offline"}
        </span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <ArmView label="Side  ·  radial → / Z ↑" points={display} mode="side" />
        <ArmView label="Top  ·  X → / Y ↑" points={display} mode="top" />
      </div>
    </div>
  );
}

const SEGMENT_COLORS = [
  "hsl(var(--primary))",            // base → shoulder
  "hsl(var(--primary) / 0.85)",     // shoulder → upper arm
  "hsl(var(--primary) / 0.7)",      // upper arm → forearm
  "hsl(var(--primary) / 0.6)",      // forearm → wrist1
  "hsl(var(--primary) / 0.5)",      // wrist1 → wrist2
  "hsl(var(--primary) / 0.4)",      // wrist2 → tcp
];

const JOINT_LABELS = ["Base", "J1", "J2", "J3", "J4", "J5", "TCP"];

function ArmView({
  label,
  points,
  mode,
}: {
  label: string;
  points: V3[];
  mode: "side" | "top";
}) {
  const W = 360, H = 280, PAD = 16;
  const reach = 1.0;

  const projected: [number, number][] = points.map(([x, y, z]) => {
    if (mode === "top") return [x, y];
    const r = Math.hypot(x, y) * (x >= 0 ? 1 : -1);
    return [r, z];
  });

  const minU = -reach, maxU = reach;
  const minV = mode === "side" ? -0.05 : -reach;
  const maxV = mode === "side" ? 1.15 : reach;

  const px = (u: number) => PAD + ((u - minU) / (maxU - minU)) * (W - 2 * PAD);
  const py = (u: number) => H - PAD - ((u - minV) / (maxV - minV)) * (H - 2 * PAD);

  const tcp = projected[projected.length - 1];

  return (
    <div className="rounded-2xl bg-secondary/60 p-3">
      <div className="text-[10px] text-muted-foreground mb-2">{label}</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block">
        {/* frame */}
        <rect x={PAD} y={PAD} width={W - 2*PAD} height={H - 2*PAD} rx={10} fill="none" stroke="hsl(var(--border))" strokeOpacity={0.4} />
        {/* grid */}
        {[0.25, 0.5, 0.75].map((f) => (
          <g key={f} stroke="hsl(var(--border))" strokeOpacity={0.2}>
            <line x1={PAD + (W-2*PAD)*f} y1={PAD} x2={PAD + (W-2*PAD)*f} y2={H-PAD} />
            <line x1={PAD} y1={PAD + (H-2*PAD)*f} x2={W-PAD} y2={PAD + (H-2*PAD)*f} />
          </g>
        ))}
        {/* origin axes */}
        <g stroke="hsl(var(--primary))" strokeOpacity={0.3} strokeDasharray="2 4">
          <line x1={px(0)} y1={PAD} x2={px(0)} y2={H-PAD} />
          <line x1={PAD} y1={py(0)} x2={W-PAD} y2={py(0)} />
        </g>

        {/* ground floor (side view) */}
        {mode === "side" && (
          <>
            <line x1={PAD} y1={py(0)} x2={W-PAD} y2={py(0)} stroke="hsl(var(--muted-foreground))" strokeOpacity={0.6} strokeWidth={1.5} />
            {/* base mount */}
            <rect
              x={px(-0.08)}
              y={py(0.04)}
              width={px(0.08) - px(-0.08)}
              height={py(0) - py(0.04)}
              rx={3}
              fill="hsl(var(--muted-foreground) / 0.35)"
            />
          </>
        )}
        {mode === "top" && (
          <circle cx={px(0)} cy={py(0)} r={Math.abs(px(0.08) - px(0))} fill="hsl(var(--muted-foreground) / 0.25)" />
        )}

        {/* arm segments — drawn thick with shadow underlayer */}
        {projected.slice(0, -1).map((p, i) => {
          const q = projected[i + 1];
          return (
            <g key={i}>
              <line
                x1={px(p[0])} y1={py(p[1])}
                x2={px(q[0])} y2={py(q[1])}
                stroke="hsl(var(--background))"
                strokeOpacity={0.7}
                strokeWidth={11}
                strokeLinecap="round"
              />
              <line
                x1={px(p[0])} y1={py(p[1])}
                x2={px(q[0])} y2={py(q[1])}
                stroke={SEGMENT_COLORS[i]}
                strokeWidth={7}
                strokeLinecap="round"
                style={{ transition: "x1 120ms linear, y1 120ms linear, x2 120ms linear, y2 120ms linear" }}
              />
            </g>
          );
        })}

        {/* joint pivots */}
        {projected.slice(0, -1).map((p, i) => (
          <g key={`j${i}`} style={{ transition: "transform 120ms linear" }}>
            <circle
              cx={px(p[0])} cy={py(p[1])}
              r={i === 0 ? 8 : 5.5}
              fill="hsl(var(--background))"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
            />
            {i > 0 && (
              <circle cx={px(p[0])} cy={py(p[1])} r={2} fill="hsl(var(--primary))" />
            )}
          </g>
        ))}

        {/* TCP marker */}
        <g>
          <circle cx={px(tcp[0])} cy={py(tcp[1])} r={12} fill="hsl(var(--primary))" fillOpacity={0.18} />
          <circle cx={px(tcp[0])} cy={py(tcp[1])} r={4.5} fill="hsl(var(--primary))" />
          <text
            x={px(tcp[0]) + 10}
            y={py(tcp[1]) - 8}
            fontSize={9}
            fill="hsl(var(--primary))"
            fontFamily="ui-monospace, monospace"
          >
            {JOINT_LABELS[JOINT_LABELS.length - 1]}
          </text>
        </g>
      </svg>
    </div>
  );
}