import { useEffect, useRef } from "react";

type Props = {
  pose?: number[]; // [x,y,z,rx,ry,rz] meters/rad in base frame
  live: boolean;
  /** Workspace half-size in meters (cube extents around base). */
  reach?: number;
};

/**
 * Lightweight live preview of the UR5 tool head position in the robot base frame.
 * Shows three orthogonal projections (Top XY, Front XZ, Side YZ) with a fading
 * trail of the recent TCP path. Pure SVG — no extra deps.
 */
export function ToolHeadPreview({ pose, live, reach = 0.9 }: Props) {
  const trailRef = useRef<{ x: number; y: number; z: number }[]>([]);
  const tickRef = useRef(0);

  // Append to trail when a new pose arrives.
  const x = pose?.[0];
  const y = pose?.[1];
  const z = pose?.[2];
  useEffect(() => {
    if (x === undefined || y === undefined || z === undefined) return;
    const t = trailRef.current;
    const last = t[t.length - 1];
    if (!last || Math.hypot(last.x - x, last.y - y, last.z - z) > 0.001) {
      t.push({ x, y, z });
      if (t.length > 200) t.shift();
      tickRef.current++;
    }
  }, [x, y, z]);

  const hasPose = x !== undefined && y !== undefined && z !== undefined;

  return (
    <div className="panel p-6">
      <div className="flex items-baseline justify-between mb-5">
        <h2 className="text-base font-semibold tracking-tight">Tool head preview</h2>
        <span className="text-xs text-muted-foreground">
          {live ? "live" : "offline"} · ±{reach.toFixed(2)} m
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <View
          label="Top  (X→ Y↑)"
          a={x}
          b={y}
          trail={trailRef.current.map((p) => [p.x, p.y] as [number, number])}
          reach={reach}
          hasPose={hasPose}
        />
        <View
          label="Front (X→ Z↑)"
          a={x}
          b={z}
          trail={trailRef.current.map((p) => [p.x, p.z] as [number, number])}
          reach={reach}
          hasPose={hasPose}
        />
        <View
          label="Side (Y→ Z↑)"
          a={y}
          b={z}
          trail={trailRef.current.map((p) => [p.y, p.z] as [number, number])}
          reach={reach}
          hasPose={hasPose}
        />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3 text-xs font-mono tabular-nums">
        <Coord label="X" v={x} />
        <Coord label="Y" v={y} />
        <Coord label="Z" v={z} />
      </div>
    </div>
  );
}

function Coord({ label, v }: { label: string; v?: number }) {
  return (
    <div className="rounded-xl bg-secondary/60 px-3 py-2 flex items-baseline justify-between">
      <span className="text-[10px] text-primary">{label}</span>
      <span>{v === undefined ? "—" : `${v.toFixed(3)} m`}</span>
    </div>
  );
}

function View({
  label,
  a,
  b,
  trail,
  reach,
  hasPose,
}: {
  label: string;
  a?: number;
  b?: number;
  trail: [number, number][];
  reach: number;
  hasPose: boolean;
}) {
  const size = 180;
  const pad = 8;
  const inner = size - pad * 2;
  // Map meters in [-reach, reach] -> pixels in [pad, size-pad]; flip Y axis (svg down).
  const px = (m: number) => pad + ((m + reach) / (2 * reach)) * inner;
  const py = (m: number) => pad + (1 - (m + reach) / (2 * reach)) * inner;

  const points = trail
    .filter(([u, v]) => Math.abs(u) <= reach * 1.2 && Math.abs(v) <= reach * 1.2)
    .map(([u, v]) => `${px(u).toFixed(1)},${py(v).toFixed(1)}`)
    .join(" ");

  return (
    <div className="rounded-2xl bg-secondary/60 p-3">
      <div className="text-[10px] text-muted-foreground mb-2">{label}</div>
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-auto block">
        {/* grid */}
        <rect
          x={pad}
          y={pad}
          width={inner}
          height={inner}
          fill="none"
          stroke="hsl(var(--border))"
          strokeOpacity={0.4}
          rx={6}
        />
        {[0.25, 0.5, 0.75].map((f) => (
          <g key={f} stroke="hsl(var(--border))" strokeOpacity={0.25}>
            <line x1={pad + inner * f} y1={pad} x2={pad + inner * f} y2={size - pad} />
            <line x1={pad} y1={pad + inner * f} x2={size - pad} y2={pad + inner * f} />
          </g>
        ))}
        {/* axes through origin */}
        <g stroke="hsl(var(--primary))" strokeOpacity={0.45} strokeDasharray="2 3">
          <line x1={px(0)} y1={pad} x2={px(0)} y2={size - pad} />
          <line x1={pad} y1={py(0)} x2={size - pad} y2={py(0)} />
        </g>
        {/* trail */}
        {points && (
          <polyline
            points={points}
            fill="none"
            stroke="hsl(var(--primary))"
            strokeOpacity={0.5}
            strokeWidth={1.2}
          />
        )}
        {/* current TCP */}
        {hasPose && a !== undefined && b !== undefined && (
          <g>
            <circle
              cx={px(a)}
              cy={py(b)}
              r={9}
              fill="hsl(var(--primary))"
              fillOpacity={0.18}
            />
            <circle cx={px(a)} cy={py(b)} r={3.5} fill="hsl(var(--primary))" />
          </g>
        )}
      </svg>
    </div>
  );
}