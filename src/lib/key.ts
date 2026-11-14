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
  /**
   * Plain light backdrops only: share of the kept piece that looks just like the backdrop,
   * where only a faint outline told them apart. High for a white sneaker on white.
   */
  doubt: number;
  /**
   * Chroma keys only: share of the piece whose colour is close to the backdrop's, which the key
   * would have eaten into had it gone by colour alone. High means the backdrop was a poor choice.
   */
  inside: number;
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
  if (b.spread < 34) return true;
  // A light studio backdrop that darkens towards a floor shadow or a corner still counts,
  // as long as it is neutral, light and smooth (a sheet, a carpet or a table is not).
  if (isSaturated(b.color) || (b.color[0] + b.color[1] + b.color[2]) / 3 < 150) return false;
  const s = smooth(d);
  const pl = readPlain(d, s, steps(s, d.width, d.height), b.color);
  return pl.tint < 10 && pl.step < 8;
}

/* ---------- alpha from the backdrop colour ---------- */

/**
 * How much each pixel is garment (255) rather than backdrop (0), for a saturated backdrop.
 *
 * Two tests, and a pixel is backdrop if either says so:
 *  - it lies on the backdrop's colour *line* (same colour, any brightness), which catches
 *    the soft shadows a garment throws on the backdrop;
 *  - it has the backdrop's *hue* and is clearly coloured, which catches backdrops that
 *    come back unevenly lit, with a paler or deeper patch.
 * The backdrop hue is chosen to be one the garment doesn't contain, so neither test bites into it.
 */
function chromaAlpha(d: ImageData, k: RGB): Uint8ClampedArray {
  const { width: w, height: h, data } = d;
  const kl = Math.hypot(k[0], k[1], k[2]) || 1;
  const kn = [k[0] / kl, k[1] / kl, k[2] / kl];
  const kh = hueOf(k[0], k[1], k[2]).h;
  const kc = Math.max(...k) - Math.min(...k);
  const out = new Uint8ClampedArray(w * h);
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    // colour line
    const lum = r * kn[0] + g * kn[1] + b * kn[2];
    const resid = Math.hypot(r - lum * kn[0], g - lum * kn[1], b - lum * kn[2]);
    let a = (resid / (lum + 20) - 0.1) / 0.18;
    // Very dark pixels are garment, never backdrop shadow.
    const dark = (0.3 * kl - lum) / (0.12 * kl);
    if (dark > a) a = dark;
    // hue
    const mx = Math.max(r, g, b);
    if (a > 0 && mx > 60) {
      const px = hueOf(r, g, b);
      const off = Math.abs(((px.h - kh + 540) % 360) - 180);
      const hueMatch = (38 - off) / 16;          // 1 within 22 degrees, 0 beyond 38
      // How coloured, as a share of the backdrop's own colourfulness. Not HSV saturation:
      // that is high for any dark pixel with a faint tint, and a black bag lit a little blue
      // by the backdrop used to come out mottled and see-through.
      const coloured = ((mx - Math.min(r, g, b)) / kc - 0.3) / 0.25; // 1 above 55% of the backdrop's, 0 below 30%
      const keyness = Math.min(1, Math.max(0, hueMatch)) * Math.min(1, Math.max(0, coloured));
      if (1 - keyness < a) a = 1 - keyness;
    }
    out[p] = a <= 0 ? 0 : a >= 1 ? 255 : a * 255;
  }
  return out;
}

/** Sum of a 0/1 mask over a (2r+1)² square around every pixel, by integral image. */
function boxCount(m: Uint8Array, w: number, h: number, r: number): Int32Array {
  const I = new Int32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += m[y * w + x];
      I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row;
    }
  }
  const out = new Int32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      out[y * w + x] = I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];
    }
  }
  return out;
}

/**
 * Only backdrop takes the key. A pixel of the backdrop's colour inside the piece (the blue of
 * a blue-and-white striped shirt, a sheen in a crease) is part of the piece: the key judged by
 * colour alone made such shirts see-through and grey, with speckles all down the stripes.
 * Backdrop is what is wide open: reached from the frame's edge, or a large enclosed gap (inside
 * a bag's handle, between an arm and the body), through stretches of backdrop at least 9 px
 * across, which a stripe, a seam or a crease never is. Near that backdrop the soft edge stays as
 * keyed; everywhere else the piece is solid, unless a pixel is the backdrop's exact flat colour.
 * Returns the share of the piece that the colour key alone would have eaten into.
 */
function onlyBackdrop(a: Uint8ClampedArray, d: ImageData, k: RGB): number {
  const { width: w, height: h, data } = d;
  const n = w * h;
  const R = Math.max(3, Math.round(Math.min(w, h) / 300));
  const bg = new Uint8Array(n);
  for (let p = 0; p < n; p++) bg[p] = a[p] < 64 ? 1 : 0;
  // Opening: wide-open backdrop only.
  const full = (2 * R + 1) ** 2;
  const c1 = boxCount(bg, w, h, R);
  const core = new Uint8Array(n);
  for (let p = 0; p < n; p++) core[p] = c1[p] === full ? 1 : 0;
  const c2 = boxCount(core, w, h, R);
  const open = new Uint8Array(n);
  for (let p = 0; p < n; p++) open[p] = c2[p] > 0 && bg[p] ? 1 : 0;
  // Its pieces that touch the frame or are big enough to be a real gap.
  const keep = new Uint8Array(n);
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  const comp = new Int32Array(n);
  for (let s0 = 0; s0 < n; s0++) {
    if (!open[s0] || seen[s0]) continue;
    let len = 0, t = 0, edge = false;
    stack[t++] = s0; seen[s0] = 1;
    while (t) {
      const p = stack[--t];
      comp[len++] = p;
      const x = p % w;
      if (x === 0 || x === w - 1 || p < w || p >= n - w) edge = true;
      if (x > 0 && open[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack[t++] = p - 1; }
      if (x < w - 1 && open[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack[t++] = p + 1; }
      if (p >= w && open[p - w] && !seen[p - w]) { seen[p - w] = 1; stack[t++] = p - w; }
      if (p < n - w && open[p + w] && !seen[p + w]) { seen[p + w] = 1; stack[t++] = p + w; }
    }
    if (edge || len > n * 0.0015) for (let i = 0; i < len; i++) keep[comp[i]] = 1;
  }
  // The soft edge next to it keeps its key.
  const near = boxCount(keep, w, h, R + 2);
  let piece = 0, eaten = 0;
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    if (near[p] > 0) continue;
    piece++;
    if (a[p] === 255) continue;
    const flat = Math.abs(data[i] - k[0]) + Math.abs(data[i + 1] - k[1]) + Math.abs(data[i + 2] - k[2]) < 40;
    if (flat) continue;
    if (a[p] < 200) eaten++;
    a[p] = 255;
  }
  return piece ? eaten / piece : 0;
}

/**
 * What a light backdrop looks like close up: its colour, how far its tint and brightness
 * wander, and how big a step between neighbouring pixels is still just noise or a soft
 * gradient rather than the outline of something lying on it.
 */
interface Plain { k: RGB; tint: number; step: number; light: number }

/** Smoothed copy (3×3 box), so JPEG noise and fabric grain don't read as outlines. */
function smooth(d: ImageData): Float32Array {
  const { width: w, height: h, data } = d;
  const out = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, c = 0;
      for (let yy = Math.max(0, y - 1); yy <= Math.min(h - 1, y + 1); yy++) {
        for (let xx = Math.max(0, x - 1); xx <= Math.min(w - 1, x + 1); xx++) {
          const i = (yy * w + xx) * 4;
          r += data[i]; g += data[i + 1]; b += data[i + 2]; c++;
        }
      }
      const o = (y * w + x) * 3;
      out[o] = r / c; out[o + 1] = g / c; out[o + 2] = b / c;
    }
  }
  return out;
}

/** Largest colour step from each pixel to a neighbour two pixels away, on the smoothed copy. */
function steps(s: Float32Array, w: number, h: number): Float32Array {
  const e = new Float32Array(w * h);
  const at = (p: number, q: number) =>
    Math.abs(s[p * 3] - s[q * 3]) + Math.abs(s[p * 3 + 1] - s[q * 3 + 1]) + Math.abs(s[p * 3 + 2] - s[q * 3 + 2]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      let m = 0;
      if (x > 1) m = Math.max(m, at(p, p - 2));
      if (x < w - 2) m = Math.max(m, at(p, p + 2));
      if (y > 1) m = Math.max(m, at(p, p - 2 * w));
      if (y < h - 2) m = Math.max(m, at(p, p + 2 * w));
      e[p] = m;
    }
  }
  return e;
}

const pct = (v: number[], q: number) => (v.sort((a, b) => a - b), v[Math.min(v.length - 1, Math.floor(v.length * q))] ?? 0);
const tintOf = (r: number, g: number, b: number, k: RGB) => {
  const m = (r + g + b) / 3, km = (k[0] + k[1] + k[2]) / 3;
  return Math.hypot(r - m - (k[0] - km), g - m - (k[1] - km), b - m - (k[2] - km));
};

/** Read the backdrop from the outer band of the frame. */
function readPlain(d: ImageData, s: Float32Array, e: Float32Array, k: RGB): Plain {
  const { width: w, height: h } = d;
  const band = Math.max(3, Math.round(Math.min(w, h) * 0.03));
  const tints: number[] = [], stepsSeen: number[] = [], lights: number[] = [];
  const by = Math.max(1, Math.round(Math.min(w, h) / 220));
  for (let y = 0; y < h; y += by) {
    for (let x = 0; x < w; x += by) {
      if (x >= band && x < w - band && y >= band && y < h - band) continue;
      const p = y * w + x;
      tints.push(tintOf(s[p * 3], s[p * 3 + 1], s[p * 3 + 2], k));
      stepsSeen.push(e[p]);
      lights.push((s[p * 3] + s[p * 3 + 1] + s[p * 3 + 2]) / 3);
    }
  }
  return { k, tint: pct(tints, 0.9), step: pct(stepsSeen, 0.9), light: pct(lights, 0.5) };
}

/**
 * Plain light backdrop (white, grey, a soft studio gradient with a floor shadow): the backdrop
 * is grown in from the frame edges, through pixels that have the backdrop's tint (any
 * brightness, so soft shadows go too) and only across soft steps, never across an outline.
 * Comparing tint rather than plain colour distance is what keeps a cream sweater on white:
 * it is barely darker than the backdrop but clearly warmer.
 */
function floodAlpha(d: ImageData, k: RGB): { alpha: Uint8ClampedArray; doubt: number } {
  const { width: w, height: h, data } = d;
  const n = w * h;
  const s = smooth(d);
  const e = steps(s, w, h);
  const pl = readPlain(d, s, e, k);
  const kl = (k[0] + k[1] + k[2]) / 3;
  const tintMax = Math.min(16, 5 + pl.tint * 1.3);
  const stepMax = Math.min(22, Math.max(4, pl.step * 2 + 2));
  const tint = new Float32Array(n);
  const lit = new Float32Array(n);
  for (let p = 0; p < n; p++) {
    tint[p] = tintOf(s[p * 3], s[p * 3 + 1], s[p * 3 + 2], k);
    lit[p] = (s[p * 3] + s[p * 3 + 1] + s[p * 3 + 2]) / 3 - kl;
  }
  // Shadows may be much darker than the backdrop; lighter is allowed only as far as the band itself wanders.
  const ok = (p: number) => tint[p] < tintMax && e[p] < stepMax && lit[p] > -90 && lit[p] < 18;

  const out = new Uint8ClampedArray(n).fill(255);
  const stack = new Int32Array(n);
  let top = 0;
  const push = (p: number) => {
    if (!out[p] || !ok(p)) return;
    out[p] = 0;
    stack[top++] = p;
  };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (top) {
    const p = stack[--top];
    const x = p % w;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (p >= w) push(p - w);
    if (p < n - w) push(p + w);
  }

  // Backdrop showing through a loop (a bag's handle, the gap under a strap) can't be reached
  // from the edge. Large, flat patches of exactly the backdrop colour go too.
  const seen = new Uint8Array(n);
  const same = (p: number) => out[p] && tint[p] < tintMax * 0.7 && Math.abs(lit[p]) < 5 && e[p] < stepMax * 0.7;
  const comp = new Int32Array(n);
  for (let s0 = 0; s0 < n; s0++) {
    if (seen[s0] || !same(s0)) continue;
    let len = 0, t = 0;
    stack[t++] = s0;
    seen[s0] = 1;
    while (t) {
      const p = stack[--t];
      comp[len++] = p;
      const x = p % w;
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p >= w ? p - w : -1, p < n - w ? p + w : -1];
      for (const q of nb) if (q >= 0 && !seen[q] && same(q)) { seen[q] = 1; stack[t++] = q; }
    }
    if (len > n * 0.002) for (let i = 0; i < len; i++) out[comp[i]] = 0;
  }

  // The outline stops the fill a pixel or two short, on pixels that are part backdrop. Those
  // get an alpha by how far they are from the backdrop colour, and the backdrop is taken back
  // out of their colour, so a dark strap has no white halo.
  let ring = new Uint8Array(n);
  for (let pass = 0; pass < 3; pass++) {
    const next = new Uint8Array(ring);
    for (let p = 0; p < n; p++) {
      if (!out[p] || ring[p]) continue;
      const x = p % w;
      const near = (q: number) => !out[q] || ring[q];
      if ((x > 0 && near(p - 1)) || (x < w - 1 && near(p + 1)) || (p >= w && near(p - w)) || (p < n - w && near(p + w))) next[p] = 1;
    }
    ring = next;
  }
  for (let p = 0; p < n; p++) {
    if (!ring[p]) continue;
    const i = p * 4;
    const dd = Math.hypot(data[i] - k[0], data[i + 1] - k[1], data[i + 2] - k[2]);
    let al = Math.min(1, Math.max(0, (dd - 4) / 56));
    // Better: how far the pixel lies from the backdrop towards the solid garment just inside it
    // (a blend of light backdrop and dark denim is mostly backdrop, though far from it in colour).
    const x = p % w, y = (p - x) / w;
    let f = -1;
    for (let r = 2; r <= 5 && f < 0; r++) {
      for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const q = yy * w + xx;
        if (out[q] === 255 && !ring[q]) { f = q; break; }
      }
    }
    if (f >= 0) {
      const j = f * 4;
      const fk = [data[j] - k[0], data[j + 1] - k[1], data[j + 2] - k[2]];
      const fl = fk[0] ** 2 + fk[1] ** 2 + fk[2] ** 2;
      if (fl > 900) {
        const t = ((data[i] - k[0]) * fk[0] + (data[i + 1] - k[1]) * fk[1] + (data[i + 2] - k[2]) * fk[2]) / fl;
        al = Math.min(1, Math.max(0, t));
      }
    }
    out[p] = al * 255;
    if (al > 0.05 && al < 1) for (let c = 0; c < 3; c++) data[i + c] = (data[i + c] - (1 - al) * k[c]) / al;
  }
  // How much of what was kept looks just like the backdrop (a white sneaker on white): there the
  // outline alone decided, and a faint outline lets the fill bite into the piece.
  let kept = 0, alike = 0;
  for (let p = 0; p < n; p++) {
    if (out[p] < 255) continue;
    kept++;
    if (tint[p] < tintMax && Math.abs(lit[p]) < 12) alike++;
  }
  return { alpha: out, doubt: kept ? alike / kept : 1 };
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

/**
 * Share of the solid piece that has the backdrop's hue in its mid and light tones. Reflected
 * backdrop light shows in the dark tones (the underside of a black bag); a backdrop's hue in
 * the light tones is the piece's own colour (a pale blue shirt that a warm photo showed grey).
 */
function hueShare(d: ImageData, a: Uint8ClampedArray, k: RGB) {
  const data = d.data;
  const kh = hueOf(k[0], k[1], k[2]).h;
  let solid = 0, like = 0;
  for (let p = 0, i = 0; p < a.length; p += 3, i += 12) {
    if (a[p] < 250) continue;
    solid++;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if ((r + g + b) / 3 < 100 || Math.max(r, g, b) - Math.min(r, g, b) < 20) continue;
    if (Math.abs(((hueOf(r, g, b).h - kh + 540) % 360) - 180) < 40) like++;
  }
  return solid ? like / solid : 0;
}

/** Remove the backdrop's tint from the pixels along the edge. */
function despill(d: ImageData, a: Uint8ClampedArray, k: RGB, whole: boolean) {
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
  // Over the whole piece: the image model lights it with its backdrop, so the underside of a
  // dark bag turns blue or purple. When the photo has none of the backdrop's colour, any of it
  // on the piece is reflected light: take out the part of each pixel that is the backdrop's
  // own colour beyond the other channels (blue above the mean of red and green, for a blue
  // backdrop; magenta's red-and-blue above green). Neutrals and the piece's own hues stay.
  if (whole) {
    const km = (k[0] + k[1] + k[2]) / 3;
    const on = [0, 1, 2].filter((c) => k[c] > km);
    const off = [0, 1, 2].filter((c) => k[c] <= km);
    // The bounce has the backdrop's own mix: cobalt is mostly blue but some green, so a little
    // green comes off too, or black leather turns teal.
    const kmin = Math.min(...k), kmax = Math.max(...k);
    const mix = [0, 1, 2].map((c) => (k[c] - kmin) / (kmax - kmin || 1));
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      if (!a[p]) continue;
      let hi = 255, lo = 0;
      for (const c of on) hi = Math.min(hi, data[i + c]);
      for (const c of off) lo += data[i + c] / off.length;
      // Only in the darker tones, where the bounce shows: a pale blue shirt that read as grey
      // in a warmly lit photo is still pale blue.
      const l = (data[i] + data[i + 1] + data[i + 2]) / 3;
      // Whites and pale greys pick up a faint tint of the backdrop too (white stripes turned
      // pink on magenta): near-neutral light pixels lose the backdrop's direction of colour.
      const ch = Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]);
      if (l > 150 && ch < 22) {
        const s = (data[i] - l) * cn[0] + (data[i + 1] - l) * cn[1] + (data[i + 2] - l) * cn[2];
        if (s > 0) for (let c = 0; c < 3; c++) data[i + c] -= cn[c] * s;
        continue;
      }
      const e = (hi - lo - 2) * Math.min(1, Math.max(0, (170 - l) / 80));
      if (e <= 0) continue;
      for (let c = 0; c < 3; c++) data[i + c] -= e * mix[c];
    }
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
 * `noSpill`: the piece is known to have none of the backdrop's colour (see `rankBackdrops`),
 * so any of it on the piece is reflected light and is taken out everywhere, not only at the edge.
 */
export function cutOut(src: HTMLCanvasElement, noSpill = false): Cut | null {
  const w = src.width, h = src.height;
  const ctx = src.getContext('2d', { willReadFrequently: true })!;
  const d = ctx.getImageData(0, 0, w, h);
  const k = border(d).color;
  const chroma = isSaturated(k);
  const flood = chroma ? null : floodAlpha(d, k);
  const a = flood ? flood.alpha : chromaAlpha(d, k);
  const inside = flood ? 0 : onlyBackdrop(a, d, k);
  keepMainShapes(a, w, h);
  refineEdge(a, w, h);
  // Reflected backdrop light is taken out of the whole piece only when the piece really has none
  // of that colour: neither the photo (judged white-balanced, see `rankBackdrops`) nor the remake.
  if (chroma) despill(d, a, k, noSpill && hueShare(d, a, k) < 0.05);

  let solid = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const al = a[y * w + x];
      d.data[(y * w + x) * 4 + 3] = al;
      if (al > 127) solid++;
      // Faint pixels (a wisp of shadow, a soft fringe) don't stretch the frame: a stray one far
      // off would shrink the piece wherever it is shown at its real size.
      if (al > 64) {
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
  return { canvas: out, cover, doubt: flood?.doubt ?? 0, inside };
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
      if (d[(y * w + x) * 4 + 3] > 64) {
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
export function rankBackdrops(photo: HTMLCanvasElement): (Backdrop & { share: number })[] {
  const s = makeCanvas(96, 96);
  const ctx = s.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(photo, 0, 0, 96, 96);
  const img = ctx.getImageData(0, 0, 96, 96);
  const d = img.data;
  // Judge colours as they are, not as the room light makes them: under a warm lamp a pale blue
  // shirt reads grey or even pink, so the cobalt backdrop was chosen for blue shirts, and the key
  // took the blue out. A light wall or sheet around the piece shows the light's colour.
  const wall = border(img).color;
  const wm = (wall[0] + wall[1] + wall[2]) / 3;
  if (wm > 110 && Math.max(...wall) - Math.min(...wall) < 90) {
    const g = wall.map((v) => Math.min(1.6, Math.max(0.6, wm / Math.max(1, v))));
    for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) d[i + c] = d[i + c] * g[c];
  }
  const mass = BACKDROPS.map(() => 0);
  const seen = BACKDROPS.map(() => 0);
  let total = 0;
  for (let y = 10; y < 86; y++) {
    for (let x = 10; x < 86; x++) {
      const i = (y * 96 + x) * 4;
      const { h, v } = hueOf(d[i], d[i + 1], d[i + 2]);
      // Absolute colourfulness, not HSV saturation: a pale blue shirt counts as blue, and the
      // faint tint of a dark pixel counts for little.
      const c = Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
      total++;
      if (c < 12 || v < 0.08) continue;
      BACKDROPS.forEach((b, bi) => {
        const diff = Math.abs(((h - b.hue + 540) % 360) - 180);
        if (diff < 48) {
          mass[bi] += c / 160;
          if (c >= 20) seen[bi]++;
        }
      });
    }
  }
  return BACKDROPS.map((b, i) => ({ b, m: mass[i] / total, i }))
    // 4% steps: a touch of a colour (a blue label, a cool shadow) does not move the backdrop; the
    // key only takes backdrop it can reach (see `onlyBackdrop`), so a little of it on the piece is safe.
    .sort((p, q) => Math.round(p.m / 0.04) - Math.round(q.m / 0.04) || p.i - q.i)
    // share: how much of the photo has even a tinge of this colour (see `cutOut`'s noSpill)
    .map((x) => ({ ...x.b, share: seen[x.i] / total }));
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

/**
 * How far the remake's colour has drifted from the photo's, as a hue angle in degrees (0 when
 * either is too grey for its hue to mean anything). The photo is judged white-balanced by the
 * wall or sheet around it, and only its middle, where the piece hangs, counts.
 */
export function drift(photo: HTMLCanvasElement, cut: HTMLCanvasElement): number {
  const mean = (c: HTMLCanvasElement, middle: boolean): RGB | null => {
    const N = 64;
    const s = makeCanvas(N, N);
    const ctx = s.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(c, 0, 0, N, N);
    const img = ctx.getImageData(0, 0, N, N);
    const d = img.data;
    let g = [1, 1, 1];
    if (middle) {
      const wall = border(img).color;
      const wm = (wall[0] + wall[1] + wall[2]) / 3;
      if (wm > 110 && Math.max(...wall) - Math.min(...wall) < 90) g = wall.map((v) => Math.min(1.6, Math.max(0.6, wm / Math.max(1, v))));
    }
    const m = [0, 0, 0];
    let n = 0;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        if (middle && (x < N * 0.35 || x > N * 0.65 || y < N * 0.35 || y > N * 0.65)) continue;
        const i = (y * N + x) * 4;
        if (d[i + 3] < 250) continue;
        for (let k = 0; k < 3; k++) m[k] += d[i + k] * g[k];
        n++;
      }
    }
    return n ? [m[0] / n, m[1] / n, m[2] / n] : null;
  };
  const a = mean(photo, true), b = mean(cut, false);
  if (!a || !b) return 0;
  const ca = Math.max(...a) - Math.min(...a), cb = Math.max(...b) - Math.min(...b);
  if (ca < 18 || cb < 18) return 0;
  const ha = hueOf(a[0], a[1], a[2]).h, hb = hueOf(b[0], b[1], b[2]).h;
  return Math.abs(((ha - hb + 540) % 360) - 180);
}
