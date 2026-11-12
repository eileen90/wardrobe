/**
 * Cutting a garment out of a picture whose backdrop is one flat colour.
 *
 * Two cases:
 *  - a studio remake, shot on a saturated backdrop we asked for (chroma key);
 *  - a shop picture that already sits on plain white or grey (flood from the edges).
 */
import { makeCanvas } from './img';

type RGB = [number, number, number];

export interface Cut {
  canvas: HTMLCanvasElement;
  /** share of the frame the garment covers, 0..1 */
  cover: number;
}

/* ---------- backdrop sampling ---------- */

function median(v: number[]) {
  v.sort((a, b) => a - b);
  return v[v.length >> 1];
}

/** Median colour of the outer band, and how much that band varies. */
export function border(d: ImageData): { color: RGB; spread: number } {
  const { width: w, height: h, data } = d;
  const band = Math.max(3, Math.round(Math.min(w, h) * 0.03));
  const r: number[] = [], g: number[] = [], b: number[] = [];
  const step = Math.max(1, Math.round(Math.min(w, h) / 220));
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      if (x >= band && x < w - band && y >= band && y < h - band) continue;
      const i = (y * w + x) * 4;
      if (data[i + 3] < 250) continue;
      r.push(data[i]); g.push(data[i + 1]); b.push(data[i + 2]);
    }
  }
  if (!r.length) return { color: [255, 255, 255], spread: 999 };
  const color: RGB = [median(r.slice()), median(g.slice()), median(b.slice())];
  const dev = r.map((_, i) =>
    Math.abs(r[i] - color[0]) + Math.abs(g[i] - color[1]) + Math.abs(b[i] - color[2]));
  // 90th percentile: a few stray pixels (a sleeve touching the edge) should not count.
  dev.sort((a, c) => a - c);
  return { color, spread: dev[Math.floor(dev.length * 0.9)] };
}

const isSaturated = (c: RGB) => Math.max(...c) - Math.min(...c) > 60;

/** True when the picture already sits on a plain backdrop and needs no remake. */
export function hasPlainBackdrop(d: ImageData) {
  const b = border(d);
  return b.spread < 34;
}

/* ---------- alpha from the backdrop colour ---------- */

/**
 * Distance from the backdrop's colour *line*: brightness along the key direction is
 * ignored so soft shadows on the backdrop (darker, same hue) still count as backdrop.
 */
function chromaAlpha(d: ImageData, k: RGB): Uint8ClampedArray {
  const { width: w, height: h, data } = d;
  const kl = Math.hypot(k[0], k[1], k[2]) || 1;
  const kn = [k[0] / kl, k[1] / kl, k[2] / kl];
  const out = new Uint8ClampedArray(w * h);
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const lum = r * kn[0] + g * kn[1] + b * kn[2];
    const resid = Math.hypot(r - lum * kn[0], g - lum * kn[1], b - lum * kn[2]);
    const rel = resid / (lum + 20);
    let a = (rel - 0.1) / 0.18;
    // Very dark pixels are garment, never backdrop shadow.
    const dark = (0.3 * kl - lum) / (0.12 * kl);
    if (dark > a) a = dark;
    out[p] = a <= 0 ? 0 : a >= 1 ? 255 : a * 255;
  }
  return out;
}

/** Plain white / grey backdrop: spread inward from the frame edges only. */
function floodAlpha(d: ImageData, k: RGB): Uint8ClampedArray {
  const { width: w, height: h, data } = d;
  const n = w * h;
  const lo = 26, hi = 58; // colour distance: certainly backdrop … certainly garment
  const dist = new Float32Array(n);
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const dr = data[i] - k[0], dg = data[i + 1] - k[1], db = data[i + 2] - k[2];
    // Darker-than-backdrop is forgiven a little (shadows), lighter is not.
    const shade = Math.min(0, (dr + dg + db) / 3);
    dist[p] = Math.hypot(dr - shade * 0.5, dg - shade * 0.5, db - shade * 0.5);
  }
  const out = new Uint8ClampedArray(n).fill(255);
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  let top = 0;
  const push = (p: number) => {
    if (seen[p] || dist[p] >= hi) return;
    seen[p] = 1;
    stack[top++] = p;
  };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (top) {
    const p = stack[--top];
    const dd = dist[p];
    out[p] = dd <= lo ? 0 : ((dd - lo) / (hi - lo)) * 255;
    // Only keep spreading through pixels that are clearly backdrop, so the fill
    // cannot leak into the garment through its soft edge.
    if (dd > (lo + hi) / 2) continue;
    const x = p % w;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (p >= w) push(p - w);
    if (p < n - w) push(p + w);
  }
  return out;
}

/* ---------- mask clean-up ---------- */

/** Keep the garment (and anything comparably big, e.g. the second shoe); drop specks. */
function keepMainShapes(a: Uint8ClampedArray, w: number, h: number) {
  const n = w * h;
  const label = new Int32Array(n);
  const stack = new Int32Array(n);
  const areas: number[] = [0];
  let next = 0;
  for (let s = 0; s < n; s++) {
    if (a[s] < 128 || label[s]) continue;
    next++;
    let area = 0, top = 0;
    stack[top++] = s;
    label[s] = next;
    while (top) {
      const p = stack[--top];
      area++;
      const x = p % w;
      const tryPush = (q: number) => {
        if (a[q] >= 128 && !label[q]) { label[q] = next; stack[top++] = q; }
      };
      if (x > 0) tryPush(p - 1);
      if (x < w - 1) tryPush(p + 1);
      if (p >= w) tryPush(p - w);
      if (p < n - w) tryPush(p + w);
    }
    areas.push(area);
  }
  const biggest = Math.max(...areas);
  const keep = areas.map((ar) => ar >= biggest * 0.04 && ar > 40);
  // Solid kept pixels, grown by two pixels, bound where soft edge pixels may survive.
  let near = new Uint8Array(n);
  for (let p = 0; p < n; p++) if (label[p] && keep[label[p]]) near[p] = 1;
  for (let pass = 0; pass < 3; pass++) {
    const g = new Uint8Array(near);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const p = y * w + x;
        if (near[p]) continue;
        if (near[p - 1] || near[p + 1] || near[p - w] || near[p + w]) g[p] = 1;
      }
    }
    near = g;
  }
  for (let p = 0; p < n; p++) if (!near[p]) a[p] = 0;
}

/** Pull the edge in by a pixel and soften it, so no backdrop fringe is left. */
function refineEdge(a: Uint8ClampedArray, w: number, h: number) {
  const n = w * h;
  const e = new Uint8ClampedArray(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      let m = a[p];
      if (x > 0 && a[p - 1] < m) m = a[p - 1];
      if (x < w - 1 && a[p + 1] < m) m = a[p + 1];
      if (y > 0 && a[p - w] < m) m = a[p - w];
      if (y < h - 1 && a[p + w] < m) m = a[p + w];
      e[p] = m;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const l = x > 0 ? e[p - 1] : e[p], r = x < w - 1 ? e[p + 1] : e[p];
      const u = y > 0 ? e[p - w] : e[p], dn = y < h - 1 ? e[p + w] : e[p];
      a[p] = (e[p] * 4 + l + r + u + dn) / 8;
    }
  }
}

/** Remove the backdrop's tint from the pixels along the edge. */
function despill(d: ImageData, a: Uint8ClampedArray, k: RGB) {
  const { width: w, height: h, data } = d;
  const mean = (k[0] + k[1] + k[2]) / 3;
  const c = [k[0] - mean, k[1] - mean, k[2] - mean];
  const cl = Math.hypot(c[0], c[1], c[2]);
  if (cl < 12) return;
  const cn = [c[0] / cl, c[1] / cl, c[2] / cl];
  const n = w * h;
  // Edge band: opaque pixels within ~3px of transparency.
  let band = new Uint8Array(n);
  for (let p = 0; p < n; p++) if (a[p] < 235) band[p] = 1;
  for (let pass = 0; pass < 3; pass++) {
    const g = new Uint8Array(band);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const p = y * w + x;
        if (!band[p] && (band[p - 1] || band[p + 1] || band[p - w] || band[p + w])) g[p] = 1;
      }
    }
    band = g;
  }
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    if (!band[p] || !a[p]) continue;
    const m = (data[i] + data[i + 1] + data[i + 2]) / 3;
    const s = (data[i] - m) * cn[0] + (data[i + 1] - m) * cn[1] + (data[i + 2] - m) * cn[2];
    if (s <= 0) continue;
    data[i] -= cn[0] * s;
    data[i + 1] -= cn[1] * s;
    data[i + 2] -= cn[2] * s;
  }
}

/* ---------- public ---------- */

/**
 * Cut the subject out of a picture with a flat backdrop.
 * Returns null when the result is not believable (nothing left, or nothing removed).
 */
export function cutOut(src: HTMLCanvasElement): Cut | null {
  const w = src.width, h = src.height;
  const ctx = src.getContext('2d', { willReadFrequently: true })!;
  const d = ctx.getImageData(0, 0, w, h);
  const k = border(d).color;
  const chroma = isSaturated(k);
  const a = chroma ? chromaAlpha(d, k) : floodAlpha(d, k);
  keepMainShapes(a, w, h);
  refineEdge(a, w, h);
  if (chroma) despill(d, a, k);

  let solid = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const al = a[y * w + x];
      d.data[(y * w + x) * 4 + 3] = al;
      if (al > 127) solid++;
      if (al > 10) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  const cover = solid / (w * h);
  if (x1 < 0 || cover < 0.03 || cover > 0.9) return null;
  ctx.putImageData(d, 0, 0);
  const pad = 2;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  const out = makeCanvas(x1 - x0 + 1, y1 - y0 + 1);
  out.getContext('2d')!.drawImage(src, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return { canvas: out, cover };
}

/** True when a picture already carries real transparency (a ready-made cut-out). */
export function hasTransparency(c: HTMLCanvasElement) {
  const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height).data;
  let clear = 0;
  const total = d.length / 4;
  for (let i = 3; i < d.length; i += 16) if (d[i] < 16) clear++;
  return clear / (total / 4) > 0.05;
}

/** Trim a transparent picture to its content. */
export function trim(c: HTMLCanvasElement): HTMLCanvasElement {
  const w = c.width, h = c.height;
  const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 10) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return c;
  const out = makeCanvas(x1 - x0 + 1, y1 - y0 + 1);
  out.getContext('2d')!.drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

/* ---------- colour reading ---------- */

function hueOf(r: number, g: number, b: number) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), dl = mx - mn;
  if (!dl) return { h: 0, s: 0, v: mx / 255 };
  let hh = mx === r ? ((g - b) / dl) % 6 : mx === g ? (b - r) / dl + 2 : (r - g) / dl + 4;
  hh *= 60;
  if (hh < 0) hh += 360;
  return { h: hh, s: dl / mx, v: mx / 255 };
}

export interface Backdrop { id: string; hue: number; words: string }
/** Backdrops the studio may ask for, in order of preference. */
export const BACKDROPS: Backdrop[] = [
  { id: 'blue', hue: 215, words: 'cobalt blue (#0047FF)' },
  { id: 'magenta', hue: 325, words: 'magenta (#FF00FF)' },
  { id: 'green', hue: 120, words: 'chroma key green (#00FF00)' },
];

/**
 * Order the backdrops so the first one is the colour least present in the photo,
 * which keeps the key from eating into the garment (blue jeans never get a blue backdrop).
 */
export function rankBackdrops(photo: HTMLCanvasElement): Backdrop[] {
  const s = makeCanvas(96, 96);
  const ctx = s.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(photo, 0, 0, 96, 96);
  const d = ctx.getImageData(0, 0, 96, 96).data;
  const mass = BACKDROPS.map(() => 0);
  let total = 0;
  for (let y = 10; y < 86; y++) {
    for (let x = 10; x < 86; x++) {
      const i = (y * 96 + x) * 4;
      const { h, s: sat, v } = hueOf(d[i], d[i + 1], d[i + 2]);
      total++;
      if (sat < 0.2 || v < 0.12) continue;
      BACKDROPS.forEach((b, bi) => {
        const diff = Math.abs(((h - b.hue + 540) % 360) - 180);
        if (diff < 48) mass[bi] += sat;
      });
    }
  }
  return BACKDROPS.map((b, i) => ({ b, m: mass[i] / total, i }))
    // 1.5% steps: ignore tiny differences so the preferred order wins ties.
    .sort((p, q) => Math.round(p.m / 0.015) - Math.round(q.m / 0.015) || p.i - q.i)
    .map((x) => x.b);
}

/** Up to three dominant colours of a cut-out, as hex. */
export function palette(c: HTMLCanvasElement): string[] {
  const s = makeCanvas(64, 64);
  const ctx = s.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(c, 0, 0, 64, 64);
  const d = ctx.getImageData(0, 0, 64, 64).data;
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 200) continue;
    const key = ((d[i] >> 5) << 6) | ((d[i + 1] >> 5) << 3) | (d[i + 2] >> 5);
    const e = bins.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++; e.r += d[i]; e.g += d[i + 1]; e.b += d[i + 2];
    bins.set(key, e);
  }
  const top = [...bins.values()].sort((a, b) => b.n - a.n);
  const picked: RGB[] = [];
  const total = top.reduce((t, e) => t + e.n, 0) || 1;
  for (const e of top) {
    if (picked.length >= 3 || e.n / total < 0.06) break;
    const col: RGB = [e.r / e.n, e.g / e.n, e.b / e.n];
    if (picked.every((p) => Math.hypot(p[0] - col[0], p[1] - col[1], p[2] - col[2]) > 60)) picked.push(col);
  }
  return picked.map((p) => '#' + p.map((v) => Math.round(v).toString(16).padStart(2, '0')).join(''));
}
