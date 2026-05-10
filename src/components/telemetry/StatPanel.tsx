import { ReactNode } from "react";

export function StatPanel({
  label,
  children,
  accent,
}: {
  label: string;
  children: ReactNode;
  accent?: "primary" | "accent" | "success" | "warning" | "destructive";
}) {
  const accentClass =
    accent === "primary" ? "text-primary"
    : accent === "accent" ? "text-accent"
    : accent === "success" ? "text-success"
    : accent === "warning" ? "text-warning"
    : accent === "destructive" ? "text-destructive"
    : "text-foreground";
  return (
    <div className="panel p-4">
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">
        {label}
      </div>
      <div className={`font-mono ${accentClass}`}>{children}</div>
    </div>
  );
}