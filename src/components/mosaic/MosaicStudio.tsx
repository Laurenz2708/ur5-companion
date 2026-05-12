import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Upload, Download, Play, Square, RotateCcw } from "lucide-react";
import {
  PALETTE, GRID, PLATE_MM, STONE_MM,
  quantizeImage, countStones, buildPlan, renderPreview,
  type PlacementStep, type StoneCount,
} from "@/lib/mosaic";

type Sender = (cmd: object) => boolean;

export function MosaicStudio({
  send, enabled,
}: { send: Sender; enabled: boolean }) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageName, setImageName] = useState<string>("");
  const [dither, setDither] = useState(true);
  const [grid, setGrid] = useState<Uint8Array | null>(null);
  const [counts, setCounts] = useState<StoneCount[]>([]);
  const [plan, setPlan] = useState<PlacementStep[]>([]);
  const [originX, setOriginX] = useState(250); // mm — TCP plate origin (X)
  const [originY, setOriginY] = useState(-150); // mm — plate origin (Y)
  const [placeZ, setPlaceZ] = useState(150); // mm
  const [hoverZ, setHoverZ] = useState(180); // mm (approach above plate)
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const stopRef = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Re-quantize whenever image / dither changes.
  useEffect(() => {
    if (!imageUrl) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const q = quantizeImage(img, { dither });
      setGrid(q);
      setCounts(countStones(q));
      setPlan(buildPlan(q));
    };
    img.src = imageUrl;
  }, [imageUrl, dither]);

  // Paint the preview canvas.
  useEffect(() => {
    if (!grid || !canvasRef.current) return;
    const src = renderPreview(grid, 8);
    const dst = canvasRef.current;
    dst.width = src.width;
    dst.height = src.height;
    const ctx = dst.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, 0, 0);
  }, [grid]);

  const totalStones = grid ? grid.length : 0;

  const onFile = (f: File | null) => {
    if (!f) return;
    setImageName(f.name);
    const url = URL.createObjectURL(f);
    setImageUrl(url);
  };

  const downloadPlan = () => {
    if (!plan.length) return;
    const meta = {
      plate_mm: PLATE_MM,
      stone_mm: STONE_MM,
      grid: GRID,
      origin_mm: { x: originX, y: originY },
      place_z_mm: placeZ,
      hover_z_mm: hoverZ,
      palette: PALETTE,
      stones: plan,
    };
    const blob = new Blob([JSON.stringify(meta, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `mosaic_plan_${Date.now()}.json`;
    a.click();
  };

  const runRobot = async () => {
    if (!plan.length || !enabled || running) return;
    setRunning(true);
    stopRef.current = false;
    setProgress(0);

    // Send start envelope so the bridge can prepare a job.
    send({
      cmd: "mosaic_begin",
      plate_mm: PLATE_MM,
      stone_mm: STONE_MM,
      grid: GRID,
      origin_mm: { x: originX, y: originY },
      place_z_mm: placeZ,
      hover_z_mm: hoverZ,
      total: plan.length,
    });

    for (let i = 0; i < plan.length; i++) {
      if (stopRef.current) break;
      const s = plan[i];
      send({
        cmd: "place_stone",
        i: s.i,
        row: s.row,
        col: s.col,
        // Convert plate coords (mm) to robot base frame (m).
        x_m: (originX + s.x_mm) / 1000,
        y_m: (originY + s.y_mm) / 1000,
        z_place_m: placeZ / 1000,
        z_hover_m: hoverZ / 1000,
        color_id: s.color_id,
        color_name: s.color_name,
      });
      setProgress(i + 1);
      // Throttle so we don't flood the bridge socket.
      await new Promise((r) => setTimeout(r, 15));
    }

    send({ cmd: "mosaic_end" });
    setRunning(false);
  };

  const stopRobot = () => {
    stopRef.current = true;
    send({ cmd: "stop" });
  };

  const reset = () => {
    setImageUrl(null);
    setImageName("");
    setGrid(null);
    setCounts([]);
    setPlan([]);
    setProgress(0);
  };

  return (
    <div className="space-y-6">
      {/* Upload */}
      <div className="panel p-6">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
          <div>
            <h2 className="text-base font-semibold tracking-tight">Bild hochladen</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Wird automatisch auf {GRID}×{GRID} Steine ({PLATE_MM}×{PLATE_MM} mm) reduziert
            </p>
          </div>
          <div className="flex gap-2">
            <label className="inline-flex">
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => onFile(e.target.files?.[0] ?? null)}
              />
              <span className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 cursor-pointer">
                <Upload className="h-4 w-4" /> Bild wählen
              </span>
            </label>
            {grid && (
              <Button variant="secondary" className="rounded-xl" onClick={reset}>
                <RotateCcw className="h-4 w-4 mr-1.5" /> Zurücksetzen
              </Button>
            )}
          </div>
        </div>
        {imageName && (
          <p className="text-xs text-muted-foreground mt-3 truncate">📎 {imageName}</p>
        )}

        <div className="mt-5 flex items-center gap-3">
          <input
            id="dither"
            type="checkbox"
            checked={dither}
            onChange={(e) => setDither(e.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          <label htmlFor="dither" className="text-sm">
            Floyd–Steinberg Dithering (weichere Farbverläufe)
          </label>
        </div>
      </div>

      {/* Preview + palette breakdown */}
      {grid && (
        <div className="grid lg:grid-cols-5 gap-6">
          <div className="panel p-6 lg:col-span-3">
            <div className="flex items-baseline justify-between mb-4">
              <h2 className="text-base font-semibold tracking-tight">Mosaik-Vorschau</h2>
              <span className="text-xs text-muted-foreground tabular-nums">
                {GRID}×{GRID} · {totalStones} Steine
              </span>
            </div>
            <div className="rounded-2xl overflow-hidden bg-secondary/40 p-2">
              <canvas
                ref={canvasRef}
                className="w-full h-auto block"
                style={{ imageRendering: "pixelated" }}
              />
            </div>
            <p className="text-[11px] text-muted-foreground mt-3 text-center">
              Endergebnis · 1 Stein = {STONE_MM}×{STONE_MM} mm
            </p>
          </div>

          <div className="panel p-6 lg:col-span-2">
            <h2 className="text-base font-semibold tracking-tight mb-4">Stein-Bedarf</h2>
            <div className="space-y-1.5 max-h-[420px] overflow-auto pr-1">
              {counts.map(({ color, count }) => {
                const pct = (count / totalStones) * 100;
                return (
                  <div key={color.id} className="flex items-center gap-3">
                    <span
                      className="h-5 w-5 rounded-md border border-border shrink-0"
                      style={{ background: color.hex }}
                    />
                    <span className="text-xs flex-1 truncate">{color.name}</span>
                    <span className="text-xs font-mono tabular-nums text-muted-foreground w-20 text-right">
                      {count} ({pct.toFixed(1)}%)
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Robot setup + run */}
      {grid && (
        <div className="panel p-6 space-y-5">
          <div>
            <h2 className="text-base font-semibold tracking-tight">Roboter-Ablage</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Ursprung der Mosaik-Platte im Roboter-Basis­frame (Ecke oben-links)
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <NumRow label="Origin X" unit="mm" value={originX} min={-500} max={500} step={1} onChange={setOriginX} />
            <NumRow label="Origin Y" unit="mm" value={originY} min={-500} max={500} step={1} onChange={setOriginY} />
            <NumRow label="Place Z"  unit="mm" value={placeZ}  min={50}   max={400} step={1} onChange={setPlaceZ} />
            <NumRow label="Hover Z"  unit="mm" value={hoverZ}  min={50}   max={400} step={1} onChange={setHoverZ} />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              className="rounded-xl"
              disabled={!enabled || running}
              onClick={runRobot}
            >
              <Play className="h-4 w-4 mr-1.5" />
              {running ? "Läuft…" : "Roboter starten"}
            </Button>
            <Button
              variant="destructive"
              className="rounded-xl"
              disabled={!running}
              onClick={stopRobot}
            >
              <Square className="h-4 w-4 mr-1.5" /> Stop
            </Button>
            <Button
              variant="secondary"
              className="rounded-xl"
              onClick={downloadPlan}
            >
              <Download className="h-4 w-4 mr-1.5" /> Plan (JSON)
            </Button>
            {!enabled && (
              <span className="text-xs text-muted-foreground">
                Bridge nicht verbunden — Plan kann trotzdem heruntergeladen werden
              </span>
            )}
          </div>

          {(running || progress > 0) && (
            <div>
              <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
                <span>Fortschritt</span>
                <span className="font-mono tabular-nums">
                  {progress} / {plan.length}
                </span>
              </div>
              <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${(progress / plan.length) * 100}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NumRow({
  label, unit, value, min, max, step, onChange,
}: {
  label: string; unit: string; value: number;
  min: number; max: number; step: number; onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <label className="text-xs uppercase tracking-wider text-muted-foreground">
          {label}
        </label>
        <span className="text-sm font-mono tabular-nums">
          {value} <span className="text-muted-foreground text-xs">{unit}</span>
        </span>
      </div>
      <Slider
        value={[value]}
        min={min} max={max} step={step}
        onValueChange={(v) => onChange(v[0])}
      />
    </div>
  );
}