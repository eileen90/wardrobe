import { realSize } from './kind';
import { BOARD_RATIO, uid, type Category, type Item, type Look, type Placed } from './types';

/* ---------- boards as canvases ---------- */

/** A board in world units on a canvas: the paper is BW × BH, at the origin. */
export const BW = 800;
export const BH = BW / BOARD_RATIO;

/** A placed piece as a box on the canvas (the stacking order is its place in the list). */
export function boxOnBoard(p: Placed, item: Item, z: number) {
  const w = p.w * BW;
  return { cx: p.x * BW, cy: p.y * BH, w, h: w / (item.aspect || 1), rot: p.rot, z };
}

/* ---------- the outfit on the looks page: a flat lay at one real scale ---------- */

/** Centimetres across the board's width; the looks page draws everything at this one scale. */
export const LOOK_CM = 160;
const LOOK_CM_H = LOOK_CM / BOARD_RATIO;

/** Stacking from the floor up: a coat under the body, the top over the waistband. */
export const LAYER = ['outer', 'bottom', 'top', 'socks', 'shoes', 'bag', 'extra'];

/**
 * Lay an outfit out like a flat lay, every piece at its true size: the top hangs from the
 * shoulders over the waistband, the shoes lie under the hem, a coat lies beside the body,
 * aligned to the shoulders and overlapping it a little, a bag and an accessory on the other side.
 * Returns placements (centred on the board) by rail, in stacking order.
 */
export function flatLay(picks: { rail: string; item: Item }[]): { rail: string; x: number; y: number; w: number }[] {
  const by = (r: string) => picks.find((p) => p.rail === r)?.item;
  const size = (i?: Item) => (i ? realSize(i) : null);
  const top = by('top'), bottom = by('bottom'), outer = by('outer');
  const isDress = top?.category === 'dress';
  const T = size(top), B = isDress ? null : size(bottom), O = size(outer);
  const S = size(by('shoes')), K = size(by('socks')), E = size(by('extra')), G = size(by('bag'));
  const cm = new Map<string, { cx: number; cy: number; w: number; h: number }>();
  // The shoulders are at y = 0, the middle of the body at x = 0.
  if (T) cm.set('top', { cx: 0, cy: T.h / 2, w: T.w, h: T.h });
  const waist = T && !isDress ? Math.min(50, Math.max(34, T.h - 14)) : 0;
  if (B) cm.set('bottom', { cx: 0, cy: waist + B.h / 2, w: B.w, h: B.h });
  const hem = B ? waist + B.h : T ? T.h : 0;
  // The body's width: a top's sleeves spread wider than the body, so they count for less.
  const half = Math.max(T ? T.w * 0.42 : 0, B ? B.w / 2 : 0, 20);
  if (S) cm.set('shoes', { cx: K ? S.w * 0.25 : 0, cy: hem + 6 + S.h / 2, w: S.w, h: S.h });
  if (K) {
    const s = cm.get('shoes');
    cm.set('socks', s ? { cx: s.cx - s.w / 2 - 4 - K.w / 2, cy: hem + 6 + K.h / 2, w: K.w, h: K.h } : { cx: 0, cy: hem + 6 + K.h / 2, w: K.w, h: K.h });
  }
  if (O) cm.set('outer', { cx: -half + 6 - O.w / 2, cy: O.h / 2, w: O.w, h: O.h });
  if (E) cm.set('extra', { cx: half + 8 + E.w / 2, cy: E.h / 2, w: E.w, h: E.h });
  if (G) {
    const y0 = E ? Math.max(E.h + 8, waist - 6) : Math.max(0, waist - 6);
    cm.set('bag', { cx: half + 8 + G.w / 2, cy: y0 + G.h / 2, w: G.w, h: G.h });
  }
  // Centred on the board.
  const all = [...cm.values()];
  if (!all.length) return [];
  const x0 = Math.min(...all.map((b) => b.cx - b.w / 2)), x1 = Math.max(...all.map((b) => b.cx + b.w / 2));
  const y0 = Math.min(...all.map((b) => b.cy - b.h / 2)), y1 = Math.max(...all.map((b) => b.cy + b.h / 2));
  const ox = LOOK_CM / 2 - (x0 + x1) / 2, oy = LOOK_CM_H / 2 - (y0 + y1) / 2;
  return LAYER.flatMap((r) => {
    const b = cm.get(r);
    return b ? [{ rail: r, x: (b.cx + ox) / LOOK_CM, y: (b.cy + oy) / LOOK_CM_H, w: b.w / LOOK_CM }] : [];
  });
}

export function newLook(n: number, pieces: Placed[] = []): Look {
  return {
    id: uid(), name: `Look ${String(n + 1).padStart(2, '0')}`, createdAt: Date.now(), updatedAt: Date.now(),
    paper: '#ECECEC', pieces,
  };
}

/*
 * Every piece on a board shares one scale: so many real centimetres to the board's width. A
 * board with nothing on it stands for this many centimetres top to bottom, about one outfit
 * from collar to shoes.
 */
const EMPTY_CM = 190;
/** Room left free along each edge, as a fraction of the board. */
const EDGE = 0.035;

/** A piece's footprint on the board: centre and size, as fractions of the board's width and height. */
interface Box { x: number; y: number; w: number; h: number }

type Find = (id: string) => Item | undefined;
const finder = (items: Item[]): Find => {
  const m = new Map(items.map((i) => [i.id, i]));
  return (id) => m.get(id);
};

const boxOf = (p: Placed, item: Item): Box => ({ x: p.x, y: p.y, w: p.w, h: (p.w / item.aspect) * BOARD_RATIO });

/**
 * Centimetres to the board's width that the pieces already there use. Pieces may have been
 * resized by hand, so the middle one counts, not the average.
 */
function boardScale(pieces: Placed[], items: Item[]): number {
  const find = finder(items);
  const ks = pieces
    .map((p) => { const it = find(p.itemId); return it && p.w > 0 ? realSize(it).w / p.w : 0; })
    .filter((k) => k > 0 && Number.isFinite(k))
    .sort((a, b) => a - b);
  return ks.length ? ks[Math.floor(ks.length / 2)] : EMPTY_CM * BOARD_RATIO;
}

/** How wide a piece would be on this board, as a fraction of its width. */
export function widthOn(item: Item, pieces: Placed[], items: Item[]): number {
  return realSize(item).w / boardScale(pieces, items);
}

/* ---------- where a new piece goes ---------- */

const CATS: Category[] = ['outer', 'top', 'dress', 'bottom', 'socks', 'shoes', 'bag', 'extra'];

const overlap = (a: Box, b: Box) => {
  // Cut-outs have empty corners, so the boxes are trimmed a little before they count as touching.
  const t = 0.05;
  const ox = Math.min(a.x + a.w * (0.5 - t), b.x + b.w * (0.5 - t)) - Math.max(a.x - a.w * (0.5 - t), b.x - b.w * (0.5 - t));
  const oy = Math.min(a.y + a.h * (0.5 - t), b.y + b.h * (0.5 - t)) - Math.max(a.y - a.h * (0.5 - t), b.y - b.h * (0.5 - t));
  return ox > 0 && oy > 0 ? ox * oy : 0;
};

/** The space taken by some kinds already on the board, or null when there are none. */
function span(on: { cat: Category; box: Box }[], cats: Category[]): Box | null {
  const bs = on.filter((o) => cats.includes(o.cat)).map((o) => o.box);
  if (!bs.length) return null;
  const l = Math.min(...bs.map((b) => b.x - b.w / 2)), r = Math.max(...bs.map((b) => b.x + b.w / 2));
  const t = Math.min(...bs.map((b) => b.y - b.h / 2)), u = Math.max(...bs.map((b) => b.y + b.h / 2));
  return { x: (l + r) / 2, y: (t + u) / 2, w: r - l, h: u - t };
}
const left = (b: Box) => b.x - b.w / 2, right = (b: Box) => b.x + b.w / 2;
const top = (b: Box) => b.y - b.h / 2, bottom = (b: Box) => b.y + b.h / 2;

/**
 * Where a piece of this kind would sit if the board were laid out like an outfit: the top over
 * the bottom, shoes and socks along the foot, a coat to one side, bag and accessory to the other.
 */
function anchor(cat: Category, w: number, h: number, on: { cat: Category; box: Box }[]) {
  const last = (c: Category[]) => [...on].reverse().find((o) => c.includes(o.cat))?.box ?? null;
  const tops = last(['top']), bottoms = last(['bottom']), shoes = last(['shoes']);
  const body = span(on, ['top', 'dress', 'bottom']);
  const lap = h * 0.04;
  switch (cat) {
    case 'top':
      return bottoms ? { x: bottoms.x, y: top(bottoms) - h / 2 + Math.min(lap, bottoms.h * 0.08) } : { x: 0.5, y: 0.3 };
    case 'dress':
      return { x: body?.x ?? 0.5, y: body ? top(body) + h / 2 : 0.42 };
    case 'bottom':
      return tops ? { x: tops.x, y: bottom(tops) + h / 2 - tops.h * 0.08 } : { x: 0.5, y: 0.6 };
    case 'shoes': {
      const legs = span(on, ['bottom', 'dress']);
      return legs ? { x: legs.x + legs.w * 0.35, y: bottom(legs) + h / 2 } : { x: 0.56, y: 1 - EDGE - h / 2 };
    }
    case 'socks':
      if (shoes) return { x: left(shoes) - w / 2, y: shoes.y };
      return body ? { x: body.x - body.w * 0.35, y: bottom(body) + h / 2 } : { x: 0.38, y: 1 - EDGE - h / 2 };
    case 'outer':
      return body ? { x: left(body) - w / 2 + w * 0.06, y: top(body) + h / 2 } : { x: 0.3, y: 0.4 };
    case 'bag':
      return body ? { x: right(body) + w / 2, y: body.y + body.h * 0.1 } : { x: 0.76, y: 0.6 };
    case 'extra':
      return body ? { x: right(body) + w / 2, y: top(body) + h / 2 } : { x: 0.76, y: 0.18 };
  }
}

/** Keep a centre where the whole piece stays on the board (or centred, if it is wider than the board). */
const inside = (v: number, size: number) => (size >= 1 - 2 * EDGE ? 0.5 : Math.min(1 - EDGE - size / 2, Math.max(EDGE + size / 2, v)));

/** The free spot nearest to where this kind belongs, avoiding the pieces already there. */
function spot(cat: Category, w: number, h: number, on: { cat: Category; box: Box }[]) {
  const a = anchor(cat, w, h, on);
  const want = { x: inside(a.x, w), y: inside(a.y, h) };
  let best = { ...want, hit: Infinity }, score = Infinity;
  const N = 48;
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const c = { x: inside(i / N, w), y: inside(j / N, h), w, h };
      let hit = 0;
      for (const o of on) hit += overlap(c, o.box);
      // Distance is measured in board heights both ways, so sideways and down weigh the same.
      const d = Math.hypot((c.x - want.x) / BOARD_RATIO, c.y - want.y);
      const s = (hit / (w * h)) * 3 + d;
      if (s < score) { score = s; best = { x: c.x, y: c.y, hit: hit / (w * h) }; }
    }
  }
  return best;
}

/** Shrink (or grow) everything on a board about its middle. */
function scaleAll(pieces: Placed[], k: number, cx = 0.5, cy = 0.5, tx = 0.5, ty = 0.5): Placed[] {
  return pieces.map((p) => ({ ...p, x: tx + (p.x - cx) * k, y: ty + (p.y - cy) * k, w: p.w * k }));
}

/**
 * Put a piece on a board: at the same scale as everything already there, in a free spot where
 * its kind belongs (or where it was dropped). If it is too big for the board at that scale, the
 * whole board shrinks so it fits. Returns the board's new pieces; the new one is last.
 */
export function addPiece(pieces: Placed[], items: Item[], item: Item, at?: { x: number; y: number }): Placed[] {
  const find = finder(items);
  const s = realSize(item);
  const cmW = boardScale(pieces, items);
  let w = s.w / cmW, h = (s.h / cmW) * BOARD_RATIO;
  let out = pieces;
  const k = Math.min(1, (1 - 2 * EDGE) / w, (1 - 2 * EDGE) / h);
  if (k < 1) {
    out = scaleAll(pieces, k);
    w *= k;
    h *= k;
  }
  const put = (all: Placed[], x: number, y: number, pw: number) => [...all, { id: uid(), itemId: item.id, x, y, w: pw, rot: 0, flip: false }];
  if (at) return put(out, inside(at.x, w), inside(at.y, h), w);
  // No free spot where it belongs: everything shrinks a little (together, so the scale stays
  // shared) until there is one, up to about two thirds of the size.
  let best: { all: Placed[]; x: number; y: number; w: number; hit: number } | null = null;
  for (let tries = 0; tries < 4; tries++) {
    const on = out.flatMap((p) => { const it = find(p.itemId); return it ? [{ cat: it.category, box: boxOf(p, it) }] : []; });
    const r = spot(item.category, w, h, on);
    if (!best || r.hit < best.hit - 0.03) best = { all: out, x: r.x, y: r.y, w, hit: r.hit };
    if (r.hit <= 0.06 || !on.length) break;
    const b = span(on, CATS);
    out = b ? scaleAll(out, 0.88, b.x, b.y, b.x, b.y) : out;
    w *= 0.88;
    h *= 0.88;
  }
  return put(best!.all, best!.x, best!.y, best!.w);
}

/** Fit everything on a board inside its edges, centred; it may grow by up to `grow` times. */
export function fitBoard(pieces: Placed[], items: Item[], grow = 1): Placed[] {
  const find = finder(items);
  const bs = pieces.flatMap((p) => { const it = find(p.itemId); return it ? [boxOf(p, it)] : []; });
  if (!bs.length) return pieces;
  const l = Math.min(...bs.map(left)), r = Math.max(...bs.map(right));
  const t = Math.min(...bs.map(top)), u = Math.max(...bs.map(bottom));
  const k = Math.min(grow, (1 - 2 * EDGE) / (r - l), (1 - 2 * EDGE) / (u - t));
  return scaleAll(pieces, k, (l + r) / 2, (t + u) / 2, 0.5, 0.5);
}

/* ---------- changing the pieces on a board ---------- */

/** What can be done to pieces lying on a canvas, besides moving and resizing them. */
export type PieceAction = 'remove' | 'forward' | 'backward' | 'flip' | 'duplicate';
export type Edit = PieceAction | 'move' | 'resize' | 'rotate' | 'transform';
export interface EditArg {
  dx?: number; dy?: number; k?: number; deg?: number;
  /** the point a group turns and grows about, in board units (BW × BH) */
  px?: number; py?: number;
}

const turn = (r: number) => { const a = ((r % 360) + 540) % 360 - 180; return Math.abs(a) < 0.01 ? 0 : a; };

/**
 * A look's pieces after a change. Shared by saved looks and the looks page, so moving,
 * resizing, turning, layering, flipping and removing mean the same everywhere.
 */
export function editPieces(pieces: Placed[], a: Edit, ids: string[], arg: EditArg = {}): Placed[] | null {
  const on = new Set(ids);
  switch (a) {
    case 'move':
      return pieces.map((p) => (on.has(p.id) ? { ...p, x: p.x + (arg.dx ?? 0) / BW, y: p.y + (arg.dy ?? 0) / BH, byHand: true } : p));
    case 'resize':
      return pieces.map((p) => (on.has(p.id) ? { ...p, w: Math.min(2, Math.max(0.03, p.w * (arg.k ?? 1))), byHand: true } : p));
    case 'rotate':
      return pieces.map((p) => (on.has(p.id) ? { ...p, rot: turn(p.rot + (arg.deg ?? 0)), byHand: true } : p));
    case 'transform': {
      // Grown and turned together about one point, as if they were glued to one sheet.
      const k = arg.k ?? 1, deg = arg.deg ?? 0, t = (deg * Math.PI) / 180;
      const c = Math.cos(t), sn = Math.sin(t);
      const px = arg.px ?? 0, py = arg.py ?? 0;
      return pieces.map((p) => {
        if (!on.has(p.id)) return p;
        const x = p.x * BW - px, y = p.y * BH - py;
        const w = Math.min(2, Math.max(0.03, p.w * k));
        const kk = w / p.w;
        return { ...p, x: (px + (x * c - y * sn) * kk) / BW, y: (py + (x * sn + y * c) * kk) / BH, w, rot: turn(p.rot + deg), byHand: true };
      });
    }
    case 'remove':
      return pieces.filter((p) => !on.has(p.id));
    case 'forward':
      return [...pieces.filter((p) => !on.has(p.id)), ...pieces.filter((p) => on.has(p.id))];
    case 'backward':
      return [...pieces.filter((p) => on.has(p.id)), ...pieces.filter((p) => !on.has(p.id))];
    case 'flip':
      return pieces.map((p) => (on.has(p.id) ? { ...p, flip: !p.flip } : p));
    case 'duplicate':
      return [...pieces, ...pieces.filter((p) => on.has(p.id)).map((p) => ({ ...p, id: uid(), x: p.x + 0.05, y: p.y + 0.04, byHand: true }))];
  }
}
/** What every change is called, in its toast and its undo, wherever it is made. */
export const LABELS: Record<Edit, string> = {
  move: 'Moved', resize: 'Resized', rotate: 'Turned', transform: 'Resized', remove: 'Removed', forward: 'Brought forward',
  backward: 'Sent back', flip: 'Flipped', duplicate: 'Copied',
};

/* ---------- the looks board: the outfit in the middle, every saved look around it ---------- */

/** How big a saved look's area is drawn, as a share of a full board, unless resized. */
export const AREA_S = 0.42;
const GAP = 70;
export const areaScale = (l: Pick<Look, 's'>) => l.s ?? AREA_S;

export interface Rect { x0: number; y0: number; x1: number; y1: number }
const meets = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** A saved look's area on the board, in board units. */
export function areaRect(l: Pick<Look, 's' | 'at'>): Rect {
  const s = areaScale(l), at = l.at ?? { x: 0, y: 0 };
  return { x0: at.x, y0: at.y, x1: at.x + BW * s, y1: at.y + BH * s };
}

/**
 * The nearest free place for a new area of scale `s`: beside the outfit first, then in rings
 * around it, never over the outfit or another area.
 */
export function freeSpot(taken: Rect[], outfit: Rect, s = AREA_S): { x: number; y: number } {
  const w = BW * s, h = BH * s;
  const cx = (outfit.x0 + outfit.x1) / 2, cy = (outfit.y0 + outfit.y1) / 2;
  const pad = { x0: outfit.x0 - GAP, y0: outfit.y0 - GAP, x1: outfit.x1 + GAP, y1: outfit.y1 + GAP };
  const sx = w + GAP, sy = h + GAP;
  const cells: { x: number; y: number; d: number }[] = [];
  const add = (x: number, y: number) => cells.push({ x, y, d: Math.hypot((x + w / 2 - cx) * 0.8, (y + h / 2 - cy) * 1.2) });
  // Columns just clear of the outfit on either side, rows lined up with its top...
  for (let j = -6; j <= 6; j++) for (let i = 0; i < 8; i++) { add(pad.x1 + i * sx, outfit.y0 + j * sy); add(pad.x0 - w - i * sx, outfit.y0 + j * sy); }
  // ...and rows under and over it.
  for (let j = 0; j < 5; j++) for (let i = -2; i <= 1; i++) { add(cx + i * sx + GAP / 2, pad.y1 + j * sy); add(cx + i * sx + GAP / 2, pad.y0 - h - j * sy); }
  cells.sort((a, b) => a.d - b.d);
  for (const c of cells) {
    const r = { x0: c.x - GAP / 3, y0: c.y - GAP / 3, x1: c.x + w + GAP / 3, y1: c.y + h + GAP / 3 };
    if (meets(r, pad) || taken.some((t) => meets(r, t))) continue;
    return { x: c.x, y: c.y };
  }
  const right = Math.max(outfit.x1, ...taken.map((t) => t.x1));
  return { x: right + GAP, y: outfit.y0 };
}

/** What a change is called; growing and turning together reads as a turn when nothing grew. */
export const labelOf = (a: Edit, arg: EditArg = {}) =>
  a === 'transform' && Math.abs((arg.k ?? 1) - 1) < 0.005 ? LABELS.rotate : LABELS[a];
