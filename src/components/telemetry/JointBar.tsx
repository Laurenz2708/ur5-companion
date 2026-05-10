export function JointBar({
  index, q, qd, temp, current,
}: { index: number; q: number; qd: number; temp: number; current: number }) {
  // q in radians, normalize -2π..2π to 0..1 for visualization
  const pct = ((q + 2 * Math.PI) / (4 * Math.PI)) * 100;
  const deg = (q * 180) / Math.PI;
  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Joint
          </span>
          <span className="font-mono text-primary font-semibold">J{index}</span>
        </div>
        <span className="font-mono text-xs text-muted-foreground">
          {temp?.toFixed(1) ?? "--"}°C · {current?.toFixed(2) ?? "--"}A
        </span>
      </div>
      <div className="font-mono text-2xl tabular-nums mb-2">
        {deg.toFixed(2)}
        <span className="text-muted-foreground text-sm ml-1">deg</span>
      </div>
      <div className="relative h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 bg-primary glow-primary transition-all duration-150"
          style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
        />
      </div>
      <div className="flex justify-between text-[10px] font-mono text-muted-foreground mt-2">
        <span>q̇ {qd?.toFixed(3) ?? "--"} rad/s</span>
        <span>{q?.toFixed(4) ?? "--"} rad</span>
      </div>
    </div>
  );
}