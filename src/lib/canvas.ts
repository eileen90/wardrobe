/**
 * The geometry every canvas shares (the closet floor, the looks page, saved boards): boxes in
 * world units, a view onto them that pans and zooms, and framing everything in view.
 */

/** A piece in world units: its centre, size, tilt in degrees and stacking order. */
export interface Box { cx: number; cy: number; w: number; h: number; rot: number; z: number }
/** world → screen: screen = world * z + (x, y) */
export interface View { z: number; x: number; y: number }
export interface Rect { x0: number; y0: number; x1: number; y1: number }
export interface Insets { top: number; right: number; bottom: number; left: number }

export const MIN_Z = 0.08;
export const MAX_Z = 4;
export const clampZ = (z: number) => Math.min(MAX_Z, Math.max(MIN_Z, z));

export function bounds(boxes: Iterable<Pick<Box, 'cx' | 'cy' | 'w' | 'h'>>): Rect | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.cx - b.w / 2); x1 = Math.max(x1, b.cx + b.w / 2);
    y0 = Math.min(y0, b.cy - b.h / 2); y1 = Math.max(y1, b.cy + b.h / 2);
  }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
}

export const union = (a: Rect | null, b: Rect | null): Rect | null =>
  !a ? b : !b ? a : { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };

/**
 * The view that frames a rectangle inside the free part of the screen. Never closer than
 * `maxZ`; when that would make things smaller than `minZ`, it stays at `minZ` and shows the top left.
 */
export function frame(r: Rect, W: number, H: number, inset: Insets, maxZ = 1, minZ = MIN_Z): View {
  const aw = Math.max(40, W - inset.left - inset.right), ah = Math.max(40, H - inset.top - inset.bottom);
  const bw = Math.max(1, r.x1 - r.x0), bh = Math.max(1, r.y1 - r.y0);
  const fit = Math.min(maxZ, aw / bw, ah / bh);
  const z = clampZ(Math.max(minZ, fit));
  // Too much to show at once: start at the top left, where reading starts.
  if (fit < minZ) return { z, x: inset.left - r.x0 * z, y: inset.top - r.y0 * z };
  const x = inset.left + aw / 2 - ((r.x0 + r.x1) / 2) * z;
  const y = inset.top + ah / 2 - ((r.y0 + r.y1) / 2) * z;
  return { z, x, y };
}

/** Zoom by a factor around a screen point, which stays where it is. */
export function zoomAround(v: View, z1: number, sx: number, sy: number): View {
  const z = clampZ(z1);
  const wx = (sx - v.x) / v.z, wy = (sy - v.y) / v.z;
  return { z, x: sx - wx * z, y: sy - wy * z };
}

export const toWorld = (v: View, sx: number, sy: number) => ({ x: (sx - v.x) / v.z, y: (sy - v.y) / v.z });

/** Box edges grown by `pad`, as a rectangle. */
export const rectOf = (b: Pick<Box, 'cx' | 'cy' | 'w' | 'h'>, pad = 0): Rect =>
  ({ x0: b.cx - b.w / 2 - pad, y0: b.cy - b.h / 2 - pad, x1: b.cx + b.w / 2 + pad, y1: b.cy + b.h / 2 + pad });
export const hits = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/**
 * Reading order of boxes laid out loosely in rows: top to bottom, and left to right within a
 * row. A box joins a row when its middle is level with the row's first box.
 */
export function readingOrder<T extends { cx: number; cy: number; h: number }>(list: T[]): T[] {
  const byTop = [...list].sort((a, b) => a.cy - a.h / 2 - (b.cy - b.h / 2));
  const rows: T[][] = [];
  for (const b of byTop) {
    const row = rows[rows.length - 1];
    const head = row?.[0];
    if (head && b.cy < head.cy + head.h / 2) row.push(b);
    else rows.push([b]);
  }
  return rows.flatMap((r) => r.sort((a, b) => a.cx - b.cx));
}

/** Stable pseudo-random numbers from an id, so a piece lies at the same slight angle every visit. */
export function seeded(id: string, salt: number) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** A position between two neighbours in an ordering, for a piece put between them. */
export function between(before: number | undefined, after: number | undefined, fallback = 0) {
  if (before !== undefined && after !== undefined) return (before + after) / 2;
  if (before !== undefined) return before + 1;
  if (after !== undefined) return after - 1;
  return fallback;
}
