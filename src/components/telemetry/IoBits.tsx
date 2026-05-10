export function IoBits({ label, bits }: { label: string; bits: number }) {
  const cells = Array.from({ length: 8 }, (_, i) => ((bits >> i) & 1) === 1);
  return (
    <div className="panel p-4">
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-3">
        {label}
      </div>
      <div className="grid grid-cols-8 gap-1.5">
        {cells.map((on, i) => (
          <div key={i} className="flex flex-col items-center gap-1">
            <div
              className={`w-full aspect-square rounded-sm border ${
                on
                  ? "bg-primary border-primary glow-primary"
                  : "bg-muted border-border"
              }`}
            />
            <span className="text-[9px] font-mono text-muted-foreground">{i}</span>
          </div>
        ))}
      </div>
    </div>
  );
}