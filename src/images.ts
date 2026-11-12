// Canvas helpers: decoding, resizing, trimming cut-outs, colour extraction.

export async function loadImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } catch {
    throw new Error("That file isn't an image I can open.");
  } finally {
    // decode() has finished, so the bitmap is in memory.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export function makeCanvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}
const ctx2d = (c: HTMLCanvasElement) => c.getContext('2d', { willReadFrequently: true })!;

export function drawScaled(
  src: HTMLImageElement | HTMLCanvasElement,
  maxSide: number,
): HTMLCanvasElement {
  const sw = 'naturalWidth' in src ? src.naturalWidth : src.width;
  const sh = 'naturalHeight' in src ? src.naturalHeight : src.height;
  const k = Math.min(1, maxSide / Math.max(sw, sh));
  const c = makeCanvas(sw * k, sh * k);
  const ctx = ctx2d(c);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

export function toBlob(c: HTMLCanvasElement, type: string, q?: number): Promise<Blob> {
  return new Promise((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode image'))), type, q),
  );
}
/** WebP keeps transparency at a fraction of PNG's size; Safari falls back to PNG. */
export const alphaBlob = (c: HTMLCanvasElement) => toBlob(c, 'image/webp', 0.92);

/** True when the picture already has a transparent background. */
export function hasTransparency(c: HTMLCanvasElement): boolean {
  const { width: w, height: h } = c;
  const d = ctx2d(c).getImageData(0, 0, w, h).data;
  // Look at the border: a clean cut-out has (nearly) fully transparent edges.
  let clear = 0;
  let n = 0;
  const step = Math.max(1, Math.floor(Math.max(w, h) / 200));
  for (let x = 0; x < w; x += step) {
    n += 2;
    if (d[x * 4 + 3] < 16) clear++;
    if (d[((h - 1) * w + x) * 4 + 3] < 16) clear++;
  }
  for (let y = 0; y < h; y += step) {
    n += 2;
    if (d[y * w * 4 + 3] < 16) clear++;
    if (d[(y * w + w - 1) * 4 + 3] < 16) clear++;
  }
  return clear / n > 0.6;
}

/**
 * Tidy a cut-out: drop faint alpha haze, crop tight to the garment and
 * cap its size. Returns null if nothing meaningful is left.
 */
export function trimCutout(src: HTMLCanvasElement, maxSide = 1200): HTMLCanvasElement | null {
  const { width: w, height: h } = src;
  const ctx = ctx2d(src);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1, solid = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4 + 3;
      if (d[i] < 14) {
        d[i] = 0;
      } else if (d[i] > 40) {
        solid++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0 || solid / (w * h) < 0.004) return null;
  ctx.putImageData(img, 0, 0);
  const pad = 2;
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad);
  y1 = Math.min(h - 1, y1 + pad);
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;
  const k = Math.min(1, maxSide / Math.max(cw, ch));
  const out = makeCanvas(cw * k, ch * k);
  const o = ctx2d(out);
  o.imageSmoothingQuality = 'high';
  o.drawImage(src, x0, y0, cw, ch, 0, 0, out.width, out.height);
  return out;
}

/**
 * Fallback cleaner for pictures on a plain backdrop (most shop photos):
 * flood-fills the background colour in from the edges.
 */
export function floodRemove(src: HTMLCanvasElement): HTMLCanvasElement | null {
  const { width: w, height: h } = src;
  const out = makeCanvas(w, h);
  const ctx = ctx2d(out);
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  // Backdrop colour = average of the border; bail out if the border is busy.
  let r = 0, g = 0, b = 0, n = 0;
  const border: number[] = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) border.push(y * w, y * w + w - 1);
  for (const p of border) {
    r += d[p * 4]; g += d[p * 4 + 1]; b += d[p * 4 + 2]; n++;
  }
  r /= n; g /= n; b /= n;
  let off = 0;
  for (const p of border) {
    if (Math.abs(d[p * 4] - r) + Math.abs(d[p * 4 + 1] - g) + Math.abs(d[p * 4 + 2] - b) > 60) off++;
  }
  if (off / n > 0.15) return null;

  const TOL = 46;
  const dist = (p: number) =>
    Math.abs(d[p * 4] - r) + Math.abs(d[p * 4 + 1] - g) + Math.abs(d[p * 4 + 2] - b);
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let sp = 0;
  for (const p of border) {
    if (!seen[p] && dist(p) < TOL) {
      seen[p] = 1;
      stack[sp++] = p;
    }
  }
  while (sp) {
    const p = stack[--sp];
    d[p * 4 + 3] = 0;
    const x = p % w;
    const y = (p - x) / w;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (y > 0) push(p - w);
    if (y < h - 1) push(p + w);
  }
  function push(q: number) {
    if (seen[q]) return;
    seen[q] = 1;
    const dq = dist(q);
    if (dq < TOL) stack[sp++] = q;
    else if (dq < TOL * 2) d[q * 4 + 3] = Math.round(255 * (dq - TOL) / TOL); // soft edge
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

/** Up to three dominant colours of the visible pixels, as hex. */
export function dominantColors(c: HTMLCanvasElement): string[] {
  const s = drawScaled(c, 64);
  const d = ctx2d(s).getImageData(0, 0, s.width, s.height).data;
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 200) continue;
    const key = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
    const e = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++; e.r += d[i]; e.g += d[i + 1]; e.b += d[i + 2];
    buckets.set(key, e);
  }
  const sorted = [...buckets.values()].sort((a, b) => b.n - a.n);
  const total = sorted.reduce((a, e) => a + e.n, 0) || 1;
  const picked: number[][] = [];
  for (const e of sorted) {
    if (picked.length && e.n / total < 0.04) break;
    const rgb = [e.r / e.n, e.g / e.n, e.b / e.n];
    if (picked.every((p) => Math.hypot(p[0] - rgb[0], p[1] - rgb[1], p[2] - rgb[2]) > 60)) {
      picked.push(rgb);
      if (picked.length === 3) break;
    }
  }
  return picked.map(
    (p) => '#' + p.map((v) => Math.round(v).toString(16).padStart(2, '0')).join(''),
  );
}

/** Small alpha map used to tell whether a tap landed on the garment itself. */
const masks = new Map<string, { w: number; h: number; a: Uint8ClampedArray } | null>();
export async function alphaMask(cacheKey: string, url: string) {
  if (masks.has(cacheKey)) return masks.get(cacheKey)!;
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = drawScaled(img, 96);
    const d = ctx2d(c).getImageData(0, 0, c.width, c.height).data;
    const a = new Uint8ClampedArray(c.width * c.height);
    for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3];
    const m = { w: c.width, h: c.height, a };
    masks.set(cacheKey, m);
    return m;
  } catch {
    masks.set(cacheKey, null);
    return null;
  }
}
export const peekMask = (cacheKey: string) => masks.get(cacheKey) ?? null;
