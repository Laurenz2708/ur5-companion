// Mosaic generation: quantize an image to a fixed palette and produce
// a placement plan for the robot arm.
//
// Physical setup (defaults):
//   - Plate:       300 x 300 mm (30 x 30 cm)
//   - Stone size:  5 x 5 mm  (0.5 x 0.5 cm)
//   - Grid:        60 x 60   = 3600 stones
//   - Palette:     20 fixed colors

export const PLATE_MM = 300;
export const STONE_MM = 5;
export const GRID = PLATE_MM / STONE_MM; // 60

export type Rgb = [number, number, number];

export type PaletteColor = {
  id: number;
  name: string;
  hex: string;
  rgb: Rgb;
};

function hexToRgb(hex: string): Rgb {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

const RAW_PALETTE: Array<[string, string]> = [
  ["Schwarz",        "#0a0a0a"],
  ["Weiß",           "#f5f5f5"],
  ["Hellgrau",       "#bfbfbf"],
  ["Dunkelgrau",     "#4a4a4a"],
  ["Beige",          "#d8c8a8"],
  ["Braun",          "#7a4a22"],
  ["Rot",            "#d62828"],
  ["Dunkelrot",      "#7a1818"],
  ["Orange",         "#f08a24"],
  ["Gelb",           "#f5c518"],
  ["Olivgrün",       "#6b7a2a"],
  ["Hellgrün",       "#7ec64a"],
  ["Dunkelgrün",     "#1f6f3a"],
  ["Türkis",         "#2aa6a6"],
  ["Hellblau",       "#5fb1e6"],
  ["Blau",           "#1d4ed8"],
  ["Dunkelblau",     "#0a2a6b"],
  ["Violett",        "#6b3fa0"],
  ["Rosa",           "#e58fb1"],
  ["Magenta",        "#c2185b"],
];

export const PALETTE: PaletteColor[] = RAW_PALETTE.map(([name, hex], i) => ({
  id: i,
  name,
  hex,
  rgb: hexToRgb(hex),
}));

function nearestPaletteIdx(r: number, g: number, b: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < PALETTE.length; i++) {
    const [pr, pg, pb] = PALETTE[i].rgb;
    const dr = r - pr, dg = g - pg, db = b - pb;
    const d = dr * dr + dg * dg + db * db;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/**
 * Reduce an HTMLImageElement / ImageBitmap to a GRIDxGRID matrix of palette
 * indices. Uses an offscreen canvas to downsample, then optional
 * Floyd–Steinberg dithering for smoother gradients.
 */
export function quantizeImage(
  source: CanvasImageSource & { width: number; height: number },
  opts: { dither?: boolean } = {},
): Uint8Array {
  const { dither = true } = opts;
  const canvas = document.createElement("canvas");
  canvas.width = GRID;
  canvas.height = GRID;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

  // Cover-fit (square crop) so a portrait/landscape image fills the plate.
  const sw = source.width;
  const sh = source.height;
  const side = Math.min(sw, sh);
  const sx = (sw - side) / 2;
  const sy = (sh - side) / 2;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, sx, sy, side, side, 0, 0, GRID, GRID);

  const img = ctx.getImageData(0, 0, GRID, GRID);
  const data = img.data;
  const out = new Uint8Array(GRID * GRID);

  // Work in a Float32 buffer for dithering.
  const buf = new Float32Array(GRID * GRID * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    buf[j] = data[i];
    buf[j + 1] = data[i + 1];
    buf[j + 2] = data[i + 2];
  }

  const idxAt = (x: number, y: number) => (y * GRID + x) * 3;

  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const i = idxAt(x, y);
      const r = Math.max(0, Math.min(255, buf[i]));
      const g = Math.max(0, Math.min(255, buf[i + 1]));
      const b = Math.max(0, Math.min(255, buf[i + 2]));
      const pi = nearestPaletteIdx(r, g, b);
      out[y * GRID + x] = pi;

      if (dither) {
        const [pr, pg, pb] = PALETTE[pi].rgb;
        const er = r - pr, eg = g - pg, eb = b - pb;
        const spread = (dx: number, dy: number, w: number) => {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || xx >= GRID || yy < 0 || yy >= GRID) return;
          const k = idxAt(xx, yy);
          buf[k] += er * w;
          buf[k + 1] += eg * w;
          buf[k + 2] += eb * w;
        };
        spread(1, 0, 7 / 16);
        spread(-1, 1, 3 / 16);
        spread(0, 1, 5 / 16);
        spread(1, 1, 1 / 16);
      }
    }
  }
  return out;
}

export type StoneCount = { color: PaletteColor; count: number };

export function countStones(grid: Uint8Array): StoneCount[] {
  const counts = new Array(PALETTE.length).fill(0);
  for (let i = 0; i < grid.length; i++) counts[grid[i]]++;
  return PALETTE.map((color, i) => ({ color, count: counts[i] }))
    .sort((a, b) => b.count - a.count);
}

export type PlacementStep = {
  i: number;          // sequential index
  row: number;        // 0..GRID-1 (top → bottom in image)
  col: number;        // 0..GRID-1 (left → right in image)
  x_mm: number;       // stone center on plate, mm
  y_mm: number;       // stone center on plate, mm
  color_id: number;
  color_hex: string;
  color_name: string;
};

/**
 * Build a serpentine placement plan (left→right, then right→left on next row)
 * to minimize travel between stones.
 */
export function buildPlan(grid: Uint8Array): PlacementStep[] {
  const plan: PlacementStep[] = [];
  let i = 0;
  for (let row = 0; row < GRID; row++) {
    const ltr = row % 2 === 0;
    for (let k = 0; k < GRID; k++) {
      const col = ltr ? k : GRID - 1 - k;
      const id = grid[row * GRID + col];
      const c = PALETTE[id];
      plan.push({
        i: i++,
        row,
        col,
        x_mm: col * STONE_MM + STONE_MM / 2,
        y_mm: row * STONE_MM + STONE_MM / 2,
        color_id: id,
        color_hex: c.hex,
        color_name: c.name,
      });
    }
  }
  return plan;
}

export function renderPreview(
  grid: Uint8Array,
  pixelSize = 8,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = GRID * pixelSize;
  canvas.height = GRID * pixelSize;
  const ctx = canvas.getContext("2d")!;
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      ctx.fillStyle = PALETTE[grid[y * GRID + x]].hex;
      ctx.fillRect(x * pixelSize, y * pixelSize, pixelSize, pixelSize);
    }
  }
  return canvas;
}