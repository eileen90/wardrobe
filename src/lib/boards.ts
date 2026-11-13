import { realSize } from './kind';
import { BOARD_RATIO, uid, type Category, type Item, type Look, type Placed } from './types';

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
export function boardScale(pieces: Placed[], items: Item[]): number {
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
export function addPiece(pieces: Placed[], items: Item[], item: Item, at?: { x: number; y: number }, scale?: number): Placed[] {
  const find = finder(items);
  const s = realSize(item);
  const cmW = pieces.length || !scale ? boardScale(pieces, items) : scale;
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

/**
 * Lay out a whole outfit on a fresh board, piece by piece in the order given (body first), then
 * fit it to the board. It is first laid out on a roomy board so nothing is squeezed while it is
 * being placed, then made as large as fits, but never larger than an empty board's scale.
 */
export function layOut(picks: Item[], items: Item[]): Placed[] {
  const size = (c: Category[]) => picks.filter((i) => c.includes(i.category)).map(realSize);
  const sum = (c: Category[]) => size(c).reduce((t, s) => t + s.h, 0);
  const widest = (c: Category[]) => Math.max(0, ...size(c).map((s) => s.w));
  const column = sum(['top', 'dress']) + sum(['bottom']) + Math.max(0, ...size(['shoes', 'socks']).map((s) => s.h));
  const across = widest(['top', 'dress', 'bottom']) + widest(['outer']) + widest(['bag', 'extra']) + widest(['socks']);
  const cmH = Math.max(EMPTY_CM, column * 1.5, (across * 1.5) / BOARD_RATIO, ...picks.map((p) => realSize(p).h * 1.5));
  let pieces: Placed[] = [];
  for (const it of picks) pieces = addPiece(pieces, items, it, undefined, cmH * BOARD_RATIO);
  return fitBoard(pieces, items, cmH / EMPTY_CM);
}
